const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  console.log('Navigating to Naukri home...');
  await page.goto('https://www.naukri.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Fill keyword
  await page.fill('input[placeholder*="Enter keyword"]', 'Node.js Developer');
  await page.waitForTimeout(500);

  // Fill location
  await page.fill('input[placeholder*="Enter location"]', 'Chennai');
  await page.waitForTimeout(500);

  // Click Search
  await page.click('.qsbSubmit, .nI-gNb-sb__icon-wrapper');
  await page.waitForTimeout(4000);

  console.log('Search Result URL:', page.url());
  const count = await page.evaluate(() => {
    return document.querySelectorAll('.srp-jobtuple-wrapper, .cust-job-tuple').length;
  });
  console.log('Jobs detected:', count);

  await browser.close();
})();
