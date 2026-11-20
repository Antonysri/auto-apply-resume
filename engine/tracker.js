const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'applications.json');

function cleanCompany(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/\b(pvt|ltd|private|limited|technologies|technology|solutions|services|consulting|inc|corp|llp|holdings|software|labs)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanRole(title) {
  if (!title) return '';
  return title.toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJobId(url) {
  if (!url) return null;
  const match = url.match(/-(\d{8,15})/);
  return match ? match[1] : null;
}

class Tracker {
  constructor() {
    this.ensureDataDir();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  getAll() {
    try {
      this.ensureDataDir();
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const list = JSON.parse(raw);

      // Backfill missing appliedDate/appliedTime from appliedAt for older records
      for (const item of list) {
        if (!item.appliedDate && item.appliedAt) {
          const d = new Date(item.appliedAt);
          item.appliedDate = d.toISOString().split('T')[0];
          item.appliedTime = d.toLocaleTimeString();
        }
      }

      // Guarantee most recent applications are always on top (descending order)
      return list.sort((a, b) => {
        const timeA = new Date(a.appliedAt || a.appliedDate || 0).getTime();
        const timeB = new Date(b.appliedAt || b.appliedDate || 0).getTime();
        return timeB - timeA;
      });
    } catch (e) {
      console.error('Error reading applications DB:', e);
      return [];
    }
  }

  /**
   * Records a job application with full metadata and local date
   */
  recordApplication({
    jobTitle,
    companyName,
    sourceUrl,
    appliedUrl,
    atsType = 'Custom / External',
    status = 'SUCCESS',
    proofScreenshot = null,
    notes = '',
    jobId = null
  }) {
    const list = this.getAll();
    const now = new Date();
    const id = 'app_' + now.getTime() + '_' + Math.random().toString(36).substr(2, 5);
    
    // YYYY-MM-DD local date format for easy grouping
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString();

    const resolvedJobId = jobId || extractJobId(sourceUrl) || extractJobId(appliedUrl);

    const entry = {
      id,
      jobId: resolvedJobId,
      jobTitle: jobTitle || 'Unknown Role',
      companyName: companyName || 'Unknown Company',
      cleanCompany: cleanCompany(companyName),
      cleanRole: cleanRole(jobTitle),
      sourceUrl: sourceUrl || null,
      appliedUrl: appliedUrl || sourceUrl || null,
      atsType,
      status, // 'SUCCESS' | 'FAILED' | 'PENDING'
      proofScreenshot,
      notes,
      appliedDate: dateStr,
      appliedTime: timeStr,
      appliedAt: now.toISOString()
    };

    list.unshift(entry);
    fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2), 'utf-8');

    // Also sync to live Naukri account tracker cache
    if (status === 'SUCCESS' || status === 'PENDING') {
      try {
        const naukriAccountTracker = require('./naukriAccountTracker');
        naukriAccountTracker.recordNewApplication(entry);
      } catch (e) {}
    }

    return entry;
  }

  /**
   * Robust duplicate checker: prevents re-applying on subsequent days
   * Checks BOTH local applications.json AND Antony's 517+ Naukri account applied history!
   */
  isAlreadyApplied(jobTitle, companyName, url = null) {
    // 0. Check Antony's real Naukri Account Applied History (517+ applied jobs / 395+ companies)
    try {
      const naukriAccountTracker = require('./naukriAccountTracker');
      if (naukriAccountTracker.isApplied(jobTitle, companyName, url)) {
        return true;
      }
    } catch (e) {}

    const list = this.getAll();
    const cClean = cleanCompany(companyName);
    const rClean = cleanRole(jobTitle);
    const incomingJobId = extractJobId(url);

    for (const item of list) {
      // Only SUCCESS and PENDING are considered applied duplicates
      if (item.status && item.status !== 'SUCCESS' && item.status !== 'PENDING') {
        continue;
      }

      // 1. Direct Job ID match
      if (incomingJobId && item.jobId && item.jobId === incomingJobId) {
        return true;
      }

      // 2. Exact URL match
      if (url && (item.sourceUrl === url || item.appliedUrl === url)) {
        return true;
      }

      // 3. Same company and matching role tokens
      if (cClean && item.cleanCompany && (item.cleanCompany.includes(cClean) || cClean.includes(item.cleanCompany))) {
        // Compare role tokens
        const rTokens = rClean.split(' ').filter(t => t.length > 2);
        const itemTokens = (item.cleanRole || '').split(' ').filter(t => t.length > 2);
        const commonTokens = rTokens.filter(tok => itemTokens.includes(tok));

        if (commonTokens.length >= 2 || rClean === item.cleanRole) {
          // If already applied (SUCCESS or PENDING), never reapply
          if (item.status === 'SUCCESS' || item.status === 'PENDING') {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Filter applications by date ('today', 'yesterday', 'all', or YYYY-MM-DD)
   * Supports 10-item pagination (per page 10, recent on top)
   */
  getByDate(filter = 'all', page = null, limit = 10) {
    const list = this.getAll();
    let filtered = list;

    if (filter && filter !== 'all') {
      const todayStr = new Date().toISOString().split('T')[0];
      let targetDateStr = filter;

      if (filter === 'today') {
        targetDateStr = todayStr;
      } else if (filter === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        targetDateStr = yesterday.toISOString().split('T')[0];
      }

      filtered = list.filter(item => item.appliedDate === targetDateStr);
    }

    const total = filtered.length;

    // Return paginated response if page parameter is passed
    if (page !== null && page !== undefined && page !== '') {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.max(1, parseInt(limit, 10) || 10);
      const totalPages = Math.ceil(total / pageSize) || 1;
      const startIndex = (pageNum - 1) * pageSize;
      const items = filtered.slice(startIndex, startIndex + pageSize);

      return {
        items,
        total,
        page: pageNum,
        limit: pageSize,
        totalPages,
        startIndex: total === 0 ? 0 : startIndex + 1,
        endIndex: Math.min(startIndex + pageSize, total)
      };
    }

    return filtered;
  }

  /**
   * Get analytics & role breakdown for a given date or all time
   */
  getAnalytics(filterDate = 'today') {
    const list = this.getByDate(filterDate);
    const total = list.length;
    const success = list.filter(a => a.status === 'SUCCESS').length;
    const failed = list.filter(a => a.status === 'FAILED').length;
    const pending = list.filter(a => a.status === 'PENDING').length;

    const easyApplyCount = list.filter(a => (a.atsType || '').toLowerCase().includes('easy apply') || (a.atsType || '').toLowerCase().includes('1-click')).length;
    const companySiteCount = list.filter(a => !((a.atsType || '').toLowerCase().includes('easy apply') || (a.atsType || '').toLowerCase().includes('1-click')) && a.status === 'SUCCESS').length;

    // Role breakdown
    const roleCounts = {};
    for (const item of list) {
      const role = item.jobTitle || 'Other';
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    }

    // Company breakdown
    const companyCounts = {};
    for (const item of list) {
      const comp = item.companyName || 'Other';
      companyCounts[comp] = (companyCounts[comp] || 0) + 1;
    }

    return {
      filterDate,
      total,
      success,
      failed,
      pending,
      easyApplyCount,
      companySiteCount,
      roleCounts,
      companyCounts,
      records: list
    };
  }

  getStats() {
    const list = this.getAll();
    const todayStr = new Date().toISOString().split('T')[0];
    const todayList = list.filter(item => item.appliedDate === todayStr);

    return {
      total: list.length,
      success: list.filter(a => a.status === 'SUCCESS').length,
      failed: list.filter(a => a.status === 'FAILED').length,
      pending: list.filter(a => a.status === 'PENDING').length,
      appliedToday: todayList.filter(a => a.status === 'SUCCESS').length
    };
  }
}

module.exports = new Tracker();
