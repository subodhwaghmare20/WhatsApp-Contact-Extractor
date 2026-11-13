/**
 * WhatsApp Browser Controller using Playwright
 * Manages persistent Chromium browser session for WhatsApp Web.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class WhatsAppBrowser {
  constructor(options = {}) {
    this.sessionPath = options.sessionPath || path.resolve(__dirname, '../../whatsapp-session');
    // Allow HEADLESS env override (useful for cloud/VPS hosting)
    const isHeadlessEnv = process.env.HEADLESS === 'true' || (process.platform === 'linux' && !process.env.DISPLAY);
    this.headless = options.headless !== undefined ? options.headless : isHeadlessEnv;
    this.context = null;
    this.page = null;
    this.isRunning = false;
  }

  /**
   * Launch browser with persistent context
   * @returns {Promise<Page>}
   */
  async launch() {
    if (this.isRunning && this.page && !this.page.isClosed()) {
      logger.info('Browser session is already running.');
      return this.page;
    }

    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }

    logger.info(`Launching persistent browser context from: ${this.sessionPath}`);

    this.context = await chromium.launchPersistentContext(this.sessionPath, {
      headless: this.headless,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    this.isRunning = true;

    this.page.on('close', () => {
      logger.warn('WhatsApp browser tab closed.');
      this.isRunning = false;
    });

    this.context.on('close', () => {
      logger.warn('WhatsApp browser context closed.');
      this.isRunning = false;
      this.context = null;
      this.page = null;
    });

    return this.page;
  }

  /**
   * Navigate to WhatsApp Web and wait for initial load
   */
  async openWhatsApp() {
    if (!this.page || this.page.isClosed()) {
      await this.launch();
    }

    const currentUrl = this.page.url();
    if (!currentUrl.includes('web.whatsapp.com')) {
      logger.info('Navigating to https://web.whatsapp.com/ ...');
      await this.page.goto('https://web.whatsapp.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    }

    return this.page;
  }

  /**
   * Determine connection and authentication status
   * @returns {Promise<{ status: 'authenticated'|'qr_required'|'loading'|'disconnected', details?: string }>}
   */
  async getStatus() {
    if (!this.isRunning || !this.page || this.page.isClosed()) {
      return { status: 'disconnected', details: 'Browser is not running' };
    }

    try {
      // 1. Check if authenticated chat pane exists
      // WhatsApp Web chat list container typically has #pane-side or role="grid" or search input
      const isAuthenticated = await this.page.evaluate(() => {
        const sidePane = document.querySelector('#pane-side') || 
                         document.querySelector('[data-testid="chat-list"]') ||
                         document.querySelector('div[contenteditable="true"][data-tab="3"]');
        return Boolean(sidePane);
      });

      if (isAuthenticated) {
        return { status: 'authenticated', details: 'Ready. Logged in to WhatsApp Web.' };
      }

      // 2. Check if QR code is displayed
      const hasQrCode = await this.page.evaluate(() => {
        const qrCanvas = document.querySelector('canvas[aria-label*="QR"], canvas');
        const qrContainer = document.querySelector('[data-ref]') || 
                            document.querySelector('div[data-testid="qrcode"]');
        return Boolean(qrCanvas || qrContainer);
      });

      if (hasQrCode) {
        return { status: 'qr_required', details: 'QR code displayed. Please scan with WhatsApp on your phone.' };
      }

      // 3. Check if loading/progress bar is present
      const isLoading = await this.page.evaluate(() => {
        const progress = document.querySelector('progress') || 
                         document.querySelector('[data-testid="startup-progress"]');
        return Boolean(progress);
      });

      if (isLoading) {
        return { status: 'loading', details: 'WhatsApp Web is loading/syncing messages...' };
      }

      return { status: 'loading', details: 'Waiting for WhatsApp Web interface to settle...' };
    } catch (err) {
      return { status: 'disconnected', details: err.message };
    }
  }

  /**
   * Capture the visible QR code canvas as base64 Data URL
   * Enables remote QR scanning in cloud/VPS environments
   * @returns {Promise<string|null>}
   */
  async getQrCodeDataUrl() {
    if (!this.isRunning || !this.page || this.page.isClosed()) {
      return null;
    }

    try {
      const qrEl = await this.page.$('canvas[aria-label*="QR"], canvas, [data-testid="qrcode"]');
      if (qrEl) {
        const buffer = await qrEl.screenshot();
        return `data:image/png;base64,${buffer.toString('base64')}`;
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  /**
   * Close the browser
   */
  async close() {
    if (this.context) {
      logger.info('Closing WhatsApp browser...');
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
      this.isRunning = false;
      logger.success('WhatsApp browser closed.');
    }
  }
}

module.exports = WhatsAppBrowser;

