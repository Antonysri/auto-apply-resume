const path = require('path');
const fs = require('fs');
const browserManager = require('./browser');
const roleMatcher = require('./roleMatcher');
const formSolver = require('./formSolver');
const tracker = require('./tracker');
const naukriScanner = require('./naukriScanner');

class Orchestrator {
  constructor() {
    this.isRunning = false;
    this.subscribers = new Set();
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify(event, data) {
    for (const sub of this.subscribers) {
      try {
        sub(event, data);
      } catch (e) {}
    }
  }

  loadProfile() {
    const profilePath = path.join(__dirname, '..', 'config', 'profile.json');
    return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  }

  loadSettings() {
    const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }

  /**
   * Applies to a single company careers/job URL directly
   * (e.g. https://salesquared.io/careers.html)
   */
  async processCompanyJobUrl(url, customRoles = null) {
    this.notify('log', { level: 'info', message: `Starting auto-apply for: ${url}` });
    const profile = this.loadProfile();
    const settings = this.loadSettings();
    const targetRoles = customRoles || profile.targetRoles;

    const context = await browserManager.launch({
      headless: settings.browser.headless,
      slowMo: settings.browser.slowMoMs
    });

    const page = await context.newPage();
    let result = {
      sourceUrl: url,
      jobTitle: 'Unknown Role',
      companyName: 'Company',
      appliedUrl: url,
      status: 'FAILED',
      proofScreenshot: null,
      notes: ''
    };

    try {
      this.notify('log', { level: 'info', message: `Navigating to ${url}...` });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Attempt to extract company name from title / domain
      const pageTitle = await page.title();
      result.companyName = pageTitle.split(/[-|–]/)[0].trim() || 'Company';

      // 1. Scan for target roles and apply trigger
      this.notify('log', { level: 'info', message: `Scanning page for target roles: ${targetRoles.slice(0, 3).join(', ')}...` });
      const matchResult = await roleMatcher.findAndTriggerJob(page, targetRoles);

      let targetPage = page;

      if (!matchResult.found) {
        this.notify('log', { level: 'warn', message: 'No target role found on company page.' });
        result.notes = 'Target role not found on page';
        tracker.recordApplication(result);
        await browserManager.close();
        return result;
      }

      result.jobTitle = matchResult.matchedRole || targetRoles[0];

      if (matchResult.isDirectForm) {
        this.notify('log', { level: 'info', message: 'Application form is directly on this page.' });
      } else if (matchResult.applyUrl && !matchResult.applyUrl.startsWith('javascript') && !matchResult.applyUrl.endsWith('#')) {
        this.notify('log', { level: 'info', message: `Following apply link: ${matchResult.applyUrl}` });
        result.appliedUrl = matchResult.applyUrl;
        
        // Listen for new tab or navigate
        const [newPage] = await Promise.all([
          context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
          page.evaluate(href => window.open(href, '_blank'), matchResult.applyUrl)
        ]);

        if (newPage) {
          targetPage = newPage;
          await targetPage.waitForLoadState('domcontentloaded');
        } else {
          await page.goto(matchResult.applyUrl, { waitUntil: 'domcontentloaded' });
          targetPage = page;
        }
      } else {
        // In-page button click (e.g. opens modal or toggles form container on same page)
        this.notify('log', { level: 'info', message: 'Clicking Apply button on page to reveal form...' });
        await page.evaluate(({ role }) => {
          function normalize(str) {
            return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
          }
          const normRole = normalize(role);
          const allRowsAndCards = Array.from(document.querySelectorAll('table tr, .table-row, [role="row"], .job-card, .job-item, article'));
          for (const item of allRowsAndCards) {
            if (normalize(item.innerText).includes(normRole)) {
              const btn = item.querySelector('button, a, input[type="button"]');
              if (btn) {
                btn.click();
                return true;
              }
            }
          }
          return false;
        }, { role: matchResult.matchedRole });

        await page.waitForTimeout(2000);
        targetPage = page;
      }

      // 2. Solve the form
      this.notify('log', { level: 'info', message: 'Solving application form and uploading resume...' });
      const formResult = await formSolver.solveForm(targetPage, profile, {
        autoSubmit: settings.automation.autoSubmit
      });

      result.atsType = formResult.atsType;
      result.status = formResult.success ? 'SUCCESS' : 'FAILED';
      result.proofScreenshot = formResult.proofPath;
      result.notes = formResult.message;

      this.notify('log', {
        level: formResult.success ? 'success' : 'warn',
        message: `Form completion result: ${formResult.message}`
      });

      // Record to tracker DB
      tracker.recordApplication(result);
      this.notify('applied', result);

    } catch (err) {
      console.error('[Orchestrator] Error during process:', err);
      this.notify('log', { level: 'error', message: `Execution failed: ${err.message}` });
      result.notes = `Error: ${err.message}`;
      tracker.recordApplication(result);
    } finally {
      await browserManager.close();
    }

    return result;
  }

  /**
   * Starts a full Naukri search and auto-apply scan session (up to targetCount, default 100)
   */
  async startNaukriScan(targetCount = 100) {
    if (this.isRunning) {
      this.notify('log', { level: 'warn', message: 'A scan session is already in progress.' });
      return;
    }

    this.isRunning = true;
    this.notify('log', { level: 'info', message: `🚀 Initializing Naukri Batch Apply (Target: ${targetCount} jobs)...` });

    const profile = this.loadProfile();
    const settings = this.loadSettings();
    const naukriVerifier = require('./naukriVerifier');

    const context = await browserManager.launch({
      headless: settings.browser.headless,
      slowMo: settings.browser.slowMoMs
    });

    try {
      // 1. Fetch baseline applies count before session starts
      const initialCount = await naukriVerifier.fetchCurrentAppliesCount(context);
      if (initialCount !== null) {
        this.notify('log', { level: 'info', message: `📊 Baseline Naukri Profile Applies Count: ${initialCount}` });
      }

      // 2. Run multi-location batch apply session
      const page = await context.newPage();
      const sessionResult = await naukriScanner.scanAndApply(page, profile, settings, targetCount, (event, data) => this.notify(event, data));

      // 3. Verify increment on profile after session
      if (initialCount !== null && sessionResult && sessionResult.appliedTotal > 0) {
        const verifyReport = await naukriVerifier.verifyIncrement(initialCount, context, (event, data) => this.notify(event, data));
        this.notify('verified_count', verifyReport);
      }

    } catch (err) {
      this.notify('log', { level: 'error', message: `Naukri scan session failed: ${err.message}` });
    } finally {
      this.isRunning = false;
      await browserManager.close();
    }
  }

  /**
   * Searches and filters jobs on Naukri without applying, returning a preview list
   * @param {object} options { keyword, location, applyType, targetCount }
   */
  async searchJobs(options = {}) {
    if (this.isRunning) {
      throw new Error('An auto-apply session is currently active. Please wait for it to complete.');
    }

    const settings = this.loadSettings();
    const context = await browserManager.launch({
      headless: settings.browser.headless,
      slowMo: settings.browser.slowMoMs
    });

    try {
      const result = await naukriScanner.searchAndFilterJobs(context, options, (event, data) => this.notify(event, data));
      return result;
    } finally {
      await browserManager.close();
    }
  }

  /**
   * Applies to user-selected jobs in batch and verifies Naukri increment afterwards
   * @param {Array} jobs
   */
  async applySelectedJobs(jobs = []) {
    if (this.isRunning) {
      throw new Error('A batch session is already in progress.');
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
      throw new Error('No jobs selected for application.');
    }

    this.isRunning = true;
    this.notify('log', { level: 'info', message: `🚀 Starting Batch Application on ${jobs.length} selected jobs...` });

    const profile = this.loadProfile();
    const settings = this.loadSettings();
    const naukriVerifier = require('./naukriVerifier');

    const context = await browserManager.launch({
      headless: settings.browser.headless,
      slowMo: settings.browser.slowMoMs
    });

    try {
      // 1. Fetch initial Naukri count before applying
      const initialCount = await naukriVerifier.fetchCurrentAppliesCount(context);
      if (initialCount !== null) {
        this.notify('log', { level: 'info', message: `📊 Baseline Naukri Profile Applies Count: ${initialCount}` });
      }

      // 2. Execute auto-apply on all selected jobs
      const batchResult = await naukriScanner.applyToJobList(context, jobs, profile, settings, (event, data) => this.notify(event, data));

      // 3. Verify increment on Naukri profile
      let verifyReport = null;
      if (initialCount !== null) {
        verifyReport = await naukriVerifier.verifyIncrement(initialCount, context, (event, data) => this.notify(event, data));
        this.notify('verified_count', verifyReport);
      }

      return {
        success: true,
        batchResult,
        verifyReport
      };

    } catch (err) {
      this.notify('log', { level: 'error', message: `Batch apply failed: ${err.message}` });
      throw err;
    } finally {
      this.isRunning = false;
      await browserManager.close();
    }
  }

  /**
   * Synchronizes Antony's full applied history directly from his Naukri account
   */
  async syncNaukriAppliedHistory() {
    if (this.isRunning) {
      throw new Error('A browser session is currently active. Please wait.');
    }
    const naukriAccountTracker = require('./naukriAccountTracker');
    const settings = this.loadSettings();
    const context = await browserManager.launch({
      headless: settings.browser.headless,
      slowMo: settings.browser.slowMoMs
    });

    try {
      const result = await naukriAccountTracker.syncFromNaukri(context, (event, data) => this.notify(event, data));
      return result;
    } finally {
      await browserManager.close();
    }
  }
}

module.exports = new Orchestrator();
