const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function testSalesquaredFlow() {
  console.log('--- Starting Salesquared Autonomous Test ---');
  
  const proofsDir = path.join(__dirname, 'proofs');
  if (!fs.existsSync(proofsDir)) {
    fs.mkdirSync(proofsDir, { recursive: true });
  }

  const browser = await chromium.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  console.log('1. Navigating to Salesquared Careers page...');
  await page.goto('https://salesquared.io/careers.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Capture screenshot of careers page
  const careersScreenshot = path.join(proofsDir, 'salesquared_careers_page.png');
  await page.screenshot({ path: careersScreenshot, fullPage: false });
  console.log('Careers page captured:', careersScreenshot);

  // 2. Find target role: e.g. "Node.JS Developer" (handling fuzzy match / typo "Node.JS Develper")
  const targetRoleQuery = 'node';
  console.log(`2. Searching for job matching "${targetRoleQuery}"...`);

  const jobRows = await page.$$eval('table tr', (rows, query) => {
    const matched = [];
    for (const row of rows) {
      const text = row.innerText.toLowerCase();
      if (text.includes(query)) {
        const link = row.querySelector('a');
        matched.push({
          rowText: row.innerText.trim().replace(/\s+/g, ' '),
          applyUrl: link ? link.href : null,
          buttonText: link ? link.innerText.trim() : null
        });
      }
    }
    return matched;
  }, targetRoleQuery);

  console.log('Matched job rows:', JSON.stringify(jobRows, null, 2));

  if (jobRows.length === 0 || !jobRows[0].applyUrl) {
    console.error('Could not find job row or apply link!');
    await browser.close();
    return;
  }

  const applyUrl = jobRows[0].applyUrl;
  console.log(`3. Found Apply URL: ${applyUrl}`);

  // 4. Open the form page
  console.log('4. Navigating to the job application form...');
  const formPage = await context.newPage();
  await formPage.goto(applyUrl, { waitUntil: 'domcontentloaded' });
  await formPage.waitForTimeout(3000);

  // Capture screenshot of application form
  const formScreenshot = path.join(proofsDir, 'salesquared_form_page.png');
  await formPage.screenshot({ path: formScreenshot, fullPage: false });
  console.log('Application form captured:', formScreenshot);

  // 5. Inspect form fields on the page
  const formInfo = await formPage.evaluate(() => {
    const title = document.title;
    const isGoogleForm = window.location.hostname.includes('docs.google.com') || window.location.hostname.includes('forms.gle');
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
      tagName: el.tagName,
      type: el.type || '',
      name: el.name || '',
      placeholder: el.placeholder || '',
      ariaLabel: el.getAttribute('aria-label') || ''
    }));

    // Check for Google Form closed notice or questions
    const bodyText = document.body.innerText;
    const isClosed = bodyText.includes('no longer accepting responses');

    return {
      title,
      isGoogleForm,
      isClosed,
      inputCount: inputs.length,
      sampleInputs: inputs.slice(0, 10)
    };
  });

  console.log('Form Inspection Details:', JSON.stringify(formInfo, null, 2));

  await browser.close();
  console.log('--- Test Complete ---');
}

testSalesquaredFlow().catch(console.error);
