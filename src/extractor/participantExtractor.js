/**
 * WhatsApp Participant Extractor
 * Multi-layer extraction engine:
 * 1. Synchronized Client Contact Store (reads IndexedDB model-storage contact & participant collections)
 * 2. Contact Dictionary Cross-Referencing (resolves saved contact names to mobile numbers)
 * 3. DOM Virtual Scrolling and Profile Inspection Fallback
 */

const logger = require('../utils/logger');
const DataProcessor = require('../services/dataProcessor');

class ParticipantExtractor {
  constructor(page) {
    this.page = page;
  }

  /**
   * Helper delay
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Detect current active chat and verify if it is a group
   * @returns {Promise<{ isGroup: boolean, title: string, subtitle?: string }>}
   */
  async detectActiveChat() {
    return await this.page.evaluate(() => {
      const mainHeader = document.querySelector('main header, #main header');
      if (!mainHeader) {
        return { isGroup: false, title: '', error: 'No active chat selected. Please open a group chat first.' };
      }

      // Title element
      const titleEl = mainHeader.querySelector('div[role="button"] span[title]') ||
                      mainHeader.querySelector('span[dir="auto"]') ||
                      mainHeader.querySelector('span[title]');
      
      let title = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText) : '';
      
      // Fallback: split mainHeader text by newlines
      const headerLines = (mainHeader.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (!title && headerLines.length > 0) {
        title = headerLines[0];
      }

      // Subtitle element
      const subTitleEl = mainHeader.querySelector('div.copyable-text span') ||
                         mainHeader.querySelector('span[title*=","]') ||
                         mainHeader.querySelector('span[dir="auto"]:not([title])');
      let subtitle = subTitleEl ? (subTitleEl.innerText || '') : '';
      if (!subtitle && headerLines.length > 1) {
        subtitle = headerLines.slice(1).join(', ');
      }

      const isOneOnOne = /^(online|typing\.\.\.|last seen|at \d)/i.test(subtitle.trim());
      const hasGroupIndicators = subtitle.includes(',') || 
                                 /participants|members|group/i.test(subtitle) ||
                                 subtitle.length > 15;

      return {
        isGroup: hasGroupIndicators && !isOneOnOne,
        title: title.trim(),
        subtitle: subtitle.trim()
      };
    });
  }

  /**
   * Extract participants and synchronized contact dictionary directly from WhatsApp Web's IndexedDB
   * @param {string} groupTitle
   * @returns {Promise<Object>}
   */
  async extractFromClientStore(groupTitle) {
    return await this.page.evaluate(async (title) => {
      function openDb(dbName) {
        return new Promise((resolve) => {
          if (!window.indexedDB) return resolve(null);
          const req = window.indexedDB.open(dbName);
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = () => resolve(null);
        });
      }

      function cleanPhone(raw) {
        if (!raw) return 'Not Available';
        const digits = raw.replace(/\D/g, '');
        if (digits.length >= 7) return `+${digits}`;
        return 'Not Available';
      }

      const db = await openDb('model-storage');
      if (!db) {
        return { storeParticipants: null, matchedSubject: null };
      }

      try {
        // 1. Get group-metadata (lightweight: ~10-50 groups)
        const groups = await new Promise((resolve) => {
          if (!db.objectStoreNames.contains('group-metadata')) return resolve([]);
          try {
            const tx = db.transaction('group-metadata', 'readonly');
            const store = tx.objectStore('group-metadata');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch (e) { resolve([]); }
        });

        const normTitle = (title || '').trim().toLowerCase();
        let matchedGroup = groups.find(g => {
          if (!g || !g.subject) return false;
          const s = g.subject.trim().toLowerCase();
          return s === normTitle || normTitle.includes(s) || s.includes(normTitle);
        });

        // If no title provided or no match, fall back to the first available group
        if (!matchedGroup && groups.length > 0 && !normTitle) {
          matchedGroup = groups[0];
        }

        if (!matchedGroup) {
          db.close();
          return { storeParticipants: null, matchedSubject: null };
        }

        // 2. Get participants for this specific group only
        const groupParticipantsData = await new Promise((resolve) => {
          if (!db.objectStoreNames.contains('participant')) return resolve(null);
          try {
            const tx = db.transaction('participant', 'readonly');
            const store = tx.objectStore('participant');
            const req = store.getAll();
            req.onsuccess = () => {
              const all = req.result || [];
              const match = all.find(p => p && p.groupId === matchedGroup.id);
              resolve(match || null);
            };
            req.onerror = () => resolve(null);
          } catch (e) { resolve(null); }
        });

        if (!groupParticipantsData || !groupParticipantsData.participants || groupParticipantsData.participants.length === 0) {
          db.close();
          return { storeParticipants: null, matchedSubject: matchedGroup.subject };
        }

        const jids = groupParticipantsData.participants;
        const admins = new Set(groupParticipantsData.admins || []);
        const jidSet = new Set(jids);

        // 3. Look up ONLY the contacts belonging to this group (avoid loading thousands of unrelated contacts)
        const contactMap = new Map();
        if (db.objectStoreNames.contains('contact')) {
          await new Promise((resolve) => {
            try {
              const tx = db.transaction('contact', 'readonly');
              const store = tx.objectStore('contact');
              const req = store.openCursor();
              req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                  const val = cursor.value;
                  if (val && val.id && (jidSet.has(val.id) || jidSet.has(val.id.replace('@c.us', '')))) {
                    contactMap.set(val.id, {
                      name: val.name || '',
                      pushname: val.pushname || '',
                      phoneNumber: val.phoneNumber || ''
                    });
                  }
                  cursor.continue();
                } else {
                  resolve();
                }
              };
              req.onerror = () => resolve();
            } catch (e) { resolve(); }
          });
        }

        db.close();

        // 4. Construct clean participant list (lightweight, under 20KB)
        const storeParticipants = [];
        for (const jid of jids) {
          const c = contactMap.get(jid) || contactMap.get(jid.replace('@c.us', '')) || {};
          let phone = cleanPhone(c.phoneNumber);
          if (phone === 'Not Available' && jid.includes('@c.us')) {
            phone = cleanPhone(jid);
          }

          const name = c.name || c.pushname || (phone !== 'Not Available' ? phone : 'Unknown');
          const status = c.name ? 'Saved' : (phone !== 'Not Available' ? 'Unsaved' : 'Unknown');
          const extStatus = phone !== 'Not Available'
            ? (c.name ? 'Extracted (Saved Contact)' : 'Extracted (Direct)')
            : 'Unavailable (Hidden)';

          storeParticipants.push({
            jid,
            primaryText: name,
            secondaryText: c.pushname ? `~${c.pushname}` : '',
            titleAttr: name,
            resolvedPhone: phone,
            contactName: c.name || '',
            pushname: c.pushname || '',
            contactStatus: status,
            extractionStatus: extStatus,
            isAdmin: admins.has(jid)
          });
        }

        return {
          matchedSubject: matchedGroup.subject,
          storeParticipants,
          exactNameMapEntries: [],
          allPhoneContacts: []
        };
      } catch (err) {
        try { db.close(); } catch (e) {}
        return { storeParticipants: null, matchedSubject: null };
      }
    }, groupTitle);
  }

  /**
   * Open the Group Info side panel / drawer if not already open
   */
  async openGroupInfo() {
    logger.info('Opening Group Info drawer...');
    
    const isAlreadyOpen = await this.page.evaluate(() => {
      const drawer = document.querySelector('[data-testid="drawer-right"]') ||
                     document.querySelector('section[data-testid="chat-info-drawer"]') ||
                     document.querySelector('span[title="Group info"]') ||
                     document.querySelector('div[role="region"]');
      return Boolean(drawer);
    });

    if (!isAlreadyOpen) {
      const headerClicked = await this.page.evaluate(() => {
        const header = document.querySelector('#main header');
        if (!header) return false;
        const clickableArea = header.querySelector('div[role="button"]') || header;
        clickableArea.click();
        return true;
      });

      if (!headerClicked) {
        throw new Error('Could not find active chat header to open Group Info.');
      }

      await this.delay(1200);
    }
  }

  /**
   * Try to open the "View all" participants modal if present (for large groups)
   */
  async openFullParticipantModal() {
    logger.info('Checking for "View all participants" modal...');
    
    const clickedViewAll = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('div[role="button"], span[dir="auto"], div[data-testid]'));
      
      const viewAllBtn = buttons.find(el => {
        const text = (el.innerText || '').toLowerCase();
        return text.includes('view all') || 
               text.includes('more participants') || 
               text.includes('view all participants') ||
               /^\d+\s+more$/.test(text.trim());
      });

      if (viewAllBtn) {
        viewAllBtn.click();
        return true;
      }
      return false;
    });

    if (clickedViewAll) {
      logger.info('Clicked "View all" participants button.');
      await this.delay(1000);
    }
  }

  /**
   * Extract raw participant items currently in the visible DOM
   */
  async getVisibleParticipantsFromDOM() {
    return await this.page.evaluate(() => {
      const results = [];

      const candidateContainers = Array.from(document.querySelectorAll('[data-testid="drawer-right"], div[role="dialog"], section, div[role="region"]'));
      
      let container = candidateContainers.find(c => {
        return c.innerText && (/participants|members/i.test(c.innerText) || c.querySelector('[role="listitem"]'));
      }) || document.body;

      let rows = Array.from(container.querySelectorAll('div[role="listitem"]'));
      if (rows.length === 0) {
        rows = Array.from(container.querySelectorAll('div[data-testid="cell-frame-container"], div.lhggfdgh, div._ak8q'));
      }

      for (const row of rows) {
        const textNodes = Array.from(row.querySelectorAll('span[dir="auto"], span[title], div[title]'));
        if (textNodes.length === 0) continue;

        let primaryText = '';
        let secondaryText = '';
        let titleAttr = '';
        let isAdmin = false;

        const rowText = row.innerText || '';
        if (rowText.toLowerCase().includes('admin')) {
          isAdmin = true;
        }

        for (const node of textNodes) {
          const t = node.getAttribute('title');
          if (t && !titleAttr) {
            titleAttr = t;
          }
        }

        const distinctTexts = [];
        for (const node of textNodes) {
          const txt = (node.innerText || '').trim();
          if (txt && !distinctTexts.includes(txt) && !txt.toLowerCase().includes('admin')) {
            distinctTexts.push(txt);
          }
        }

        if (distinctTexts.length > 0) {
          primaryText = distinctTexts[0];
        }
        if (distinctTexts.length > 1) {
          secondaryText = distinctTexts[1];
        }

        if (primaryText) {
          results.push({
            primaryText,
            secondaryText,
            titleAttr,
            isAdmin
          });
        }
      }

      return results;
    });
  }

  /**
   * Main extraction workflow
   * @param {Function} onProgress - Callback for live progress updates
   * @param {Object} options
   * @returns {Promise<{ groupTitle: string, participants: Array<Object>, stats: Object }>}
   */
  async extract(onProgress = () => {}, options = {}) {
    // 1. Determine target group (either passed from cloud UI dropdown or detected from active chat)
    let targetGroupTitle = (options.groupTitle || '').trim();

    if (!targetGroupTitle) {
      const chatInfo = await this.detectActiveChat();
      if (chatInfo.error) {
        throw new Error('No WhatsApp group selected. Please select a group from the dropdown list.');
      }
      targetGroupTitle = chatInfo.title;
    }

    logger.info(`Extracting Group: "${targetGroupTitle}"`);

    onProgress({
      phase: 'init',
      message: `Analyzing WhatsApp client stores for "${targetGroupTitle}"...`
    });

    // 2. Query WhatsApp client database (IndexedDB model-storage)
    const clientData = await this.extractFromClientStore(targetGroupTitle);
    const exactNameMap = new Map(clientData.exactNameMapEntries || []);
    const allPhoneContacts = clientData.allPhoneContacts || [];

    logger.info(`Synchronized Contact Dictionary loaded: ${exactNameMap.size} phone-mapped contacts available.`);

    let participantsList = [];

    // Method A: Direct Group Store Lookup (Fastest, 100% reliable in cloud)
    if (clientData.storeParticipants && clientData.storeParticipants.length > 0) {
      logger.success(`Direct Group Store Match! Found ${clientData.storeParticipants.length} group participants directly in WhatsApp client memory.`);
      
      onProgress({
        phase: 'store_extracted',
        message: `Extracted ${clientData.storeParticipants.length} participants directly from client store...`
      });

      for (const p of clientData.storeParticipants) {
        participantsList.push({
          primaryText: p.contactName || p.primaryText,
          secondaryText: p.secondaryText,
          titleAttr: p.titleAttr,
          mobileNumber: p.resolvedPhone,
          contactStatus: p.contactStatus,
          extractionStatus: p.extractionStatus,
          isAdmin: p.isAdmin
        });
      }
    }

    // Method B: DOM Traversal Fallback (ONLY runs if client store did not find group participants)
    if (participantsList.length === 0) {
      logger.info('Client store did not match; falling back to DOM inspection...');
      try {
        await this.openGroupInfo();
        await this.openFullParticipantModal();

        const scrollContainerSelector = await this.page.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (dialog) {
            const scrollable = Array.from(dialog.querySelectorAll('div')).find(el => {
              const style = window.getComputedStyle(el);
              return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            });
            if (scrollable) {
              scrollable.setAttribute('data-extractor-scroll', 'true');
              return '[data-extractor-scroll="true"]';
            }
          }

          const drawer = document.querySelector('[data-testid="drawer-right"]') || document.querySelector('section');
          if (drawer) {
            const scrollable = Array.from(drawer.querySelectorAll('div')).find(el => {
              const style = window.getComputedStyle(el);
              return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            });
            if (scrollable) {
              scrollable.setAttribute('data-extractor-scroll', 'true');
              return '[data-extractor-scroll="true"]';
            }
          }

          return null;
        });

        const domRawMap = new Map();
        let noNewCount = 0;
        const maxNoNew = 5;
        let iteration = 0;

        logger.info('Scanning visible DOM participant rows...');

        while (noNewCount < maxNoNew && iteration < 50) {
          iteration++;

          const currentBatch = await this.getVisibleParticipantsFromDOM();
          let addedInThisIteration = 0;

          for (const item of currentBatch) {
            const key = `${item.primaryText}|${item.secondaryText}|${item.titleAttr}`;
            if (!domRawMap.has(key)) {
              domRawMap.set(key, item);
              addedInThisIteration++;
            }
          }

          if (addedInThisIteration > 0) {
            noNewCount = 0;
          } else {
            noNewCount++;
          }

          onProgress({
            phase: 'list_scan',
            iteration,
            totalRawFound: domRawMap.size,
            message: `Scanning group list: found ${domRawMap.size} visible rows...`
          });

          const scrollResult = await this.page.evaluate((sel) => {
            let el = sel ? document.querySelector(sel) : null;
            if (!el) {
              const candidate = Array.from(document.querySelectorAll('div')).find(d => {
                return d.scrollHeight > d.clientHeight && (d.innerText || '').includes('participants');
              });
              el = candidate;
            }

            if (el) {
              const prevTop = el.scrollTop;
              el.scrollTop += 380;
              return {
                prevTop,
                newTop: el.scrollTop,
                maxTop: el.scrollHeight - el.clientHeight
              };
            }
            return null;
          }, scrollContainerSelector);

          if (scrollResult && scrollResult.prevTop === scrollResult.newTop && scrollResult.newTop >= scrollResult.maxTop - 5) {
            noNewCount += 2;
          }

          await this.delay(300);
        }

        // Merge DOM items with store items
        const domList = Array.from(domRawMap.values());
        for (const domItem of domList) {
          const alreadyExists = participantsList.some(p => 
            (p.primaryText && p.primaryText.toLowerCase() === domItem.primaryText.toLowerCase()) ||
            (p.titleAttr && p.titleAttr.toLowerCase() === domItem.primaryText.toLowerCase())
          );

          if (!alreadyExists) {
            participantsList.push(domItem);
          }
        }
      } catch (domErr) {
        logger.warn('DOM fallback skipped:', domErr.message);
      }
    }

    // 3. Resolve phone numbers for all saved contacts using Contact Dictionary
    logger.info(`Enriching ${participantsList.length} participants with synchronized phone numbers...`);

    for (const p of participantsList) {
      // If already has a valid phone number, preserve it
      if (p.mobileNumber && p.mobileNumber !== 'Not Available') {
        continue;
      }

      const nameCandidates = [
        p.contactName,
        p.primaryText,
        p.titleAttr,
        p.secondaryText ? p.secondaryText.replace(/^~/, '').trim() : ''
      ].filter(Boolean);

      let resolvedNumber = null;

      for (const rawCandidate of nameCandidates) {
        if (!rawCandidate || rawCandidate === 'You' || rawCandidate === 'Unknown') continue;
        const lower = rawCandidate.toLowerCase().trim();

        // Check if candidate is already a phone number
        if (DataProcessor.isPhoneNumber(rawCandidate)) {
          resolvedNumber = DataProcessor.normalizePhoneNumber(rawCandidate);
          p.contactStatus = 'Unsaved';
          p.extractionStatus = 'Extracted (Direct)';
          break;
        }

        // 1. Exact match in synchronized contact dictionary
        if (exactNameMap.has(lower)) {
          resolvedNumber = exactNameMap.get(lower);
          p.contactStatus = 'Saved';
          p.extractionStatus = 'Extracted (Saved Contact)';
          break;
        }

        // 2. Substring match
        const subMatch = allPhoneContacts.find(c => {
          if (!c.name) return false;
          return lower.includes(c.name) || c.name.includes(lower);
        });

        if (subMatch) {
          resolvedNumber = subMatch.phone;
          p.contactStatus = 'Saved';
          p.extractionStatus = 'Extracted (Saved Contact)';
          break;
        }

        // 3. Significant token match
        const tokens = lower.split(/[\s,()_-]+/).filter(t => t.length >= 3 && !['sir', 'mam', 'branch', 'head', 'tyss', 'sql', 'manual', 'testing', 'group'].includes(t));
        if (tokens.length > 0) {
          const tokMatch = allPhoneContacts.find(c => {
            if (!c.name) return false;
            return tokens.some(tok => c.name.includes(tok));
          });
          if (tokMatch) {
            resolvedNumber = tokMatch.phone;
            p.contactStatus = 'Saved';
            p.extractionStatus = 'Extracted (Saved Contact)';
            break;
          }
        }
      }

      if (resolvedNumber) {
        p.mobileNumber = resolvedNumber;
      } else if (!p.mobileNumber) {
        p.mobileNumber = 'Not Available';
        p.extractionStatus = 'Unavailable (Hidden)';
      }
    }

    // 4. Clean, deduplicate and format
    const cleanedParticipants = DataProcessor.processAndDeduplicate(participantsList);
    const summaryStats = DataProcessor.getSummaryStats(cleanedParticipants);

    logger.success(`Extraction complete! Cleaned participants: ${cleanedParticipants.length} (Numbers Extracted: ${summaryStats.numbersExtracted}, Unavailable: ${summaryStats.numbersUnavailable})`);

    return {
      groupTitle: clientData.matchedSubject || chatInfo.title,
      participants: cleanedParticipants,
      stats: summaryStats
    };
  }
}

module.exports = ParticipantExtractor;
