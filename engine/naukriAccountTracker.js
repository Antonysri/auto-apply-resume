const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'naukri_applied_history.json');

function cleanCompany(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\b(pvt|ltd|private|limited|technologies|technology|solutions|services|consulting|inc|corp|llp|holdings|software|labs|india|global|systems|infotech)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJobId(url) {
  if (!url) return null;
  const match = String(url).match(/-(\d{8,15})/);
  return match ? match[1] : (url.match(/^\d{8,15}$/) ? url : null);
}

class NaukriAccountTracker {
  constructor() {
    this.appliedJobs = [];
    this.appliedJobIds = new Set();
    this.appliedCleanCompanies = new Set();
    this.appliedRawCompanies = new Set();
    this.lastSyncedAt = null;
    this.totalApplied = 0;
    this.uniqueCompanies = 0;

    this.ensureDataDir();
    this.loadFromDisk();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Loads cached applied history from disk into memory for instant lookups
   */
  loadFromDisk() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
        const data = JSON.parse(raw);
        this.appliedJobs = Array.isArray(data.appliedJobs) ? data.appliedJobs : [];
        this.lastSyncedAt = data.lastSyncedAt || null;
        this.rebuildIndexes();
        console.log(`[NaukriAccountTracker] Loaded ${this.appliedJobs.length} applied jobs (${this.appliedCleanCompanies.size} companies) from cache.`);
      }
    } catch (e) {
      console.warn('[NaukriAccountTracker] Error loading applied history cache:', e.message);
    }
  }

  rebuildIndexes() {
    this.appliedJobIds.clear();
    this.appliedCleanCompanies.clear();
    this.appliedRawCompanies.clear();

    for (const job of this.appliedJobs) {
      if (job.jobId) {
        this.appliedJobIds.add(String(job.jobId).trim());
      }
      if (job.company) {
        const rawComp = job.company.toLowerCase().trim();
        const cleanComp = cleanCompany(job.company);
        if (rawComp) this.appliedRawCompanies.add(rawComp);
        if (cleanComp && cleanComp.length >= 2) this.appliedCleanCompanies.add(cleanComp);
      }
    }

    this.totalApplied = this.appliedJobs.length;
    this.uniqueCompanies = this.appliedCleanCompanies.size;
  }

  saveToDisk() {
    try {
      const data = {
        lastSyncedAt: this.lastSyncedAt || new Date().toISOString(),
        totalApplied: this.appliedJobs.length,
        uniqueCompanies: this.appliedCleanCompanies.size,
        appliedJobs: this.appliedJobs
      };
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[NaukriAccountTracker] Error saving applied history to disk:', e.message);
    }
  }

  /**
   * Fetches full applied history directly from the user's Naukri account via Playwright context
   * @param {import('playwright').BrowserContext} context
   * @param {Function} notify
   */
  async syncFromNaukri(context, notify = () => {}) {
    notify('log', { level: 'info', message: '🔄 Verifying & syncing applied jobs from your Naukri account...' });

    let page = null;
    try {
      page = await context.newPage();
      await page.goto('https://www.naukri.com/myapply/historypage', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2000);

      const syncResult = await page.evaluate(async () => {
        const fetched = [];
        let pageNum = 1;
        let totalCount = 0;

        while (true) {
          const url = `https://www.naukri.com/cloudgateway-apply/whtma-services/v0/applyapi/v5/history?pageSize=100&days=365&filterInfo=2&pageNumber=${pageNum}`;
          try {
            const res = await fetch(url, {
              headers: {
                'accept': 'application/json, text/plain, */*',
                'clientid': 'd304',
                'appid': '109',
                'systemid': '109'
              }
            });
            if (!res.ok) break;
            const data = await res.json();
            totalCount = parseInt(data.matchingRowsCount, 10) || totalCount;
            const list = data.applyDetails || [];
            if (list.length === 0) break;

            for (const item of list) {
              fetched.push({
                jobId: item.jobId,
                jobTitle: item.jobTitle,
                company: item.company,
                location: item.location,
                applyType: item.applyType,
                status: item.status && item.status[0] ? item.status[0].statusValue : 'Applied',
                appliedDate: item.status && item.status[0] ? item.status[0].dateTime : null
              });
            }

            if (fetched.length >= totalCount || list.length < 100) break;
            pageNum++;
          } catch (fetchErr) {
            break;
          }
        }

        return {
          totalCount,
          jobs: fetched
        };
      });

      if (syncResult && Array.isArray(syncResult.jobs) && syncResult.jobs.length > 0) {
        this.appliedJobs = syncResult.jobs;
        this.lastSyncedAt = new Date().toISOString();
        this.rebuildIndexes();
        this.saveToDisk();

        notify('log', {
          level: 'success',
          message: `✅ Verified Naukri Account: Synced ${this.totalApplied} applied jobs across ${this.uniqueCompanies} companies!`
        });

        return {
          success: true,
          totalApplied: this.totalApplied,
          uniqueCompanies: this.uniqueCompanies,
          lastSyncedAt: this.lastSyncedAt
        };
      } else {
        notify('log', {
          level: 'warn',
          message: 'Notice: Could not fetch new applied history from Naukri. Using cached history.'
        });
        return {
          success: false,
          totalApplied: this.totalApplied,
          uniqueCompanies: this.uniqueCompanies,
          lastSyncedAt: this.lastSyncedAt
        };
      }
    } catch (err) {
      notify('log', {
        level: 'warn',
        message: `Naukri account sync note: ${err.message}. Using cached records (${this.appliedJobs.length} jobs).`
      });
      return {
        success: false,
        error: err.message,
        totalApplied: this.totalApplied,
        uniqueCompanies: this.uniqueCompanies,
        lastSyncedAt: this.lastSyncedAt
      };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * Checks if a company has already been applied to in Naukri account
   * @param {string} companyName
   * @returns {boolean}
   */
  isCompanyApplied(companyName) {
    if (!companyName) return false;
    const raw = companyName.toLowerCase().trim();
    if (this.appliedRawCompanies.has(raw)) return true;

    const cleaned = cleanCompany(companyName);
    if (!cleaned || cleaned.length < 2) return false;

    // 1. Direct match in clean companies set
    if (this.appliedCleanCompanies.has(cleaned)) return true;

    // 2. Substring & token match for company variations
    // E.g. "Virtusa Consulting" matches "virtusa", "Infosys Limited" matches "infosys"
    const candidateTokens = cleaned.split(' ').filter(t => t.length > 2);

    for (const appliedClean of this.appliedCleanCompanies) {
      // Direct substring
      if (appliedClean.length >= 4 && (cleaned.includes(appliedClean) || appliedClean.includes(cleaned))) {
        return true;
      }

      // Check token match if company has 2+ distinct words
      if (candidateTokens.length >= 1) {
        const appliedTokens = appliedClean.split(' ').filter(t => t.length > 2);
        // If single distinct brand name matches (e.g. "virtusa", "sysvine", "incedo", "bounteous")
        if (candidateTokens.length === 1 && appliedTokens.length === 1 && candidateTokens[0] === appliedTokens[0]) {
          return true;
        }
        // If multiple words match strongly
        const commonTokens = candidateTokens.filter(t => appliedTokens.includes(t));
        if (commonTokens.length >= 2 || (commonTokens.length >= 1 && candidateTokens.length <= 2 && commonTokens[0].length >= 5)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if a specific job ID or URL has already been applied to
   * @param {string} jobIdOrUrl
   * @returns {boolean}
   */
  isJobIdApplied(jobIdOrUrl) {
    if (!jobIdOrUrl) return false;
    const jobId = extractJobId(jobIdOrUrl);
    if (!jobId) return false;
    return this.appliedJobIds.has(String(jobId).trim());
  }

  /**
   * Checks if job is applied by company, jobId, or url
   * @param {string} jobTitle
   * @param {string} companyName
   * @param {string} urlOrJobId
   * @returns {boolean}
   */
  isApplied(jobTitle, companyName, urlOrJobId = null) {
    if (urlOrJobId && this.isJobIdApplied(urlOrJobId)) {
      return true;
    }
    if (companyName && this.isCompanyApplied(companyName)) {
      return true;
    }
    return false;
  }

  /**
   * Dynamically records a newly applied job into memory & disk cache
   * @param {object} job
   */
  recordNewApplication(job) {
    if (!job) return;
    const jobId = job.jobId || extractJobId(job.url || job.sourceUrl || job.appliedUrl);
    const newEntry = {
      jobId: jobId || `local_${Date.now()}`,
      jobTitle: job.jobTitle || job.title || '',
      company: job.companyName || job.company || '',
      location: job.location || '',
      applyType: job.applyType || 'easy_apply',
      status: job.status || 'Applied',
      appliedDate: new Date().toISOString()
    };

    this.appliedJobs.unshift(newEntry);
    this.rebuildIndexes();
    this.saveToDisk();
  }

  getStats() {
    return {
      totalApplied: this.totalApplied,
      uniqueCompanies: this.uniqueCompanies,
      lastSyncedAt: this.lastSyncedAt
    };
  }
}

module.exports = new NaukriAccountTracker();
