# Job Vacancy Intelligence Dashboard — Advanced Job Search Scheduler

A modern, responsive **Job Vacancy Dashboard** designed in a **Navy Blue, White, and Teal** corporate aesthetic featuring a **native SQLite database engine**, an **Advanced Job Search Scheduler**, configurable website URL management, and an **Excel spreadsheet-style table** with live AutoFilter, sorting, search, and direct application links.

---

## Key Features

### 1. Advanced Job Search Scheduler
- **Manual Control Panel**: A prominent **Start Job Search Scheduler** button and **Stop Scheduler** button in the dashboard ribbon.
- **Configurable Website Management (`job_websites.txt`)**:
  - Exclusively searches the URLs listed in `job_websites.txt`.
  - Read fresh at the start of every search session.
  - Can be edited directly via file or through the dashboard's **Configured Websites** modal.
- **Intelligent CV Alignment**:
  - Automatically matches discovered vacancies against target credentials for **Achal Saxena** (M.Tech CSE, B.E. CSE, 10+ Years Experience, Technical Project Management, e-Governance, Enterprise Architecture, AI, and Cybersecurity).
  - Prioritizes preferred locations: **Priority 1 (Mumbai MMR)**, **Priority 2 (Delhi NCR)**, **Priority 3 (Pan-India)**, and **Priority 4 (Remote / Hybrid)**.
- **Strict Deduplication & Data Preservation**:
  - Baseline records are preserved as immutable entries.
  - Checks duplicate entries using notification URLs, application URLs, and normalized Title + Organization + Advt No.
  - Appends only genuinely new, relevant opportunities to the database.
- **Execution Audit Logging**:
  - Tracks session timestamps, websites checked, vacancies found, new additions, skipped duplicates, and error diagnostics in SQLite table `scheduler_logs`.

### 2. Native SQLite Database (`data/vacancies.db`)
- Powered natively by Node.js `node:sqlite`.
- Stores structured vacancy records with indexed fields.
- Automatic background mirror to [`data/vacancies_log.csv`](file:///c:/Users/SAXENA/Desktop/New%20folder/data/vacancies_log.csv) for Microsoft Excel and [`data/vacancies_log.json`](file:///c:/Users/SAXENA/Desktop/New%20folder/data/vacancies_log.json) for portability.
- Offline-ready zero-CORS script mirror in [`data/vacancies_data.js`](file:///c:/Users/SAXENA/Desktop/New%20folder/data/vacancies_data.js).

### 3. Excel Spreadsheet-Style Table & Age Limit Column
- Clearly defined cell borders & gridlines (`1px solid #CBD5E1`).
- Dedicated **Age Limit** column with distinct tags and AutoFilter search.
- Alternating row zebra striping, high-match highlighting ($\ge 85\%$), and active row selection.
- Density toggle (*Normal* vs *Compact* row heights).
- Excel-style AutoFilter dropdowns (`▼`) on every column with multi-select checklists, frequency counts, and search.
- In-table instant sorting and global multi-criteria filtering.

### 4. Fully Responsive Design
- Optimized across **Mobile** (`<= 480px`), **Small Tablets** (`<= 768px`), **Medium Tablets** (`<= 992px`), and **Desktop/Laptop** displays.
- Touch horizontal scrolling (`-webkit-overflow-scrolling: touch`) with scroll guidance hint.
- Mobile-clamped filter popovers and responsive touch modal cards.

### 5. SEO & Search Engine Auto-Indexing
- **`robots.txt`**: Declares bot crawling permissions for public pages while securing API and internal DB files.
- **`sitemap.xml`**: W3C/Google-compliant XML sitemap for rapid auto-discovery and indexing.
- **JSON-LD Schema.org**: Declares `WebSite`, `ProfilePage` (Achal Saxena, M.Tech/B.E. CSE), and `ItemList` (78 active opportunities).
- **Social Graph**: Complete Open Graph (Facebook / LinkedIn / WhatsApp) and Twitter Card tags.

### 6. Interactive Customer Explainer Video (Hindi)
- **Live Animated Video Web App**: [`explainer_video_hindi.html`](file:///c:/Users/SAXENA/Desktop/New%20folder/explainer_video_hindi.html) (playable directly in browser with synthesized Hindi speech voiceover and synchronized subtitles).
- **Word-for-Word Voiceover Script**: [`customer_explainer_script_hindi.md`](file:///c:/Users/SAXENA/Desktop/New%20folder/customer_explainer_script_hindi.md).

---

## Configuration (`job_websites.txt`)

Add or modify target recruitment portals in `job_websites.txt` (one URL per line):

```text
# Government & Public Sector Recruitment Portals
https://careers.cdac.in/
https://www.freejobalert.com/latest-notifications/
https://rebouncecareers.com/job-opening/
https://stpi.in/en/careers
https://dic.gov.in/index.php/vacancies
https://www.freejobalert.com/articles/
https://rites.com/Career
https://sailcareers.com/
https://www.nabard.org/careers-notices.aspx
```

---

## Running Locally

1. **Start the server:**
   ```bash
   npm start
   # or: node server.js
   ```
2. **Open in your browser:**
   - Main Dashboard: [http://localhost:3000/](http://localhost:3000/)
   - Job Vacancies View: [http://localhost:3000/job_vacancies.html](http://localhost:3000/job_vacancies.html)
   - Hindi Explainer Video: [http://localhost:3000/explainer_video_hindi.html](http://localhost:3000/explainer_video_hindi.html)
   - XML Sitemap: [http://localhost:3000/sitemap.xml](http://localhost:3000/sitemap.xml)
   - Robots: [http://localhost:3000/robots.txt](http://localhost:3000/robots.txt)

---

## Automated QA Testing (Production Readiness)

Run the full 28-test automated production verification suite:
```bash
npm test
# or: node run_production_tests.js
```
Covers:
- SQLite Database & Unit Operations
- REST API Endpoints & Contract Validation
- Data Persistence & Triple-Sync (SQLite, CSV, JSON)
- Security Hardening (SQLi immunity, path traversal, payload limits)
- High-Concurrency Stress Testing (50 parallel queries, <3ms latency)
- Responsive & SEO Schema Integrity

---

## License
MIT License

