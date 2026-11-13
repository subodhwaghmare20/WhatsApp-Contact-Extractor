/**
 * Data Processor Service
 * Cleans, normalizes, deduplicates, and categorizes WhatsApp participant data.
 */

class DataProcessor {
  /**
   * Check if a string resembles a phone number
   * @param {string} str
   * @returns {boolean}
   */
  static isPhoneNumber(str) {
    if (!str || typeof str !== 'string') return false;
    const cleaned = str.trim();
    const digitsOnly = cleaned.replace(/\D/g, '');
    const hasPlus = cleaned.startsWith('+');
    return (hasPlus || digitsOnly.length >= 8) && digitsOnly.length <= 16 && /^[\d\s\-+().]+$/.test(cleaned);
  }

  /**
   * Normalize a phone number to standard international format (e.g., +919876543210)
   * Preserves '+' if present, strips whitespace, hyphens, parentheses
   * @param {string} phone
   * @returns {string}
   */
  static normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return 'Not Available';
    let trimmed = phone.trim();

    if (trimmed.toLowerCase() === 'not available' || trimmed === '-' || trimmed === '') {
      return 'Not Available';
    }

    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');

    if (!digits || digits.length < 7) {
      return 'Not Available';
    }

    return hasPlus ? `+${digits}` : `+${digits}`;
  }

  /**
   * Clean text string (remove zero-width characters, non-breaking spaces, etc.)
   * @param {string} text
   * @returns {string}
   */
  static cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
      .replace(/\s+/g, ' ')                  // Normalize multiple spaces
      .trim();
  }

  /**
   * Process a single participant raw entry
   * @param {Object} raw - { primaryText, secondaryText, titleAttr, role, mobileNumber, contactStatus, extractionStatus, name }
   * @param {number} index
   * @returns {Object}
   */
  static processParticipant(raw, index = 1) {
    const primary = this.cleanText(raw.primaryText || '');
    const secondary = this.cleanText(raw.secondaryText || '');
    const titleAttr = this.cleanText(raw.titleAttr || '');
    const isAdmin = Boolean(raw.isAdmin || raw.role?.toLowerCase().includes('admin'));

    let name = this.cleanText(raw.name || '');
    let mobileNumber = raw.mobileNumber && raw.mobileNumber !== 'Not Available'
      ? this.normalizePhoneNumber(raw.mobileNumber)
      : 'Not Available';
    let contactStatus = raw.contactStatus || 'Unknown';
    let extractionStatus = raw.extractionStatus || 'Unavailable (Unknown)';

    // Case 1: Phone number is already known/resolved
    if (mobileNumber !== 'Not Available') {
      if (!name || name === 'Unknown') {
        if (primary && !this.isPhoneNumber(primary)) {
          name = primary;
        } else if (titleAttr && !this.isPhoneNumber(titleAttr)) {
          name = titleAttr;
        } else if (secondary && secondary.startsWith('~')) {
          name = this.cleanText(secondary.replace(/^~/, ''));
        } else {
          name = 'Unknown';
        }
      }

      if (contactStatus === 'Unknown') {
        contactStatus = name !== 'Unknown' ? 'Saved' : 'Unsaved';
      }

      if (extractionStatus === 'Unavailable (Unknown)' || extractionStatus.includes('Unavailable')) {
        extractionStatus = contactStatus === 'Saved' ? 'Extracted (Saved Contact)' : 'Extracted (Direct)';
      }
    }
    // Case 2: Primary text is a phone number (e.g., "+91 98765 43210")
    else if (this.isPhoneNumber(primary)) {
      mobileNumber = this.normalizePhoneNumber(primary);
      contactStatus = 'Unsaved';
      extractionStatus = 'Extracted (Direct)';

      if (secondary && secondary.startsWith('~')) {
        name = this.cleanText(secondary.replace(/^~/, ''));
      } else if (titleAttr && !this.isPhoneNumber(titleAttr)) {
        name = titleAttr;
      } else {
        name = 'Unknown';
      }
    }
    // Case 3: Primary text is a contact name (e.g., "Rahul Patil")
    else {
      name = primary || titleAttr || 'Unknown';

      // Check if secondary text contains a phone number
      if (this.isPhoneNumber(secondary)) {
        mobileNumber = this.normalizePhoneNumber(secondary);
        contactStatus = 'Saved';
        extractionStatus = 'Extracted (Direct)';
      }
      // Check if title attribute contains a phone number
      else if (this.isPhoneNumber(titleAttr)) {
        mobileNumber = this.normalizePhoneNumber(titleAttr);
        contactStatus = 'Saved';
        extractionStatus = 'Extracted (Direct)';
      }
      else {
        mobileNumber = 'Not Available';
        contactStatus = name !== 'Unknown' ? 'Saved' : 'Unknown';
        extractionStatus = name !== 'Unknown' ? 'Unavailable (Hidden)' : 'Unavailable (Unknown)';
      }
    }

    return {
      srNo: index,
      name: name || 'Unknown',
      mobileNumber: mobileNumber,
      contactStatus: contactStatus,
      extractionStatus: extractionStatus,
      isAdmin: isAdmin
    };
  }

  /**
   * Deduplicate and clean an array of raw or processed participants
   * @param {Array<Object>} list
   * @returns {Array<Object>}
   */
  static processAndDeduplicate(list) {
    if (!Array.isArray(list)) return [];

    const processed = [];
    const seenNumbers = new Set();
    const seenNamesWithoutNumber = new Set();

    let counter = 1;

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;

      const p = this.processParticipant(item, counter);

      if (!p || (!p.name && p.mobileNumber === 'Not Available')) continue;
      if (p.name === 'Unknown' && p.mobileNumber === 'Not Available') continue;

      const hasValidNumber = p.mobileNumber && p.mobileNumber !== 'Not Available';

      if (hasValidNumber) {
        if (seenNumbers.has(p.mobileNumber)) {
          continue; // Duplicate phone number
        }
        seenNumbers.add(p.mobileNumber);
      } else {
        const nameKey = (p.name || 'Unknown').toLowerCase().trim();
        if (nameKey !== 'unknown' && seenNamesWithoutNumber.has(nameKey)) {
          continue; // Duplicate name with missing number
        }
        if (nameKey !== 'unknown') {
          seenNamesWithoutNumber.add(nameKey);
        }
      }

      processed.push({
        ...p,
        srNo: counter++
      });
    }

    return processed;
  }

  /**
   * Generate summary statistics from participant list
   * @param {Array<Object>} participants
   * @returns {Object}
   */
  static getSummaryStats(participants) {
    const total = participants.length;
    let numbersExtracted = 0;
    let numbersUnavailable = 0;
    let savedCount = 0;
    let unsavedCount = 0;
    let adminCount = 0;
    let profileExtractedCount = 0;

    for (const p of participants) {
      if (p.mobileNumber && p.mobileNumber !== 'Not Available') {
        numbersExtracted++;
      } else {
        numbersUnavailable++;
      }

      if (p.contactStatus === 'Saved') savedCount++;
      else if (p.contactStatus === 'Unsaved') unsavedCount++;

      if (p.extractionStatus && (p.extractionStatus.includes('Saved') || p.extractionStatus.includes('Profile'))) {
        profileExtractedCount++;
      }

      if (p.isAdmin) adminCount++;
    }

    return {
      totalParticipants: total,
      numbersExtracted,
      numbersUnavailable,
      savedContacts: savedCount,
      unsavedContacts: unsavedCount,
      profileExtracted: profileExtractedCount,
      admins: adminCount
    };
  }
}

module.exports = DataProcessor;
