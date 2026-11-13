/**
 * Test Excel Generation and Formatting (with Extraction Status Column)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const ExcelService = require('../src/services/excelService');
const logger = require('../src/utils/logger');

async function runExcelTest() {
  logger.step(1, 'Generating Test Excel File with 5 Columns');

  const sampleParticipants = [
    {
      srNo: 1,
      name: 'Rahul Patil',
      mobileNumber: '+919876543210',
      contactStatus: 'Saved',
      extractionStatus: 'Extracted (Profile)',
      isAdmin: true
    },
    {
      srNo: 2,
      name: 'Amit Sharma',
      mobileNumber: '+919876543211',
      contactStatus: 'Unsaved',
      extractionStatus: 'Extracted (Direct)',
      isAdmin: false
    },
    {
      srNo: 3,
      name: 'Priya Verma',
      mobileNumber: 'Not Available',
      contactStatus: 'Saved',
      extractionStatus: 'Unavailable (Hidden)',
      isAdmin: false
    },
    {
      srNo: 4,
      name: 'John Doe',
      mobileNumber: '+14155552671',
      contactStatus: 'Saved',
      extractionStatus: 'Extracted (Direct)',
      isAdmin: false
    }
  ];

  const groupName = 'Developers Community';
  const result = await ExcelService.generateWorkbook(sampleParticipants, { groupName });

  logger.info(`Workbook generated at: ${result.filePath}`);
  assert.strictEqual(fs.existsSync(result.filePath), true, 'Excel file must exist on disk');

  logger.step(2, 'Verifying Excel File Structure, 5 Columns and Formatting');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.filePath);

  const sheet = workbook.getWorksheet('Group Participants');
  assert.ok(sheet, 'Worksheet "Group Participants" must exist');

  // Check Title
  const titleCell = sheet.getCell('A1');
  assert.ok(titleCell.value.includes('WHATSAPP GROUP CONTACT EXTRACTOR'));

  // Check Headers at Row 7
  const headerRow = sheet.getRow(7);
  assert.strictEqual(headerRow.getCell(1).value, 'Sr. No.');
  assert.strictEqual(headerRow.getCell(2).value, 'Participant Name');
  assert.strictEqual(headerRow.getCell(3).value, 'Mobile Number');
  assert.strictEqual(headerRow.getCell(4).value, 'Contact Status');
  assert.strictEqual(headerRow.getCell(5).value, 'Extraction Status');

  // Verify header formatting
  assert.strictEqual(headerRow.getCell(1).font.bold, true);
  assert.strictEqual(headerRow.getCell(5).font.bold, true);
  assert.strictEqual(headerRow.getCell(1).fill.type, 'pattern');

  // Verify row 8 (Saved contact with profile inspection)
  const row8 = sheet.getRow(8);
  assert.strictEqual(row8.getCell(1).value, 1);
  assert.strictEqual(row8.getCell(2).value, 'Rahul Patil');
  assert.strictEqual(row8.getCell(3).value, '+919876543210');
  assert.strictEqual(row8.getCell(3).numFmt, '@', 'Phone number cell must have text format @');
  assert.strictEqual(row8.getCell(4).value, 'Saved');
  assert.strictEqual(row8.getCell(5).value, 'Extracted (Profile)');

  // Verify row 9 (Unsaved direct contact)
  const row9 = sheet.getRow(9);
  assert.strictEqual(row9.getCell(2).value, 'Amit Sharma');
  assert.strictEqual(row9.getCell(3).value, '+919876543211');
  assert.strictEqual(row9.getCell(4).value, 'Unsaved');
  assert.strictEqual(row9.getCell(5).value, 'Extracted (Direct)');

  // Verify row 10 (hidden number)
  const row10 = sheet.getRow(10);
  assert.strictEqual(row10.getCell(2).value, 'Priya Verma');
  assert.strictEqual(row10.getCell(3).value, 'Not Available');
  assert.strictEqual(row10.getCell(4).value, 'Saved');
  assert.strictEqual(row10.getCell(5).value, 'Unavailable (Hidden)');

  // Verify view freeze
  assert.strictEqual(sheet.views[0].ySplit, 7, 'Rows above data table must be frozen');

  // Verify AutoFilter spans columns A to E
  assert.ok(sheet.autoFilter, 'AutoFilter should be defined');
  const filterStr = typeof sheet.autoFilter === 'string' ? sheet.autoFilter : `${sheet.autoFilter.from}:${sheet.autoFilter.to}`;
  assert.ok(filterStr.includes('A7') && filterStr.includes('E'), 'AutoFilter must cover columns A through E');

  logger.success('All Excel tests verified successfully with 5 columns!');
  process.exit(0);
}

runExcelTest().catch(err => {
  logger.error('Excel test failed:', err);
  process.exit(1);
});
