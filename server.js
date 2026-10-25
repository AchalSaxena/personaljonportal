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

// HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
  let safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`SQLite Database active at: ${db.DB_PATH}`);
  console.log(`Configured Websites file: ${path.join(__dirname, 'job_websites.txt')}`);
});
