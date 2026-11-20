const path = require('path');
const fs = require('fs');

/**
 * Naukri Profile Verification Engine
 * Verifies live increment of 'Applies (X)' count on Antony's real profile
 */
class NaukriVerifier {
  /**
   * Fetches current 'Applies (X)' count directly from Antony's Naukri homepage
   * @param {import('playwright').BrowserContext} context
   */
  async fetchCurrentAppliesCount(context) {
    let page = null;
    try {
      page = await context.newPage();
      await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded', timeout: 35000 });

      let count = null;
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(2000);
        count = await page.evaluate(() => {
          const match = document.body.innerText.match(/Applies\s*\(\s*(\d+)\s*\)/i);
          return match ? parseInt(match[1], 10) : null;
        });
        if (count !== null) break;
      }

      console.log(`[NaukriVerifier] Live Naukri Applies Count: ${count}`);
      return count;
    } catch (e) {
      console.warn('[NaukriVerifier] Error reading applies count:', e.message);
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * Verifies that the count increased after an application session
   * @param {number} beforeCount
   * @param {import('playwright').BrowserContext} context
   * @param {Function} notify
   */
  async verifyIncrement(beforeCount, context, notify = () => {}) {
    if (beforeCount === null) {
      return { verified: false, reason: 'Initial count not recorded' };
    }

    notify('log', { level: 'info', message: '🔍 Verifying application increment on Naukri profile...' });

    let page = null;
    try {
      page = await context.newPage();
      await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(4000);

      const afterCount = await page.evaluate(() => {
        const match = document.body.innerText.match(/Applies\s*\(\s*(\d+)\s*\)/i);
        return match ? parseInt(match[1], 10) : null;
      });

      // Capture screenshot proof of updated profile applies count
      const proofsDir = path.join(__dirname, '..', 'proofs');
      const filename = `naukri_count_verify_${Date.now()}.png`;
      await page.screenshot({ path: path.join(proofsDir, filename) });

      const diff = afterCount !== null ? afterCount - beforeCount : 0;
      const isIncreased = diff > 0;

      if (isIncreased) {
        notify('log', {
          level: 'success',
          message: `🎯 Verified! Naukri profile applies count increased from ${beforeCount} to ${afterCount} (+${diff})!`
        });
      } else {
        notify('log', {
          level: 'warn',
          message: `Notice: Naukri applies count is ${afterCount} (was ${beforeCount}). External company site applies may take time to reflect or sync via email confirmation.`
        });
      }

      return {
        verified: isIncreased,
        beforeCount,
        afterCount,
        diff,
        proofScreenshot: filename
      };
    } catch (e) {
      notify('log', { level: 'error', message: `Verification check failed: ${e.message}` });
      return { verified: false, error: e.message };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }
}

module.exports = new NaukriVerifier();
