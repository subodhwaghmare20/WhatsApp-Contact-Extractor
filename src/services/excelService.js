/**
 * Excel Generation Service using ExcelJS
 * Generates professional spreadsheets with borders, styling, frozen headers, and summary stats.
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const DataProcessor = require('./dataProcessor');

class ExcelService {
  /**
   * Generate formatted Excel workbook and write to disk
   * @param {Array<Object>} participants - Array of participant objects
   * @param {Object} options - { groupName, outputDir, fileName }
   * @returns {Promise<{ filePath: string, fileName: string, stats: Object }>}
   */
  static async generateWorkbook(participants, options = {}) {
    const outputDir = options.outputDir || path.resolve(__dirname, '../../exports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const today = new Date().toISOString().split('T')[0];
    const safeGroupName = (options.groupName || 'Export')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 30);
    
    const fileName = options.fileName || `WhatsApp_Group_Contacts_${safeGroupName}_${today}.xlsx`;
    const filePath = path.join(outputDir, fileName);

    const stats = DataProcessor.getSummaryStats(participants);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QSpiders Coimbatore';
    workbook.lastModifiedBy = 'QSpiders Coimbatore';
    workbook.company = 'QSpiders Coimbatore';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Group Participants', {
      views: [{ showGridLines: true }]
    });

    // 1. Title Block (Merged A1:E1)
    sheet.mergeCells('A1:E1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'WHATSAPP GROUP CONTACT EXTRACTOR REPORT';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' } // Dark Slate
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 32;

    // 2. Metadata / Summary Card
    const metaRows = [
      ['Group Name:', options.groupName || 'WhatsApp Group', 'Export Date:', today, ''],
      ['Total Participants:', stats.totalParticipants, 'Numbers Extracted:', stats.numbersExtracted, ''],
      ['Numbers Unavailable:', stats.numbersUnavailable, 'Profile Inspected:', stats.profileExtracted || 0, '']
    ];

    metaRows.forEach((rowVals, rIdx) => {
      const rowNum = 3 + rIdx;
      const row = sheet.getRow(rowNum);
      row.values = [rowVals[0], rowVals[1], rowVals[2], rowVals[3]];
      sheet.getCell(`A${rowNum}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF475569' } };
      sheet.getCell(`B${rowNum}`).font = { name: 'Calibri', size: 10, bold: false };
      sheet.getCell(`C${rowNum}`).font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF475569' } };
      sheet.getCell(`D${rowNum}`).font = { name: 'Calibri', size: 10, bold: false };
      row.height = 20;
    });

    // Blank row 6 for spacing
    sheet.getRow(6).height = 10;

    // 3. Table Headers at Row 7
    const headers = ['Sr. No.', 'Participant Name', 'Mobile Number', 'Contact Status', 'Extraction Status'];
    const headerRow = sheet.getRow(7);
    headerRow.values = headers;
    headerRow.height = 26;

    const headerFill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' } // Elegant Teal
    };

    const headerBorder = {
      top: { style: 'medium', color: { argb: 'FF0D9488' } },
      bottom: { style: 'medium', color: { argb: 'FF0D9488' } },
      left: { style: 'thin', color: { argb: 'FF94A3B8' } },
      right: { style: 'thin', color: { argb: 'FF94A3B8' } }
    };

    for (let c = 1; c <= 5; c++) {
      const cell = headerRow.getCell(c);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = headerFill;
      cell.alignment = { horizontal: c === 1 ? 'center' : 'left', vertical: 'middle' };
      cell.border = headerBorder;
    }

    // 4. Populate Participant Rows
    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };

    let startRow = 8;
    participants.forEach((p, idx) => {
      const row = sheet.getRow(startRow + idx);
      const isEven = idx % 2 === 0;

      const rowFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: isEven ? 'FFFFFFFF' : 'FFF8FAFC' } // Subtle alternate row
      };

      row.values = [
        idx + 1,
        p.name || 'Unknown',
        p.mobileNumber || 'Not Available',
        p.contactStatus || 'Unknown',
        p.extractionStatus || (p.mobileNumber !== 'Not Available' ? 'Extracted' : 'Unavailable')
      ];

      // Format Sr No
      const c1 = row.getCell(1);
      c1.alignment = { horizontal: 'center', vertical: 'middle' };
      c1.border = thinBorder;
      c1.fill = rowFill;

      // Format Name
      const c2 = row.getCell(2);
      c2.alignment = { horizontal: 'left', vertical: 'middle' };
      c2.border = thinBorder;
      c2.fill = rowFill;

      // Format Phone Number (Text format '@' to preserve leading '+' and zeros)
      const c3 = row.getCell(3);
      c3.numFmt = '@';
      c3.alignment = { horizontal: 'left', vertical: 'middle' };
      c3.border = thinBorder;
      c3.fill = rowFill;
      if (p.mobileNumber === 'Not Available') {
        c3.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
      } else {
        c3.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
      }

      // Format Contact Status
      const c4 = row.getCell(4);
      c4.alignment = { horizontal: 'center', vertical: 'middle' };
      c4.border = thinBorder;
      c4.fill = rowFill;

      if (p.contactStatus === 'Saved') {
        c4.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF15803D' } }; // Green
      } else if (p.contactStatus === 'Unsaved') {
        c4.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFB45309' } }; // Amber
      } else {
        c4.font = { name: 'Calibri', size: 10, color: { argb: 'FF64748B' } }; // Slate
      }

      // Format Extraction Status
      const c5 = row.getCell(5);
      c5.alignment = { horizontal: 'center', vertical: 'middle' };
      c5.border = thinBorder;
      c5.fill = rowFill;

      const extStatus = p.extractionStatus || '';
      if (extStatus.includes('Profile')) {
        c5.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0284C7' } }; // Blue
      } else if (extStatus.includes('Direct') || extStatus === 'Extracted') {
        c5.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF15803D' } }; // Green
      } else {
        c5.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF64748B' } }; // Muted
      }

      row.height = 22;
    });

    const endRow = Math.max(startRow + participants.length - 1, startRow);

    // 5. Freeze Header Row and Enable Filters
    sheet.views = [
      {
        state: 'frozen',
        ySplit: 7,
        activeCell: 'A8'
      }
    ];

    sheet.autoFilter = {
      from: 'A7',
      to: `E${endRow}`
    };

    // 6. Set explicit column widths with comfortable padding
    sheet.columns = [
      { key: 'srNo', width: 12 },
      { key: 'name', width: 34 },
      { key: 'mobile', width: 26 },
      { key: 'status', width: 18 },
      { key: 'extractionStatus', width: 24 }
    ];

    // Write file
    await workbook.xlsx.writeFile(filePath);
    logger.success(`Excel file generated: ${filePath}`);

    return {
      filePath,
      fileName,
      stats
    };
  }

  /**
   * Generate workbook as a Buffer
   * @param {Array<Object>} participants
   * @param {Object} options
   * @returns {Promise<Buffer>}
   */
  static async generateBuffer(participants, options = {}) {
    const res = await this.generateWorkbook(participants, options);
    return fs.readFileSync(res.filePath);
  }
}

module.exports = ExcelService;
