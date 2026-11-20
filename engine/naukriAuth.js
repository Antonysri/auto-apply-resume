const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const AUTH_FILE = path.join(__dirname, '..', 'config', 'naukri_auth.json');
const SESSION_DIR = path.join(__dirname, '..', '.login-session');

class NaukriAuth {
  isLoggedIn() {
    return fs.existsSync(AUTH_FILE);
  }

  getStorageStatePath() {
    return fs.existsSync(AUTH_FILE) ? AUTH_FILE : null;
  }

  /**
   * Opens a visible Chrome window to let Antony log into Naukri.
   * Automatically captures cookies & storageState upon successful login.
   */
  async openLoginWindow(notify = () => {}) {
    notify('log', { level: 'info', message: 'Opening Chrome for Naukri Login. Please click "Sign in with Google"...' });

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const context = await chromium.launchPersistentContext(SESSION_DIR, {
      executablePath: '/opt/google/chrome/chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const page = await context.newPage();
    await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });

    notify('log', { level: 'info', message: 'Browser window is open. Waiting for login completion...' });

    const startTime = Date.now();
    let loginSuccess = false;

    // Monitor for 5 minutes
    while (Date.now() - startTime < 300000) {
      await page.waitForTimeout(2000);

      const pages = context.pages();
      for (const p of pages) {
        try {
          const url = p.url();
          if (url.includes('/mnjuser/homepage') || url.includes('/my-naukri') || url.includes('/profiles/')) {
            loginSuccess = true;
            break;
          }
        } catch (e) {}
      }

      const cookies = await context.cookies().catch(() => []);
      const hasSessionCookie = cookies.some(c => 
        c.domain.includes('naukri.com') && (c.name.includes('MYNAUKRI') || c.name === 'PS' || c.name === 'NKWAP')
      );

      if (hasSessionCookie && loginSuccess) {
        break;
      }

      if (hasSessionCookie) {
        const hasUser = await page.evaluate(() => {
          return document.querySelector('.user-name, .nI-gNb-drawer__header-title, [class*="profile-name"]') !== null;
        }).catch(() => false);

        if (hasUser) {
          loginSuccess = true;
          break;
        }
      }
    }

    if (loginSuccess) {
      notify('log', { level: 'success', message: '🎉 Login detected! Saving session state...' });
      await context.storageState({ path: AUTH_FILE });
      notify('log', { level: 'success', message: 'Session permanently saved to config/naukri_auth.json!' });
      notify('auth_success', { status: 'CONNECTED', authFile: AUTH_FILE });
      await context.close().catch(() => {});
      return { success: true };
    } else {
      notify('log', { level: 'warn', message: 'Login window closed or timed out.' });
      await context.close().catch(() => {});
      return { success: false, error: 'Login timed out' };
    }
  }

  logout() {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
  }
}

module.exports = new NaukriAuth();
