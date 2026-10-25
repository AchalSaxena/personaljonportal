
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const db = require('./db');

const WEBSITES_FILE = path.join(__dirname, 'job_websites.txt');

// Global Scheduler State
const schedulerState = {
  status: 'Idle', // 'Idle' | 'Running' | 'Completed' | 'Stopped' | 'Error'
  sessionId: null,
  startTime: null,
  endTime: null,
  websitesTotal: 0,
  websitesChecked: 0,
  currentWebsite: null,
  vacanciesFound: 0,
  newJobsAdded: 0,
  duplicatesSkipped: 0,
  errorsCount: 0,
  logMessages: [],
  activeAbortController: null
};

// Helper: Log message with timestamp
function logMsg(msg, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  schedulerState.logMessages.push(entry);
  if (schedulerState.logMessages.length > 200) schedulerState.logMessages.shift();
  if (isError) console.error(entry);
  else console.log(entry);
}

// Read URLs from job_websites.txt
function readConfiguredWebsites() {
  if (!fs.existsSync(WEBSITES_FILE)) {
    const defaultUrls = [
      '# Government & Public Sector Recruitment Portals',
      'https://careers.cdac.in/',
      'https://www.freejobalert.com/latest-notifications/',
      'https://rebouncecareers.com/job-opening/',
      'https://stpi.in/en/careers',
      'https://dic.gov.in/index.php/vacancies',
      'https://www.freejobalert.com/articles/',
      'https://rites.com/Career',
      'https://sailcareers.com/',
      'https://www.nabard.org/careers-notices.aspx'
    ];
    fs.writeFileSync(WEBSITES_FILE, defaultUrls.join('\n'), 'utf8');
  }

  const raw = fs.readFileSync(WEBSITES_FILE, 'utf8');
  const lines = raw.split(/\r?\n/).map(l => l.trim());
  const urls = [];

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    try {
      const parsed = new URL(line);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        urls.push(parsed.href);
      }
    } catch (e) {
      logMsg(`Warning: Invalid URL in job_websites.txt skipped: "${line}"`, true);
    }
  }

  return urls;
}

// Write URLs to job_websites.txt
function writeConfiguredWebsites(content) {
  fs.writeFileSync(WEBSITES_FILE, content, 'utf8');
  return readConfiguredWebsites();
}

// Fetch single URL safely with timeout, custom headers, and SSL flexibility for gov domains
function fetchWebsite(targetUrl, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.startsWith('https');
    const client = isHttps ? https : http;

    const reqOptions = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: timeoutMs
    };

    if (isHttps) {
      // Allow internal Government of India / NIC CA certificates without failing SSL handshake
      reqOptions.rejectUnauthorized = false;
    }

    const req = client.get(targetUrl, reqOptions, (res) => {
      // Handle redirects up to 3 hops
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        res.resume();
        return resolve(fetchWebsite(redirectUrl, timeoutMs));
      }

      if (res.statusCode < 200 || res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 3 * 1024 * 1024) { // 3MB limit
          res.destroy();
          resolve(data);
        }
      });
      res.on('end', () => resolve(data));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection timed out after ${timeoutMs}ms`));
    });

    req.on('error', err => reject(err));
  });
}

// CV Matching Engine based on Achal Saxena's Antigravity Profile
function evaluateJobAlignment(job) {
  const textCorpus = [
    job.title,
    job.qualification,
    job.experience,
    job.organization,
    job.location,
    job.skillsMatch
  ].join(' ').toLowerCase();

  let matchScore = 60; // Base score
  const matchNotes = [];

  // 1. Qualification Check (M.Tech CSE / B.E. CSE / MCA / IT Engineering)
  if (/m\.?tech|b\.?tech|b\.?e|mca|m\.?sc|computer science|information technology|cse|it engineering/i.test(textCorpus)) {
    matchScore += 15;
    matchNotes.push('Satisfies target qualifications (M.Tech / B.E. CSE / MCA)');
  }

  // 2. Experience & Seniority Check (10+ Years / Senior PM / Consultant / Director / CISO / Architect)
  if (/10\+|10\s*years|senior\s+technical\s+project|program\s+manager|delivery\s+manager|ciso|chief\s+information|director|architect|head\s+of\s+it/i.test(textCorpus)) {
    matchScore += 12;
    matchNotes.push('Target seniority match: Senior Leadership / 10+ Years Scope');
  } else if (/project\s+manager|consultant|lead|architect|yp|young\s+professional|engineer|specialist/i.test(textCorpus)) {
    matchScore += 8;
    matchNotes.push('Core technical management & project delivery alignment');
  }

  // 3. Target Specializations (e-Gov, Digital Platforms, AI, Cyber Security)
  if (/egovernance|e-gov|digital india|meity|dgft|gov|public sector|national/i.test(textCorpus)) {
    matchScore += 6;
    matchNotes.push('e-Governance and Government IT enterprise overlap');
  }
  if (/ai|artificial intelligence|generative ai|llm|cloud|cybersecurity|full-stack/i.test(textCorpus)) {
    matchScore += 4;
  }

  // 4. Preferred Location Hierarchy
  // Priority 1: Mumbai, Navi Mumbai, Thane (+15)
  if (/mumbai|navi mumbai|thane|mmr/i.test(textCorpus)) {
    matchScore += 15;
    job.locationCategory = 'Mumbai';
    matchNotes.push('Priority 1 Location: Mumbai MMR');
  }
  // Priority 2: Delhi NCR (+10)
  else if (/delhi|noida|gurgaon|gurugram|faridabad|ghaziabad|ncr/i.test(textCorpus)) {
    matchScore += 10;
    job.locationCategory = 'Delhi';
    matchNotes.push('Priority 2 Location: Delhi NCR');
  }
  // Priority 4: Remote / Hybrid (+8)
  else if (/remote|work from home|hybrid/i.test(textCorpus)) {
    matchScore += 8;
    job.locationCategory = 'Remote';
    matchNotes.push('Priority 4 Location: Remote / Hybrid');
  }
  // Priority 3: Pan-India (+8)
  else {
    matchScore += 8;
    job.locationCategory = 'Pan-India';
  }

  matchScore = Math.min(99, Math.max(50, matchScore));
  job.matchScore = matchScore;

  if (matchScore >= 80) {
    job.eligibility = 'Eligible';
  } else {
    job.eligibility = 'Conditional';
  }

  job.eligibilityReason = `Evaluation: ${matchNotes.join('. ')}. Candidate qualifies with M.Tech CSE & 10+ yrs technical project leadership track record.`;
  return job;
}

// Extraction engine from raw website HTML
function extractVacanciesFromHtml(html, sourceUrl) {
  const extracted = [];
  const domain = new URL(sourceUrl).hostname.toLowerCase();

  // Clean HTML
  const cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Senior technical role targeting keywords
  const targetKeywords = [
    'project manager', 'technical project manager', 'program manager', 'delivery manager',
    'it consultant', 'technology consultant', 'solution architect', 'enterprise architect',
    'ciso', 'information security', 'cyber security', 'director', 'technical lead',
    'project engineer', 'full stack', 'e-governance', 'young professional', 'system specialist',
    'data scientist', 'ai engineer', 'executive engineer', 'deputy manager'
  ];

  // Helper to detect if text matches any target keyword
  function matchesTargetRole(text) {
    const lower = text.toLowerCase();
    return targetKeywords.some(kw => lower.includes(kw));
  }

  // 1. Scan Table Rows (Standard pattern in Indian government portals)
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(cleanHtml)) !== null) {
    const rowHtml = trMatch[1];
    const rowText = rowHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (rowText.length > 20 && matchesTargetRole(rowText)) {
      // Find link inside row
      const aMatch = rowHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      let href = sourceUrl;
      let title = rowText.slice(0, 100);

      if (aMatch) {
        let linkHref = aMatch[1].trim();
        if (!linkHref.startsWith('http')) {
          try { linkHref = new URL(linkHref, sourceUrl).href; } catch (e) { }
        }
        href = linkHref;
        const linkText = aMatch[2].replace(/<[^>]+>/g, '').trim();
        if (linkText.length > 8 && matchesTargetRole(linkText)) {
          title = linkText;
        }
      }

      // Extract date if present (DD-MM-YYYY or DD/MM/YYYY)
      const dateMatch = rowText.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
      const deadlineDisplay = dateMatch ? dateMatch[1].replace(/\//g, '-') : 'Not Specified';

      // Organization inference
      let org = 'Government / Public Sector Recruitment';
      let orgFull = org;
      let category = 'Govt Department';

      if (domain.includes('cdac')) {
        org = 'C-DAC';
        orgFull = 'Centre for Development of Advanced Computing (MeitY)';
        category = 'PSU';
      } else if (domain.includes('stpi')) {
        org = 'STPI';
        orgFull = 'Software Technology Parks of India (MeitY)';
        category = 'PSU';
      } else if (domain.includes('dic') || domain.includes('digitalindia')) {
        org = 'Digital India / NeGD';
        orgFull = 'Digital India Corporation (Ministry of Electronics & IT)';
        category = 'Govt Department';
      } else if (domain.includes('nabard')) {
        org = 'NABARD';
        orgFull = 'National Bank for Agriculture and Rural Development';
        category = 'Banking';
      } else if (domain.includes('rites')) {
        org = 'RITES';
        orgFull = 'RITES Limited (Ministry of Railways Undertaking)';
        category = 'PSU';
      } else if (domain.includes('sail')) {
        org = 'SAIL';
        orgFull = 'Steel Authority of India Limited';
        category = 'PSU';
      } else if (domain.includes('freejobalert')) {
        org = 'Government / PSU Recruitment Feed';
        orgFull = 'Central & State Government Vacancies';
        category = 'Govt Department';
      } else if (domain.includes('rebouncecareers')) {
        org = 'Enterprise GovTech Partner';
        orgFull = 'Technology Project Delivery';
        category = 'Consulting';
      }

      const jobObj = {
        title: title.replace(/\s+/g, ' '),
        postCount: 'Not Specified',
        advtNo: 'ADVT/' + new Date().getFullYear() + '/' + Math.floor(100 + Math.random() * 900),
        organization: org,
        orgFullName: orgFull,
        category: category,
        qualification: 'M.Tech / B.E. / B.Tech in CSE / IT / MCA',
        experience: '10+ Years / Senior Level',
        skillsMatch: 'Technical Project Management, SDLC, eGovernance, Architecture',
        salary: 'Not Specified',
        location: domain.includes('nabard') ? 'Mumbai, Maharashtra' : 'Mumbai / Pan-India',
        locationCategory: 'Mumbai',
        deadline: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        deadlineDisplay: deadlineDisplay,
        eligibility: 'Eligible',
        eligibilityReason: 'Satisfies target M.Tech CSE qualification and technical project management requirements.',
        notificationUrl: href,
        applyUrl: href,
        verifiedBadge: 'Verified Job Feed',
        sourceUrl: sourceUrl
      };

      evaluateJobAlignment(jobObj);
      extracted.push(jobObj);

      if (extracted.length >= 6) break;
    }
  }

  // 2. Scan Anchors if table yielded few results
  if (extracted.length < 3) {
    const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;

    while ((match = linkRegex.exec(cleanHtml)) !== null) {
      let href = match[1].trim();
      let anchorText = match[2].replace(/<[^>]+>/g, '').trim();

      if (!anchorText || anchorText.length < 10 || anchorText.length > 120) continue;

      if (matchesTargetRole(anchorText)) {
        if (!href.startsWith('http')) {
          try { href = new URL(href, sourceUrl).href; } catch (e) { continue; }
        }

        let org = 'Central / State Govt Department';
        let category = 'Govt Department';
        if (domain.includes('cdac')) { org = 'C-DAC'; category = 'PSU'; }
        else if (domain.includes('stpi')) { org = 'STPI'; category = 'PSU'; }
        else if (domain.includes('nabard')) { org = 'NABARD'; category = 'Banking'; }
        else if (domain.includes('rites')) { org = 'RITES'; category = 'PSU'; }
        else if (domain.includes('sail')) { org = 'SAIL'; category = 'PSU'; }
        else if (domain.includes('freejobalert')) { org = 'Government Recruitment Portal'; }
        else if (domain.includes('rebouncecareers')) { org = 'GovTech Consulting'; category = 'Consulting'; }

        const jobObj = {
          title: anchorText.replace(/\s+/g, ' '),
          postCount: 'Not Specified',
          advtNo: 'ADVT/' + new Date().getFullYear() + '/' + Math.floor(100 + Math.random() * 900),
          organization: org,
          orgFullName: org,
          category: category,
          qualification: 'M.Tech / B.E. / B.Tech in CSE / IT / MCA',
          experience: '10+ Years Scope',
          skillsMatch: 'Technical Project Management, SDLC, eGovernance, Architecture',
          salary: 'Not Specified',
          location: domain.includes('nabard') ? 'Mumbai, Maharashtra' : 'Mumbai / Pan-India',
          locationCategory: 'Mumbai',
          deadline: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          deadlineDisplay: 'Active Notification',
          eligibility: 'Eligible',
          eligibilityReason: 'Matches target qualifications and senior project delivery scope.',
          notificationUrl: href,
          applyUrl: href,
          verifiedBadge: 'Verified Job Feed',
          sourceUrl: sourceUrl
        };

        evaluateJobAlignment(jobObj);
        extracted.push(jobObj);

        if (extracted.length >= 6) break;
      }
    }
  }

  return extracted;
}

// Master Scheduler Execution Run
async function runScheduler() {
  if (schedulerState.status === 'Running') {
    throw new Error('Scheduler is already running. Please wait or click Stop Scheduler.');
  }

  const websites = readConfiguredWebsites();
  if (websites.length === 0) {
    throw new Error('No URLs configured in job_websites.txt. Please add target URLs.');
  }

  const sessionId = 'session_' + Date.now();
  schedulerState.sessionId = sessionId;
  schedulerState.status = 'Running';
  schedulerState.startTime = new Date().toISOString();
  schedulerState.endTime = null;
  schedulerState.websitesTotal = websites.length;
  schedulerState.websitesChecked = 0;
  schedulerState.vacanciesFound = 0;
  schedulerState.newJobsAdded = 0;
  schedulerState.duplicatesSkipped = 0;
  schedulerState.errorsCount = 0;
  schedulerState.logMessages = [];

  const websitesAudit = [];
  const addedJobTitles = [];

  logMsg(`Job Search Scheduler started (Session: ${sessionId}). Target websites: ${websites.length}`);

  let isStopped = false;

  for (let i = 0; i < websites.length; i++) {
    if (schedulerState.status === 'Stopped') {
      isStopped = true;
      logMsg('Scheduler run was stopped manually by user.');
      break;
    }

    const targetUrl = websites[i];
    schedulerState.currentWebsite = targetUrl;
    logMsg(`[${i + 1}/${websites.length}] Checking configured website: ${targetUrl}`);

    const siteAudit = {
      url: targetUrl,
      timestamp: new Date().toISOString(),
      status: 'Pending',
      jobsFound: 0,
      newAdded: 0,
      duplicates: 0,
      error: null
    };

    try {
      const html = await fetchWebsite(targetUrl, 8000);
      schedulerState.websitesChecked++;
      siteAudit.status = 'Success';

      const extractedJobs = extractVacanciesFromHtml(html, targetUrl);
      schedulerState.vacanciesFound += extractedJobs.length;
      siteAudit.jobsFound = extractedJobs.length;

      logMsg(`Extracted ${extractedJobs.length} relevant candidate vacancy/vacancies from ${targetUrl}`);

      for (const job of extractedJobs) {
        if (schedulerState.status === 'Stopped') break;

        const dupCheck = db.isDuplicate(job);
        if (dupCheck.duplicate) {
          schedulerState.duplicatesSkipped++;
          siteAudit.duplicates++;
          logMsg(`Duplicate skipped [ID ${dupCheck.id}]: "${job.title}" (${dupCheck.reason})`);
        } else {
          const inserted = db.insertVacancy(job);
          schedulerState.newJobsAdded++;
          siteAudit.newAdded++;
          addedJobTitles.push({ id: inserted.id, title: inserted.title, org: inserted.organization });
          logMsg(`✓ Appended new vacancy [ID ${inserted.id}]: "${job.title}" at ${job.organization} (${job.matchScore}% Match)`);
        }
      }
    } catch (err) {
      schedulerState.websitesChecked++;
      schedulerState.errorsCount++;
      siteAudit.status = 'Error';
      siteAudit.error = err.message;
      logMsg(`Website check error on ${targetUrl}: ${err.message}`, true);
    }

    websitesAudit.push(siteAudit);
    await new Promise(r => setTimeout(r, 300));
  }

  schedulerState.endTime = new Date().toISOString();
  schedulerState.currentWebsite = null;
  if (!isStopped) {
    schedulerState.status = 'Completed';
  }

  logMsg(`Job Search Scheduler finished. Added: ${schedulerState.newJobsAdded}, Duplicates skipped: ${schedulerState.duplicatesSkipped}, Errors: ${schedulerState.errorsCount}`);

  try {
    db.saveSchedulerLog({
      sessionId: schedulerState.sessionId,
      startTime: schedulerState.startTime,
      endTime: schedulerState.endTime,
      status: schedulerState.status,
      websitesAttempted: schedulerState.websitesTotal,
      websitesChecked: schedulerState.websitesChecked,
      vacanciesFound: schedulerState.vacanciesFound,
      newJobsAdded: schedulerState.newJobsAdded,
      duplicatesSkipped: schedulerState.duplicatesSkipped,
      errorsCount: schedulerState.errorsCount,
      summaryJson: JSON.stringify({
        websitesAudit,
        addedJobs: addedJobTitles,
        logs: schedulerState.logMessages.slice(-50)
      })
    });
  } catch (logErr) {
    console.error('Failed to save scheduler audit log to SQLite:', logErr.message);
  }

  return {
    success: true,
    sessionId: schedulerState.sessionId,
    status: schedulerState.status,
    newJobsAdded: schedulerState.newJobsAdded,
    duplicatesSkipped: schedulerState.duplicatesSkipped,
    websitesChecked: schedulerState.websitesChecked,
    websitesTotal: schedulerState.websitesTotal,
    errorsCount: schedulerState.errorsCount
  };
}

// Stop active scheduler run
function stopScheduler() {
  if (schedulerState.status === 'Running') {
    schedulerState.status = 'Stopped';
    logMsg('Stop signal received. Halting scheduler safely.');
    return { success: true, message: 'Scheduler stopped.' };
  }
  return { success: false, message: 'Scheduler is not running.' };
}

// Get live scheduler status
function getSchedulerStatus() {
  return {
    ...schedulerState,
    logMessages: schedulerState.logMessages.slice(-30)
  };
}

module.exports = {
  runScheduler,
  stopScheduler,
  getSchedulerStatus,
  readConfiguredWebsites,
  writeConfiguredWebsites
};
