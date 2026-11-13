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
    // If running in headless Linux environment (e.g. Docker, Render) without X11, force headless = true
    const noDisplay = process.platform === 'linux' && !process.env.DISPLAY;
    const isHeadlessEnv = process.env.HEADLESS === 'true' || process.env.NODE_ENV === 'production' || noDisplay;
    this.headless = noDisplay ? true : (options.headless !== undefined ? options.headless : isHeadlessEnv);
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
        '--disable-gpu',
        '--disable-extensions',
        '--disable-notifications',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-sync',
        '--mute-audio'
      ]
    });

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
    this.isRunning = true;

    // Block non-essential heavy resources (media, fonts) to conserve memory inside constrained 512MB cloud environments
    await this.page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['media', 'font'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

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

    // Proactively wait up to 15 seconds for either QR canvas or authenticated chat pane
    try {
      await Promise.race([
        this.page.waitForSelector('canvas, [data-ref], [data-testid="qrcode"]', { timeout: 15000 }),
        this.page.waitForSelector('#pane-side, [data-testid="chat-list"]', { timeout: 15000 })
      ]);
    } catch (e) {
      // Timeout is harmless; background polling will continue
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
      const authInfo = await this.page.evaluate(() => {
        // A. Check localStorage for multi-device authenticated credentials
        const hasWid = Boolean(
          window.localStorage.getItem('last-wid') ||
          window.localStorage.getItem('last-wid-md') ||
          window.localStorage.getItem('WASecretBundle')
        );

        // B. Check DOM for authenticated elements
        const sidePane = document.querySelector('#pane-side');
        const chatList = document.querySelector('[data-testid="chat-list"]');
        const searchInput = document.querySelector('div[contenteditable="true"]');
        const mainHeader = document.querySelector('header');
        const introTitle = document.querySelector('[data-testid="intro-title"]');
        const hasAuthDOM = Boolean(sidePane || chatList || searchInput || mainHeader || introTitle);

        // C. Check if QR code canvas is actively visible on the screen
        const qrCanvas = document.querySelector('canvas[aria-label*="QR"], canvas[aria-label*="device"], canvas');
        const isCanvasVisible = qrCanvas && qrCanvas.offsetWidth > 50 && qrCanvas.offsetHeight > 50 && window.getComputedStyle(qrCanvas).display !== 'none';
        const hasQrContainer = Boolean(
          document.querySelector('div[data-testid="qrcode"]') ||
          document.querySelector('[data-ref]')
        );

        // D. Check for loading / syncing progress
        const hasProgress = Boolean(
          document.querySelector('progress') ||
          document.querySelector('[data-testid="startup-progress"]')
        );

        return {
          isAuthenticated: hasWid || hasAuthDOM,
          isQrVisible: (isCanvasVisible || hasQrContainer) && !hasWid,
          isLoading: hasProgress
        };
      });

      if (authInfo.isAuthenticated) {
        return { status: 'authenticated', details: 'Ready. Logged in to WhatsApp Web.' };
      }

      if (authInfo.isQrVisible) {
        return { status: 'qr_required', details: 'QR code displayed. Please scan with WhatsApp on your phone.' };
      }

      if (authInfo.isLoading) {
        return { status: 'loading', details: 'WhatsApp Web is syncing chats from your phone...' };
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
      // Auto-click reload button if the QR code expired
      const reloadBtn = await this.page.$('[data-testid="qrcode"] button, [data-testid="qrcode"] [role="button"], span[data-icon="refresh"]');
      if (reloadBtn) {
        await reloadBtn.click().catch(() => {});
        await this.page.waitForTimeout(1000);
      }

      const qrEl = await this.page.$('canvas[aria-label*="QR"], canvas[aria-label*="device"], canvas, [data-testid="qrcode"]');
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

