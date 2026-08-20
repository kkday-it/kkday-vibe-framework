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

import * as fs from 'fs';
import * as path from 'path';

export class Notify {
  logger: Logger;
  constructor(logger: Logger) {
    this.logger = logger;
  }
  
  async slack(msg: string) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg })
        });
        if (response.ok) {
          this.logger.info(`🔔 [SLACK NOTIFY SENT] ${msg}`);
        } else {
          this.logger.error(`❌ [SLACK NOTIFY FAILED] HTTP ${response.status}`);
        }
      } catch (e: any) {
        this.logger.error(`❌ [SLACK NOTIFY FAILED] ${e.message}`);
      }
    } else {
      this.logger.info(`🔔 [SLACK NOTIFY MOCKED] ${msg}`);
    }
  }
}

export class StorageManager {
  logger: Logger;
  basePath: string;

  constructor(logger: Logger) {
    this.logger = logger;
    this.basePath = process.env.VIBE_STORAGE_PATH || '/tmp/vibe_storage';
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  writeText(filename: string, content: string): string {
    const filePath = path.join(this.basePath, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    this.logger.info(`📝 [STORAGE] 檔案已寫入: ${filePath}`);
    return filePath;
  }
}

export class Context {
  secrets: SecretManager;
  logger: Logger;
  notify: Notify;
  storage: StorageManager;
  browser: BrowserContext | null = null;
  private _playwrightBrowser: Browser | null = null;

  constructor(allowedSecrets: string[]) {
    this.secrets = new SecretManager(allowedSecrets);
    this.logger = new Logger();
    this.notify = new Notify(this.logger);
    this.storage = new StorageManager(this.logger);
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
