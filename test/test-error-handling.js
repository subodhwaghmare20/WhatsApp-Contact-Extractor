/**
 * Test Error Handling Mechanisms
 */

const assert = require('assert');
const { app, browserController } = require('../src/server');
const ExcelService = require('../src/services/excelService');
const logger = require('../src/utils/logger');

async function testErrorHandling() {
  logger.step(1, 'Testing Browser Disconnected State');
  const status = await browserController.getStatus();
  assert.strictEqual(status.status, 'disconnected', 'Status should be disconnected before browser launch');
  logger.success('Status check correctly identified disconnected state.');

  logger.step(2, 'Testing Export Error on Empty Dataset');
  try {
    await ExcelService.generateWorkbook([], { groupName: 'EmptyGroup' });
    logger.success('Handled empty participants list safely.');
  } catch (err) {
    logger.error('Unexpected error on empty dataset:', err.message);
    process.exit(1);
  }

  logger.step(3, 'Testing DataProcessor with Malformed Inputs');
  const malformed = [
    null,
    undefined,
    {},
    { primaryText: '' },
    { primaryText: '    ' }
  ];
  const cleaned = require('../src/services/dataProcessor').processAndDeduplicate(malformed);
  assert.strictEqual(cleaned.length, 0, 'Malformed entries should be filtered or sanitized gracefully');
  logger.success('Malformed data gracefully handled.');

  logger.success('All error handling tests passed.');
  process.exit(0);
}

testErrorHandling().catch(err => {
  logger.error('Error handling test failed:', err);
  process.exit(1);
});

