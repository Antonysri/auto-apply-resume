const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const naukriAuth = require('./naukriAuth');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
  }

  async launch(options = {}) {
    const headless = options.headless !== undefined ? options.headless : false;
    const slowMo = options.slowMo || 50;

    console.log(`[BrowserManager] Launching Chrome (Headless: ${headless})...`);

    const storageState = naukriAuth.getStorageStatePath();
    if (storageState) {
      console.log(`[BrowserManager] Loading saved Naukri session from: ${storageState}`);
    }

    try {
      this.browser = await chromium.launch({
        executablePath: '/opt/google/chrome/chrome',
        headless,
        slowMo
      });

      const contextOptions = {
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };

      if (storageState) {
        contextOptions.storageState = storageState;
      }

      this.context = await this.browser.newContext(contextOptions);
      console.log('[BrowserManager] Browser context initialized.');
      return this.context;
    } catch (err) {
      console.error('[BrowserManager] Browser launch error:', err);
      throw err;
    }
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    console.log('[BrowserManager] Browser closed.');
  }
}

module.exports = new BrowserManager();
