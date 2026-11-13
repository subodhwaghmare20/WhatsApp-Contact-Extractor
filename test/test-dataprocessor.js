/**
 * Unit Test for DataProcessor Service (with Profile Inspection Support)
 */

const assert = require('assert');
const DataProcessor = require('../src/services/dataProcessor');
const logger = require('../src/utils/logger');

logger.step(1, 'Testing Phone Number Detection and Normalization');

// Test phone number formats
assert.strictEqual(DataProcessor.isPhoneNumber('+91 98765 43210'), true);
assert.strictEqual(DataProcessor.isPhoneNumber('+1 (555) 123-4567'), true);
assert.strictEqual(DataProcessor.isPhoneNumber('+44 20 7946 0958'), true);
assert.strictEqual(DataProcessor.isPhoneNumber('Rahul Patil'), false);
assert.strictEqual(DataProcessor.isPhoneNumber(''), false);

// Test normalization
assert.strictEqual(DataProcessor.normalizePhoneNumber('+91 98765 43210'), '+919876543210');
assert.strictEqual(DataProcessor.normalizePhoneNumber('+1 (555) 123-4567'), '+15551234567');
assert.strictEqual(DataProcessor.normalizePhoneNumber('Not Available'), 'Not Available');
assert.strictEqual(DataProcessor.normalizePhoneNumber(''), 'Not Available');

logger.success('Phone number detection and normalization passed.');

logger.step(2, 'Testing Participant Processing and Extraction Status');

// Unsaved contact
const rawUnsaved = {
  primaryText: '+91 98765 43210',
  secondaryText: '~Amit',
  titleAttr: '+91 98765 43210',
  isAdmin: false
};
const pUnsaved = DataProcessor.processParticipant(rawUnsaved, 1);
assert.strictEqual(pUnsaved.mobileNumber, '+919876543210');
assert.strictEqual(pUnsaved.name, 'Amit');
assert.strictEqual(pUnsaved.contactStatus, 'Unsaved');
assert.strictEqual(pUnsaved.extractionStatus, 'Extracted (Direct)');

// Saved contact with visible number in row
const rawSavedWithNum = {
  primaryText: 'Rahul Patil',
  secondaryText: '+91 98765 43211',
  titleAttr: 'Rahul Patil',
  isAdmin: true
};
const pSaved = DataProcessor.processParticipant(rawSavedWithNum, 2);
assert.strictEqual(pSaved.name, 'Rahul Patil');
assert.strictEqual(pSaved.mobileNumber, '+919876543211');
assert.strictEqual(pSaved.contactStatus, 'Saved');
assert.strictEqual(pSaved.extractionStatus, 'Extracted (Direct)');

// Saved contact without visible number initially
const rawSavedNoNum = {
  primaryText: 'Priya Sharma',
  secondaryText: 'Hey there! I am using WhatsApp.',
  titleAttr: 'Priya Sharma',
  isAdmin: false
};
const pSavedNoNum = DataProcessor.processParticipant(rawSavedNoNum, 3);
assert.strictEqual(pSavedNoNum.name, 'Priya Sharma');
assert.strictEqual(pSavedNoNum.mobileNumber, 'Not Available');
assert.strictEqual(pSavedNoNum.contactStatus, 'Saved');
assert.strictEqual(pSavedNoNum.extractionStatus, 'Unavailable (Hidden)');

// Saved contact after profile inspection
const pProfileInspected = {
  ...pSavedNoNum,
  mobileNumber: '+919876543299',
  extractionStatus: 'Extracted (Profile)'
};

logger.success('Participant processing and extraction status passed.');

logger.step(3, 'Testing Deduplication with Profile Inspected Contacts');

const rawList = [
  rawUnsaved,
  rawUnsaved, // Duplicate unsaved
  rawSavedWithNum,
  pProfileInspected,
  { primaryText: '+91 98765 43210', secondaryText: '~Amit P' } // Duplicate phone
];

const deduplicated = DataProcessor.processAndDeduplicate(rawList);
assert.strictEqual(deduplicated.length, 3);
assert.strictEqual(deduplicated[0].mobileNumber, '+919876543210');
assert.strictEqual(deduplicated[1].mobileNumber, '+919876543211');
assert.strictEqual(deduplicated[2].name, 'Priya Sharma');
assert.strictEqual(deduplicated[2].mobileNumber, '+919876543299');
assert.strictEqual(deduplicated[2].extractionStatus, 'Extracted (Profile)');

const stats = DataProcessor.getSummaryStats(deduplicated);
assert.strictEqual(stats.totalParticipants, 3);
assert.strictEqual(stats.numbersExtracted, 3);
assert.strictEqual(stats.profileExtracted, 1);
assert.strictEqual(stats.numbersUnavailable, 0);
assert.strictEqual(stats.savedContacts, 2);
assert.strictEqual(stats.unsavedContacts, 1);

logger.success('Deduplication and statistics calculation with profile inspection passed.');
process.exit(0);
