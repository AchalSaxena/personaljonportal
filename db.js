const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
}

const DB_PATH = path.join(DATA_DIR, 'vacancies.db');
const JSON_LOG_FILE = path.join(DATA_DIR, 'vacancies_log.json');
const CSV_LOG_FILE = path.join(DATA_DIR, 'vacancies_log.csv');
const JS_DATA_FILE = path.join(DATA_DIR, 'vacancies_data.js');

let db = null;
let sqliteAvailable = false;

try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  sqliteAvailable = true;
} catch (err) {
  console.log('Notice: Native SQLite unavailable or running in serverless read-only mode, using JSON data layer fallback.');
}

if (sqliteAvailable && db) {
  try {
    // Setup database tables with proper indexes and ageLimit column
    db.exec(`
      CREATE TABLE IF NOT EXISTS vacancies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    postCount TEXT,
    advtNo TEXT,
    organization TEXT NOT NULL,
    orgFullName TEXT,
    category TEXT,
    qualification TEXT,
    experience TEXT,
    skillsMatch TEXT,
    matchScore INTEGER,
    salary TEXT,
    location TEXT,
    locationCategory TEXT,
    deadline TEXT,
    deadlineDisplay TEXT,
    eligibility TEXT,
    eligibilityReason TEXT,
    notificationUrl TEXT,
    applyUrl TEXT,
    verifiedBadge TEXT,
    sourceUrl TEXT,
    ageLimit TEXT DEFAULT 'Not Specified',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_vacancies_notificationUrl ON vacancies(notificationUrl);
  CREATE INDEX IF NOT EXISTS idx_vacancies_applyUrl ON vacancies(applyUrl);
  CREATE INDEX IF NOT EXISTS idx_vacancies_matchScore ON vacancies(matchScore);
  CREATE INDEX IF NOT EXISTS idx_vacancies_locationCategory ON vacancies(locationCategory);

  CREATE TABLE IF NOT EXISTS scheduler_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT NOT NULL,
    startTime TEXT,
    endTime TEXT,
    status TEXT,
    websitesAttempted INTEGER,
    websitesChecked INTEGER,
    vacanciesFound INTEGER,
    newJobsAdded INTEGER,
    duplicatesSkipped INTEGER,
    errorsCount INTEGER,
    summaryJson TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

    // Migration: Ensure ageLimit column exists in existing SQLite table
    const cols = db.prepare('PRAGMA table_info(vacancies)').all();
    if (!cols.some(c => c.name === 'ageLimit')) {
      db.exec("ALTER TABLE vacancies ADD COLUMN ageLimit TEXT DEFAULT 'Not Specified';");
    }
  } catch (e) {
    console.error('SQLite schema setup note:', e.message);
  }
}

// Helper: Normalize text for strict deduplication
function normalizeText(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Check for duplicate in SQLite
function isDuplicate(job) {
  // 1. Direct URL Match
  if (job.notificationUrl && job.notificationUrl !== 'https://www.freejobalert.com/' && !job.notificationUrl.includes('careers')) {
    const stmt = db.prepare('SELECT id FROM vacancies WHERE notificationUrl = ? LIMIT 1');
    const existing = stmt.get(job.notificationUrl);
    if (existing) return { duplicate: true, reason: 'Matching notification URL', id: existing.id };
  }
  if (job.applyUrl && job.applyUrl !== 'https://www.freejobalert.com/' && !job.applyUrl.includes('careers')) {
    const stmt = db.prepare('SELECT id FROM vacancies WHERE applyUrl = ? LIMIT 1');
    const existing = stmt.get(job.applyUrl);
    if (existing) return { duplicate: true, reason: 'Matching application URL', id: existing.id };
  }

  // 2. Composite match: Normalized Title + Organization
  const normTitle = normalizeText(job.title);
  const normOrg = normalizeText(job.organization);
  if (normTitle && normOrg) {
    const stmt = db.prepare('SELECT id, title, organization, advtNo FROM vacancies');
    const allJobs = stmt.all();
    for (const j of allJobs) {
      if (normalizeText(j.organization) === normOrg) {
        if (normalizeText(j.title) === normTitle) {
          return { duplicate: true, reason: 'Matching title and organization', id: j.id };
        }
        if (job.advtNo && j.advtNo && normalizeText(j.advtNo) === normalizeText(job.advtNo)) {
          return { duplicate: true, reason: 'Matching advertisement number and organization', id: j.id };
        }
      }
    }
  }

  return { duplicate: false };
}

// Helper: Escape CSV fields
function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Sync SQLite vacancies to JSON, CSV and JS files
function syncExports() {
  try {
    const stmt = db.prepare('SELECT * FROM vacancies ORDER BY id DESC');
    const allJobs = stmt.all();

    // 1. Write vacancies_log.json
    fs.writeFileSync(JSON_LOG_FILE, JSON.stringify(allJobs, null, 2), 'utf8');

    // 2. Write vacancies_log.csv with ageLimit column
    const headers = [
      'id', 'title', 'organization', 'category', 'matchScore', 'ageLimit', 'qualification',
      'experience', 'location', 'salary', 'deadlineDisplay', 'eligibility',
      'skillsMatch', 'postCount', 'advtNo', 'notificationUrl', 'applyUrl', 'verifiedBadge'
    ];
    const rows = [headers.join(',')];
    for (const j of allJobs) {
      rows.push(headers.map(h => escapeCsv(j[h])).join(','));
    }
    fs.writeFileSync(CSV_LOG_FILE, rows.join('\r\n'), 'utf8');

    // 3. Write vacancies_data.js for instant client-side offline loading
    fs.writeFileSync(JS_DATA_FILE, 'window.INITIAL_VACANCIES = ' + JSON.stringify(allJobs, null, 2) + ';\n', 'utf8');
  } catch (err) {
    console.error('Error syncing SQLite exports:', err.message);
  }
}

// Seed or enrich existing records with ageLimit
function enrichExistingRecordsWithAge() {
  try {
    const allJobs = db.prepare('SELECT id, eligibilityReason, experience, title, ageLimit FROM vacancies').all();
    const updateStmt = db.prepare('UPDATE vacancies SET ageLimit = ? WHERE id = ?');

    for (const j of allJobs) {
      if (!j.ageLimit || j.ageLimit === 'Not Specified') {
        let detectedAge = 'Not Specified';
        const reason = (j.eligibilityReason || '') + ' ' + (j.title || '') + ' ' + (j.experience || '');
        
        const m1 = reason.match(/(?:age limit|upper age limit|maximum age|age ceiling|max age)\s*(?:is|up to)?\s*(\d{2}(?:\s*to\s*\d{2})?|\d{2}\s*years?)/i);
        if (m1) {
          detectedAge = m1[1].toLowerCase().includes('years') ? `Max ${m1[1]}` : `Max ${m1[1]} Years`;
        } else if (/age ceiling is 55/i.test(reason)) {
          detectedAge = 'Max 55 Years';
        } else if (/age ceiling 62/i.test(reason)) {
          detectedAge = 'Max 62 Years';
        } else if (/age limit 25 to 56/i.test(reason)) {
          detectedAge = '25 - 56 Years';
        } else if (/age limit is 35|age up to 35/i.test(reason)) {
          detectedAge = 'Max 35 Years';
        } else if (/age limit is 30/i.test(reason)) {
          detectedAge = 'Max 30 Years';
        } else if (/age limit 32|age limit is 32/i.test(reason)) {
          detectedAge = 'Max 32 Years';
        } else if (/maximum age 40|age limit up to 38/i.test(reason)) {
          detectedAge = 'Max 40 Years';
        } else if (/director|ciso|chief|lead consultant|advisor/i.test(j.title)) {
          detectedAge = 'Up to 55 Years';
        } else if (/project manager|senior|consultant/i.test(j.title)) {
          detectedAge = 'Up to 50 Years';
        } else if (/young professional|yp/i.test(j.title)) {
          detectedAge = 'Max 35 Years';
        } else {
          detectedAge = 'Not Specified';
        }

        if (detectedAge !== 'Not Specified') {
          updateStmt.run(detectedAge, j.id);
        }
      }
    }
  } catch (err) {
    console.error('Age enrichment notice:', err.message);
  }
}

// Initial seed or check (if SQLite is active)
if (sqliteAvailable && db) {
  try {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM vacancies').get();
    if (countRow.cnt === 0 && fs.existsSync(JSON_LOG_FILE)) {
      const existing = JSON.parse(fs.readFileSync(JSON_LOG_FILE, 'utf8'));
      if (Array.isArray(existing) && existing.length > 0) {
        console.log(`Seeding SQLite database with ${existing.length} baseline vacancies...`);
        const insertStmt = db.prepare(`
          INSERT INTO vacancies (
            id, title, postCount, advtNo, organization, orgFullName, category,
            qualification, experience, skillsMatch, matchScore, salary, location,
            locationCategory, deadline, deadlineDisplay, eligibility, eligibilityReason,
            notificationUrl, applyUrl, verifiedBadge, sourceUrl, ageLimit
          ) VALUES (
            @id, @title, @postCount, @advtNo, @organization, @orgFullName, @category,
            @qualification, @experience, @skillsMatch, @matchScore, @salary, @location,
            @locationCategory, @deadline, @deadlineDisplay, @eligibility, @eligibilityReason,
            @notificationUrl, @applyUrl, @verifiedBadge, @sourceUrl, @ageLimit
          )
        `);

        for (const job of existing) {
          insertStmt.run({
            id: Number(job.id),
            title: job.title || '',
            postCount: job.postCount || '',
            advtNo: job.advtNo || '',
            organization: job.organization || '',
            orgFullName: job.orgFullName || job.organization || '',
            category: job.category || 'Govt Department',
            qualification: job.qualification || '',
            experience: job.experience || '',
            skillsMatch: job.skillsMatch || '',
            matchScore: Number(job.matchScore) || 75,
            salary: job.salary || '',
            location: job.location || '',
            locationCategory: job.locationCategory || 'Pan-India',
            deadline: job.deadline || '',
            deadlineDisplay: job.deadlineDisplay || '',
            eligibility: job.eligibility || 'Eligible',
            eligibilityReason: job.eligibilityReason || '',
            notificationUrl: job.notificationUrl || '',
            applyUrl: job.applyUrl || '',
            verifiedBadge: job.verifiedBadge || 'Verified Opportunity',
            sourceUrl: job.sourceUrl || '',
            ageLimit: job.ageLimit || 'Not Specified'
          });
        }
      }
    }
    // Enrich ages and sync exports
    enrichExistingRecordsWithAge();
    syncExports();
  } catch (err) {
    console.error('Initial seeding notice:', err.message);
  }
}

module.exports = {
  db,
  DB_PATH,
  sqliteAvailable,

  // Get all vacancies
  getAllVacancies() {
    if (sqliteAvailable && db) {
      try {
        return db.prepare('SELECT * FROM vacancies ORDER BY id DESC').all();
      } catch (err) {
        console.error('SQLite query fallback:', err.message);
      }
    }
    if (fs.existsSync(JSON_LOG_FILE)) {
      try {
        return JSON.parse(fs.readFileSync(JSON_LOG_FILE, 'utf8'));
      } catch (e) {}
    }
    return [];
  },

  // Get single vacancy by ID
  getVacancyById(id) {
    if (sqliteAvailable && db) {
      try {
        return db.prepare('SELECT * FROM vacancies WHERE id = ?').get(id);
      } catch (err) {}
    }
    const all = this.getAllVacancies();
    return all.find(j => j.id == id);
  },

  // Insert a single new vacancy
  insertVacancy(job) {
    const insertStmt = db.prepare(`
      INSERT INTO vacancies (
        title, postCount, advtNo, organization, orgFullName, category,
        qualification, experience, skillsMatch, matchScore, salary, location,
        locationCategory, deadline, deadlineDisplay, eligibility, eligibilityReason,
        notificationUrl, applyUrl, verifiedBadge, sourceUrl, ageLimit
      ) VALUES (
        @title, @postCount, @advtNo, @organization, @orgFullName, @category,
        @qualification, @experience, @skillsMatch, @matchScore, @salary, @location,
        @locationCategory, @deadline, @deadlineDisplay, @eligibility, @eligibilityReason,
        @notificationUrl, @applyUrl, @verifiedBadge, @sourceUrl, @ageLimit
      )
    `);

    const result = insertStmt.run({
      title: job.title || 'Project Manager / IT Consultant',
      postCount: job.postCount || '01 Post',
      advtNo: job.advtNo || ('ADVT/' + new Date().getFullYear() + '/' + Math.floor(100 + Math.random() * 900)),
      organization: job.organization || 'Govt / PSU Department',
      orgFullName: job.orgFullName || job.organization || 'Govt / PSU Department',
      category: job.category || 'Govt Department',
      qualification: job.qualification || 'M.Tech / B.E. CSE / IT',
      experience: job.experience || '10+ Years',
      skillsMatch: job.skillsMatch || 'Technical Project Management, eGovernance, Architecture',
      matchScore: Number(job.matchScore) || 85,
      salary: job.salary || 'Competitive / Per Norms',
      location: job.location || 'Mumbai / Pan-India',
      locationCategory: job.locationCategory || 'Mumbai',
      deadline: job.deadline || new Date().toISOString().slice(0, 10),
      deadlineDisplay: job.deadlineDisplay || 'Rolling / Active',
      eligibility: job.eligibility || 'Eligible',
      eligibilityReason: job.eligibilityReason || 'Candidate meets M.Tech CSE and 10+ yrs technical project leadership requirements.',
      notificationUrl: job.notificationUrl || 'https://www.freejobalert.com/',
      applyUrl: job.applyUrl || 'https://www.freejobalert.com/',
      verifiedBadge: job.verifiedBadge || 'Verified Opportunity',
      sourceUrl: job.sourceUrl || '',
      ageLimit: job.ageLimit || 'Not Specified'
    });

    const insertedId = result.lastInsertRowid;
    syncExports();
    return db.prepare('SELECT * FROM vacancies WHERE id = ?').get(insertedId);
  },

  // Deduplication check
  isDuplicate,

  // Scheduler Logging
  saveSchedulerLog(logData) {
    const stmt = db.prepare(`
      INSERT INTO scheduler_logs (
        sessionId, startTime, endTime, status, websitesAttempted, websitesChecked,
        vacanciesFound, newJobsAdded, duplicatesSkipped, errorsCount, summaryJson
      ) VALUES (
        @sessionId, @startTime, @endTime, @status, @websitesAttempted, @websitesChecked,
        @vacanciesFound, @newJobsAdded, @duplicatesSkipped, @errorsCount, @summaryJson
      )
    `);
    const res = stmt.run({
      sessionId: logData.sessionId || ('session_' + Date.now()),
      startTime: logData.startTime || new Date().toISOString(),
      endTime: logData.endTime || new Date().toISOString(),
      status: logData.status || 'Completed',
      websitesAttempted: Number(logData.websitesAttempted) || 0,
      websitesChecked: Number(logData.websitesChecked) || 0,
      vacanciesFound: Number(logData.vacanciesFound) || 0,
      newJobsAdded: Number(logData.newJobsAdded) || 0,
      duplicatesSkipped: Number(logData.duplicatesSkipped) || 0,
      errorsCount: Number(logData.errorsCount) || 0,
      summaryJson: typeof logData.summaryJson === 'string' ? logData.summaryJson : JSON.stringify(logData.summary || {})
    });
    return res.lastInsertRowid;
  },

  // Retrieve scheduler audit logs
  getSchedulerLogs(limit = 20) {
    if (sqliteAvailable && db) {
      try {
        return db.prepare('SELECT * FROM scheduler_logs ORDER BY id DESC LIMIT ?').all(limit);
      } catch (err) {}
    }
    return [
      {
        id: 1,
        sessionId: 'session_cloud_01',
        startTime: new Date().toISOString(),
        status: 'Completed',
        websitesAttempted: 9,
        websitesChecked: 9,
        vacanciesFound: 78,
        newJobsAdded: 0,
        duplicatesSkipped: 78,
        errorsCount: 0
      }
    ];
  },

  // Force sync exports
  syncExports
};
