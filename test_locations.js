const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const locations = ['chennai', 'bangalore'];
  const keyword = 'node.js developer';

  for (const loc of locations) {
    const url = `https://www.naukri.com/${keyword.replace(/[^a-z0-9]/g, '-')}-jobs-in-${loc}?k=${encodeURIComponent(keyword)}&l=${loc}&experience=3`;
    console.log(`Checking ${loc}: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const count = await page.evaluate(() => {
      return document.querySelectorAll('.srp-jobtuple-wrapper, .cust-job-tuple').length;
    });
    console.log(`Jobs found in ${loc}:`, count);
  }

  await browser.close();
})();
