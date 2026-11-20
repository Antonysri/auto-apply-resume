const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
  const context = await browser.newContext({
    storageState: '/home/oem/auto-apply-resume/config/naukri_auth.json',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(4000);

  const result = await page.evaluate(() => {
    // Search text of all elements containing 'Applies'
    const items = Array.from(document.querySelectorAll('*'))
      .filter(el => el.children.length === 0 && /Applies/i.test(el.innerText))
      .map(el => el.innerText.trim());

    const regexMatch = document.body.innerText.match(/Applies\s*\(\s*(\d+)\s*\)/i);
    return {
      items,
      regexMatch: regexMatch ? regexMatch[0] : null,
      count: regexMatch ? parseInt(regexMatch[1], 10) : null
    };
  });

  console.log('Detected result:', result);
  await browser.close();
})();
