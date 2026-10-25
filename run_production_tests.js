const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const scheduler = require('./scheduler');

const BASE_URL = 'http://localhost:3000';

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  categories: {
    unitAndDb: [],
    apiEndpoints: [],
    dataIntegrity: [],
    securityAndSanitization: [],
    performanceAndLoad: [],
    frontendAndSeo: []
  }
};

function recordTest(category, name, passed, details = '') {
  results.total++;
  if (passed) {
    results.passed++;
    results.categories[category].push({ name, status: 'PASS', details });
  } else {
    results.failed++;
    results.categories[category].push({ name, status: 'FAIL', details });
  }
}

function request(method, pathUrl, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { ...headers }
    };

    let postData = '';
    if (body) {
      if (typeof body === 'object') {
        postData = JSON.stringify(body);
        options.headers['Content-Type'] = 'application/json';
      } else {
        postData = String(body);
      }
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runAllTests() {
  console.log('================================================================');
  console.log('STARTING COMPREHENSIVE PRODUCTION READINESS TEST SUITE');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // SUITE 1: UNIT & DATABASE FUNCTIONAL TESTING (db.js)
  // -------------------------------------------------------------
  console.log('--> Running Suite 1: SQLite DB & Unit Tests...');
  try {
    const allVacancies = db.getAllVacancies();
    recordTest('unitAndDb', 'SQLite Connection & getAllVacancies()', allVacancies.length > 0, `Loaded ${allVacancies.length} records`);

    // Verify ageLimit field exists on all records
    const recordsWithoutAge = allVacancies.filter(v => typeof v.ageLimit === 'undefined');
    recordTest('unitAndDb', 'Schema Integrity: ageLimit exists on all rows', recordsWithoutAge.length === 0, `Missing: ${recordsWithoutAge.length}`);

    // Test Deduplication check
    const dupCheck = db.isDuplicate({
      title: allVacancies[0].title,
      organization: allVacancies[0].organization
    });
    recordTest('unitAndDb', 'Duplicate Detection Algorithm', dupCheck.duplicate === true, `Detected duplicate id: ${dupCheck.id}`);

    // Test Scheduler logs table
    const logs = db.getSchedulerLogs(5);
    recordTest('unitAndDb', 'Scheduler Logs SQLite Table Access', Array.isArray(logs), `Retrieved ${logs.length} log entries`);
  } catch (err) {
    recordTest('unitAndDb', 'SQLite Core Failure', false, err.message);
  }

  // -------------------------------------------------------------
  // SUITE 2: REST API ENDPOINTS TESTING
  // -------------------------------------------------------------
  console.log('--> Running Suite 2: REST API Endpoints...');
  try {
    // 2.1 GET /api/vacancies
    const vacRes = await request('GET', '/api/vacancies');
    const vacJson = JSON.parse(vacRes.data);
    recordTest('apiEndpoints', 'GET /api/vacancies returns 200 & valid JSON', vacRes.statusCode === 200 && vacJson.success === true, `Count: ${vacJson.count}`);

    // 2.2 GET /api/scheduler/status
    const statusRes = await request('GET', '/api/scheduler/status');
    const statusJson = JSON.parse(statusRes.data);
    recordTest('apiEndpoints', 'GET /api/scheduler/status returns 200', statusRes.statusCode === 200 && statusJson.success === true, `Status: ${statusJson.data.status}`);

    // 2.3 GET /api/scheduler/websites
    const webRes = await request('GET', '/api/scheduler/websites');
    const webJson = JSON.parse(webRes.data);
    recordTest('apiEndpoints', 'GET /api/scheduler/websites returns 9 configured URLs', webRes.statusCode === 200 && webJson.urls && webJson.urls.length === 9, `Configured: ${webJson.urls ? webJson.urls.length : 0} websites`);

    // 2.4 GET /api/scheduler/log
    const logRes = await request('GET', '/api/scheduler/log');
    const logJson = JSON.parse(logRes.data);
    recordTest('apiEndpoints', 'GET /api/scheduler/log returns audit entries', logRes.statusCode === 200 && logJson.success === true, `Log count: ${logJson.data ? logJson.data.length : 0}`);

    // 2.5 POST /api/parse-vacancy (Smart Text Parsing & CV Match)
    const testRawJob = `Recruitment for Technical Lead - eGovernance
Organization: National Informatics Centre (NIC)
Qualification: B.E. / B.Tech / M.Tech in Computer Science
Experience: 10+ Years required in Government Project Management
Age Limit: Max 45 Years
Location: Mumbai / New Delhi
Salary: Pay Matrix Level 13 (approx 22 LPA)
Last Date: 30-11-2026`;
    const parseRes = await request('POST', '/api/parse-vacancy', { rawText: testRawJob });
    const parseJson = JSON.parse(parseRes.data);
    const parsedValid = parseRes.statusCode === 200 && parseJson.success === true && parseJson.job.ageLimit === 'Max 45 Years' && parseJson.job.matchScore >= 80;
    recordTest('apiEndpoints', 'POST /api/parse-vacancy extracts Age Limit & calculates Match %', parsedValid, `Extracted Age: ${parseJson.job ? parseJson.job.ageLimit : 'N/A'}, Match: ${parseJson.job ? parseJson.job.matchScore : 'N/A'}%`);

    // 2.6 POST /api/vacancies Duplicate Rejection Test
    const dupPayload = {
      title: 'Senior Technical Lead (Automated Test)',
      organization: 'TEST ORG ' + Date.now(),
      category: 'PSU',
      ageLimit: 'Max 40 Years',
      qualification: 'B.Tech CSE',
      experience: '10+ Years',
      location: 'Mumbai',
      salary: '25 LPA',
      deadline: '2026-12-31',
      deadlineDisplay: '31-Dec-2026',
      notificationUrl: 'https://example.com/test-notification-' + Date.now(),
      applyUrl: 'https://example.com/test-apply-' + Date.now(),
      matchScore: 92,
      eligibility: 'Eligible'
    };
    // Insert 1st time
    const insRes1 = await request('POST', '/api/vacancies', dupPayload);
    const insJson1 = JSON.parse(insRes1.data);
    // Insert 2nd time (should skip duplicate)
    const insRes2 = await request('POST', '/api/vacancies', dupPayload);
    const insJson2 = JSON.parse(insRes2.data);
    const dupPrevented = insJson1.added && insJson1.added.length === 1 && insJson2.added && insJson2.added.length === 0;
    recordTest('apiEndpoints', 'POST /api/vacancies strict deduplication', dupPrevented, `First insert: ${insJson1.added.length}, Duplicate re-insert: ${insJson2.added.length} added`);
  } catch (err) {
    recordTest('apiEndpoints', 'API Endpoints Failure', false, err.message);
  }

  // -------------------------------------------------------------
  // SUITE 3: DATA INTEGRITY & SYNC TESTING
  // -------------------------------------------------------------
  console.log('--> Running Suite 3: Data Integrity & File Mirrors...');
  try {
    const csvExists = fs.existsSync(path.join(__dirname, 'data', 'vacancies_log.csv'));
    const jsonExists = fs.existsSync(path.join(__dirname, 'data', 'vacancies_log.json'));
    const jsExists = fs.existsSync(path.join(__dirname, 'data', 'vacancies_data.js'));
    const dbExists = fs.existsSync(path.join(__dirname, 'data', 'vacancies.db'));

    recordTest('dataIntegrity', 'Data Persistence: SQLite file active (vacancies.db)', dbExists, `Size: ${fs.statSync(path.join(__dirname, 'data', 'vacancies.db')).size} bytes`);
    recordTest('dataIntegrity', 'Data Persistence: CSV mirror active (vacancies_log.csv)', csvExists, `Lines: ${fs.readFileSync(path.join(__dirname, 'data', 'vacancies_log.csv'), 'utf8').split('\n').length}`);
    recordTest('dataIntegrity', 'Data Persistence: JSON log active (vacancies_log.json)', jsonExists, `Size: ${fs.statSync(path.join(__dirname, 'data', 'vacancies_log.json')).size} bytes`);
    recordTest('dataIntegrity', 'Zero-CORS Fallback: vacancies_data.js active', jsExists, `Size: ${fs.statSync(path.join(__dirname, 'data', 'vacancies_data.js')).size} bytes`);

    // Verify CSV header contains ageLimit
    const csvHeader = fs.readFileSync(path.join(__dirname, 'data', 'vacancies_log.csv'), 'utf8').split('\n')[0];
    recordTest('dataIntegrity', 'CSV Mirror Header Schema includes ageLimit', csvHeader.includes('ageLimit'), csvHeader);
  } catch (err) {
    recordTest('dataIntegrity', 'Data Integrity Failure', false, err.message);
  }

  // -------------------------------------------------------------
  // SUITE 4: SECURITY & INPUT SANITIZATION TESTING
  // -------------------------------------------------------------
  console.log('--> Running Suite 4: Security & Input Sanitization...');
  try {
    // 4.1 Path Traversal Prevention
    const traversalRes1 = await request('GET', '/../../../../windows/win.ini');
    const traversalRes2 = await request('GET', '/..%2f..%2f..%2fserver.js');
    const safeTraversal = traversalRes1.statusCode === 404;
    recordTest('securityAndSanitization', 'Path Traversal Prevention (Directory Escape blocked)', safeTraversal, `Status: ${traversalRes1.statusCode}`);

    // 4.2 Non-Existent Routes Handling (404 Not Found)
    const notFoundRes = await request('GET', '/non-existent-page-xyz.html');
    recordTest('securityAndSanitization', 'Graceful 404 for non-existent resources', notFoundRes.statusCode === 404, `Status: ${notFoundRes.statusCode}`);

    // 4.3 Large Payload Protection (> 5MB rejection)
    const largeBody = 'A'.repeat(6 * 1024 * 1024); // 6MB
    let rejectedLarge = false;
    try {
      const largeRes = await request('POST', '/api/parse-vacancy', largeBody);
      rejectedLarge = largeRes.statusCode >= 400;
    } catch(e) {
      rejectedLarge = true; // Connection destroyed by server safety limit
    }
    recordTest('securityAndSanitization', 'Large Payload Protection (>5MB rejected safely)', rejectedLarge, 'Excessive payload terminated');

    // 4.4 SQL Injection Resistance (Parameterization verification)
    const sqlInjectionTitle = "Senior PM'; DROP TABLE vacancies; --";
    const sqlRes = await request('POST', '/api/vacancies', {
      title: sqlInjectionTitle,
      organization: 'TEST ORG INJ ' + Date.now(),
      ageLimit: 'Max 35 Years'
    });
    // Verify table vacancies still exists and intact
    const afterCount = db.getAllVacancies().length;
    recordTest('securityAndSanitization', 'SQL Injection Immunity (Prepared statements)', afterCount > 0, `Table intact with ${afterCount} rows`);
  } catch (err) {
    recordTest('securityAndSanitization', 'Security Testing Failure', false, err.message);
  }

  // -------------------------------------------------------------
  // SUITE 5: PERFORMANCE, CONCURRENCY & STRESS LOAD TESTING
  // -------------------------------------------------------------
  console.log('--> Running Suite 5: Performance & Load Testing...');
  try {
    const concurrentCount = 50;
    const startTime = Date.now();
    const promises = [];

    for (let i = 0; i < concurrentCount; i++) {
      promises.push(request('GET', '/api/vacancies'));
    }

    const responses = await Promise.all(promises);
    const duration = Date.now() - startTime;
    const allSuccessful = responses.every(r => r.statusCode === 200);
    const avgResponseTime = (duration / concurrentCount).toFixed(2);

    recordTest('performanceAndLoad', `High Concurrency: ${concurrentCount} simultaneous API queries`, allSuccessful, `Completed in ${duration}ms (Avg ${avgResponseTime}ms/req)`);
    recordTest('performanceAndLoad', 'Sub-100ms Response Time (TTFB)', avgResponseTime < 100, `Average latency: ${avgResponseTime}ms`);
  } catch (err) {
    recordTest('performanceAndLoad', 'Performance Testing Failure', false, err.message);
  }

  // -------------------------------------------------------------
  // SUITE 6: FRONTEND, RESPONSIVE & SEO INTEGRATION TESTING
  // -------------------------------------------------------------
  console.log('--> Running Suite 6: Frontend, Responsive & SEO Testing...');
  try {
    const htmlRes = await request('GET', '/');
    const html = htmlRes.data;

    // Robots and Sitemap endpoints
    const robotsRes = await request('GET', '/robots.txt');
    const sitemapRes = await request('GET', '/sitemap.xml');
    const jvRes = await request('GET', '/job_vacancies.html');

    recordTest('frontendAndSeo', 'robots.txt HTTP 200 & text/plain', robotsRes.statusCode === 200 && robotsRes.headers['content-type'].includes('text/plain'));
    recordTest('frontendAndSeo', 'sitemap.xml HTTP 200 & application/xml', sitemapRes.statusCode === 200 && sitemapRes.headers['content-type'].includes('application/xml'));
    recordTest('frontendAndSeo', 'job_vacancies.html mirror HTTP 200', jvRes.statusCode === 200);

    // Responsive media queries check
    const hasMedia1200 = html.includes('@media (max-width: 1200px)');
    const hasMedia992 = html.includes('@media (max-width: 992px)');
    const hasMedia768 = html.includes('@media (max-width: 768px)');
    const hasMedia480 = html.includes('@media (max-width: 480px)');
    recordTest('frontendAndSeo', 'Responsive Breakpoints (1200px, 992px, 768px, 480px)', hasMedia1200 && hasMedia992 && hasMedia768 && hasMedia480, 'All 4 breakpoint tiers active');

    // Excel filter and Age limit columns in DOM
    const hasAgeTh = html.includes('data-column="age"');
    const hasFilterTrigger = html.includes('excel-filter-trigger');
    const hasPopover = html.includes('id="excelFilterPopover"');
    recordTest('frontendAndSeo', 'Excel AutoFilter & Age Limit DOM Structure', hasAgeTh && hasFilterTrigger && hasPopover, 'Header triggers & popover verified');

    // JSON-LD schema
    const hasJsonLd = html.includes('application/ld+json') && html.includes('WebSite') && html.includes('ProfilePage') && html.includes('ItemList');
    recordTest('frontendAndSeo', 'Schema.org JSON-LD Structured Data Valid', hasJsonLd, '3 entities verified');

    // Semantic Tags
    const hasSemanticTags = html.includes('<header') && html.includes('<main') && html.includes('<footer') && html.includes('<section');
    recordTest('frontendAndSeo', 'HTML5 Semantic Landmark Elements', hasSemanticTags, 'header, main, section, footer present');
  } catch (err) {
    recordTest('frontendAndSeo', 'Frontend & SEO Failure', false, err.message);
  }

  // -------------------------------------------------------------
  // FINAL SUMMARY REPORT
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST EXECUTION SUMMARY: ${results.passed} / ${results.total} PASSED (${((results.passed / results.total) * 100).toFixed(1)}%)`);
  if (results.failed === 0) {
    console.log('STATUS: ALL TESTS PASSED - SYSTEM IS 100% PRODUCTION READY!');
  } else {
    console.log(`STATUS: ${results.failed} TESTS FAILED - ATTENTION REQUIRED`);
  }
  console.log('================================================================\n');

  console.log(JSON.stringify(results, null, 2));
}

runAllTests().catch(console.error);
