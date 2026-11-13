/**
 * Test WhatsApp Browser Launch and Status Detection
 */

const WhatsAppBrowser = require('../src/browser/whatsappBrowser');
const logger = require('../src/utils/logger');

async function testBrowser() {
  logger.step(1, 'Launching WhatsApp Browser');

  const browser = new WhatsAppBrowser({
    headless: true // Run headless for automated self-test
  });

  try {
    const page = await browser.launch();
    logger.success('Chromium persistent context launched successfully.');

    logger.step(2, 'Navigating to WhatsApp Web');
    await browser.openWhatsApp();
    logger.info(`Current URL: ${page.url()}`);

    // Wait a few seconds for initial DOM rendering
    await page.waitForTimeout(5000);

    logger.step(3, 'Checking WhatsApp Connection Status');
    const status = await browser.getStatus();
    logger.info(`Detected Status: ${status.status} (${status.details})`);

    await browser.close();
    logger.success('Browser closed cleanly.');
    process.exit(0);
  } catch (err) {
    logger.error('Browser test failed:', err);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

testBrowser();

