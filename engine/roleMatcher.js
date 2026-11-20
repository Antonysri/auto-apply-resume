/**
 * Role Matcher Engine
 * Scans company career pages to identify target roles and locate the apply button/link.
 * Enforces strict exclusion rules (NEVER apply to Java, Python, Django, .NET, C#, Ruby, Go, Flutter, etc.).
 */

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
  { name: 'Kotlin', regex: /\b(kotlin)\b/i },
  { name: 'Lead / Tech Lead', regex: /(?:^|[^a-zA-Z0-9])(?:lead|leads|leader|leaders|tech\s*lead|technical\s*lead|team\s*lead|team\s*leader|module\s*lead|project\s*lead|engineering\s*lead|lead\s*developer|lead\s*engineer|lead\s*consultant|lead\s*architect)(?:$|[^a-zA-Z0-9])/i }
];

function isBlacklisted(text) {
  if (!text) return { excluded: false };
  for (const item of BLACKLIST_RULES) {
    if (item.regex.test(text)) {
      return { excluded: true, skill: item.name };
    }
  }
  return { excluded: false };
}

function hasBlacklist(str) {
  if (!str) return false;
  return BLACKLIST_RULES.some(item => item.regex.test(str));
}

class RoleMatcher {
  /**
   * Scans a company page to find the target job apply action
   * @param {import('playwright').Page} page
   * @param {string[]} targetRoles
   * @param {string[]} excludedSkills
   */
  async findAndTriggerJob(page, targetRoles, excludedSkills = []) {
    console.log(`[RoleMatcher] Scanning ${page.url()} for target roles:`, targetRoles);

    // 1. Scan Table Rows first (e.g. Salesquared careers.html)
    const tableResult = await page.evaluate(({ roles }) => {
      function normalize(str) {
        return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      }

      function checkBlacklist(str) {
        if (!str) return false;
        const patterns = [
          /\b(python|python3|pyspark|pandas|numpy)\b/i,
          /\b(django|dajno|flask|fastapi)\b/i,
          /\b(java|core\s*java|advanced\s*java|j2ee|spring|spring\s*boot|hibernate|quarkus|micronaut)\b(?!\s*script)/i,
          /(?:^|[^a-zA-Z0-9])(?:c#|csharp|c\s*sharp|\.net|\.\s*net|dotnet|dot\s*net|dot\.net|dot-net|asp\.net|asp\s*\.?net|vb\.net|vb\s*\.?net)(?:$|[^a-zA-Z0-9])/i,
          /(^|[^a-zA-Z0-9])(c\+\+|embedded\s*c)($|[^a-zA-Z0-9])/i,
          /\b(ruby|ruby\s*on\s*rails|rails)\b/i,
          /\b(golang|\bgo\s+developer\b)\b/i,
          /\b(rust|rustlang)\b/i,
          /\b(scala|akka)\b/i,
          /\b(flutter|dart|swift|swiftui|kotlin|objective-c)\b/i,
          /(?:^|[^a-zA-Z0-9])(?:lead|leads|leader|leaders|tech\s*lead|technical\s*lead|team\s*lead|team\s*leader|module\s*lead|project\s*lead|engineering\s*lead|lead\s*developer|lead\s*engineer|lead\s*consultant|lead\s*architect)(?:$|[^a-zA-Z0-9])/i
        ];
        return patterns.some(p => p.test(str));
      }

      const rows = Array.from(document.querySelectorAll('table tr, .table-row, [role="row"]'));
      for (const row of rows) {
        const rawText = row.innerText;
        // Skip if job requires blacklisted skills
        if (checkBlacklist(rawText)) {
          continue;
        }

        const text = normalize(rawText);
        for (const role of roles) {
          const normRole = normalize(role);
          const tokens = normRole.split(' ').filter(t => t.length > 2);
          const matched = text.includes(normRole) || (tokens.length > 0 && tokens.every(tok => text.includes(tok)));
          
          if (matched) {
            const link = row.querySelector('a, button');
            if (link) {
              const href = link.tagName === 'A' ? link.href : null;
              return {
                found: true,
                matchedRole: role,
                rowSnippet: row.innerText.trim().replace(/\s+/g, ' '),
                applyUrl: href,
                buttonText: link.innerText.trim(),
                selector: 'table tr'
              };
            }
          }
        }
      }
      return null;
    }, { roles: targetRoles });

    if (tableResult) {
      console.log('[RoleMatcher] Found role in table row:', tableResult);
      return tableResult;
    }

    // 2. Scan Job Cards / Containers (e.g. Workday, Lever, Greenhouse, custom cards)
    const cardResult = await page.evaluate(({ roles }) => {
      function normalize(str) {
        return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      }

      function checkBlacklist(str) {
        if (!str) return false;
        const patterns = [
          /\b(python|python3|pyspark|pandas|numpy)\b/i,
          /\b(django|dajno|flask|fastapi)\b/i,
          /\b(java|core\s*java|advanced\s*java|j2ee|spring|spring\s*boot|hibernate|quarkus|micronaut)\b(?!\s*script)/i,
          /(?:^|[^a-zA-Z0-9])(?:c#|csharp|c\s*sharp|\.net|\.\s*net|dotnet|dot\s*net|dot\.net|dot-net|asp\.net|asp\s*\.?net|vb\.net|vb\s*\.?net)(?:$|[^a-zA-Z0-9])/i,
          /(^|[^a-zA-Z0-9])(c\+\+|embedded\s*c)($|[^a-zA-Z0-9])/i,
          /\b(ruby|ruby\s*on\s*rails|rails)\b/i,
          /\b(golang|\bgo\s+developer\b)\b/i,
          /\b(rust|rustlang)\b/i,
          /\b(scala|akka)\b/i,
          /\b(flutter|dart|swift|swiftui|kotlin|objective-c)\b/i,
          /(?:^|[^a-zA-Z0-9])(?:lead|leads|leader|leaders|tech\s*lead|technical\s*lead|team\s*lead|team\s*leader|module\s*lead|project\s*lead|engineering\s*lead|lead\s*developer|lead\s*engineer|lead\s*consultant|lead\s*architect)(?:$|[^a-zA-Z0-9])/i
        ];
        return patterns.some(p => p.test(str));
      }

      const selectors = [
        '.job-item', '.job-card', '.career-card', '.posting', '.opening',
        '[data-job-id]', '.position', '.listing-item', '.vacancy', 'article', '.job'
      ];
      const elements = Array.from(document.querySelectorAll(selectors.join(', ')));

      for (const el of elements) {
        const rawText = el.innerText;
        // Skip blacklisted skills
        if (checkBlacklist(rawText)) {
          continue;
        }

        const text = normalize(rawText);
        for (const role of roles) {
          const normRole = normalize(role);
          const tokens = normRole.split(' ').filter(t => t.length > 2);
          const matched = text.includes(normRole) || (tokens.length > 0 && tokens.every(tok => text.includes(tok)));
          if (matched) {
            const btn = el.querySelector('a, button');
            return {
              found: true,
              matchedRole: role,
              applyUrl: btn && btn.tagName === 'A' ? btn.href : null,
              buttonText: btn ? btn.innerText.trim() : null
            };
          }
        }
      }
      return null;
    }, { roles: targetRoles });

    if (cardResult) {
      console.log('[RoleMatcher] Found role in job card:', cardResult);
      return cardResult;
    }

    // 3. Scan all clickable Links/Buttons on the page for role keywords
    const linkResult = await page.evaluate(({ roles }) => {
      function normalize(str) {
        return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      }

      function checkBlacklist(str) {
        if (!str) return false;
        const patterns = [
          /\b(python|python3|pyspark|pandas|numpy)\b/i,
          /\b(django|dajno|flask|fastapi)\b/i,
          /\b(java|core\s*java|advanced\s*java|j2ee|spring|spring\s*boot|hibernate|quarkus|micronaut)\b(?!\s*script)/i,
          /(?:^|[^a-zA-Z0-9])(?:c#|csharp|c\s*sharp|\.net|\.\s*net|dotnet|dot\s*net|dot\.net|dot-net|asp\.net|asp\s*\.?net|vb\.net|vb\s*\.?net)(?:$|[^a-zA-Z0-9])/i,
          /(^|[^a-zA-Z0-9])(c\+\+|embedded\s*c)($|[^a-zA-Z0-9])/i,
          /\b(ruby|ruby\s*on\s*rails|rails)\b/i,
          /\b(golang|\bgo\s+developer\b)\b/i,
          /\b(rust|rustlang)\b/i,
          /\b(scala|akka)\b/i,
          /\b(flutter|dart|swift|swiftui|kotlin|objective-c)\b/i,
          /(?:^|[^a-zA-Z0-9])(?:lead|leads|leader|leaders|tech\s*lead|technical\s*lead|team\s*lead|team\s*leader|module\s*lead|project\s*lead|engineering\s*lead|lead\s*developer|lead\s*engineer|lead\s*consultant|lead\s*architect)(?:$|[^a-zA-Z0-9])/i
        ];
        return patterns.some(p => p.test(str));
      }

      const allLinks = Array.from(document.querySelectorAll('a, button'));
      for (const link of allLinks) {
        const rawText = link.innerText || link.getAttribute('aria-label') || '';
        if (checkBlacklist(rawText)) {
          continue;
        }

        const text = normalize(rawText);
        for (const role of roles) {
          const normRole = normalize(role);
          const tokens = normRole.split(' ').filter(t => t.length > 2);
          if (text.includes(normRole) || (tokens.length > 0 && tokens.every(tok => text.includes(tok)))) {
            return {
              found: true,
              matchedRole: role,
              applyUrl: link.tagName === 'A' ? link.href : null,
              buttonText: link.innerText.trim()
            };
          }
        }
      }
      return null;
    }, { roles: targetRoles });

    if (linkResult) {
      console.log('[RoleMatcher] Found role in direct link/button:', linkResult);
      return linkResult;
    }

    // 4. Check if the page is already a dedicated job application form (e.g. Greenhouse, Lever, Google Form)
    const formCheck = await page.evaluate(() => {
      function checkBlacklist(str) {
        if (!str) return false;
        const patterns = [
          /\b(python|python3|pyspark|pandas|numpy)\b/i,
          /\b(django|dajno|flask|fastapi)\b/i,
          /\b(java|core\s*java|advanced\s*java|j2ee|spring|spring\s*boot|hibernate|quarkus|micronaut)\b(?!\s*script)/i,
          /(?:^|[^a-zA-Z0-9])(?:c#|csharp|c\s*sharp|\.net|\.\s*net|dotnet|dot\s*net|dot\.net|dot-net|asp\.net|asp\s*\.?net|vb\.net|vb\s*\.?net)(?:$|[^a-zA-Z0-9])/i,
          /(^|[^a-zA-Z0-9])(c\+\+|embedded\s*c)($|[^a-zA-Z0-9])/i,
          /\b(ruby|ruby\s*on\s*rails|rails)\b/i,
          /\b(golang|\bgo\s+developer\b)\b/i,
          /\b(rust|rustlang)\b/i,
          /\b(scala|akka)\b/i,
          /\b(flutter|dart|swift|swiftui|kotlin|objective-c)\b/i,
          /(?:^|[^a-zA-Z0-9])(?:lead|leads|leader|leaders|tech\s*lead|technical\s*lead|team\s*lead|team\s*leader|module\s*lead|project\s*lead|engineering\s*lead|lead\s*developer|lead\s*engineer|lead\s*consultant|lead\s*architect)(?:$|[^a-zA-Z0-9])/i
        ];
        return patterns.some(p => p.test(str));
      }

      const bodyText = document.body.innerText || '';
      if (checkBlacklist(bodyText)) {
        return { isDirectForm: false, isBlacklisted: true };
      }

      const isATS = /greenhouse|lever|workday|ashby|smartrecruiters|forms\.gle|docs\.google\.com\/forms/i.test(window.location.href);
      const hasFileInput = document.querySelector('input[type="file"]') !== null;
      const hasApplicantInputs = Array.from(document.querySelectorAll('input, textarea')).some(el => {
        const meta = `${el.name || ''} ${el.placeholder || ''} ${el.id || ''}`.toLowerCase();
        return /resume|cv|first_name|full_name|applicant|experience/i.test(meta);
      });
      return { isDirectForm: isATS || (hasFileInput && hasApplicantInputs), isBlacklisted: false };
    });

    if (formCheck.isBlacklisted) {
      console.warn('[RoleMatcher] Page requires blacklisted skill. Skipping!');
      return { found: false, blacklisted: true };
    }

    if (formCheck.isDirectForm) {
      console.log('[RoleMatcher] Page is a dedicated job application form directly!');
      return { found: true, isDirectForm: true, applyUrl: page.url() };
    }

    console.warn('[RoleMatcher] No matching job role found on page.');
    return { found: false };
  }
}

module.exports = new RoleMatcher();
