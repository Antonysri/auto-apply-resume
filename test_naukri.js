const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const url = 'https://www.naukri.com/job-listings-react-js-node-js-developer-s-infosys-hyderabad-chennai-bengaluru-2-to-5-years-260826032376';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  console.log('Page Title:', await page.title());
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a.apply-button, .apply-button')).map(b => ({
      tag: b.tagName,
      text: b.innerText.trim(),
      className: b.className
    }));
  });

  console.log('Buttons:', buttons);
  await page.screenshot({ path: '/home/oem/auto-apply-resume/proofs/naukri_job_page.png' });
  await browser.close();
})();
