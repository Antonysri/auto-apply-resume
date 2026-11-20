const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const tracker = require('../engine/tracker');
const orchestrator = require('../engine/orchestrator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve captured proof screenshots
const proofsDir = path.join(__dirname, '..', 'proofs');
if (!fs.existsSync(proofsDir)) {
  fs.mkdirSync(proofsDir, { recursive: true });
}
app.use('/proofs', express.static(proofsDir));

// WebSocket broadcast
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Subscribe orchestrator events to WS
orchestrator.subscribe((event, data) => {
  broadcast(event, data);
});

// API Routes
app.get('/api/status', (req, res) => {
  const stats = tracker.getStats();
  res.json({
    isRunning: orchestrator.isRunning,
    stats
  });
});

app.get('/api/applications', (req, res) => {
  const dateFilter = req.query.date || 'all';
  const page = req.query.page !== undefined ? req.query.page : null;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
  res.json(tracker.getByDate(dateFilter, page, limit));
});

app.get('/api/analytics', (req, res) => {
  const dateFilter = req.query.date || 'today';
  res.json(tracker.getAnalytics(dateFilter));
});

app.get('/api/naukri/current-count', async (req, res) => {
  try {
    const browserManager = require('../engine/browser');
    const naukriVerifier = require('../engine/naukriVerifier');
    const context = await browserManager.launch({ headless: true });
    const count = await naukriVerifier.fetchCurrentAppliesCount(context);
    await browserManager.close();
    res.json({ count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/profile', (req, res) => {
  try {
    const profile = orchestrator.loadProfile();
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/profile', (req, res) => {
  try {
    const profilePath = path.join(__dirname, '..', 'config', 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/settings', (req, res) => {
  try {
    const settings = orchestrator.loadSettings();
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const settingsPath = path.join(__dirname, '..', 'config', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Trigger auto-apply on a single company careers URL
app.post('/api/apply-url', async (req, res) => {
  const { url, roles } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Run in background and return immediate ACK
  res.json({ success: true, message: `Auto-apply process started for: ${url}` });

  // Execute asynchronously
  orchestrator.processCompanyJobUrl(url, roles).catch(err => {
    broadcast('log', { level: 'error', message: `Job execution error: ${err.message}` });
  });
});

const naukriAuth = require('../engine/naukriAuth');

// Naukri Auth Status
app.get('/api/naukri/auth-status', (req, res) => {
  res.json({
    isLoggedIn: naukriAuth.isLoggedIn(),
    authFile: naukriAuth.getStorageStatePath()
  });
});

// Open Login Window for one-time Naukri connection
app.post('/api/naukri/login', async (req, res) => {
  res.json({ success: true, message: 'Opening Naukri login window in Chrome...' });

  naukriAuth.openLoginWindow((event, data) => {
    broadcast(event, data);
  }).catch(err => {
    broadcast('log', { level: 'error', message: `Login error: ${err.message}` });
  });
});

const naukriAccountTracker = require('../engine/naukriAccountTracker');

// Get Naukri Account Applied History Stats (e.g. 517 jobs across 395 companies)
app.get('/api/naukri/applied-stats', (req, res) => {
  res.json({
    success: true,
    stats: naukriAccountTracker.getStats()
  });
});

// Force sync applied history directly from live Naukri account
app.post('/api/naukri/sync-applied', async (req, res) => {
  try {
    const stats = await orchestrator.syncNaukriAppliedHistory();
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Trigger full Naukri search and auto-apply batch session (e.g. 100 jobs)
app.post('/api/scan-naukri', async (req, res) => {
  if (orchestrator.isRunning) {
    return res.status(400).json({ error: 'A scanning session is already running' });
  }

  const targetCount = parseInt(req.body.targetCount, 10) || 100;
  res.json({ success: true, message: `Naukri automated scanning session started for ${targetCount} jobs` });

  orchestrator.startNaukriScan(targetCount).catch(err => {
    broadcast('log', { level: 'error', message: `Naukri scanning error: ${err.message}` });
  });
});

// Search and filter Naukri jobs without applying (Preview Table)
app.post('/api/jobs/search', async (req, res) => {
  try {
    const { keyword, location, applyType, targetCount, minSalary, includeUnspecifiedSal, freshness, experience } = req.body;
    const result = await orchestrator.searchJobs({
      keyword,
      location,
      applyType,
      targetCount: parseInt(targetCount, 10) || 20,
      minSalary: parseFloat(minSalary) || 0,
      includeUnspecifiedSal: includeUnspecifiedSal !== false,
      freshness: freshness || 'all',
      experience: experience !== undefined && experience !== null && experience !== '' ? parseFloat(experience) : 5
    });
    res.json({ success: true, jobs: result.jobs, count: result.jobs.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Apply to selected discovered jobs in batch
app.post('/api/jobs/apply-batch', async (req, res) => {
  const { jobs } = req.body;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one job to apply.' });
  }

  if (orchestrator.isRunning) {
    return res.status(400).json({ error: 'A scanning or apply session is already active.' });
  }

  res.json({ success: true, message: `Batch auto-apply started for ${jobs.length} jobs.` });

  orchestrator.applySelectedJobs(jobs).catch(err => {
    broadcast('log', { level: 'error', message: `Batch apply error: ${err.message}` });
  });
});

const PORT = process.env.PORT || 4200;
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Auto-Apply Resume Server running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`===============================================`);
});
