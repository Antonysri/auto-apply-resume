const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function loginToNaukri() {
  console.log('=== Attempting Automated Naukri Login ===');
  
  const authFile = path.join(__dirname, '..', 'config', 'naukri_auth.json');
  const proofsDir = path.join(__dirname, '..', 'proofs');

  const browser = await chromium.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: true,
    slowMo: 100
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  console.log('1. Navigating to Naukri login page...');
  await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(3000);

  // Fill Email
  console.log('2. Entering Email: antonys27199@gmail.com...');
  await page.fill('#usernameField', 'antonys27199@gmail.com');
  await page.waitForTimeout(800);

  // Fill Password
  console.log('3. Entering Password...');
  await page.fill('#passwordField', 'Markantony777@gmail.com');
  await page.waitForTimeout(800);

  // Click Login
  console.log('4. Clicking Login button...');
  await page.click('button[type="submit"]:has-text("Login")');
  await page.waitForTimeout(6000);

  const currentUrl = page.url();
  console.log('Current URL after submit:', currentUrl);

  // Check if error message is displayed
  const errorMsg = await page.evaluate(() => {
    const errEl = document.querySelector('.server-err, .err, [class*="error"]');
    return errEl ? errEl.innerText.trim() : null;
  });
  if (errorMsg) {
    console.log('Notice/Error on page:', errorMsg);
  }

  // Check login success
  const cookies = await context.cookies();
  const isSessionPresent = cookies.some(c => c.name.includes('MYNAUKRI') || c.name === 'PS' || c.name === 'NKWAP');

  if (isSessionPresent || currentUrl.includes('/mnjuser/homepage') || !currentUrl.includes('/nlogin/login')) {
    console.log('✅ LOGIN SUCCESSFUL! Saving session state...');
    await context.storageState({ path: authFile });
    console.log(`Saved storageState to ${authFile}`);
  } else {
    console.log('Login pending verification or challenge.');
  }

  const screenshotPath = path.join(proofsDir, 'login_result.png');
  await page.screenshot({ path: screenshotPath });
  console.log('Screenshot captured:', screenshotPath);

  await browser.close();
}

loginToNaukri().catch(console.error);
