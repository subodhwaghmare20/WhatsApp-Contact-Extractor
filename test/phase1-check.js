/**
 * Phase 1 Verification Test
 * Checks that all required dependencies can be loaded properly.
 */

const logger = require('../src/utils/logger');

try {
  logger.step(1, 'Testing Dependency Resolution');

  const playwright = require('playwright');
  logger.success('Playwright imported successfully.');

  const exceljs = require('exceljs');
  logger.success('ExcelJS imported successfully.');

  const express = require('express');
  logger.success('Express imported successfully.');

  logger.info('Node version: ' + process.version);
  logger.success('All Phase 1 dependencies are installed and accessible.');
  process.exit(0);
} catch (err) {
  logger.error('Phase 1 dependency check failed:', err.message);
  process.exit(1);
}

