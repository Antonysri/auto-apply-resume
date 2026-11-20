const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function launchLoginHelper() {
  console.log('====================================================');
  console.log('🔑 Launching Chrome for One-Time Naukri Authentication');
  console.log('   Please click "Sign in with Google" (or enter OTP)');
  console.log('====================================================');

  const authFile = path.join(__dirname, '..', 'config', 'naukri_auth.json');
  const sessionDir = path.join(__dirname, '..', '.login-session');
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(sessionDir, {
    executablePath: '/opt/google/chrome/chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });

  const page = await context.newPage();
  await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded' });

  console.log('Browser opened. Waiting for login completion on Naukri...');

  // Poll for login success
  const startTime = Date.now();
  let loggedIn = false;

  while (Date.now() - startTime < 300000) { // 5 minutes window
    await page.waitForTimeout(2000);

    const pages = context.pages();
    for (const p of pages) {
      const url = p.url();
      if (url.includes('/mnjuser/homepage') || url.includes('/my-naukri') || url.includes('/profiles/')) {
        loggedIn = true;
        break;
      }
    }

    const cookies = await context.cookies();
    const hasNaukriSession = cookies.some(c => 
      c.domain.includes('naukri.com') && (c.name.includes('MYNAUKRI') || c.name === 'PS' || c.name === 'NKWAP')
    );

    if (hasNaukriSession && loggedIn) {
      break;
    }

    if (hasNaukriSession) {
      // Check if top navbar has user profile icon
      const hasUser = await page.evaluate(() => {
        return document.querySelector('.user-name, .nI-gNb-drawer__header-title, [class*="profile-name"]') !== null;
      }).catch(() => false);

      if (hasUser) {
        loggedIn = true;
        break;
      }
    }
  }

  if (loggedIn) {
    console.log('🎉 LOGIN CONFIRMED! Saving session tokens...');
    await context.storageState({ path: authFile });
    console.log(`✅ Session permanently saved to: ${authFile}`);
  } else {
    console.log('⚠️ Window closed or login timed out.');
  }

  await context.close();
}

launchLoginHelper().catch(console.error);
