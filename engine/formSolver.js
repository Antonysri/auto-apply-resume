const path = require('path');
const fs = require('fs');

/**
 * Universal Form Solver Engine
 * Handles Google Forms, ATS (Greenhouse, Lever, etc.), and custom company HTML career forms
 */
class FormSolver {
  /**
   * Solves and fills an application form
   * @param {import('playwright').Page} page
   * @param {object} profile
   * @param {object} options
   */
  async solveForm(page, profile, options = { autoSubmit: true }) {
    console.log(`[FormSolver] Inspecting form at ${page.url()}...`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const isGoogleForm = page.url().includes('docs.google.com/forms') || page.url().includes('forms.gle');
    const isLever = page.url().includes('jobs.lever.co');
    const isGreenhouse = page.url().includes('boards.greenhouse.io');

    let result = {
      success: false,
      atsType: 'Custom HTML Form',
      fieldsFilled: 0,
      resumeUploaded: false,
      submitted: false,
      proofPath: null,
      message: ''
    };

    if (isGoogleForm) {
      result.atsType = 'Google Form';
      result = await this.solveGoogleForm(page, profile, options);
    } else if (isLever) {
      result.atsType = 'Lever ATS';
      result = await this.solveLeverForm(page, profile, options);
    } else if (isGreenhouse) {
      result.atsType = 'Greenhouse ATS';
      result = await this.solveGreenhouseForm(page, profile, options);
    } else {
      result = await this.solveStandardHtmlForm(page, profile, options);
    }

    return result;
  }

  /**
   * Google Form Handler
   */
  async solveGoogleForm(page, profile, options) {
    console.log('[FormSolver] Running Google Form solver...');
    let fieldsFilled = 0;
    let resumeUploaded = false;

    // Check if form is closed
    const isClosed = await page.evaluate(() => {
      return document.body.innerText.includes('no longer accepting responses');
    });
    if (isClosed) {
      return {
        success: false,
        atsType: 'Google Form',
        message: 'Google Form is closed (no longer accepting responses).'
      };
    }

    // Check if login is required
    const requiresLogin = await page.evaluate(() => {
      return document.body.innerText.includes('Sign in to continue');
    });
    if (requiresLogin) {
      console.warn('[FormSolver] Google Form requires Google Account sign-in.');
    }

    // Google Form questions are items with role="listitem"
    const questions = await page.$$('[role="listitem"]');
    console.log(`[FormSolver] Found ${questions.length} question blocks in Google Form.`);

    for (const q of questions) {
      try {
        const qText = await q.evaluate(el => el.innerText.toLowerCase());

        // 1. Text Inputs
        const textInput = await q.$('input[type="text"], input[type="email"], input[type="tel"], textarea');
        if (textInput && await textInput.isVisible()) {
          let valueToFill = null;

          if (qText.includes('name')) {
            valueToFill = profile.personal.fullName;
          } else if (qText.includes('email')) {
            valueToFill = profile.personal.email;
          } else if (qText.includes('phone') || qText.includes('mobile') || qText.includes('contact')) {
            valueToFill = profile.personal.phone;
          } else if (qText.includes('date of birth') || qText.includes('dob')) {
            valueToFill = profile.personal.dob;
          } else if (qText.includes('linkedin')) {
            valueToFill = profile.links.linkedin;
          } else if (qText.includes('github')) {
            valueToFill = profile.links.github;
          } else if (qText.includes('college') || qText.includes('institute') || qText.includes('ug')) {
            valueToFill = `${profile.education.college}, ${profile.education.passingYear}, ${profile.education.degreeName}, ${profile.education.percentage}`;
          } else if (qText.includes('project')) {
            valueToFill = profile.answers.projectDetails;
          } else if (qText.includes('strength') || qText.includes('weakness')) {
            valueToFill = `${profile.answers.strengths} | ${profile.answers.weaknesses}`;
          } else if (qText.includes('hobbi') || qText.includes('extra-curricular')) {
            valueToFill = profile.answers.hobbies;
          } else if (qText.includes('achievement') || qText.includes('award')) {
            valueToFill = profile.answers.achievements;
          } else if (qText.includes('technical')) {
            valueToFill = `Expertise in ${profile.skills.join(', ')}. 3+ years experience.`;
          }

          if (valueToFill) {
            await textInput.fill(valueToFill);
            fieldsFilled++;
          }
        }

        // 2. Radio & Checkbox options
        const optionsList = await q.$$('[role="radio"], [role="checkbox"]');
        for (const opt of optionsList) {
          const optLabel = await opt.evaluate(el => (el.getAttribute('aria-label') || el.innerText || '').toLowerCase());
          let shouldCheck = false;

          // Relocate / Independent / Night shift / Self learning
          if (qText.includes('relocate') && optLabel.includes('yes')) shouldCheck = true;
          if (qText.includes('independent') && optLabel.includes('yes')) shouldCheck = true;
          if (qText.includes('self learning') && optLabel.includes('yes')) shouldCheck = true;
          if (qText.includes('night shift') && optLabel.includes('yes')) shouldCheck = true;
          if (qText.includes('long hours') && optLabel.includes('yes')) shouldCheck = true;
          if (qText.includes('money or success') && optLabel.includes('success')) shouldCheck = true;

          // Experience
          if (qText.includes('experience') && (optLabel.includes('2+') || optLabel.includes('3+'))) shouldCheck = true;

          // Highest Degree
          if (qText.includes('highest degree') && (optLabel.includes('b.tech') || optLabel.includes('degree'))) shouldCheck = true;

          // Technology checkboxes
          for (const skill of profile.skills) {
            if (optLabel.trim() === skill.toLowerCase()) {
              shouldCheck = true;
              break;
            }
          }

          if (shouldCheck) {
            const isChecked = await opt.getAttribute('aria-checked');
            if (isChecked !== 'true') {
              await opt.click();
              fieldsFilled++;
            }
          }
        }
      } catch (err) {
        // Continue to next question
      }
    }

    // Submit if requested
    let submitted = false;
    let message = `Filled ${fieldsFilled} Google Form fields.`;

    if (options.autoSubmit && fieldsFilled > 0) {
      const submitBtn = await page.$('[role="button"]:has-text("Submit")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
        submitted = true;
        message = 'Google Form submitted successfully!';
      }
    }

    const proofPath = await this.captureProof(page, 'google_form');

    return {
      success: fieldsFilled > 0,
      atsType: 'Google Form',
      fieldsFilled,
      resumeUploaded,
      submitted,
      proofPath,
      message
    };
  }

  /**
   * Standard HTML Career Page Form Solver
   */
  async solveStandardHtmlForm(page, profile, options) {
    console.log('[FormSolver] Solving standard HTML form...');
    let fieldsFilled = 0;
    let resumeUploaded = false;

    // 1. Text Inputs & Textareas
    const inputMatches = [
      { keys: ['fullname', 'full_name', 'full name', 'your name', 'applicant_name'], val: profile.personal.fullName },
      { keys: ['first_name', 'firstname', 'first name'], val: profile.personal.firstName },
      { keys: ['last_name', 'lastname', 'last name'], val: profile.personal.lastName },
      { keys: ['email', 'e-mail'], val: profile.personal.email },
      { keys: ['phone', 'mobile', 'cell', 'contact_number'], val: profile.personal.phone },
      { keys: ['linkedin', 'linked_in'], val: profile.links.linkedin },
      { keys: ['github'], val: profile.links.github },
      // Skill Experience (User: fill 3 years for all matching skills)
      { keys: ['node', 'nodejs'], val: '3' },
      { keys: ['php'], val: '3' },
      { keys: ['react', 'reactjs'], val: '3' },
      { keys: ['typescript'], val: '3' },
      { keys: ['express', 'expressjs'], val: '3' },
      { keys: ['mongodb', 'mongo'], val: '3' },
      { keys: ['mysql', 'sql'], val: '3' },
      { keys: ['rest api', 'restful', 'api'], val: '3' },
      { keys: ['git', 'github'], val: '3' },
      { keys: ['cloud', 'aws'], val: '3' },
      { keys: ['experience', 'years_of_experience', 'total_experience', 'total experience', 'overall experience'], val: String(profile.professional.totalExperienceYears || '3') },
      { keys: ['current_ctc', 'current ctc', 'current_salary'], val: String(profile.professional.currentCtcLpa || '3.6') },
      { keys: ['expected_ctc', 'expected ctc', 'expected_salary'], val: String(profile.professional.expectedCtcLpa || '6.0') },
      { keys: ['notice', 'notice_period'], val: profile.professional.noticePeriodText || 'Immediate' },
      { keys: ['city', 'location', 'current_location'], val: profile.personal.currentLocation || 'Chennai' }
    ];

    const allInputs = await page.$$('input:not([type="hidden"]):not([type="file"]):not([type="submit"]), textarea');
    for (const input of allInputs) {
      try {
        if (!await input.isVisible()) continue;

        const meta = await input.evaluate(el => {
          const id = el.id || '';
          const name = el.name || '';
          const placeholder = el.placeholder || '';
          const aria = el.getAttribute('aria-label') || '';
          const label = el.labels && el.labels[0] ? el.labels[0].innerText : '';
          return `${id} ${name} ${placeholder} ${aria} ${label}`.toLowerCase();
        });

        for (const match of inputMatches) {
          if (match.keys.some(k => meta.includes(k))) {
            const currentVal = await input.inputValue();
            if (!currentVal) {
              await input.fill(match.val);
              fieldsFilled++;
            }
            break;
          }
        }
      } catch (e) {}
    }

    // 2. Resume File Upload
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length > 0 && fs.existsSync(profile.resume.filePath)) {
      try {
        console.log(`[FormSolver] Attaching resume: ${profile.resume.filePath}`);
        await fileInputs[0].setInputFiles(profile.resume.filePath);
        resumeUploaded = true;
        fieldsFilled++;
      } catch (e) {
        console.warn('[FormSolver] File upload failed:', e.message);
      }
    }

    // 3. Dropdowns (<select>)
    const selects = await page.$$('select');
    for (const select of selects) {
      try {
        const text = await select.evaluate(el => el.innerText.toLowerCase());
        if (text.includes('notice') || text.includes('immediate')) {
          await select.selectOption({ index: 1 });
          fieldsFilled++;
        } else if (text.includes('experience') || text.includes('year')) {
          await select.selectOption({ index: 2 });
          fieldsFilled++;
        }
      } catch (e) {}
    }

    // 4. Submit
    let submitted = false;
    let message = `Filled ${fieldsFilled} fields. Resume uploaded: ${resumeUploaded}`;

    if (options.autoSubmit && fieldsFilled > 0) {
      const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Apply Now")');
      if (submitBtn && await submitBtn.isVisible()) {
        console.log('[FormSolver] Submitting application...');
        await submitBtn.click();
        await page.waitForTimeout(3000);
        submitted = true;

        // Check confirmation text on the page
        const confirmed = await page.evaluate(() => {
          const body = (document.body.innerText || '').toLowerCase();
          return body.includes('thank you') || 
                 body.includes('successfully submitted') || 
                 body.includes('application received') || 
                 body.includes('response has been recorded') ||
                 body.includes('we will contact you');
        });

        if (confirmed) {
          message = 'Application submitted and verified successfully!';
        } else {
          message = 'Application submitted. Confirmation captured.';
        }
      }
    }

    const proofPath = await this.captureProof(page, 'html_form');

    return {
      success: fieldsFilled > 0,
      atsType: 'Custom HTML Form',
      fieldsFilled,
      resumeUploaded,
      submitted,
      proofPath,
      message
    };
  }

  /**
   * Lever Form Solver
   */
  async solveLeverForm(page, profile, options) {
    console.log('[FormSolver] Solving Lever form...');
    let fieldsFilled = 0;
    let resumeUploaded = false;

    try {
      const nameInput = await page.$('input[name="name"]');
      if (nameInput) { await nameInput.fill(profile.personal.fullName); fieldsFilled++; }

      const emailInput = await page.$('input[name="email"]');
      if (emailInput) { await emailInput.fill(profile.personal.email); fieldsFilled++; }

      const phoneInput = await page.$('input[name="phone"]');
      if (phoneInput) { await phoneInput.fill(profile.personal.phone); fieldsFilled++; }

      const orgInput = await page.$('input[name="org"]');
      if (orgInput) { await orgInput.fill(profile.professional.currentCompany); fieldsFilled++; }

      const linkedInInput = await page.$('input[name="urls[LinkedIn]"]');
      if (linkedInInput) { await linkedInInput.fill(profile.links.linkedin); fieldsFilled++; }

      const fileInput = await page.$('input[type="file"]');
      if (fileInput && fs.existsSync(profile.resume.filePath)) {
        await fileInput.setInputFiles(profile.resume.filePath);
        resumeUploaded = true;
        fieldsFilled++;
      }
    } catch (e) {
      console.error('[FormSolver] Lever solver error:', e);
    }

    let submitted = false;
    if (options.autoSubmit && fieldsFilled > 0) {
      const btn = await page.$('button[data-qa="btn-submit"]');
      if (btn) {
        await btn.click();
        await page.waitForTimeout(3000);
        submitted = true;
      }
    }

    const proofPath = await this.captureProof(page, 'lever_form');

    return {
      success: fieldsFilled > 0,
      atsType: 'Lever ATS',
      fieldsFilled,
      resumeUploaded,
      submitted,
      proofPath,
      message: `Lever application completed. Fields: ${fieldsFilled}, Resume: ${resumeUploaded}`
    };
  }

  /**
   * Greenhouse Form Solver
   */
  async solveGreenhouseForm(page, profile, options) {
    console.log('[FormSolver] Solving Greenhouse form...');
    let fieldsFilled = 0;
    let resumeUploaded = false;

    try {
      const first = await page.$('#first_name');
      if (first) { await first.fill(profile.personal.firstName); fieldsFilled++; }

      const last = await page.$('#last_name');
      if (last) { await last.fill(profile.personal.lastName); fieldsFilled++; }

      const email = await page.$('#email');
      if (email) { await email.fill(profile.personal.email); fieldsFilled++; }

      const phone = await page.$('#phone');
      if (phone) { await phone.fill(profile.personal.phone); fieldsFilled++; }

      const fileInput = await page.$('input[type="file"]');
      if (fileInput && fs.existsSync(profile.resume.filePath)) {
        await fileInput.setInputFiles(profile.resume.filePath);
        resumeUploaded = true;
        fieldsFilled++;
      }
    } catch (e) {}

    let submitted = false;
    if (options.autoSubmit && fieldsFilled > 0) {
      const submitBtn = await page.$('#submit_app');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
        submitted = true;
      }
    }

    const proofPath = await this.captureProof(page, 'greenhouse_form');

    return {
      success: fieldsFilled > 0,
      atsType: 'Greenhouse ATS',
      fieldsFilled,
      resumeUploaded,
      submitted,
      proofPath,
      message: `Greenhouse application completed. Fields: ${fieldsFilled}`
    };
  }

  /**
   * Captures screenshot proof
   */
  async captureProof(page, prefix = 'proof') {
    try {
      const proofsDir = path.join(__dirname, '..', 'proofs');
      if (!fs.existsSync(proofsDir)) {
        fs.mkdirSync(proofsDir, { recursive: true });
      }
      const filename = `${prefix}_${Date.now()}.png`;
      const fullPath = path.join(proofsDir, filename);
      await page.screenshot({ path: fullPath, fullPage: false });
      return filename;
    } catch (e) {
      console.warn('Screenshot capture failed:', e.message);
      return null;
    }
  }
}

module.exports = new FormSolver();
