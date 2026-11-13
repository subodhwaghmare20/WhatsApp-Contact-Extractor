/**
 * Express Server for WhatsApp Contact Extractor
 * Orchestrates browser automation, participant extraction, and Excel generation.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const WhatsAppBrowser = require('./browser/whatsappBrowser');
const ParticipantExtractor = require('./extractor/participantExtractor');
const ExcelService = require('./services/excelService');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'ui')));

// Global state - Determine headless mode (headless in Linux/Docker/Cloud, or when HEADLESS=true / NODE_ENV=production)
const isHeadless = process.env.HEADLESS === 'true' || process.env.NODE_ENV === 'production' || (process.platform === 'linux' && !process.env.DISPLAY);

const browserController = new WhatsAppBrowser({
  headless: isHeadless,
  sessionPath: path.resolve(__dirname, '../whatsapp-session')
});

let sseClients = [];
let lastExtractedData = null;

// SSE Progress Event Dispatcher
function broadcastProgress(data) {
  sseClients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// 1. Connection Status API
app.get('/api/status', async (req, res) => {
  try {
    const statusInfo = await browserController.getStatus();
    res.json(statusInfo);
  } catch (err) {
    res.status(500).json({ status: 'disconnected', error: err.message });
  }
});

// 1b. Remote QR Code API (Enables cloud / VPS QR scanning directly from dashboard)
app.get('/api/qr', async (req, res) => {
  try {
    const qrImage = await browserController.getQrCodeDataUrl();
    res.json({ qr: qrImage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1c. Available Groups API (For remote cloud selection without desktop UI)
app.get('/api/groups', async (req, res) => {
  try {
    const page = browserController.page;
    if (!page || page.isClosed()) {
      return res.json({ groups: [] });
    }

    const groups = await page.evaluate(async () => {
      function getAllFromStore(dbName, storeName) {
        return new Promise((resolve) => {
          if (!window.indexedDB) return resolve([]);
          const req = window.indexedDB.open(dbName);
          req.onsuccess = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
              db.close();
              return resolve([]);
            }
            try {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const getAllReq = store.getAll();
              getAllReq.onsuccess = () => {
                const res = getAllReq.result;
                db.close();
                resolve(res || []);
              };
              getAllReq.onerror = () => { db.close(); resolve([]); };
            } catch (err) { db.close(); resolve([]); }
          };
          req.onerror = () => resolve([]);
        });
      }

      const allGroups = await getAllFromStore('model-storage', 'group-metadata');
      return allGroups
        .filter(g => Boolean(g.subject))
        .map(g => ({ id: g.id, subject: g.subject }))
        .sort((a, b) => a.subject.localeCompare(b.subject));
    });

    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Launch Browser API
app.post('/api/browser/start', async (req, res) => {
  try {
    await browserController.openWhatsApp();
    const statusInfo = await browserController.getStatus();
    res.json({ success: true, ...statusInfo });
  } catch (err) {
    logger.error('Failed to launch browser:', err.message);
    res.status(500).json({ error: `Failed to launch WhatsApp browser: ${err.message}` });
  }
});

// 3. Close Browser API
app.post('/api/browser/close', async (req, res) => {
  try {
    await browserController.close();
    res.json({ success: true, message: 'Browser session closed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. SSE Progress Stream
app.get('/api/extract/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// 5. Start Extraction API
app.post('/api/extract', async (req, res) => {
  try {
    let statusInfo = await browserController.getStatus();
    if (statusInfo.status === 'loading') {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        statusInfo = await browserController.getStatus();
        if (statusInfo.status === 'authenticated') break;
      }
    }

    if (statusInfo.status !== 'authenticated') {
      return res.status(400).json({
        error: statusInfo.status === 'qr_required'
          ? 'WhatsApp Web is not authenticated. Please scan the QR code first.'
          : 'WhatsApp Web is not ready or still syncing. Please wait a moment and try again.'
      });
    }

    const page = browserController.page;
    if (!page || page.isClosed()) {
      return res.status(400).json({ error: 'Browser tab is not available.' });
    }

    const extractor = new ParticipantExtractor(page);
    logger.info('Starting participant extraction process...');

    const result = await extractor.extract((progress) => {
      broadcastProgress({
        type: 'progress',
        ...progress
      });
    }, req.body || {});

    lastExtractedData = result;
    res.json(result);
  } catch (err) {
    logger.error('Extraction error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6. Export to Excel API
app.post('/api/export', async (req, res) => {
  try {
    const participants = req.body.participants || lastExtractedData?.participants;
    const groupName = req.body.groupName || lastExtractedData?.groupTitle || 'Export';

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ error: 'No participants available to export.' });
    }

    const exportResult = await ExcelService.generateWorkbook(participants, { groupName });
    res.json({
      success: true,
      fileName: exportResult.fileName,
      filePath: exportResult.filePath,
      stats: exportResult.stats
    });
  } catch (err) {
    logger.error('Excel export error:', err.message);
    res.status(500).json({ error: `Excel export failed: ${err.message}` });
  }
});

// 7. Download Excel File
app.get('/api/download/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const safeFileName = path.basename(fileName);
  const filePath = path.resolve(__dirname, '../exports', safeFileName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  fs.createReadStream(filePath).pipe(res);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');
  await browserController.close();
  process.exit(0);
});

if (require.main === module) {
  app.listen(PORT, () => {
    logger.step('SERVER', `WhatsApp Extractor Dashboard running on http://localhost:${PORT}`);
  });
}

module.exports = { app, browserController };

