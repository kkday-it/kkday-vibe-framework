import { chromium, Browser, BrowserContext } from 'playwright';

export class SecretManager {
  private allowedKeys: string[];

  constructor(allowedKeys: string[]) {
    this.allowedKeys = allowedKeys;
  }

  get(key: string): string | undefined {
    if (!this.allowedKeys.includes(key)) {
      throw new Error(`Permission Denied: Workflow not authorized to access secret '${key}'. Please declare it in manifest.yaml.`);
    }
    // TODO: In production, fetch from Vault. Currently fallback to process.env
    return process.env[key];
  }
}

export class Logger {
  info(msg: string) {
    console.log(`[INFO] ${msg}`);
  }
  error(msg: string) {
    console.error(`[ERROR] ${msg}`);
  }
}

export class Notify {
  slack(msg: string) {
    // Mock implementation for slack
    console.log(`[SLACK NOTIFY] ${msg}`);
  }
}

export class Context {
  secrets: SecretManager;
  logger: Logger;
  notify: Notify;
  browser: BrowserContext | null = null;
  private _playwrightBrowser: Browser | null = null;

  constructor(allowedSecrets: string[]) {
    this.secrets = new SecretManager(allowedSecrets);
    this.logger = new Logger();
    this.notify = new Notify();
  }

  async initBrowser() {
    this._playwrightBrowser = await chromium.launch({ headless: true });
    this.browser = await this._playwrightBrowser.newContext();
  }

  async close() {
    if (this._playwrightBrowser) {
      await this._playwrightBrowser.close();
    }
  }
}
