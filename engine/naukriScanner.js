/**
 * Naukri Scanner Engine (Batch 100+ Jobs Autonomous Runner)
 * Automates multi-page scanning, Easy Apply, and external "Apply on company site" redirects.
 * Strictly enforces:
 *  1. ZERO Naukri profile modifications.
 *  2. NEVER apply to Java, Python, Django, .NET, C#, Ruby, Go, Flutter, or any non-resume skills.
 *  3. Auto-fills 3 years experience for all target skills (Node, PHP, React, TS, Express, Mongo, MySQL, REST API, Git, Cloud, AWS).
 *  4. Notice period: Immediate / 0 Days, Current CTC: 3.6 LPA, Expected CTC: 6.0 LPA.
 */

const path = require('path');
const fs = require('fs');
const roleMatcher = require('./roleMatcher');
const formSolver = require('./formSolver');
const tracker = require('./tracker');
const naukriAccountTracker = require('./naukriAccountTracker');

const BLACKLIST_RULES = [
  { name: 'Python', regex: /\b(python|python3|pyspark|pandas|numpy)\b/i },
  { name: 'Django / Flask', regex: /\b(django|dajno|flask|fastapi)\b/i },
  { name: 'Java', regex: /\b(java|core\s*java|advanced\s*java|j2ee|spring|spring\s*boot|hibernate|quarkus|micronaut)\b(?!\s*script)/i },
  { name: '.NET / C#', regex: /(?:^|[^a-zA-Z0-9])(?:c#|csharp|c\s*sharp|\.net|\.\s*net|dotnet|dot\s*net|dot\.net|dot-net|asp\.net|asp\s*\.?net|vb\.net|vb\s*\.?net)(?:$|[^a-zA-Z0-9])/i },
  { name: 'C / C++', regex: /(^|[^a-zA-Z0-9])(c\+\+|embedded\s*c)($|[^a-zA-Z0-9])/i },
  { name: 'Ruby', regex: /\b(ruby|ruby\s*on\s*rails|rails)\b/i },
  { name: 'Golang', regex: /\b(golang|\bgo\s+developer\b)\b/i },
  { name: 'Rust', regex: /\b(rust|rustlang)\b/i },
  { name: 'Scala', regex: /\b(scala|akka)\b/i },
  { name: 'Flutter / Dart', regex: /\b(flutter|dart)\b/i },
  { name: 'Swift / iOS', regex: /\b(swift|swiftui|objective-c)\b/i },
  { name: 'Kotlin', regex: /\b(kotlin)\b/i }
];

// Lead roles regex: Candidate has 3 years exp, strictly skip Lead / Tech Lead / Leadership roles
const LEAD_TITLE_REGEX = /(?:^|[^a-zA-Z0-9])(?:lead|leads|leader|leaders|tech\s*lead|technical\s*lead|team\s*lead|team\s*leader|module\s*lead|project\s*lead|engineering\s*lead|lead\s*developer|lead\s*engineer|lead\s*consultant|lead\s*architect)(?:$|[^a-zA-Z0-9])/i;
const LEAD_PHRASES_REGEX = /\b(tech\s*lead|technical\s*lead|team\s*lead|team\s*leader|module\s*lead|project\s*lead|engineering\s*lead|role:\s*lead|position:\s*lead)\b/i;

// Core stack that Antony specializes in (Node.js, Express, React, MERN, PHP)
const CORE_STACK_REGEX = /(?:^|[^a-zA-Z0-9])(?:mern|node|nodejs|node\.js|\.node|react|reactjs|react\.js|\.react|express|expressjs|php)(?:$|[^a-zA-Z0-9])/i;

// Whitelist: At least one of Antony's resume core skills must be present
const WHITELIST_REGEX = /\b(node|nodejs|node\.js|express|expressjs|react|reactjs|react\.js|mern|php|full\s*stack|fullstack|backend|javascript|typescript|mongodb|mysql|rest\s*api|restful\s*api|api\s*developer|web\s*developer)\b/i;

class NaukriScanner {
  /**
   * Scans multiple pages on Naukri and applies up to targetCount jobs
   * @param {import('playwright').Page} page
   * @param {object} profile
   * @param {object} settings
   * @param {number} targetCount
   * @param {Function} notify
   */
  async scanAndApply(page, profile, settings, targetCount = 100, notify = () => {}) {
    notify('log', { level: 'info', message: `🚀 Starting Batch Auto-Apply Session for ${targetCount} jobs...` });

    const keyword = settings.search.keyword || 'Node.js Developer';
    const locationRaw = settings?.search?.location || 'Chennai, Bangalore, Thiruvananthapuram, Hyderabad';
    const locationList = locationRaw.split(/[,/|]/).map(l => l.trim().toLowerCase()).filter(Boolean);
    if (locationList.length === 0) locationList.push('chennai');
    const experience = settings?.search?.experience || 5;

    let appliedTotal = 0;
    let easyApplyCount = 0;
    let companySiteCount = 0;
    let skippedCount = 0;

    notify('log', { level: 'info', message: `📍 Locations configured: ${locationList.map(l => l.toUpperCase()).join(', ')}` });

    for (const loc of locationList) {
      if (appliedTotal >= targetCount) break;

      notify('log', { level: 'info', message: `🔍 Scanning for ${keyword} jobs in ${loc.toUpperCase()}...` });
      let currentPage = 1;
      const maxPagesPerLoc = Math.ceil(targetCount / 12) + 2;

      while (appliedTotal < targetCount && currentPage <= maxPagesPerLoc) {
        const slug = this.generateSlug(keyword);
        const searchUrl = `https://www.naukri.com/${slug}-jobs-in-${loc}?k=${encodeURIComponent(keyword)}&l=${encodeURIComponent(loc)}&experience=${experience}&pageNo=${currentPage}`;

        notify('log', { level: 'info', message: `📄 [${loc.toUpperCase()}] Navigating to Page ${currentPage}: ${searchUrl}` });
        try {
          await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(2000);
        } catch (e) {
          notify('log', { level: 'warn', message: `Page load warning on page ${currentPage}, proceeding with current DOM.` });
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        }
        await page.waitForSelector('.srp-jobtuple-wrapper, article.jobTuple, .cust-job-tuple', { timeout: 12000 }).catch(() => {});

        // Collect job card elements
        const jobCards = await page.$$('.srp-jobtuple-wrapper, article.jobTuple, .cust-job-tuple');
        notify('log', { level: 'info', message: `Found ${jobCards.length} job cards on Page ${currentPage}.` });

        if (jobCards.length === 0) {
          notify('log', { level: 'warn', message: `No more jobs found on Page ${currentPage} for ${loc.toUpperCase()}.` });
          break;
        }

        for (let i = 0; i < jobCards.length && appliedTotal < targetCount; i++) {
          const card = jobCards[i];

          try {
            // Extract job card information
            const jobInfo = await card.evaluate(el => {
              const titleEl = el.querySelector('a.title, .job-title, [class*="title"]');
              const compEl = el.querySelector('a.comp-name, .company-name, [class*="comp-name"]');
              const tags = Array.from(el.querySelectorAll('.tags-gt li, .tag-li, .dot-gt li')).map(li => li.innerText.trim());
              const expEl = el.querySelector('.exp-wrap, .experience, [class*="exp"]');
              const locEl = el.querySelector('.loc-wrap, .location, [class*="loc"]');

              return {
                title: titleEl ? titleEl.innerText.trim() : 'Unknown Role',
                url: titleEl ? titleEl.href : null,
                company: compEl ? compEl.innerText.trim() : 'Unknown Company',
                tags: tags.join(' '),
                experience: expEl ? expEl.innerText.trim() : '2-5 Yrs',
                fullText: el.innerText || ''
              };
            });

            // 1. Strict Skill Filtering: Check Blacklist (Python, Java, .NET, etc.) & Non-Resume Skills
            const filterCheck = this.checkBlacklist(`${jobInfo.title} ${jobInfo.tags} ${jobInfo.fullText}`, jobInfo.title);
            if (filterCheck.excluded) {
              notify('log', { level: 'warn', message: `⛔ [Filter] Skipping "${jobInfo.title}" at ${jobInfo.company} (${filterCheck.reason})` });
              skippedCount++;
              continue;
            }

            // 2. Lead Role Check (Candidate has 3 Yrs exp, skip all Lead / Tech Lead roles)
            if (this.isLeadRole(jobInfo.title)) {
              notify('log', { level: 'warn', message: `⛔ [Lead Filter] Skipping "${jobInfo.title}" at ${jobInfo.company} (Lead / Technical Lead role excluded)` });
              skippedCount++;
              continue;
            }

            // 3. Position Title Match Filter: Title MUST match the input keyword
            if (!this.matchesPositionTitle(jobInfo.title, keyword)) {
              notify('log', { level: 'info', message: `🔍 [Title Filter] Skipping "${jobInfo.title}" at ${jobInfo.company} (Position title does not match "${keyword}")` });
              skippedCount++;
              continue;
            }

            // 4. Experience Filter (Candidate experience <= job experience requirements)
            if (experience !== null && experience !== undefined) {
              const expInfo = this.parseExperienceYears(jobInfo.experience || '');
              if (expInfo.isDisclosed && expInfo.min > experience) {
                notify('log', { level: 'info', message: `⏳ [Exp Filter] Skipping "${jobInfo.title}" at ${jobInfo.company} (${jobInfo.experience} - min ${expInfo.min} yrs exceeds <= ${experience} yrs)` });
                skippedCount++;
                continue;
              }
            }

            // 2. Duplicate Check: Block re-applications to the same company & role (checks local DB & 517+ Naukri account history)
            if (tracker.isAlreadyApplied(jobInfo.title, jobInfo.company, jobInfo.url) || naukriAccountTracker.isCompanyApplied(jobInfo.company)) {
              notify('log', { level: 'info', message: `⏭️ [Duplicate] Already applied to ${jobInfo.company} in your Naukri account history. Skipping.` });
              skippedCount++;
              continue;
            }

            notify('log', { level: 'info', message: `🎯 [${appliedTotal + 1}/${targetCount}] Processing: ${jobInfo.title} at ${jobInfo.company}` });

            if (!jobInfo.url) continue;

            // Open job page in new browser tab
            const jobPage = await page.context().newPage();
            try {
              await jobPage.goto(jobInfo.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
              await jobPage.waitForTimeout(2500);

              // Double check page content for blacklisted skills in actual JD container (excluding sidebar recommendation ads)
              const jdText = await jobPage.evaluate(() => {
                const jdContainer = document.querySelector('.styles_job-desc-container__txpYf, .job-desc, [class*="job-desc"], [class*="styles_JDC__dang-inner-html"], section[class*="job-desc"]');
                return jdContainer ? jdContainer.innerText : (document.body.innerText || '');
              });
              const jdFilter = this.checkBlacklist(`${jobInfo.title} ${jdText.slice(0, 3000)}`, jobInfo.title);
              if (jdFilter.excluded) {
                notify('log', { level: 'warn', message: `⛔ [Filter] Skipping "${jobInfo.title}" - JD explicitly requires ${jdFilter.reason}` });
                await jobPage.close();
                skippedCount++;
                continue;
              }

              // Check if already applied directly on Naukri
              const isAlreadyAppliedOnNaukri = await jobPage.evaluate(() => {
                const bodyText = (document.body.innerText || '').toLowerCase();
                const appliedBtn = Array.from(document.querySelectorAll('button, a')).some(b => 
                  (b.innerText || '').toLowerCase().trim() === 'applied'
                );
                return appliedBtn || bodyText.includes('you have already applied');
              });

              if (isAlreadyAppliedOnNaukri) {
                notify('log', { level: 'info', message: `ℹ️ Already applied to ${jobInfo.company} on Naukri. Recording and moving on.` });
                tracker.recordApplication({
                  jobTitle: jobInfo.title,
                  companyName: jobInfo.company,
                  sourceUrl: jobInfo.url,
                  appliedUrl: jobInfo.url,
                  atsType: 'Naukri (Previously Applied)',
                  status: 'SUCCESS',
                  notes: 'Already marked as applied on Naukri'
                });
                await jobPage.close();
                continue;
              }

              // Determine apply button type (Easy Apply vs Apply on company site)
              const applyBtnInfo = await jobPage.evaluate(() => {
                const allBtns = Array.from(document.querySelectorAll('button, a'));
                const btn = allBtns.find(b => {
                  const txt = (b.innerText || '').toLowerCase();
                  return txt.includes('apply on company site') || txt.trim() === 'apply';
                });

                if (!btn) return null;
                const isCompanySite = (btn.innerText || '').toLowerCase().includes('company site');
                return {
                  isCompanySite,
                  text: btn.innerText.trim(),
                  selector: btn.tagName
                };
              });

              if (!applyBtnInfo) {
                notify('log', { level: 'warn', message: `No active apply button found for ${jobInfo.title}. Skipping.` });
                await jobPage.close();
                continue;
              }

              if (applyBtnInfo.isCompanySite) {
                // --- Case A: Apply on Company Site (External ATS / Careers) ---
                notify('log', { level: 'info', message: `🏢 "Apply on company site" detected for ${jobInfo.company}. Redirecting...` });

                const [companyPage] = await Promise.all([
                  jobPage.context().waitForEvent('page', { timeout: 12000 }).catch(() => null),
                  jobPage.evaluate(() => {
                    const b = Array.from(document.querySelectorAll('button, a')).find(el => 
                      (el.innerText || '').toLowerCase().includes('apply on company site')
                    );
                    if (b) b.click();
                  })
                ]);

                const targetCompanyPage = companyPage || jobPage;
                await targetCompanyPage.waitForLoadState('domcontentloaded');
                await targetCompanyPage.waitForTimeout(3000);

                notify('log', { level: 'info', message: `🌐 Landed on external portal: ${targetCompanyPage.url()}` });

                // Locate target role and solve form
                const matchResult = await roleMatcher.findAndTriggerJob(targetCompanyPage, profile.targetRoles);
                let formPage = targetCompanyPage;

                if (matchResult.applyUrl && matchResult.applyUrl !== targetCompanyPage.url()) {
                  await targetCompanyPage.goto(matchResult.applyUrl, { waitUntil: 'domcontentloaded' });
                  formPage = targetCompanyPage;
                }

                const solveResult = await formSolver.solveForm(formPage, profile, {
                  autoSubmit: settings.automation.autoSubmit
                });

                tracker.recordApplication({
                  jobTitle: jobInfo.title,
                  companyName: jobInfo.company,
                  sourceUrl: jobInfo.url,
                  appliedUrl: formPage.url(),
                  atsType: solveResult.atsType,
                  status: solveResult.success ? 'SUCCESS' : 'FAILED',
                  proofScreenshot: solveResult.proofPath,
                  notes: solveResult.message
                });

                if (solveResult.success) {
                  appliedTotal++;
                  companySiteCount++;
                  notify('applied', {
                    jobTitle: jobInfo.title,
                    companyName: jobInfo.company,
                    atsType: solveResult.atsType,
                    status: 'SUCCESS'
                  });
                  notify('log', { level: 'success', message: `✅ External application completed for ${jobInfo.company}! Total: ${appliedTotal}/${targetCount}` });
                }

                if (companyPage) await companyPage.close().catch(() => {});

              } else {
                // --- Case B: Direct Naukri Easy Apply (1-Click with Screening Questionnaire) ---
                notify('log', { level: 'info', message: `⚡ 1-Click Naukri Apply detected for ${jobInfo.company}. Clicking Apply...` });

                const applyClicked = await jobPage.evaluate(() => {
                  const b = Array.from(document.querySelectorAll('button, a')).find(el => 
                    (el.innerText || '').toLowerCase().trim() === 'apply'
                  );
                  if (b) {
                    b.click();
                    return true;
                  }
                  return false;
                });

                if (applyClicked) {
                  await jobPage.waitForTimeout(2500);

                  // Check for immediate error banner
                  const immediateErr = await this.checkNaukriErrorBanner(jobPage);
                  if (immediateErr.hasError) {
                    const proofsDir = path.join(__dirname, '..', 'proofs');
                    if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir, { recursive: true });
                    const proofFilename = `naukri_error_${Date.now()}.png`;
                    await jobPage.screenshot({ path: path.join(proofsDir, proofFilename) }).catch(() => {});

                    notify('log', {
                      level: 'error',
                      message: `🛑 [Naukri Apply Blocked] "${immediateErr.errorMessage}". Daily quota limit reached (50 jobs limit). Resets at 12:00 AM midnight!`
                    });
                    tracker.recordApplication({
                      jobTitle: jobInfo.title,
                      companyName: jobInfo.company,
                      sourceUrl: jobInfo.url,
                      appliedUrl: jobInfo.url,
                      atsType: 'Naukri 1-Click Apply',
                      status: 'QUOTA_EXCEEDED',
                      proofScreenshot: proofFilename,
                      notes: `Naukri Error: "${immediateErr.errorMessage}". Daily application quota reached.`
                    });
                    await jobPage.close();
                    return {
                      appliedTotal,
                      easyApplyCount,
                      companySiteCount,
                      skippedCount,
                      quotaExceeded: true
                    };
                  }

                  // Handle multi-step screening questionnaire / chatbot questions
                  const qnaResult = await this.handleNaukriChatbotQuestions(jobPage, profile, notify);
                  await jobPage.waitForTimeout(2000);

                  // Check for error banner after questionnaire submission
                  const postQnaErr = await this.checkNaukriErrorBanner(jobPage);
                  if (postQnaErr.hasError) {
                    const proofsDir = path.join(__dirname, '..', 'proofs');
                    if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir, { recursive: true });
                    const proofFilename = `naukri_error_${Date.now()}.png`;
                    await jobPage.screenshot({ path: path.join(proofsDir, proofFilename) }).catch(() => {});

                    notify('log', {
                      level: 'error',
                      message: `🛑 [Naukri Apply Blocked] "${postQnaErr.errorMessage}" after questionnaire. Daily quota reached.`
                    });
                    tracker.recordApplication({
                      jobTitle: jobInfo.title,
                      companyName: jobInfo.company,
                      sourceUrl: jobInfo.url,
                      appliedUrl: jobInfo.url,
                      atsType: 'Naukri 1-Click Apply',
                      status: 'QUOTA_EXCEEDED',
                      proofScreenshot: proofFilename,
                      notes: `Naukri Error: "${postQnaErr.errorMessage}". Daily application quota reached.`
                    });
                    await jobPage.close();
                    return {
                      appliedTotal,
                      easyApplyCount,
                      companySiteCount,
                      skippedCount,
                      quotaExceeded: true
                    };
                  }

                  // Check for 100% applied status:
                  // 1. Chatbot reached "Thank you for your responses" / completed
                  // 2. Page has "Applied" button
                  // 3. Page body contains "you have already applied" / "application submitted" / "thank you for your responses"
                  let hasApplied = qnaResult.completed;
                  let applyConfirmedBy = qnaResult.completed ? (qnaResult.reason || 'Thank you for your responses') : '';

                  if (!hasApplied) {
                    const pageStatus = await jobPage.evaluate(() => {
                      const bodyText = (document.body.innerText || '').toLowerCase();
                      const btns = Array.from(document.querySelectorAll('button, span, a')).map(el => (el.innerText || '').trim().toLowerCase());
                      if (btns.includes('applied') || bodyText.includes('you have already applied')) {
                        return { applied: true, reason: 'Applied badge' };
                      }
                      if (
                        bodyText.includes('thank you for your responses') ||
                        bodyText.includes('thank you for your response') ||
                        bodyText.includes('thanks for your response') ||
                        bodyText.includes('thanks for response') ||
                        bodyText.includes('thank you for your time') ||
                        bodyText.includes('responses have been recorded') ||
                        bodyText.includes('response has been submitted') ||
                        bodyText.includes('application submitted') ||
                        bodyText.includes('applied successfully')
                      ) {
                        return { applied: true, reason: 'Thank you for your responses' };
                      }
                      return { applied: false, reason: '' };
                    });

                    if (pageStatus.applied) {
                      hasApplied = true;
                      applyConfirmedBy = pageStatus.reason;
                    }
                  }

                  if (!hasApplied) {
                    await jobPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                    await this.waitForCleanProofState(jobPage);
                    hasApplied = await jobPage.evaluate(() => {
                      const bodyText = (document.body.innerText || '').toLowerCase();
                      const btns = Array.from(document.querySelectorAll('button, span, a')).map(el => (el.innerText || '').trim().toLowerCase());
                      return btns.includes('applied') || bodyText.includes('you have already applied');
                    });
                    if (hasApplied) applyConfirmedBy = 'Applied badge after reload';
                  } else {
                    await this.waitForCleanProofState(jobPage);
                  }

                  // Capture clean proof screenshot of Naukri apply
                  const proofsDir = path.join(__dirname, '..', 'proofs');
                  if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir, { recursive: true });
                  const proofFilename = `naukri_apply_${Date.now()}.png`;
                  await jobPage.screenshot({ path: path.join(proofsDir, proofFilename) });

                  if (hasApplied) {
                    tracker.recordApplication({
                      jobTitle: jobInfo.title,
                      companyName: jobInfo.company,
                      sourceUrl: jobInfo.url,
                      appliedUrl: jobInfo.url,
                      atsType: 'Naukri 1-Click Apply',
                      status: 'SUCCESS',
                      proofScreenshot: proofFilename,
                      notes: qnaResult.answered
                        ? `100% Applied via Recruiter Chat (${qnaResult.count} answers filled, confirmed: ${applyConfirmedBy || 'Thank you for your responses'})`
                        : `Direct apply confirmed (${applyConfirmedBy || 'Applied badge'})`
                    });

                    appliedTotal++;
                    easyApplyCount++;
                    notify('applied', {
                      jobTitle: jobInfo.title,
                      companyName: jobInfo.company,
                      atsType: 'Naukri 1-Click Apply',
                      status: 'SUCCESS'
                    });
                    notify('log', { level: 'success', message: `✅ Direct apply 100% successful for ${jobInfo.company} (${applyConfirmedBy || 'Confirmed'})! Total: ${appliedTotal}/${targetCount}` });
                  } else {
                    tracker.recordApplication({
                      jobTitle: jobInfo.title,
                      companyName: jobInfo.company,
                      sourceUrl: jobInfo.url,
                      appliedUrl: jobInfo.url,
                      atsType: 'Naukri 1-Click Apply',
                      status: 'FAILED',
                      proofScreenshot: proofFilename,
                      notes: 'Application attempted, but Applied or Thank You confirmation could not be verified.'
                    });
                  }
                }
              }

            } catch (jobErr) {
              notify('log', { level: 'warn', message: `Error applying to ${jobInfo.company}: ${jobErr.message}` });
            } finally {
              await jobPage.close().catch(() => {});
            }

            // Human-like randomized pause between applications
            const pauseMs = settings.limits.pauseBetweenJobsMs || 3500;
            await page.waitForTimeout(pauseMs);

          } catch (cardErr) {
            notify('log', { level: 'error', message: `Error processing job card: ${cardErr.message}` });
          }
        }

        currentPage++;
      }
    }

    notify('log', {
      level: 'success',
      message: `🎉 Batch application completed! Applied: ${appliedTotal} (Easy Apply: ${easyApplyCount}, Company Sites: ${companySiteCount}), Skipped: ${skippedCount}`
    });

    return {
      appliedTotal,
      easyApplyCount,
      companySiteCount,
      skippedCount
    };
  }

  /**
   * Searches and filters Naukri jobs based on keyword, location, and applyType filter
   * (Easy Apply Only, Apply on Company Site Only, or All Jobs).
   * Strictly filters out company sites if easy_apply is selected!
   * @param {import('playwright').BrowserContext} context
   * @param {object} options
   * @param {Function} notify
   */
  async searchAndFilterJobs(context, options = {}, notify = () => {}) {
    const keyword = options.keyword || 'Node.js Developer';
    const locationRaw = options.location || 'Chennai, Bangalore, Thiruvananthapuram, Hyderabad';
    const locationList = locationRaw.split(/[,/|]/).map(l => l.trim().toLowerCase()).filter(Boolean);
    if (locationList.length === 0) locationList.push('chennai');
    const applyTypeFilter = (options.applyType || 'all').toLowerCase(); // 'all', 'easy_apply', 'company_site'
    const targetCount = parseInt(options.targetCount, 10) || 20;

    // Experience filter: optional input (e.g. 1, 2, 3, or 5 years). Defaults to 5 if unspecified.
    const filterExperience = (options.experience !== undefined && options.experience !== null && options.experience !== '')
      ? parseFloat(options.experience)
      : 5;
    const searchExperienceParam = filterExperience !== null ? filterExperience : 5;

    const minSalary = parseFloat(options.minSalary) || 0;
    const includeUnspecifiedSal = options.includeUnspecifiedSal !== false;
    const freshness = options.freshness && options.freshness !== 'all' ? parseInt(options.freshness, 10) : 0;

    const freshnessLabel = freshness > 0 ? ` | Freshness: Last ${freshness} Day(s)` : '';
    const expLabel = filterExperience !== null ? ` | Exp: <= ${filterExperience} Yrs` : '';
    notify('log', {
      level: 'info',
      message: `🔍 Starting Job Filter Search: "${keyword}" in ${locationList.map(l => l.toUpperCase()).join(', ')} | Mode: ${applyTypeFilter.toUpperCase()}${minSalary > 0 ? ` | Min Salary: ${minSalary} LPA+` : ''}${expLabel}${freshnessLabel}`
    });

    const page = await context.newPage();
    const discoveredJobs = [];
    const seenUrls = new Set();
    let totalScanned = 0;

    // Verify & ensure Naukri Account Applied History (517+ jobs) is loaded
    if (naukriAccountTracker.totalApplied === 0) {
      await naukriAccountTracker.syncFromNaukri(context, notify);
    } else {
      notify('log', {
        level: 'info',
        message: `🛡️ Verified Naukri Applied History: ${naukriAccountTracker.totalApplied} applied jobs across ${naukriAccountTracker.uniqueCompanies} companies loaded for duplicate exclusion.`
      });
    }

    try {
      for (const loc of locationList) {
        if (discoveredJobs.length >= targetCount) break;

        let currentPage = 1;
        const maxPages = Math.max(12, Math.ceil(targetCount / 4) + 5);

        while (discoveredJobs.length < targetCount && currentPage <= maxPages) {
          const pageParam = currentPage > 1 ? `&pageNo=${currentPage}` : '';
          const freshnessParam = freshness > 0 ? `&freshness=${freshness}&jobAge=${freshness}` : '';
          const slug = this.generateSlug(keyword);
          const searchUrl = `https://www.naukri.com/${slug}-jobs-in-${loc}?k=${encodeURIComponent(keyword)}&l=${encodeURIComponent(loc)}&experience=${searchExperienceParam}${pageParam}${freshnessParam}`;

          notify('log', { level: 'info', message: `📄 [${loc.toUpperCase()}] Fetching Page ${currentPage}: ${searchUrl}` });
          try {
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
          } catch (e) {
            notify('log', { level: 'warn', message: `Page load note: ${e.message}` });
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          }

          try {
            await page.waitForSelector('a[href*="job-listings"], .cust-job-tuple, .srp-jobtuple-wrapper', { timeout: 15000 });
          } catch (_) {}
          await page.waitForTimeout(1500);

          // Extract job links and card metadata with retry for frame navigation / context destruction
          let rawPageJobs = [];
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              rawPageJobs = await page.evaluate(() => {
                const jobLinks = Array.from(document.querySelectorAll('a[href*="job-listings"]'));
                const seen = new Set();
                const list = [];

                for (const a of jobLinks) {
                  const href = a.href || a.getAttribute('href') || '';
                  const titleText = (a.innerText || a.getAttribute('title') || '').trim();
                  if (!seen.has(href) && href.includes('job-listings') && titleText.length > 2) {
                    seen.add(href);
                    let card = a;
                    while (card && card.parentElement && card.parentElement !== document.body) {
                      if (card.className && typeof card.className === 'string' && (card.className.includes('tuple') || card.className.includes('srp-jobtuple'))) {
                        break;
                      }
                      card = card.parentElement;
                    }

                    const title = titleText;
                    const url = href;
                    const comp = card ? (card.querySelector('a.comp-name, .comp-name, [class*="comp-name"]')?.innerText.trim() || 
                                         card.querySelector('a[href*="/cmp/"]')?.innerText.trim() ||
                                         'Company') : 'Company';
                    const exp = card ? (card.querySelector('.exp-wrap, [class*="exp"]')?.innerText.trim() || '2-5 Yrs') : '2-5 Yrs';
                    const sal = card ? (card.querySelector('.sal-wrap, [class*="sal"]')?.innerText.trim() || 'Not disclosed') : 'Not disclosed';
                    const loc = card ? (card.querySelector('.loc-wrap, [class*="loc"]')?.innerText.trim() || 'Chennai') : 'Chennai';
                    const tags = card ? Array.from(card.querySelectorAll('ul.tags-gt li, [class*="tag"]')).map(li => li.innerText.trim()).filter(Boolean).join(' ') : '';
                    
                    // Bulletproof posted text extraction
                    let postedText = '';
                    const dateEl = card ? card.querySelector('.job-post-day, .posted-date, [class*="job-post-day"], [class*="posted-date"], span[class*="date"]') : null;
                    if (dateEl && dateEl.innerText) {
                      postedText = dateEl.innerText.trim();
                    }
                    const cardText = card ? (card.innerText || '') : '';
                    if (!postedText && cardText) {
                      const postMatch = cardText.match(/posted:?\s*([0-9\+\w\s]+?(?:ago|today|just now))/i);
                      if (postMatch) {
                        postedText = postMatch[1].trim();
                      } else {
                        const rawM = cardText.match(/(\d+\+?\s*(?:day|week|month)s?\s*ago|just now|today|few hours?\s*ago|\d+\s*hours?\s*ago|yesterday)/i);
                        if (rawM) {
                          postedText = rawM[1].trim();
                        }
                      }
                    }
                    if (postedText) {
                      const cleanM = postedText.match(/(\d+\+?\s*(?:day|week|month)s?\s*ago|just now|today|few hours?\s*ago|\d+\s*hours?\s*ago|yesterday)/i);
                      if (cleanM) {
                        postedText = cleanM[1].trim();
                      }
                    }

                    const isCompanySite = cardText.toLowerCase().includes('external site') || 
                                          cardText.toLowerCase().includes('company site') || 
                                          cardText.toLowerCase().includes('web job') ||
                                          url.includes('external');

                    list.push({
                      title,
                      company: comp,
                      experience: exp,
                      salary: sal,
                      location: loc,
                      tags,
                      url,
                      postedText: postedText || '',
                      isCompanySiteCard: isCompanySite,
                      fullText: cardText
                    });
                  }
                }
                return list;
              });
              break;
            } catch (evalErr) {
              const errMsg = evalErr ? evalErr.message : '';
              if (errMsg.includes('Execution context was destroyed') || errMsg.includes('navigation') || errMsg.includes('Target closed')) {
                notify('log', { level: 'warn', message: `Page navigation detected during evaluation (attempt ${attempt}/3), waiting for page to settle...` });
                await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                await page.waitForTimeout(2500);
                if (attempt === 3) {
                  notify('log', { level: 'warn', message: `Could not evaluate page after 3 attempts due to navigation.` });
                  rawPageJobs = [];
                }
              } else {
                throw evalErr;
              }
            }
          }

          if (rawPageJobs.length === 0) {
            notify('log', { level: 'info', message: `No more job cards on page ${currentPage} for ${loc.toUpperCase()}` });
            break;
          }

          totalScanned += rawPageJobs.length;

          // 1. Filter candidates by strict Blacklist (Python, Java, etc.) and Whitelist (Node, React, etc.)
          const candidateJobs = [];
          for (const rj of rawPageJobs) {
            if (seenUrls.has(rj.url)) continue;
            seenUrls.add(rj.url);

            // 0. Account Applied Check: Skip any company already applied in user's Naukri account (517+ jobs)
            if (naukriAccountTracker.isCompanyApplied(rj.company) || naukriAccountTracker.isJobIdApplied(rj.url) || tracker.isAlreadyApplied(rj.title, rj.company, rj.url)) {
              notify('log', {
                level: 'info',
                message: `⏭️ [Already Applied] Skipping "${rj.title}" at "${rj.company}" (Already applied in your Naukri account: 517+ history)`
              });
              continue;
            }

            // 1. Skill Blacklist Check
            const filterCheck = this.checkBlacklist(`${rj.title} ${rj.tags} ${rj.fullText}`, rj.title);
            if (filterCheck.excluded) continue;

            // 2. Lead Role Check (Candidate has 3 Yrs exp, skip all Lead / Tech Lead roles)
            if (this.isLeadRole(rj.title)) {
              notify('log', {
                level: 'info',
                message: `⏭️ [Lead Filter] Skipping "${rj.title}" at ${rj.company} (Lead / Technical Lead role excluded)`
              });
              continue;
            }

            // 3. Position Title Match Filter: Title MUST match the input keyword
            if (!this.matchesPositionTitle(rj.title, keyword)) {
              notify('log', {
                level: 'info',
                message: `🔍 [Title Filter] Skipping "${rj.title}" at ${rj.company} (Position title does not match "${keyword}")`
              });
              continue;
            }

            // 4. Experience Filter (Strict: job minimum required experience <= filterExperience)
            if (filterExperience !== null) {
              const expInfo = this.parseExperienceYears(rj.experience);
              if (expInfo.isDisclosed && expInfo.min > filterExperience) {
                notify('log', {
                  level: 'info',
                  message: `⏳ [Exp Filter] Skipping "${rj.title}" at ${rj.company} (${rj.experience} - min ${expInfo.min} yrs exceeds requested <= ${filterExperience} yrs)`
                });
                continue;
              }
            }

            // Freshness / Date Posted Filter (Strict: daysAgo <= freshness)
            if (freshness > 0) {
              const daysAgo = this.parsePostedDays(rj.postedText);
              if (daysAgo > freshness) {
                notify('log', {
                  level: 'info',
                  message: `⏳ [Date Filter] Skipping "${rj.title}" at ${rj.company} (${rj.postedText || 'No date'} - ${daysAgo}d ago exceeds ${freshness}d limit)`
                });
                continue;
              }
            }

            // 2. Minimum Salary (LPA) Filter
            if (minSalary > 0) {
              const salInfo = this.parseSalaryLpa(rj.salary);
              if (salInfo.isDisclosed) {
                // If package max is lower than minSalary requested, exclude
                if (salInfo.max < minSalary) {
                  continue;
                }
                // If package starts below minSalary and user requested min package
                if (salInfo.min < minSalary && salInfo.max < minSalary) {
                  continue;
                }
              } else {
                // "Not disclosed" handling
                if (!includeUnspecifiedSal) {
                  continue;
                }
              }
            }

            candidateJobs.push(rj);
          }

          // 2. Parallel Apply Type Verification (inspects the actual button in parallel chunks of 5)
          // 2. Parallel Apply Type Verification (inspects the actual button in parallel chunks of 3)
          const chunkSize = 3;
          for (let i = 0; i < candidateJobs.length && discoveredJobs.length < targetCount; i += chunkSize) {
            const chunk = candidateJobs.slice(i, i + chunkSize);
            const verifiedChunk = await Promise.all(chunk.map(async (job) => {
              const p = await context.newPage();
              try {
                await p.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await p.waitForSelector('button, a', { timeout: 8000 }).catch(() => {});
                await p.waitForTimeout(1500);

                const btnInfo = await p.evaluate(() => {
                  const bodyText = (document.body.innerText || '').toLowerCase();
                  const btns = Array.from(document.querySelectorAll('button, a')).map(b => (b.innerText || '').toLowerCase().trim());
                  const hasCompanySite = btns.some(t => t.includes('company site')) || bodyText.includes('apply on company site');
                  const hasApplied = btns.some(t => t === 'applied') || bodyText.includes('you have already applied');
                  const hasEasyApply = btns.some(t => t === 'apply');
                  return { hasCompanySite, hasEasyApply, hasApplied };
                });
                await p.close();

                let detectedType = 'easy_apply';
                if (btnInfo.hasCompanySite || job.isCompanySiteCard) {
                  detectedType = 'company_site';
                } else if (btnInfo.hasEasyApply || btnInfo.hasApplied) {
                  detectedType = 'easy_apply';
                }

                return {
                  ...job,
                  applyType: detectedType,
                  alreadyAppliedOnNaukri: btnInfo.hasApplied,
                  alreadyAppliedInDb: tracker.isAlreadyApplied(job.title, job.company, job.url) || naukriAccountTracker.isApplied(job.title, job.company, job.url)
                };
              } catch (e) {
                await p.close().catch(() => {});
                return {
                  ...job,
                  applyType: job.isCompanySiteCard ? 'company_site' : 'easy_apply',
                  alreadyAppliedOnNaukri: false,
                  alreadyAppliedInDb: tracker.isAlreadyApplied(job.title, job.company, job.url) || naukriAccountTracker.isApplied(job.title, job.company, job.url)
                };
              }
            }));

            // 3. Apply User's Apply Type Filter
            for (const item of verifiedChunk) {
              if (discoveredJobs.length >= targetCount) break;

              // Rule: If Easy Apply is selected, MUST NOT include company site jobs!
              if (applyTypeFilter === 'easy_apply' && item.applyType !== 'easy_apply') {
                continue;
              }
              // Rule: If Company Site is selected, MUST NOT include easy apply jobs!
              if (applyTypeFilter === 'company_site' && item.applyType !== 'company_site') {
                continue;
              }

              // Main Goal: If already applied in Naukri account, NEVER include in filter list!
              const isApplied = item.alreadyAppliedOnNaukri || item.alreadyAppliedInDb || naukriAccountTracker.isApplied(item.title, item.company, item.url);
              if (isApplied) {
                notify('log', {
                  level: 'info',
                  message: `⏭️ [Already Applied] Excluding "${item.title}" at "${item.company}" from filter list (Already applied in Naukri account)`
                });
                continue;
              }

              discoveredJobs.push({
                id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                title: item.title,
                company: item.company,
                experience: item.experience,
                salary: item.salary,
                location: item.location,
                tags: item.tags,
                url: item.url,
                postedText: item.postedText || 'Recent',
                applyType: item.applyType,
                alreadyApplied: false,
                status: 'READY'
              });
            }
          }

          currentPage++;
        }
      }
    } finally {
      await page.close().catch(() => {});
    }

    notify('log', {
      level: 'success',
      message: `🎯 Filter complete: Discovered ${discoveredJobs.length} jobs (Filter: ${applyTypeFilter.toUpperCase()}, Scanned: ${totalScanned})`
    });

    return {
      jobs: discoveredJobs,
      totalScanned,
      count: discoveredJobs.length
    };
  }

  /**
   * Applies to a list of selected jobs one by one with live progress updates
   * @param {import('playwright').BrowserContext} context
   * @param {Array} jobList
   * @param {object} profile
   * @param {object} settings
   * @param {Function} notify
   */
  async applyToJobList(context, jobList, profile, settings, notify = () => {}) {
    let appliedCount = 0;
    let skippedCount = 0;
    let quotaExceeded = false;

    notify('log', {
      level: 'info',
      message: `🚀 Starting Autonomous Auto-Apply for ${jobList.length} jobs in queue...`
    });

    for (let i = 0; i < jobList.length; i++) {
      const job = jobList[i];

      notify('job_apply_progress', {
        index: i + 1,
        total: jobList.length,
        jobId: job.id,
        jobTitle: job.title,
        companyName: job.company,
        status: 'APPLYING',
        message: `Applying to ${job.company}...`
      });

      const res = await this.applySingleJob(context, job, profile, settings, notify);

      if (res.status === 'QUOTA_EXCEEDED') {
        quotaExceeded = true;
        notify('job_apply_progress', {
          index: i + 1,
          total: jobList.length,
          jobId: job.id,
          jobTitle: job.title,
          companyName: job.company,
          status: 'QUOTA_EXCEEDED',
          message: '🛑 Naukri Daily Application Quota Reached! Resets at midnight.'
        });
        break;
      }

      if (res.status === 'SUCCESS') {
        appliedCount++;
        notify('job_apply_progress', {
          index: i + 1,
          total: jobList.length,
          jobId: job.id,
          jobTitle: job.title,
          companyName: job.company,
          status: 'SUCCESS',
          proofScreenshot: res.proofScreenshot,
          notes: res.notes,
          message: `✅ Applied to ${job.company}`
        });
      } else {
        skippedCount++;
        notify('job_apply_progress', {
          index: i + 1,
          total: jobList.length,
          jobId: job.id,
          jobTitle: job.title,
          companyName: job.company,
          status: res.status || 'SKIPPED',
          notes: res.notes,
          message: res.notes || `Skipped ${job.company}`
        });
      }

      const pauseMs = settings?.limits?.pauseBetweenJobsMs || 3000;
      await new Promise(r => setTimeout(r, pauseMs));
    }

    notify('log', {
      level: quotaExceeded ? 'warn' : 'success',
      message: `🎉 Batch Auto-Apply complete! Applied: ${appliedCount}, Skipped: ${skippedCount}${quotaExceeded ? ' (Stopped due to Naukri Daily Quota limit)' : ''}`
    });

    return {
      appliedCount,
      skippedCount,
      quotaExceeded
    };
  }

  /**
   * Applies to a single job (handles both direct Easy Apply & Company Site)
   * Strictly enforces:
   * - ZERO Naukri profile modifications
   * - Solves questionnaire with 3 yrs exp, Immediate notice, 3.6 CTC, 6.0 expected CTC
   * - Captures proof screenshot
   * - Records in tracker
   */
  async applySingleJob(context, jobInfo, profile, settings, notify = () => {}) {
    // 1. Duplicate check in DB
    if (tracker.isAlreadyApplied(jobInfo.title, jobInfo.company)) {
      notify('log', { level: 'info', message: `⏭️ [Duplicate] Already applied to ${jobInfo.company}. Skipping.` });
      return { status: 'ALREADY_APPLIED', notes: 'Already recorded in database' };
    }

    if (!jobInfo.url) {
      return { status: 'FAILED', notes: 'No job URL provided' };
    }

    const jobPage = await context.newPage();
    try {
      notify('log', { level: 'info', message: `🌐 Navigating to ${jobInfo.company}: ${jobInfo.title}...` });
      await jobPage.goto(jobInfo.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await jobPage.waitForTimeout(2500);

      // Check JD for blacklisted skills in actual JD container (excluding sidebar recommendation ads)
      const jdText = await jobPage.evaluate(() => {
        const jdContainer = document.querySelector('.styles_job-desc-container__txpYf, .job-desc, [class*="job-desc"], [class*="styles_JDC__dang-inner-html"], section[class*="job-desc"]');
        return jdContainer ? jdContainer.innerText : (document.body.innerText || '');
      });
      const jdFilter = this.checkBlacklist(`${jobInfo.title} ${jdText.slice(0, 3000)}`, jobInfo.title);
      if (jdFilter.excluded) {
        notify('log', { level: 'warn', message: `⛔ [Filter] Skipping "${jobInfo.title}" - JD requires ${jdFilter.reason}` });
        tracker.recordApplication({
          jobTitle: jobInfo.title,
          companyName: jobInfo.company,
          sourceUrl: jobInfo.url,
          appliedUrl: jobInfo.url,
          atsType: 'Skill Filter',
          status: 'SKIPPED',
          notes: `Job description requires non-matching skill: ${jdFilter.reason}. Filtered out to avoid irrelevant applications.`
        });
        return { status: 'SKIPPED', notes: `JD requires ${jdFilter.reason}` };
      }

      // Check if already applied on Naukri
      const isAlreadyAppliedOnNaukri = await jobPage.evaluate(() => {
        const bodyText = (document.body.innerText || '').toLowerCase();
        const appliedBtn = Array.from(document.querySelectorAll('button, a')).some(b => 
          (b.innerText || '').toLowerCase().trim() === 'applied'
        );
        return appliedBtn || bodyText.includes('you have already applied');
      });

      if (isAlreadyAppliedOnNaukri) {
        notify('log', { level: 'info', message: `ℹ️ Marked as already applied on Naukri for ${jobInfo.company}` });
        tracker.recordApplication({
          jobTitle: jobInfo.title,
          companyName: jobInfo.company,
          sourceUrl: jobInfo.url,
          appliedUrl: jobInfo.url,
          atsType: 'Naukri (Previously Applied)',
          status: 'SUCCESS',
          notes: 'Already marked as applied on Naukri'
        });
        return { status: 'SUCCESS', notes: 'Already applied on Naukri' };
      }

      // Determine apply button
      const applyBtnInfo = await jobPage.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll('button, a'));
        const btn = allBtns.find(b => {
          const txt = (b.innerText || '').toLowerCase();
          return txt.includes('apply on company site') || txt.trim() === 'apply';
        });

        if (!btn) return null;
        const isCompanySite = (btn.innerText || '').toLowerCase().includes('company site');
        return { isCompanySite, text: btn.innerText.trim() };
      });

      if (!applyBtnInfo) {
        notify('log', { level: 'warn', message: `No apply button found for ${jobInfo.company}. Skipping.` });
        tracker.recordApplication({
          jobTitle: jobInfo.title,
          companyName: jobInfo.company,
          sourceUrl: jobInfo.url,
          appliedUrl: jobInfo.url,
          atsType: 'Naukri Direct',
          status: 'FAILED',
          notes: 'No active Apply button found on job page. Opening link directly may show application closed or expired.'
        });
        return { status: 'FAILED', notes: 'No active apply button on job page' };
      }

      if (applyBtnInfo.isCompanySite) {
        // --- External Company Site Application ---
        notify('log', { level: 'info', message: `🏢 "Apply on company site" detected for ${jobInfo.company}. Following portal...` });

        const [companyPage] = await Promise.all([
          context.waitForEvent('page', { timeout: 12000 }).catch(() => null),
          jobPage.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button, a')).find(el => 
              (el.innerText || '').toLowerCase().includes('apply on company site')
            );
            if (b) b.click();
          })
        ]);

        const targetCompanyPage = companyPage || jobPage;
        await targetCompanyPage.waitForLoadState('domcontentloaded');
        await targetCompanyPage.waitForTimeout(3000);

        const matchResult = await roleMatcher.findAndTriggerJob(targetCompanyPage, profile.targetRoles);
        let formPage = targetCompanyPage;

        if (matchResult.applyUrl && matchResult.applyUrl !== targetCompanyPage.url()) {
          await targetCompanyPage.goto(matchResult.applyUrl, { waitUntil: 'domcontentloaded' });
          formPage = targetCompanyPage;
        }

        const solveResult = await formSolver.solveForm(formPage, profile, {
          autoSubmit: settings.automation.autoSubmit
        });

        tracker.recordApplication({
          jobTitle: jobInfo.title,
          companyName: jobInfo.company,
          sourceUrl: jobInfo.url,
          appliedUrl: formPage.url(),
          atsType: solveResult.atsType,
          status: solveResult.success ? 'SUCCESS' : 'FAILED',
          proofScreenshot: solveResult.proofPath,
          notes: solveResult.message
        });

        if (companyPage) await companyPage.close().catch(() => {});

        return {
          status: solveResult.success ? 'SUCCESS' : 'FAILED',
          atsType: solveResult.atsType,
          proofScreenshot: solveResult.proofPath,
          notes: solveResult.message
        };

      } else {
        // --- Direct 1-Click Easy Apply on Naukri ---
        notify('log', { level: 'info', message: `⚡ 1-Click Naukri Apply for ${jobInfo.company}...` });

        const applyClicked = await jobPage.evaluate(() => {
          const b = Array.from(document.querySelectorAll('button, a')).find(el => 
            (el.innerText || '').toLowerCase().trim() === 'apply'
          );
          if (b) {
            b.click();
            return true;
          }
          return false;
        });

        if (!applyClicked) {
          tracker.recordApplication({
            jobTitle: jobInfo.title,
            companyName: jobInfo.company,
            sourceUrl: jobInfo.url,
            appliedUrl: jobInfo.url,
            atsType: 'Naukri 1-Click Apply',
            status: 'FAILED',
            notes: 'Apply button click was unhandled or blocked by page structure'
          });
          return { status: 'FAILED', notes: 'Could not click Apply button' };
        }

        await jobPage.waitForTimeout(2500);

        // 1. Check for immediate error banner (e.g. daily quota reached or server error)
        const immediateErr = await this.checkNaukriErrorBanner(jobPage);
        if (immediateErr.hasError) {
          const proofsDir = path.join(__dirname, '..', 'proofs');
          if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir, { recursive: true });
          const proofFilename = `naukri_error_${Date.now()}.png`;
          await jobPage.screenshot({ path: path.join(proofsDir, proofFilename) }).catch(() => {});

          notify('log', {
            level: 'error',
            message: `🛑 [Naukri Apply Blocked] "${immediateErr.errorMessage}" on ${jobInfo.company}. Daily apply quota limit (50 jobs/day) reached for today. Resets automatically at 12:00 AM midnight.`
          });

          tracker.recordApplication({
            jobTitle: jobInfo.title,
            companyName: jobInfo.company,
            sourceUrl: jobInfo.url,
            appliedUrl: jobInfo.url,
            atsType: 'Naukri 1-Click Apply',
            status: 'QUOTA_EXCEEDED',
            proofScreenshot: proofFilename,
            notes: `Naukri Error: "${immediateErr.errorMessage}". Daily application quota (50 jobs limit) reached for today. Resets automatically at 12:00 AM midnight.`
          });
          return { status: 'QUOTA_EXCEEDED', notes: immediateErr.errorMessage, proofScreenshot: proofFilename };
        }

        // 2. Handle multi-step chatbot / screening questionnaire
        const qnaResult = await this.handleNaukriChatbotQuestions(jobPage, profile, notify);
        await jobPage.waitForTimeout(2000);

        // 3. Check for error banner after questionnaire submission
        const postQnaErr = await this.checkNaukriErrorBanner(jobPage);
        if (postQnaErr.hasError) {
          const proofsDir = path.join(__dirname, '..', 'proofs');
          if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir, { recursive: true });
          const proofFilename = `naukri_error_${Date.now()}.png`;
          await jobPage.screenshot({ path: path.join(proofsDir, proofFilename) }).catch(() => {});

          notify('log', {
            level: 'error',
            message: `🛑 [Naukri Apply Failed] "${postQnaErr.errorMessage}" on ${jobInfo.company} after questionnaire submission. Daily apply limit reached.`
          });

          tracker.recordApplication({
            jobTitle: jobInfo.title,
            companyName: jobInfo.company,
            sourceUrl: jobInfo.url,
            appliedUrl: jobInfo.url,
            atsType: 'Naukri 1-Click Apply',
            status: 'QUOTA_EXCEEDED',
            proofScreenshot: proofFilename,
            notes: `Naukri Error: "${postQnaErr.errorMessage}". Daily application quota (50 jobs limit) reached for today.`
          });
          return { status: 'QUOTA_EXCEEDED', notes: postQnaErr.errorMessage, proofScreenshot: proofFilename };
        }

        // 4. Verify 100% applied state:
        // A. Chatbot reached "Thank you for your responses" / completed
        // B. Green "Applied" badge on page
        // C. Body text contains applied / thank you confirmation
        let hasApplied = qnaResult.completed;
        let applyConfirmedBy = qnaResult.completed ? (qnaResult.reason || 'Thank you for your responses') : '';

        if (!hasApplied) {
          const pageStatus = await jobPage.evaluate(() => {
            const bodyText = (document.body.innerText || '').toLowerCase();
            const btns = Array.from(document.querySelectorAll('button, span, a')).map(el => (el.innerText || '').trim().toLowerCase());
            if (btns.includes('applied') || bodyText.includes('you have already applied')) {
              return { applied: true, reason: 'Applied badge' };
            }
            if (
              bodyText.includes('thank you for your responses') ||
              bodyText.includes('thank you for your response') ||
              bodyText.includes('thanks for your response') ||
              bodyText.includes('thanks for response') ||
              bodyText.includes('thank you for your time') ||
              bodyText.includes('responses have been recorded') ||
              bodyText.includes('response has been submitted') ||
              bodyText.includes('application submitted') ||
              bodyText.includes('applied successfully')
            ) {
              return { applied: true, reason: 'Thank you for your responses' };
            }
            return { applied: false, reason: '' };
          });

          if (pageStatus.applied) {
            hasApplied = true;
            applyConfirmedBy = pageStatus.reason;
          }
        }

        if (!hasApplied) {
          await jobPage.waitForTimeout(2500);
          const retryCheck = await jobPage.evaluate(() => {
            const bodyText = (document.body.innerText || '').toLowerCase();
            const btns = Array.from(document.querySelectorAll('button, span, a')).map(el => (el.innerText || '').trim().toLowerCase());
            return btns.includes('applied') ||
                   bodyText.includes('you have already applied') ||
                   bodyText.includes('thank you for your response') ||
                   bodyText.includes('thank you for your responses') ||
                   bodyText.includes('thanks for response') ||
                   bodyText.includes('responses have been recorded');
          });
          if (retryCheck) {
            hasApplied = true;
            applyConfirmedBy = 'Applied / Thank you confirmation';
          }
        }

        if (!hasApplied) {
          // If still not detected, reload page and check again as last resort
          await jobPage.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await this.waitForCleanProofState(jobPage);
          hasApplied = await jobPage.evaluate(() => {
            const bodyText = (document.body.innerText || '').toLowerCase();
            const btns = Array.from(document.querySelectorAll('button, span, a')).map(el => (el.innerText || '').trim().toLowerCase());
            return btns.includes('applied') || bodyText.includes('you have already applied');
          });
          if (hasApplied) applyConfirmedBy = 'Applied badge after reload';
        } else {
          // Wait for clean non-skeleton page rendering
          await this.waitForCleanProofState(jobPage);
        }

        // 5. Capture clean proof screenshot (without skeleton grey placeholders)
        const proofsDir = path.join(__dirname, '..', 'proofs');
        if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir, { recursive: true });
        const proofFilename = `naukri_apply_${Date.now()}.png`;
        await jobPage.screenshot({ path: path.join(proofsDir, proofFilename) });

        if (hasApplied) {
          tracker.recordApplication({
            jobTitle: jobInfo.title,
            companyName: jobInfo.company,
            sourceUrl: jobInfo.url,
            appliedUrl: jobInfo.url,
            atsType: 'Naukri 1-Click Apply',
            status: 'SUCCESS',
            proofScreenshot: proofFilename,
            notes: qnaResult.answered
              ? `100% Applied via Recruiter Chat (${qnaResult.count} answers filled, confirmed: ${applyConfirmedBy || 'Thank you for your responses'})`
              : `Direct apply confirmed (${applyConfirmedBy || 'Applied badge'})`
          });

          notify('applied', {
            jobTitle: jobInfo.title,
            companyName: jobInfo.company,
            atsType: 'Naukri 1-Click Apply',
            status: 'SUCCESS'
          });

          return {
            status: 'SUCCESS',
            atsType: 'Naukri 1-Click Apply',
            proofScreenshot: proofFilename,
            notes: qnaResult.answered ? `Questionnaire answered (${qnaResult.count} fields filled, ${applyConfirmedBy})` : 'Direct apply successful'
          };
        } else {
          // Fallback if applied badge could not be verified
          tracker.recordApplication({
            jobTitle: jobInfo.title,
            companyName: jobInfo.company,
            sourceUrl: jobInfo.url,
            appliedUrl: jobInfo.url,
            atsType: 'Naukri 1-Click Apply',
            status: 'FAILED',
            proofScreenshot: proofFilename,
            notes: 'Application submitted, but green Applied or Thank you confirmation was not confirmed on page.'
          });

          return {
            status: 'FAILED',
            notes: 'Could not confirm Applied status on Naukri'
          };
        }
      }

    } catch (err) {
      notify('log', { level: 'error', message: `Apply error on ${jobInfo.company}: ${err.message}` });
      return { status: 'FAILED', notes: err.message };
    } finally {
      await jobPage.close().catch(() => {});
    }
  }

  /**
   * Strict Skill Filtering:
   * 1. If the job title explicitly matches Antony's core stack (MERN, Node.js, React, Express, Fullstack, Frontend, Backend, PHP),
   *    and does NOT have a blacklisted language in the title, it is a 100% core target role and MUST NEVER be skipped
   *    due to secondary/optional mentions of Python/Java in JD or sidebar recommendations.
   * Strict Skill Filtering:
   * 1. Direct Title Blacklist Check: Excludes roles explicitly for Python, Java, .NET, C#, Ruby, Go, Flutter, Swift, etc.
   *    (e.g., "Full Stack .NET Developer", "Dot Net Developer", "C# Developer", "Python Developer").
   * 2. Core Target Title Protection: If title explicitly mentions MERN, Node.js, React, Express, PHP, etc.,
   *    and passed title blacklist, it is 100% protected and never skipped due to sidebar ads (e.g. TVM Infotech).
   * 3. For generic titles (e.g. "Software Engineer", "Full Stack Developer", "Backend Developer"):
   *    Strictly excludes roles requiring blacklisted tech (.NET, Java, etc.) without Antony's core stack.
   */
  checkBlacklist(text, title = '') {
    if (!text && !title) return { excluded: false };

    const cleanTitle = (title || '').toLowerCase().trim();

    // 0. Lead Role Title Check (Candidate has 3 Yrs exp, strictly skip Lead / Tech Lead roles)
    if (this.isLeadRole(cleanTitle)) {
      return { excluded: true, reason: 'Position is a Lead / Tech Lead role' };
    }

    // 1. Direct Title Blacklist Check (Always exclude if title is explicitly for blacklisted tech)
    for (const item of BLACKLIST_RULES) {
      if (item.regex.test(cleanTitle)) {
        return { excluded: true, reason: `Title requires ${item.name}` };
      }
    }

    // 2. Core Target Title Protection:
    // If title explicitly mentions MERN, Node, React, Express, PHP, etc. (and passed title blacklist above):
    const hasCoreSkillInTitle = CORE_STACK_REGEX.test(cleanTitle);
    if (hasCoreSkillInTitle) {
      // Core target jobs (e.g. "MERN Developer", "Backend Developer - .Node JS", "React Developer")
      // MUST NEVER be rejected just because Python or Java is mentioned in sidebars or optional bullets!
      return { excluded: false };
    }

    // 3. For generic titles (e.g. "Software Engineer", "Full Stack Developer", "Backend Developer"):
    // Check if blacklisted tech is present in text/JD
    let hasBlacklistSkill = false;
    let blacklistReason = '';
    for (const item of BLACKLIST_RULES) {
      if (item.regex.test(text)) {
        hasBlacklistSkill = true;
        blacklistReason = `Requires ${item.name}`;
        break;
      }
    }

    const hasCoreStack = CORE_STACK_REGEX.test(text);
    const hasWhitelistSkill = WHITELIST_REGEX.test(text);

    // If a generic title requires blacklisted tech (like .NET or Java) and DOES NOT have Antony core stack:
    if (hasBlacklistSkill && !hasCoreStack) {
      return { excluded: true, reason: blacklistReason };
    }

    // If blacklisted tech is present along with core stack, verify it is not predominantly a blacklisted role
    if (hasBlacklistSkill && hasCoreStack) {
      // If the blacklist rule is .NET/C#, Antony does not do .NET
      if (/c#|\.net|dotnet|dot\s*net|asp\.net/i.test(blacklistReason)) {
        return { excluded: true, reason: blacklistReason };
      }
    }

    // Check if JD requires a Tech Lead / Team Lead role
    if (LEAD_PHRASES_REGEX.test(text)) {
      return { excluded: true, reason: 'JD requires Tech Lead / Team Lead role' };
    }

    if (!hasWhitelistSkill) {
      return { excluded: true, reason: 'Skills not present in Antony resume' };
    }

    return { excluded: false };
  }

  /**
   * Checks if a title is for a Lead / Tech Lead / Leadership role
   * (Antony has 3 years experience; Lead positions require 7-10+ years and are not suitable)
   */
  isLeadRole(title) {
    if (!title) return false;
    const clean = (title || '').toLowerCase().trim();
    return LEAD_TITLE_REGEX.test(clean);
  }

  /**
   * Checks if the job position title matches the user-configured search keyword
   * @param {string} title - Job position title
   * @param {string} keyword - Search keyword from filter UI (e.g. "Node.js Developer")
   * @returns {boolean}
   */
  matchesPositionTitle(title, keyword) {
    if (!keyword || !keyword.trim()) return true;

    // Handle comma or pipe separated multiple keywords e.g. "Node.js, React Developer"
    const subKeywords = keyword.split(/[,|]/).map(k => k.trim()).filter(Boolean);
    if (subKeywords.length > 1) {
      return subKeywords.some(subKey => this.matchesPositionTitle(title, subKey));
    }

    const normTitle = (title || '').toLowerCase().trim();
    const normKeyword = (keyword || '').toLowerCase().trim();

    // 1. Direct exact or substring match
    if (normTitle.includes(normKeyword)) return true;

    // 2. Canonical Skill Mapping
    const skillAliases = [
      {
        canonical: 'node',
        patterns: [/\b(node|nodejs|node\.js|\.node)\b/i],
        titleMatches: [/\b(node|nodejs|node\.js|\.node|mern)\b/i]
      },
      {
        canonical: 'react',
        patterns: [/\b(react|reactjs|react\.js|\.react)\b/i],
        titleMatches: [/\b(react|reactjs|react\.js|\.react|mern)\b/i]
      },
      {
        canonical: 'mern',
        patterns: [/\b(mern|mern\s*stack)\b/i],
        titleMatches: [/\b(mern|node|nodejs|node\.js|\.node|react|reactjs|react\.js)\b/i]
      },
      {
        canonical: 'express',
        patterns: [/\b(express|expressjs|express\.js)\b/i],
        titleMatches: [/\b(express|expressjs|express\.js|mern|node)\b/i]
      },
      {
        canonical: 'fullstack',
        patterns: [/\b(full\s*stack|fullstack)\b/i],
        titleMatches: [/\b(full\s*stack|fullstack|mern)\b/i]
      },
      {
        canonical: 'frontend',
        patterns: [/\b(front\s*end|frontend)\b/i],
        titleMatches: [/\b(front\s*end|frontend|react|ui\s*developer)\b/i]
      },
      {
        canonical: 'backend',
        patterns: [/\b(back\s*end|backend)\b/i],
        titleMatches: [/\b(back\s*end|backend|node|php)\b/i]
      },
      {
        canonical: 'php',
        patterns: [/\bphp\b/i],
        titleMatches: [/\b(php|laravel|codeigniter|wordpress)\b/i]
      },
      {
        canonical: 'javascript',
        patterns: [/\b(javascript|js)\b/i],
        titleMatches: [/\b(javascript|node|react|mern|frontend|backend)\b/i]
      },
      {
        canonical: 'typescript',
        patterns: [/\b(typescript|ts)\b/i],
        titleMatches: [/\b(typescript|ts|node|react)\b/i]
      }
    ];

    let matchedAnyAliasInKeyword = false;
    for (const alias of skillAliases) {
      const keywordHasSkill = alias.patterns.some(p => p.test(normKeyword));
      if (keywordHasSkill) {
        matchedAnyAliasInKeyword = true;
        const titleMatches = alias.titleMatches.some(p => p.test(normTitle));
        if (titleMatches) {
          return true;
        }
      }
    }

    if (matchedAnyAliasInKeyword) {
      return false;
    }

    // 3. Custom / arbitrary keyword tokenization (e.g. "Angular", "Vue", "AWS")
    const fillerRegex = /\b(developer|engineers?|programmers?|software|specialists?|consultants?|analysts?|openings?|jobs?|hiring|expert|lead|architect)\b/gi;
    const cleanKeyword = normKeyword.replace(fillerRegex, ' ').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = cleanKeyword.split(' ').filter(t => t.length >= 2);

    if (tokens.length > 0) {
      return tokens.some(token => normTitle.includes(token));
    }

    return /\b(developer|engineer|specialist|programmer)\b/i.test(normTitle);
  }

  generateSlug(keyword) {
    if (!keyword || !keyword.trim()) return 'jobs';
    return keyword.toLowerCase()
      .replace(/\.js\b/gi, '-dot-js')
      .replace(/\./g, '-dot-')
      .replace(/\+/g, '-plus-')
      .replace(/#/g, '-sharp-')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'jobs';
  }

  /**
   * Parses salary string to extract min and max in LPA
   * Supports "4-8 Lacs PA", "3.5 - 7 LPA", "500000 - 1000000", "Not disclosed"
   */
  parseSalaryLpa(salaryText) {
    if (!salaryText) return { min: 0, max: 0, isDisclosed: false };
    const text = salaryText.toLowerCase().replace(/,/g, '').trim();

    if (text.includes('not disclosed') || text.includes('unspecified') || text === '') {
      return { min: 0, max: 0, isDisclosed: false };
    }

    // Range with Lacs/Lakh/LPA e.g. "4-8 Lacs PA", "3.5 - 7.5 LPA"
    const rangeMatch = text.match(/([\d\.]+)\s*(?:-|to)\s*([\d\.]+)\s*(?:lac|lakh|lpa)/i);
    if (rangeMatch) {
      return {
        min: parseFloat(rangeMatch[1]),
        max: parseFloat(rangeMatch[2]),
        isDisclosed: true
      };
    }

    // Single value with Lacs/Lakh/LPA e.g. "5 Lacs PA"
    const singleMatch = text.match(/([\d\.]+)\s*(?:lac|lakh|lpa)/i);
    if (singleMatch) {
      const val = parseFloat(singleMatch[1]);
      return { min: val, max: val, isDisclosed: true };
    }

    // Rupee amounts e.g. "400000 - 800000"
    const nums = text.match(/(\d{5,8})/g);
    if (nums && nums.length >= 2) {
      return {
        min: parseFloat(nums[0]) / 100000,
        max: parseFloat(nums[1]) / 100000,
        isDisclosed: true
      };
    } else if (nums && nums.length === 1) {
      const val = parseFloat(nums[0]) / 100000;
      return { min: val, max: val, isDisclosed: true };
    }

    return { min: 0, max: 0, isDisclosed: false };
  }

  /**
   * Parses experience text into min and max years
   * Supports "0-1 Yrs", "0-2 Yrs", "2-5 Yrs", "3-5 years", "3+ Yrs", "Fresher"
   */
  parseExperienceYears(expText) {
    if (!expText) return { min: 0, max: 99, isDisclosed: false };
    const text = (expText || '').toLowerCase().replace(/,/g, '').trim();

    if (text.includes('fresher')) {
      return { min: 0, max: 0, isDisclosed: true };
    }

    // Range e.g. "0-2 Yrs", "2-5 Yrs", "3 - 5 years", "1 to 3 Yrs"
    const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/i);
    if (rangeMatch) {
      return {
        min: parseFloat(rangeMatch[1]),
        max: parseFloat(rangeMatch[2]),
        isDisclosed: true
      };
    }

    // Single value e.g. "3+ Yrs", "3 years", "3 Yrs", "min 2 years"
    const singleMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:\+|yrs?|years?)?/i);
    if (singleMatch) {
      const val = parseFloat(singleMatch[1]);
      return {
        min: val,
        max: val,
        isDisclosed: true
      };
    }

    return { min: 0, max: 99, isDisclosed: false };
  }

  /**
   * Parses posted date string from job card to days count
   * e.g., "Just Now", "Today", "1 Day Ago", "7 Days Ago", "1 Week Ago", "3+ Weeks Ago", "30+ Days Ago"
   */
  parsePostedDays(text) {
    if (!text || typeof text !== 'string') return 999;
    const t = text.toLowerCase().trim();
    if (!t) return 999;

    // "just now", "today", "few hours ago", "X hours ago", "X mins ago"
    if (t.includes('just now') || t.includes('today') || t.includes('hour') || t.includes('minute') || t.includes('min ago')) {
      return 0;
    }

    // "yesterday"
    if (t.includes('yesterday')) {
      return 1;
    }

    // Check months: e.g. "1 month ago", "2 months ago", "30+ days ago", "1+ month ago"
    if (t.includes('month') || t.includes('30+')) {
      const monthMatch = t.match(/(\d+)\+?\s*month/i);
      if (monthMatch) {
        return parseInt(monthMatch[1], 10) * 30;
      }
      return 30;
    }

    // Check weeks: e.g. "1 week ago", "2 weeks ago", "3 weeks ago", "3+ weeks ago", "4 weeks ago"
    const weekMatch = t.match(/(\d+)\+?\s*week/i);
    if (weekMatch) {
      const w = parseInt(weekMatch[1], 10);
      return w * 7;
    }
    if (t.includes('week')) {
      return 7;
    }

    // Check days: e.g. "1 day ago", "2 days ago", "5 days ago", "15 days ago"
    const dayMatch = t.match(/(\d+)\+?\s*day/i);
    if (dayMatch) {
      return parseInt(dayMatch[1], 10);
    }

    // If completely unknown format, return 999 (treat as old so it doesn't bypass freshness filter)
    return 999;
  }

  /**
   * Dynamically checks if Naukri displayed an application error or quota banner
   * @param {import('playwright').Page} page
   */
  async checkNaukriErrorBanner(page) {
    try {
      return await page.evaluate(() => {
        const bodyText = (document.body.innerText || '').toLowerCase();
        const errSelectors = [
          '.server-err', '.toaster', '.toast-message', '[class*="error-message"]',
          '[class*="server-error"]', '[class*="server_err"]', 'div[role="alert"]',
          '.msg-wrapper', '.err-msg', '[class*="toast"]', '[class*="banner"]',
          '.apply-error', '[class*="status-msg"]'
        ];
        
        let specific = '';
        for (const sel of errSelectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            const txt = (el.innerText || '').trim();
            const tLower = txt.toLowerCase();
            if (
              tLower.includes('there was an error') ||
              tLower.includes('daily quota') ||
              tLower.includes('daily apply limit') ||
              tLower.includes('please try again later') ||
              tLower.includes('limit reached') ||
              tLower.includes('quota of jobs exceeded') ||
              tLower.includes('maximum applications')
            ) {
              specific = txt;
              break;
            }
          }
          if (specific) break;
        }

        const hasErrorText = 
          bodyText.includes('there was an error while processing your request') ||
          bodyText.includes('daily quota of jobs exceeded') ||
          bodyText.includes('daily apply limit') ||
          bodyText.includes('daily quota reached') ||
          bodyText.includes('maximum applications reached') ||
          bodyText.includes('you have reached the maximum');

        return {
          hasError: !!specific || hasErrorText,
          errorMessage: specific || (hasErrorText ? 'There was an error while processing your request, please try again later' : '')
        };
      });
    } catch (e) {
      return { hasError: false, errorMessage: '' };
    }
  }

  /**
   * Waits for skeleton loaders to vanish and real content to load before taking proof screenshot
   * @param {import('playwright').Page} page
   */
  async waitForCleanProofState(page) {
    try {
      await page.waitForFunction(() => {
        const skeletons = document.querySelectorAll('.styles_skeleton__wrap, .skeleton, [class*="skeleton"], [class*="shimmer"]');
        const hasContent = document.querySelector('h1, [class*="jd-header"], button, .apply-button-container, [class*="top-head"]');
        return skeletons.length === 0 && !!hasContent;
      }, { timeout: 10000 });
    } catch (e) {
      await page.waitForTimeout(2500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
  }

  /**
   * Handles multi-step screening questionnaire / recruiter chatbot on Naukri
   * Keeps scanning & answering questions step-by-step until "Thank you for your responses" or "Applied" appears.
   * Specific rules:
   * 1. "Holding Offer ?" -> ALWAYS answer "No" (candidate has no competing offers, available immediately).
   * 2. "When will be your last working day?" -> "Sept 15 2026" / "Immediate".
   * 3. Experience (Fullstack, Node, AI platforms, Total years) -> "3" or "2-4 years" / "3-5 years" / "3 > 4".
   * 4. Relocation (Bengaluru, Chennai, etc.) -> ALWAYS answer "Yes".
   * 5. Bond / Employment Agreement -> ALWAYS answer "Yes".
   * 6. Notice Period -> "Immediate" / "0".
   * 7. Loops up to 20 steps with dynamic polling so no question is skipped.
   */
  async handleNaukriChatbotQuestions(jobPage, profile, notify = () => {}) {
    let totalFieldsFilled = 0;
    const maxSteps = 20;
    let isCompleted = false;
    let completionMessage = '';
    let consecutiveIdleSteps = 0;

    for (let step = 1; step <= maxSteps; step++) {
      try {
        // Detect if questionnaire modal/drawer or chatbot is present and visible
        const drawerInfo = await jobPage.evaluate(() => {
          const selectors = [
            '.chatbot_Drawer', '.chatbot-container', '.bot-container',
            '.drawer-wrapper', '.apply-message', 'div.styles_modal-content',
            'div[class*="drawer"]', 'div[class*="apply-message"]',
            'div[class*="chat-window"]', 'div[class*="chatbot"]',
            'div.apply-chat-container', 'div[role="dialog"]', '.qna-container',
            'div[class*="bot-msg"]', 'div[class*="botContainer"]',
            'div[class*="chat-container"]', 'div[class*="chatContainer"]',
            'div[class*="chatWrapper"]', 'div[class*="chat_wrapper"]'
          ];
          for (const s of selectors) {
            const els = Array.from(document.querySelectorAll(s));
            for (const el of els) {
              if (el) {
                const style = window.getComputedStyle(el);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  const rect = el.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    const text = (el.innerText || '').trim();
                    return { visible: true, text: text.slice(0, 3000) };
                  }
                }
              }
            }
          }
          return { visible: false, text: '' };
        });

        // Check if drawer or body shows completion message
        const screenStatus = await jobPage.evaluate(() => {
          const body = (document.body.innerText || '').toLowerCase();
          const btns = Array.from(document.querySelectorAll('button, span, a')).map(el => (el.innerText || '').trim().toLowerCase());
          
          const hasThankYou =
            body.includes('thank you for your responses') ||
            body.includes('thank you for your response') ||
            body.includes('thanks for your response') ||
            body.includes('thanks for response') ||
            body.includes('thank you for your time') ||
            body.includes('responses have been recorded') ||
            body.includes('response has been recorded') ||
            body.includes('response has been submitted') ||
            body.includes('you have successfully applied') ||
            body.includes('application submitted') ||
            body.includes('applied successfully');

          const hasApplied = btns.includes('applied') || body.includes('you have already applied');

          return { hasThankYou, hasApplied };
        });

        if (screenStatus.hasThankYou || screenStatus.hasApplied) {
          isCompleted = true;
          completionMessage = screenStatus.hasThankYou ? 'Thank you for your responses' : 'Applied';
          notify('log', { level: 'success', message: `🎉 [Recruiter Chat] 100% Completed! Detected "${completionMessage}" on screen.` });
          break;
        }

        if (!drawerInfo.visible) {
          if (screenStatus.hasApplied) {
            isCompleted = true;
            completionMessage = 'Applied';
          }
          break;
        }

        notify('log', { level: 'info', message: `💬 [Recruiter Chat] Scanning & answering question step ${step}...` });

        // Answer questions inside the drawer with maximum positive & accurate bias
        const fillResult = await jobPage.evaluate((prof) => {
          let count = 0;
          let answeredSummary = [];

          // Find the active chatbot drawer container
          const drawerEl = Array.from(document.querySelectorAll(
            '.chatbot_Drawer, .chatbot-container, .bot-container, .drawer-wrapper, .apply-message, div.styles_modal-content, div[class*="drawer"], div[class*="apply-message"], div[class*="chat-window"], div[class*="chatbot"], div.apply-chat-container, div[role="dialog"], .qna-container, div[class*="bot-msg"], div[class*="botContainer"], div[class*="chat-container"]'
          )).find(el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
          const container = drawerEl || document;

          // Helper to get text context of an element including preceding question bubble
          function getContext(el) {
            const id = el.id || '';
            const name = el.name || '';
            const ph = el.placeholder || '';
            const aria = el.getAttribute('aria-label') || '';
            const label = el.labels && el.labels[0] ? el.labels[0].innerText : '';
            const parent = el.closest('div, li, section, p, label, form');
            const parentText = parent ? parent.innerText : '';
            
            // Look backwards for the nearest preceding question bubble
            let prevQ = '';
            let prev = el.closest('div[class*="msg"], div[class*="bubble"], div[class*="row"], div[class*="card"], form') || el;
            while (prev && prev.previousElementSibling) {
              prev = prev.previousElementSibling;
              const txt = (prev.innerText || '').trim();
              if (txt.length > 5) {
                prevQ = txt;
                break;
              }
            }
            return `${id} ${name} ${ph} ${aria} ${label} ${parentText} ${prevQ}`.toLowerCase();
          }

          // Extract the latest question bubble text
          const questionBubbles = Array.from(container.querySelectorAll(
            '.chat-bubble, div[class*="msg"], div[class*="bubble"], div[class*="bot-msg"], div[class*="question"], p[class*="question"], .styles_question-text'
          ));
          const qText = questionBubbles.length > 0
            ? (questionBubbles[questionBubbles.length - 1].innerText || '').toLowerCase().trim()
            : (container.innerText || '').toLowerCase().trim();

          // 1. Checkbox Multi-Select Options (e.g., Locations: Mumbai, Kolkata, Chennai; Skills; Shift preferences)
          const checkboxInputs = Array.from(container.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
          let rawCheckboxes = [];
          if (checkboxInputs.length > 0) {
            rawCheckboxes = checkboxInputs.map(cb => {
              const parent = cb.closest('label, div[class*="checkbox"], div[class*="option"], li') || cb;
              const txt = (parent.innerText || parent.textContent || cb.value || '').trim();
              const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true' || parent.classList.contains('active') || parent.classList.contains('selected');
              return { el: parent, input: cb, text: txt, val: txt.toLowerCase(), isChecked };
            });
          } else {
            const customCbs = Array.from(container.querySelectorAll('label[class*="checkbox"], div[class*="checkbox"], span[class*="checkbox"]'));
            rawCheckboxes = customCbs.map(cb => {
              const txt = (cb.innerText || cb.textContent || '').trim();
              const isChecked = cb.classList.contains('active') || cb.classList.contains('selected');
              return { el: cb, input: cb.querySelector('input[type="checkbox"]'), text: txt, val: txt.toLowerCase(), isChecked };
            });
          }

          const uncheckedBoxes = rawCheckboxes.filter(c => !c.isChecked);

          if (uncheckedBoxes.length > 0) {
            let toCheck = [];

            // Case A: Location / Relocation question (e.g. "Which of these locations are you willing to relocate to?")
            const isLocationQ = qText.includes('location') || qText.includes('relocate') || qText.includes('relocating') ||
                                qText.includes('city') || qText.includes('cities') || qText.includes('willing to move') ||
                                qText.includes('which of these') || qText.includes('where are you') ||
                                uncheckedBoxes.some(c => ['chennai', 'mumbai', 'kolkata', 'bangalore', 'bengaluru', 'hyderabad', 'delhi', 'pune', 'noida', 'gurgaon'].some(city => c.val.includes(city)));

            if (isLocationQ) {
              const preferredCities = ['chennai', 'bangalore', 'bengaluru', 'thiruvananthapuram', 'trivandrum', 'hyderabad', 'remote', 'work from home'];
              toCheck = uncheckedBoxes.filter(c => preferredCities.some(city => c.val.includes(city)));

              // Fallback: If no preferred city matched, select first option (candidate is willing to relocate)
              if (toCheck.length === 0) {
                toCheck = [uncheckedBoxes[0]];
              }
            }
            // Case B: Skills / Technology Checkbox
            else if (qText.includes('skill') || qText.includes('technolog') || qText.includes('experience') || qText.includes('tools')) {
              const mySkills = [
                'node', 'react', 'javascript', 'typescript', 'express', 'mongo',
                'mysql', 'sql', 'php', 'rest api', 'api', 'html', 'css', 'git', 'full stack', 'fullstack'
              ];
              const blacklistedSkills = ['python', 'java', 'django', '.net', 'c#', 'c++', 'golang', 'ruby', 'flutter', 'swift', 'kotlin'];

              toCheck = uncheckedBoxes.filter(c => {
                const isBlacklisted = blacklistedSkills.some(b => c.val.includes(b));
                const isMySkill = mySkills.some(s => c.val.includes(s));
                return isMySkill && !isBlacklisted;
              });

              if (toCheck.length === 0) {
                toCheck = uncheckedBoxes.filter(c => !blacklistedSkills.some(b => c.val.includes(b)));
              }
            }
            // Case C: General positive checkboxes
            else {
              toCheck = uncheckedBoxes.filter(c => !c.val.includes('no') && !c.val.includes('none') && !c.val.includes('not willing'));
              if (toCheck.length === 0) {
                toCheck = [uncheckedBoxes[0]];
              }
            }

            for (const item of toCheck) {
              if (item.input) {
                item.input.checked = true;
                item.input.dispatchEvent(new Event('input', { bubbles: true }));
                item.input.dispatchEvent(new Event('change', { bubbles: true }));
              }
              item.el.scrollIntoView({ block: 'center', behavior: 'instant' });
              item.el.click();
              count++;
              answeredSummary.push(`Checkbox: ${item.text}`);
            }
          }

          // 2. Radio Options & Clickable Option Pills
          const radioInputs = Array.from(container.querySelectorAll('input[type="radio"], [role="radio"]'));
          let rawOptions = [];
          if (radioInputs.length > 0) {
            rawOptions = radioInputs.map(r => {
              const parent = r.closest('label, div[class*="radio"], div[class*="option"], li') || r;
              const txt = (parent.innerText || parent.textContent || r.value || '').trim();
              return { el: parent, input: r, text: txt, val: txt.toLowerCase() };
            });
          } else {
            const customOpts = Array.from(container.querySelectorAll('label, div[class*="radio"], div[class*="option"], li[class*="option"], .chip, .quick-reply, span[class*="radio"]'));
            rawOptions = customOpts.map(o => ({
              el: o,
              input: o.querySelector('input[type="radio"]'),
              text: (o.innerText || o.textContent || '').trim(),
              val: (o.innerText || o.textContent || o.getAttribute('value') || '').toLowerCase().trim()
            }));
          }

          if (rawOptions.length > 0) {
            let chosenOption = null;

            // Type 1: Holding Offer ? (User confirmed: MUST ANSWER "No" so recruiter sees candidate is immediately available)
            const isHoldingOffer = qText.includes('holding offer') || qText.includes('holding any offer') ||
                                   qText.includes('other offer') || qText.includes('competing offer') ||
                                   qText.includes('have any other offer') || qText.includes('any other offers');
            if (isHoldingOffer) {
              chosenOption = rawOptions.find(o => {
                const t = o.val;
                return t === 'no' || t.startsWith('no ') || t.endsWith(' no') || t.includes('no offer') || t.includes('do not have');
              });
            }

            // Type 2: Relocation Question (e.g. "Ready to relocate to Bangalore?" / "living in or ready to relocate...")
            const isRelocate = qText.includes('relocate') || qText.includes('relocating') ||
                               qText.includes('relocation') || qText.includes('willing to move') ||
                               qText.includes('ready to relocate') || qText.includes('living in or ready to relocate');
            if (!chosenOption && isRelocate) {
              // Priority A: Option containing "Yes" and "relocate"
              chosenOption = rawOptions.find(o => {
                const t = o.val;
                return (t.includes('yes') && t.includes('relocate')) || t.includes('willing to relocate');
              });
              // Priority B: Plain "Yes" option
              if (!chosenOption) {
                chosenOption = rawOptions.find(o => {
                  const t = o.val;
                  return (t === 'yes' || t.startsWith('yes')) && !t.includes('no');
                });
              }
            }

            // Type 3: Experience Range Questions (e.g. 1 > 2, 2 > 3, 3 > 4, 2-4 years, 3-5 years)
            const isExp = qText.includes('experience') || qText.includes('expereince') || qText.includes('experince') ||
                          qText.includes('years') || qText.includes('how many years') ||
                          rawOptions.some(o => /[\d]+\s*[-–to>]\s*[\d]+/i.test(o.text) || /\d+\+?\s*(?:year|yr)/i.test(o.text));

            if (!chosenOption && isExp) {
              // Sub-priority 1: Starts with 3 or exact 3 (e.g., "3 - 4", "3 > 4", "3 to 4", "3-5", "3+", "3 years", "3")
              chosenOption = rawOptions.find(o => {
                const t = o.val;
                if (/^\s*3\s*[-–to>]\s*\d+/i.test(t) || /\b3\s*[-–to>]\s*\d+/i.test(t)) return true;
                if (/^\s*3\+?\s*(?:years?|yrs?)?\s*$/i.test(t)) return true;
                if (/^3\s*\+?\s*(?:years?|yrs?)/i.test(t) && !/[-–to>]\s*3/i.test(t)) return true;
                return false;
              });

              // Sub-priority 2: Covers 3 (e.g., "2 - 3", "2 > 3", "2 to 3", "2-4", "2-4 years")
              if (!chosenOption) {
                chosenOption = rawOptions.find(o => {
                  const t = o.val;
                  return /[-–to>]\s*3\b/i.test(t) || /\b2\s*[-–to>]\s*4/i.test(t);
                });
              }
            }

            // Type 4: Bond / Agreement Question
            if (!chosenOption && (qText.includes('bond') || qText.includes('agreement') || qText.includes('commitment') || qText.includes('contract'))) {
              chosenOption = rawOptions.find(o => {
                const t = o.val;
                return (t === 'yes' || t.startsWith('yes') || t.includes('agree')) && !t.includes('no');
              });
            }

            // Type 5: Notice Period Question
            if (!chosenOption && (qText.includes('notice') || qText.includes('how soon') || qText.includes('joining'))) {
              chosenOption = rawOptions.find(o => {
                const t = o.val;
                return t.includes('immediate') || t.includes('0-15') || t.includes('15 days') || t === '0';
              });
            }

            // Type 6: General Positive Yes
            if (!chosenOption) {
              chosenOption = rawOptions.find(o => {
                const t = o.val;
                const isNo = t === 'no' || t.startsWith('no ') || t.endsWith(' no') || t.includes('not willing');
                return !isNo && (t.includes('yes') || t.startsWith('yes'));
              });
            }

            // Fallback: Pick any non-"no" option
            if (!chosenOption) {
              chosenOption = rawOptions.find(o => {
                const t = o.val;
                return !t.startsWith('no') && t !== '0' && !t.includes('fresher') && !t.includes('none');
              });
            }

            if (chosenOption) {
              if (chosenOption.input) {
                chosenOption.input.checked = true;
                chosenOption.input.dispatchEvent(new Event('input', { bubbles: true }));
                chosenOption.input.dispatchEvent(new Event('change', { bubbles: true }));
              }
              chosenOption.el.click();
              count++;
              answeredSummary.push(`Option: ${chosenOption.text}`);
            }
          }

          // 2. Text / Number / Date Inputs
          const inputs = Array.from(container.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea'));
          for (const inp of inputs) {
            if (inp.value && inp.value.trim().length > 0) continue; // Already filled

            const ctx = getContext(inp);
            let valToSet = '';

            // Holding Offer input
            if (ctx.includes('holding offer') || ctx.includes('other offer') || ctx.includes('competing offer')) {
              valToSet = (inp.type === 'number') ? '0' : 'No';
            }
            // Last Working Day (LWD)
            else if (ctx.includes('last working day') || ctx.includes('lwd') || ctx.includes('end date') || qText.includes('last working day')) {
              if (inp.type === 'date') {
                valToSet = '2026-09-15';
              } else {
                valToSet = 'Sept 15 2026';
              }
            }
            // Bond question text input
            else if (ctx.includes('bond') || ctx.includes('agreement') || ctx.includes('commitment') || ctx.includes('contract')) {
              valToSet = (inp.type === 'number') ? '1' : 'Yes';
            }
            // Notice Period (0 days or Immediate)
            else if (ctx.includes('notice') || ctx.includes('how soon') || ctx.includes('joining')) {
              valToSet = (inp.type === 'number') ? '0' : 'Immediate';
            }
            // Relocation / Location
            else if (ctx.includes('relocate') || qText.includes('relocate')) {
              valToSet = (inp.type === 'number') ? '1' : 'Yes, willing to relocate';
            }
            // Skills Experience (Total, Relevant, Fullstack, AI platforms, Technologies)
            else if (
              ctx.includes('node') || ctx.includes('php') || ctx.includes('react') ||
              ctx.includes('typescript') || ctx.includes('express') || ctx.includes('mongo') ||
              ctx.includes('mysql') || ctx.includes('sql') || ctx.includes('rest api') ||
              ctx.includes('api') || ctx.includes('git') || ctx.includes('cloud') ||
              ctx.includes('aws') || ctx.includes('backend') || ctx.includes('full stack') ||
              ctx.includes('fullstack') || ctx.includes('developer') || ctx.includes('ai platform') ||
              ctx.includes('ai') || ctx.includes('javascript') || ctx.includes('experience') ||
              ctx.includes('expereince') || ctx.includes('experince') || ctx.includes('years') ||
              ctx.includes('how many years') || ctx.includes('total experience') || ctx.includes('relevant experience')
            ) {
              valToSet = '3';
            }
            // Current CTC
            else if (ctx.includes('current ctc') || ctx.includes('current salary') || ctx.includes('present ctc')) {
              const ph = (inp.placeholder || '').toLowerCase();
              valToSet = (ph.includes('lakh') || ph.includes('lpa') || ph.includes('lac') || ph.includes('in l') || !ph.includes('000')) ? '3.6' : '360000';
            }
            // Expected CTC
            else if (ctx.includes('expected ctc') || ctx.includes('expected salary') || ctx.includes('desired ctc')) {
              const ph = (inp.placeholder || '').toLowerCase();
              valToSet = (ph.includes('lakh') || ph.includes('lpa') || ph.includes('lac') || ph.includes('in l') || !ph.includes('000')) ? '6.0' : '600000';
            }
            // Location
            else if (ctx.includes('location') || ctx.includes('city')) {
              valToSet = 'Chennai';
            }
            // Open-ended / General Summary / Why hire
            else if (inp.tagName === 'TEXTAREA' || ctx.includes('describe') || ctx.includes('why') || ctx.includes('summary')) {
              valToSet = 'Full Stack Developer with 3 years of experience in Node.js, Express, React, TypeScript, PHP, MySQL, MongoDB, and REST APIs. Immediate joiner based in Chennai, willing to relocate.';
            }
            // Default positive fallback
            else if (inp.type === 'number') {
              valToSet = '3';
            } else {
              valToSet = 'Yes';
            }

            if (valToSet) {
              // React-safe setter
              const proto = inp instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (nativeSetter) {
                nativeSetter.call(inp, valToSet);
              } else {
                inp.value = valToSet;
              }
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              count++;
              answeredSummary.push(`${valToSet}`);
            }
          }

          // 3. Dropdown selects (<select>)
          const selects = Array.from(container.querySelectorAll('select'));
          for (const s of selects) {
            const ctx = getContext(s);
            let chosenOptIdx = -1;

            // Relocation in dropdown
            if (ctx.includes('relocate') || qText.includes('relocate')) {
              for (let optIdx = 0; optIdx < s.options.length; optIdx++) {
                const optText = (s.options[optIdx].text || '').toLowerCase();
                if ((optText.includes('yes') && optText.includes('relocate')) || optText.includes('yes') || optText.includes('willing')) {
                  chosenOptIdx = optIdx;
                  break;
                }
              }
            }

            // Experience in dropdown (starts with 3 or covers 3)
            if (chosenOptIdx === -1 && (ctx.includes('experience') || qText.includes('experience'))) {
              for (let optIdx = 0; optIdx < s.options.length; optIdx++) {
                const optText = (s.options[optIdx].text || '').toLowerCase().trim();
                if (/^\s*3\s*[-–to>]\s*\d+/i.test(optText) || /\b3\s*[-–to>]\s*\d+/i.test(optText) || /^\s*3\+?\s*(?:years?|yrs?)?$/i.test(optText) || optText === '3' || optText === '3 years') {
                  chosenOptIdx = optIdx;
                  break;
                }
              }
              if (chosenOptIdx === -1) {
                for (let optIdx = 0; optIdx < s.options.length; optIdx++) {
                  const optText = (s.options[optIdx].text || '').toLowerCase().trim();
                  if (/[-–to>]\s*3\b/i.test(optText) || /\b2\s*[-–to>]\s*4/i.test(optText)) {
                    chosenOptIdx = optIdx;
                    break;
                  }
                }
              }
            }

            // Notice period in dropdown
            if (chosenOptIdx === -1 && (ctx.includes('notice') || qText.includes('notice'))) {
              for (let optIdx = 0; optIdx < s.options.length; optIdx++) {
                const optText = (s.options[optIdx].text || '').toLowerCase();
                if (optText.includes('immediate') || optText.includes('0-15') || optText.includes('15') || optText === '0') {
                  chosenOptIdx = optIdx;
                  break;
                }
              }
            }

            // General Yes in dropdown
            if (chosenOptIdx === -1) {
              for (let optIdx = 0; optIdx < s.options.length; optIdx++) {
                const optText = (s.options[optIdx].text || '').toLowerCase();
                if (optText.includes('yes') && !optText.includes('no')) {
                  chosenOptIdx = optIdx;
                  break;
                }
              }
            }

            if (chosenOptIdx !== -1) {
              s.selectedIndex = chosenOptIdx;
              s.dispatchEvent(new Event('change', { bubbles: true }));
              count++;
              answeredSummary.push(`Select: ${s.options[chosenOptIdx].text}`);
            }
          }

          // 4. Clickable Quick-Reply Chips / Buttons
          const chips = Array.from(container.querySelectorAll('.chip, .quick-reply, button.reply, [class*="chip"]'));
          for (const chip of chips) {
            const txt = (chip.innerText || '').toLowerCase().trim();
            if (txt === 'yes' || txt === '3' || txt === '3 years' || txt === 'immediate' || txt === 'chennai') {
              chip.click();
              count++;
              answeredSummary.push(`Chip: ${txt}`);
              break;
            }
          }

          return { count, summary: answeredSummary.join(', ') };
        }, profile);

        totalFieldsFilled += fillResult.count;
        if (fillResult.summary) {
          notify('log', { level: 'info', message: `✅ [Recruiter Chat] Answered: ${fillResult.summary}` });
        }

        await jobPage.waitForTimeout(1000);

        // Click Action Button: "Save" (as in TVM Infotech screenshot), "Save & Next", "Next", "Submit", etc.
        const clickedAction = await jobPage.evaluate(() => {
          const drawerEl = Array.from(document.querySelectorAll(
            '.chatbot_Drawer, .chatbot-container, .bot-container, .drawer-wrapper, .apply-message, div.styles_modal-content, div[class*="drawer"], div[class*="apply-message"], div[class*="chat-window"], div[class*="chatbot"], div.apply-chat-container, div[role="dialog"], .qna-container, div[class*="bot-msg"], div[class*="botContainer"], div[class*="chat-container"]'
          )).find(el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          });
          const container = drawerEl || document;

          const actionBtn = Array.from(container.querySelectorAll('button, input[type="submit"], div[role="button"], a')).find(el => {
            const txt = (el.innerText || el.value || '').toLowerCase().trim();
            const isTarget = txt === 'save' || txt === 'save & next' || txt === 'next' ||
                             txt === 'submit' || txt === 'continue' ||
                             txt === 'done' || txt === 'send' ||
                             (txt.includes('save') && !txt.includes('later')) ||
                             (txt.includes('submit') && !txt.includes('feedback'));
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            return isTarget && isVisible && !el.disabled;
          });

          if (actionBtn) {
            actionBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
            actionBtn.click();
            return (actionBtn.innerText || actionBtn.value || '').trim();
          }
          return null;
        });

        if (clickedAction) {
          notify('log', { level: 'info', message: `🔘 [Recruiter Chat] Clicked "${clickedAction}"` });
        }

        // Wait for next question or completion
        await jobPage.waitForTimeout(2000);

        // Check if chat reached completion text or main page shows applied
        const postStepStatus = await jobPage.evaluate(() => {
          const body = (document.body.innerText || '').toLowerCase();
          const btns = Array.from(document.querySelectorAll('button, span, a')).map(el => (el.innerText || '').trim().toLowerCase());
          
          const hasThankYou =
            body.includes('thank you for your responses') ||
            body.includes('thank you for your response') ||
            body.includes('thanks for your response') ||
            body.includes('thanks for response') ||
            body.includes('thank you for your time') ||
            body.includes('responses have been recorded') ||
            body.includes('response has been recorded') ||
            body.includes('response has been submitted') ||
            body.includes('you have successfully applied') ||
            body.includes('application submitted') ||
            body.includes('applied successfully');

          const hasApplied = btns.includes('applied') || body.includes('you have already applied');

          // Check if drawer is still open
          const drawer = document.querySelector('.chatbot_Drawer, .chatbot-container, .bot-container, div[class*="chatbot_Drawer"], div[class*="chat-window"], div.apply-chat-container, div[role="dialog"]');
          let isDrawerVisible = false;
          if (drawer) {
            const style = window.getComputedStyle(drawer);
            const rect = drawer.getBoundingClientRect();
            isDrawerVisible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          }

          return { hasThankYou, hasApplied, isDrawerVisible };
        });

        if (postStepStatus.hasThankYou || postStepStatus.hasApplied) {
          isCompleted = true;
          completionMessage = postStepStatus.hasThankYou ? 'Thank you for your responses' : 'Applied';
          notify('log', { level: 'success', message: `🎉 [Recruiter Chat] All questions completed! "${completionMessage}" confirmed on screen.` });
          break;
        }

        if (!postStepStatus.isDrawerVisible) {
          notify('log', { level: 'info', message: '💬 [Recruiter Chat] Chatbot drawer dismissed.' });
          break;
        }

        // If no fields filled and no action clicked, wait dynamically for bot typing animation / next question
        if (fillResult.count === 0 && !clickedAction) {
          consecutiveIdleSteps++;
          let foundNewQuestion = false;
          for (let waitCount = 0; waitCount < 6; waitCount++) {
            await jobPage.waitForTimeout(500);
            const hasNewContent = await jobPage.evaluate(() => {
              const body = (document.body.innerText || '').toLowerCase();
              const isDone = body.includes('thank you for your response') ||
                             body.includes('thank you for your responses') ||
                             body.includes('thanks for your response') ||
                             body.includes('thanks for response') ||
                             body.includes('responses have been recorded') ||
                             body.includes('applied');
              const hasInputs = !!document.querySelector('input:not([type="hidden"]), select, textarea, button[class*="reply"], .chip');
              return isDone || hasInputs;
            });
            if (hasNewContent) {
              foundNewQuestion = true;
              break;
            }
          }

          if (!foundNewQuestion && consecutiveIdleSteps >= 2) {
            notify('log', { level: 'info', message: '💬 [Recruiter Chat] No further questions detected.' });
            break;
          }
        } else {
          consecutiveIdleSteps = 0;
        }

      } catch (stepErr) {
        notify('log', { level: 'warn', message: `Recruiter chat step notice: ${stepErr.message}` });
        break;
      }
    }

    await jobPage.waitForTimeout(1000);

    return {
      answered: totalFieldsFilled > 0,
      count: totalFieldsFilled,
      completed: isCompleted,
      reason: completionMessage
    };
  }
}

module.exports = new NaukriScanner();
