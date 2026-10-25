/**
 * PORTAL-COMMON.JS — Accessibility & Localization Controller
 * Job Vacancy Intelligence Portal (GIGW 3.0 & WCAG 2.1/2.2 AA)
 */

// Screen Reader Live Announcement Helper — WCAG 4.1.3
function srAnnounce(msg, isAlert = false) {
    const el = document.getElementById(isAlert ? 'sr-alert' : 'sr-status');
    if (el) {
        el.textContent = '';
        setTimeout(() => { el.textContent = msg; }, 60);
    }
}

// ── Font Size Resizing Controller ───────────────────────────────────────────
let currentFontScale = 1;
function adjustFontSize(delta) {
    if (delta === 0) {
        currentFontScale = 1;
    } else {
        currentFontScale = Math.min(1.3, Math.max(0.85, currentFontScale + delta * 0.1));
    }
    document.documentElement.style.setProperty('--portal-font-scale', currentFontScale);
    document.documentElement.style.fontSize = (currentFontScale * 14) + 'px';

    // Update button states
    const btnDecrease = document.getElementById('btnFontDecrease');
    const btnReset = document.getElementById('btnFontReset');
    const btnIncrease = document.getElementById('btnFontIncrease');

    if (btnDecrease && btnReset && btnIncrease) {
        btnDecrease.classList.toggle('active', currentFontScale < 0.95);
        btnReset.classList.toggle('active', Math.abs(currentFontScale - 1) < 0.05);
        btnIncrease.classList.toggle('active', currentFontScale > 1.05);

        btnDecrease.setAttribute('aria-pressed', String(currentFontScale < 0.95));
        btnReset.setAttribute('aria-pressed', String(Math.abs(currentFontScale - 1) < 0.05));
        btnIncrease.setAttribute('aria-pressed', String(currentFontScale > 1.05));
    }

    srAnnounce('Text size adjusted to ' + Math.round(currentFontScale * 100) + ' percent.');
    localStorage.setItem('portal-font-scale', currentFontScale);
}

// ── High Contrast Mode Controller ───────────────────────────────────────────
function toggleHighContrast() {
    document.body.classList.toggle('high-contrast');
    const isHc = document.body.classList.contains('high-contrast');
    const btn = document.getElementById('contrastToggleBtn');
    if (btn) {
        btn.classList.toggle('active', isHc);
        btn.setAttribute('aria-pressed', String(isHc));
    }
    srAnnounce(isHc ? 'High contrast mode enabled' : 'High contrast mode disabled');
    localStorage.setItem('portal-high-contrast', isHc ? 'true' : 'false');
}

// ── English-Hindi Localization Controller ──────────────────────────────────
const commonTranslations = {
    en: {
        portalTitle: "Job Vacancy Intelligence Portal",
        portalSubtitle: "Candidate Recruitment Engine • Independent Platform",
        navHome: "Home",
        navVacancies: "Job Vacancies",
        navVideo: "Hindi Explainer Video",
        navAccessibility: "Accessibility",
        navContact: "Contact Us",
        navPrivacy: "Privacy Policy",
        navTerms: "Terms",
        navDisclaimer: "Disclaimer",
        navSitemap: "Sitemap",
        lastUpdated: "Last Updated:",
        breadcrumbHome: "Home",
        rightsReserved: "© 2026 Job Vacancy Intelligence Portal • GIGW 3.0 & WCAG 2.1 AA Compliant • IT Act 2000",
        independentDisclaimer: "Independent platform for Candidate Achal Saxena (Not affiliated with any Government entity)."
    },
    hi: {
        portalTitle: "रोजगार रिक्ति बुद्धिमत्ता पोर्टल",
        portalSubtitle: "उम्मीदवार भर्ती इंजन • स्वतंत्र मंच",
        navHome: "मुख्य पृष्ठ",
        navVacancies: "रोजगार रिक्तियां",
        navVideo: "हिंदी व्याख्यात्मक वीडियो",
        navAccessibility: "सुगम्यता विवरण",
        navContact: "संपर्क करें",
        navPrivacy: "गोपनीयता नीति",
        navTerms: "नियम एवं शर्तें",
        navDisclaimer: "अस्वीकरण",
        navSitemap: "साइटमैप",
        lastUpdated: "अंतिम अद्यतन:",
        breadcrumbHome: "मुख्य पृष्ठ",
        rightsReserved: "© 2026 रोजगार रिक्ति बुद्धिमत्ता पोर्टल • GIGW 3.0 एवं WCAG 2.1 AA अनुरूप • आईटी अधिनियम 2000",
        independentDisclaimer: "उम्मीदवार अचल सक्सेना हेतु स्वतंत्र मंच (किसी भी सरकारी संस्था से संबद्ध नहीं)।"
    }
};

function setLanguage(lang) {
    const isHi = lang === 'hi';
    document.documentElement.lang = lang;
    document.documentElement.setAttribute('xml:lang', lang);

    const enBtn = document.getElementById('langEnBtn');
    const hiBtn = document.getElementById('langHiBtn');
    if (enBtn && hiBtn) {
        enBtn.classList.toggle('active', !isHi);
        hiBtn.classList.toggle('active', isHi);
        enBtn.setAttribute('aria-pressed', String(!isHi));
        hiBtn.setAttribute('aria-pressed', String(isHi));
    }

    // Translate common UI elements
    const t = isHi ? commonTranslations.hi : commonTranslations.en;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.textContent = t[key];
    });

    // Toggle content blocks if page provides separate language sections
    document.querySelectorAll('.lang-block-en').forEach(el => {
        el.style.display = isHi ? 'none' : 'block';
    });
    document.querySelectorAll('.lang-block-hi').forEach(el => {
        el.style.display = isHi ? 'block' : 'none';
    });

    // Translate elements with explicit data-en and data-hi attributes
    document.querySelectorAll('[data-en][data-hi]').forEach(el => {
        el.textContent = isHi ? el.getAttribute('data-hi') : el.getAttribute('data-en');
    });

    srAnnounce(isHi ? 'भाषा हिंदी में बदल दी गई है' : 'Language switched to English');
    localStorage.setItem('portal-lang', lang);
}

// ── External Link Sanitizer & Keyboard Trap Safeguard ───────────────────────
function setupAccessibilityEnhancements() {
    // Add external link indicators and accessible labels to external links
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        if (!link.classList.contains('no-ext-icon')) {
            link.classList.add('external-link');
        }
        if (!link.getAttribute('rel')) {
            link.setAttribute('rel', 'noopener noreferrer');
        }
        const currentAria = link.getAttribute('aria-label') || link.textContent.trim();
        if (!currentAria.includes('new window') && !currentAria.includes('External')) {
            link.setAttribute('aria-label', currentAria + ' (opens in new window)');
        }
        if (!link.getAttribute('title')) {
            link.setAttribute('title', 'External link opens in a new window');
        }
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.modal-overlay.open, .feedback-modal-overlay.open');
            if (openModal) {
                openModal.classList.remove('open');
                openModal.style.display = 'none';
                document.body.style.overflow = '';
            }
        }
    });
}

// ── State Restoration on Page Load ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    // Restore Font Scale
    const savedFontScale = localStorage.getItem('portal-font-scale');
    if (savedFontScale) {
        currentFontScale = parseFloat(savedFontScale);
        document.documentElement.style.setProperty('--portal-font-scale', currentFontScale);
        document.documentElement.style.fontSize = (currentFontScale * 14) + 'px';
        adjustFontSize(0); // sync button states
    }

    // Restore High Contrast
    const savedHc = localStorage.getItem('portal-high-contrast');
    if (savedHc === 'true') {
        document.body.classList.add('high-contrast');
        const btn = document.getElementById('contrastToggleBtn');
        if (btn) {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
        }
    }

    // Restore Language
    const savedLang = localStorage.getItem('portal-lang');
    if (savedLang && savedLang === 'hi') {
        setLanguage('hi');
    }

    setupAccessibilityEnhancements();
});
