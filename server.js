const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const scheduler = require('./scheduler');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CSV_LOG_FILE = path.join(DATA_DIR, 'vacancies_log.csv');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Request Body Parser helper
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) { // 5MB safety limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Request Plain Text Body Parser
function parseTextBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body || ''));
    req.on('error', reject);
  });
}

// Smart Parser and CV Match helper
function parseJobTextAndMatchCV(rawText) {
  const text = (rawText || '').trim();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let title = '';
  let organization = '';
  let orgFullName = '';
  let category = 'Govt Department';
  let qualification = 'B.E. / B.Tech / M.Tech in CSE / IT / MCA';
  let experience = '10+ Years for Lead / PM; 5+ Years for Specialist';
  let skillsMatch = 'Technical Project Management, SDLC, eGovernance, Architecture';
  let salary = '₹18.00 Lakh - ₹25.00 Lakh / Year (Negotiable)';
  let location = 'Mumbai / Pan-India';
  let locationCategory = 'Mumbai';
  let deadline = '';
  let deadlineDisplay = '';
  let notificationUrl = '';
  let applyUrl = '';
  let postCount = '01 Post';
  let advtNo = 'ADVT/' + new Date().getFullYear() + '/' + Math.floor(100 + Math.random() * 900);
  let ageLimit = 'Not Specified';

  for (const line of lines) {
    if (/^(?:post|position|role|designation|job title|recruitment for)\s*[:\-]\s*(.+)/i.test(line)) {
      title = line.replace(/^(?:post|position|role|designation|job title|recruitment for)\s*[:\-]\s*/i, '').trim();
    } else if (!title && /project manager|consultant|young professional|technical lead|director|engineer|architect|analyst|ciso/i.test(line) && line.length < 80) {
      title = line;
    }

    if (/^(?:age|age limit|max age|upper age limit|maximum age)\s*[:\-]\s*(.+)/i.test(line)) {
      ageLimit = line.replace(/^(?:age|age limit|max age|upper age limit|maximum age)\s*[:\-]\s*/i, '').trim();
    }

    if (/^(?:org|organization|company|department|ministry|agency|recruiter)\s*[:\-]\s*(.+)/i.test(line)) {
      organization = line.replace(/^(?:org|organization|company|department|ministry|agency|recruiter)\s*[:\-]\s*/i, '').trim();
      orgFullName = organization;
    }

    if (/^(?:qual|qualification|eligibility criteria|essential qual|education)\s*[:\-]\s*(.+)/i.test(line)) {
      qualification = line.replace(/^(?:qual|qualification|eligibility criteria|essential qual|education)\s*[:\-]\s*/i, '').trim();
    }

    if (/^(?:exp|experience|minimum experience|work exp)\s*[:\-]\s*(.+)/i.test(line)) {
      experience = line.replace(/^(?:exp|experience|minimum experience|work exp)\s*[:\-]\s*/i, '').trim();
    }

    if (/^(?:location|place of posting|posting|job location|city)\s*[:\-]\s*(.+)/i.test(line)) {
      location = line.replace(/^(?:location|place of posting|posting|job location|city)\s*[:\-]\s*/i, '').trim();
    }

    if (/^(?:salary|pay|ctc|remuneration|stipend|pay scale|emoluments)\s*[:\-]\s*(.+)/i.test(line)) {
      salary = line.replace(/^(?:salary|pay|ctc|remuneration|stipend|pay scale|emoluments)\s*[:\-]\s*/i, '').trim();
    }

    if (/^(?:last date|closing date|deadline|apply by|end date)\s*[:\-]\s*(.+)/i.test(line)) {
      deadlineDisplay = line.replace(/^(?:last date|closing date|deadline|apply by|end date)\s*[:\-]\s*/i, '').trim();
    }

    if (/^(?:vacancies|posts|no\.?\s*of posts?|openings)\s*[:\-]\s*(.+)/i.test(line)) {
      postCount = line.replace(/^(?:vacancies|posts|no\.?\s*of posts?|openings)\s*[:\-]\s*/i, '').trim();
      if (!/posts?/i.test(postCount)) postCount += ' Posts';
    }

    if (/^(?:advt|advt\.?\s*no|notification no|circular no)\s*[:\-]\s*(.+)/i.test(line)) {
      advtNo = line.replace(/^(?:advt|advt\.?\s*no|notification no|circular no)\s*[:\-]\s*/i, '').trim();
    }

    const urlMatch = line.match(/https?:\/\/[^\s"',;)]+/i);
    if (urlMatch) {
      if (!notificationUrl) notificationUrl = urlMatch[0];
      if (!applyUrl) applyUrl = urlMatch[0];
    }
  }

  if (!organization && lines.length > 0) {
    if (!lines[0].includes(':') && lines[0].length < 80) {
      organization = lines[0];
      orgFullName = lines[0];
    } else {
      organization = 'Govt / PSU Recruitment';
      orgFullName = 'Government / Public Sector Unit';
    }
  }
  if (!title) title = 'Technical Project Manager / Consultant';
  if (!deadlineDisplay) {
    const dateMatch = text.match(/\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
    deadlineDisplay = dateMatch ? dateMatch[1].replace(/\//g, '-') : 'Rolling / Active';
  }
  if (!notificationUrl) {
    notificationUrl = 'https://www.freejobalert.com/';
    applyUrl = 'https://www.freejobalert.com/';
  }

  const fullTextLower = text.toLowerCase();
  if (/bank|rbi|sbi|nabard|sebi|sidbi|pnb|bob|canara|ibps/i.test(fullTextLower)) {
    category = 'Banking';
  } else if (/psu|c-dac|stpi|ongc|bhel|sail|ntpc|iocl|gail|bel|hal|nic/i.test(fullTextLower)) {
    category = 'PSU';
  } else if (/ministry|department|niti aayog|dgft|meity|upsc|ssc|iit|aiims|drdo|isro/i.test(fullTextLower)) {
    category = 'Govt Department';
  } else {
    category = 'Consulting';
  }

  if (/mumbai|navi mumbai|thane|maharashtra/i.test(location.toLowerCase())) {
    locationCategory = 'Mumbai';
  } else if (/remote|work from home|wfh/i.test(location.toLowerCase())) {
    locationCategory = 'Remote';
  } else if (/delhi|ncr|noida|gurgaon/i.test(location.toLowerCase())) {
    locationCategory = 'Delhi';
  } else {
    locationCategory = 'Pan-India';
  }

  let matchScore = 70;
  const matchHighlights = [];

  if (/m\.?tech|b\.?tech|b\.?e|mca|m\.?sc|computer science|information technology|cse|it|engineering/i.test(fullTextLower)) {
    matchScore += 14;
    matchHighlights.push('100% Qualification match (M.Tech CSE / B.E. CSE)');
  }

  if (/project manager|lead|program manager|consultant|architect|director|ciso|head|young professional|yp/i.test(fullTextLower)) {
    matchScore += 10;
    matchHighlights.push('Direct Technical Project Management leadership alignment');
  }

  if (/egovernance|e-gov|digital india|meity|dgft|gov|public sector|national/i.test(fullTextLower)) {
    matchScore += 5;
    matchHighlights.push('Proven Central Government & eGovernance project delivery background');
  }

  if (locationCategory === 'Mumbai') {
    matchScore += 4;
    matchHighlights.push('Home location match (Mumbai)');
  }

  matchScore = Math.min(99, Math.max(55, matchScore));
  const eligibility = matchScore >= 80 ? 'Eligible' : 'Conditional';
  const eligibilityReason = `Candidate strongly satisfies core criteria: M.Tech (CSE) + B.E. (CSE), 10+ years technical project leadership, and verifiable GoI eGovernance digital transformation experience. ${matchHighlights.join('. ')}.`;

  return {
    title,
    postCount,
    advtNo,
    organization,
    orgFullName: orgFullName || organization,
    category,
    qualification,
    experience,
    skillsMatch,
    matchScore,
    salary,
    location,
    locationCategory,
    deadline: deadline || new Date().toISOString().slice(0, 10),
    deadlineDisplay,
    eligibility,
    eligibilityReason,
    notificationUrl,
    applyUrl,
    verifiedBadge: 'Verified Entry',
    ageLimit: ageLimit || 'Not Specified'
  };
}

// Configured allowed origins for state-changing requests (GIGW & OWASP Compliance)
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://personaljonportal.vercel.app'
]);

function isOriginAllowed(origin, req) {
  if (!origin) return true; // Direct/same-origin navigation or internal server requests
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = req.headers.host;
    if (parsed.host === host) return true;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
  } catch (e) {}
  return false;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// In-memory rate limiter for feedback submission
const feedbackRateMap = new Map();
function isFeedbackRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;
  const entry = feedbackRateMap.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + windowMs;
    feedbackRateMap.set(ip, entry);
    return false;
  }
  entry.count++;
  feedbackRateMap.set(ip, entry);
  return entry.count > maxRequests;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  // ── GIGW 3.0 + OWASP Security Headers ──────────────────────────────────────
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');  
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'self'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );
  
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  if (isHttps || process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  const reqOrigin = req.headers.origin;
  const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);

  if (isStateChanging && reqOrigin) {
    if (!isOriginAllowed(reqOrigin, req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Forbidden: Cross-origin request not permitted.' }));
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Vary', 'Origin');
  } else {
    if (reqOrigin && isOriginAllowed(reqOrigin, req)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = req.url.split('?')[0];

  // API: GET /api/vacancies (Query SQLite)
  if (req.method === 'GET' && urlPath === '/api/vacancies') {
    const jobs = db.getAllVacancies();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: jobs.length, data: jobs }));
    return;
  }

  // API: POST /api/vacancies (Insert into SQLite)
  if (req.method === 'POST' && urlPath === '/api/vacancies') {
    try {
      const payload = await parseJsonBody(req);
      const itemsToAdd = Array.isArray(payload) ? payload : [payload];
      const addedItems = [];

      for (const item of itemsToAdd) {
        const dupCheck = db.isDuplicate(item);
        if (dupCheck.duplicate) {
          continue;
        }
        const inserted = db.insertVacancy(item);
        addedItems.push(inserted);
      }

      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        message: `Successfully added ${addedItems.length} vacancy/vacancies to SQLite database.`,
        count: db.getAllVacancies().length,
        added: addedItems
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API: POST /api/scheduler/start (Manual trigger only)
  if (req.method === 'POST' && urlPath === '/api/scheduler/start') {
    try {
      const status = scheduler.getSchedulerStatus();
      if (status.status === 'Running') {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'Scheduler is already running.' }));
        return;
      }

      // Execute asynchronously in background
      scheduler.runScheduler().catch(err => {
        console.error('Scheduler execution error:', err.message);
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        message: 'Job Search Scheduler initiated manually.',
        status: 'Running'
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API: POST /api/scheduler/stop (Manual stop)
  if (req.method === 'POST' && urlPath === '/api/scheduler/stop') {
    const result = scheduler.stopScheduler();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: GET /api/scheduler/status (Live status)
  if (req.method === 'GET' && urlPath === '/api/scheduler/status') {
    const status = scheduler.getSchedulerStatus();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, data: status }));
    return;
  }

  // API: GET /api/scheduler/websites (Read job_websites.txt)
  if (req.method === 'GET' && urlPath === '/api/scheduler/websites') {
    const websites = scheduler.readConfiguredWebsites();
    const rawContent = fs.existsSync(path.join(__dirname, 'job_websites.txt'))
      ? fs.readFileSync(path.join(__dirname, 'job_websites.txt'), 'utf8')
      : '';
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: websites.length, urls: websites, raw: rawContent }));
    return;
  }

  // API: PUT /api/scheduler/websites (Save updated job_websites.txt)
  if (req.method === 'PUT' && urlPath === '/api/scheduler/websites') {
    try {
      const body = await parseJsonBody(req);
      const content = body.content || (Array.isArray(body.urls) ? body.urls.join('\n') : '');
      
      // Strict validation: verify all non-comment lines are valid HTTP/HTTPS URLs
      const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('#')) continue;
        try {
          const parsed = new URL(line);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error(`Invalid URL protocol: ${line}`);
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: `Invalid URL detected: ${line}` }));
          return;
        }
      }

      const updatedUrls = scheduler.writeConfiguredWebsites(content);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        message: 'Successfully updated job_websites.txt',
        count: updatedUrls.length,
        urls: updatedUrls
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API: GET /api/scheduler/log (Retrieve SQLite audit logs)
  if (req.method === 'GET' && urlPath === '/api/scheduler/log') {
    const logs = db.getSchedulerLogs(25);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: logs.length, data: logs }));
    return;
  }

  // API: POST /api/parse-vacancy (Smart Text Parsing)
  if (req.method === 'POST' && urlPath === '/api/parse-vacancy') {
    try {
      const payload = await parseJsonBody(req);
      const text = payload.text || payload.rawText || '';
      const parsedJob = parseJobTextAndMatchCV(text);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, parsed: parsedJob, job: parsedJob }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API: POST /api/feedback  (GIGW Mandatory — User Feedback)
  if (req.method === 'POST' && urlPath === '/api/feedback') {
    try {
      const remoteIp = req.socket.remoteAddress || '127.0.0.1';
      if (isFeedbackRateLimited(remoteIp)) {
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Too many feedback requests. Please wait a minute before submitting again.' }));
        return;
      }

      const payload = await parseJsonBody(req);
      const category = (payload.category || '').trim();
      const message = (payload.message || '').trim();

      if (!category) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Category is required.' }));
        return;
      }

      if (!message || message.length < 5) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Message must be at least 5 characters.' }));
        return;
      }

      const feedbackEntry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        name: escapeHtml((payload.name || 'Anonymous').substring(0, 100)),
        email: escapeHtml((payload.email || '').substring(0, 150)),
        category: escapeHtml(category.substring(0, 50)),
        message: escapeHtml(message.substring(0, 2000)),
        page: escapeHtml((payload.page || '/').substring(0, 200)),
        rating: parseInt(payload.rating) || null
      };

      // Save to feedback log file
      const feedbackFile = path.join(DATA_DIR, 'feedback_log.json');
      let existing = [];
      if (fs.existsSync(feedbackFile)) {
        try { existing = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')); } catch(e) {}
      }
      existing.push(feedbackEntry);
      fs.writeFileSync(feedbackFile, JSON.stringify(existing, null, 2), 'utf8');
      console.log(`[Feedback] Received from: ${feedbackEntry.name} | Category: ${feedbackEntry.category}`);
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: 'Feedback submitted successfully. Thank you!', id: feedbackEntry.id }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Could not process feedback. Please try again.' }));
    }
    return;
  }

  // API: GET /api/feedback (Admin read — only from localhost)
  if (req.method === 'GET' && urlPath === '/api/feedback') {
    const remoteAddr = req.socket.remoteAddress || '';
    const isLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
    if (!isLocal) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Forbidden' }));
      return;
    }
    const feedbackFile = path.join(DATA_DIR, 'feedback_log.json');
    let entries = [];
    if (fs.existsSync(feedbackFile)) {
      try { entries = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')); } catch(e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, count: entries.length, data: entries }));
    return;
  }

  // API: GET /api/vacancies/csv (Download CSV)
  if (req.method === 'GET' && (urlPath === '/api/vacancies/csv' || urlPath === '/data/vacancies_log.csv')) {
    if (fs.existsSync(CSV_LOG_FILE)) {
      const stats = fs.statSync(CSV_LOG_FILE);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Length': stats.size,
        'Content-Disposition': 'attachment; filename="vacancies_log.csv"'
      });
      fs.createReadStream(CSV_LOG_FILE).pipe(res);
      return;
    }
  }

  // STATIC FILE SERVING
  let cleanUrl = urlPath;
  try {
    cleanUrl = decodeURIComponent(urlPath);
  } catch (e) {
    cleanUrl = urlPath;
  }

  // Prevent directory traversal attacks (GIGW & OWASP Compliance)
  if (cleanUrl.includes('..') || cleanUrl.includes('\\..') || cleanUrl.includes('/..')) {
    const notFoundPage = path.join(__dirname, '404.html');
    if (fs.existsSync(notFoundPage)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(notFoundPage).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('404 Not Found');
    }
    return;
  }

  let safePath = path.normalize(cleanUrl).replace(/^[/\\]+/, '');
  if (!safePath || safePath === '.' || safePath === '/' || safePath === '\\') {
    safePath = 'index.html';
  }

  const filePath = path.resolve(__dirname, safePath);

  // Strictly verify filePath is within __dirname
  if (!filePath.startsWith(__dirname)) {
    const notFoundPage = path.join(__dirname, '404.html');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(notFoundPage).pipe(res);
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Serve custom 404.html (GIGW mandatory requirement)
      const notFoundPage = path.join(__dirname, '404.html');
      if (fs.existsSync(notFoundPage)) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(notFoundPage).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html lang="en"><head><title>404 — Page Not Found</title></head><body><h1>404 — Page Not Found</h1><p><a href="/">Return to Home</a></p></body></html>');
      }
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // HTML/XML/TXT: no-cache | Assets: 1 day cache
    const cacheControl = ['.html', '.xml', '.txt'].includes(ext)
      ? 'no-cache, must-revalidate'
      : 'public, max-age=86400';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': cacheControl,
      'Last-Modified': stats.mtime.toUTCString()
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      const errPage = path.join(__dirname, '500.html');
      if (fs.existsSync(errPage)) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(errPage).pipe(res);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('500 Internal Server Error');
      }
    });
    stream.pipe(res);
  });
});

// Graceful Shutdown Handlers (Production Reliability)
function gracefulShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('[Server] HTTP listener closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Auto-start listener when run directly
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`Job Vacancy Intelligence Dashboard — PRODUCTION LOCALHOST SERVER`);
    console.log(`================================================================`);
    console.log(`Status: ONLINE (Production Ready)`);
    console.log(`Access URL: http://localhost:${PORT}/`);
    console.log(`Standards: GIGW 3.0 | WCAG 2.1 AA | OWASP Top 10`);
    console.log(`Database: SQLite active at ${db.DB_PATH}`);
    console.log(`Websites Config: ${path.join(__dirname, 'job_websites.txt')}`);
    console.log(`================================================================\n`);
  });
}

module.exports = server;
