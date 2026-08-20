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

/**
 * ctx.storage — 產出檔案儲存 adapter(Spec §2.4 / §2.8),用 env 切換實作。
 *
 * STORAGE_PROVIDER=local(預設,開發用)| s3(雲上)。
 * - local:寫 /tmp(暫存;重啟即失、多 pod 不共享)—— 僅供本機開發,不可當持久儲存。
 * - s3:走 AWS SDK 預設憑證鏈(pod 綁 IAM role),程式內零 key;只需 S3_BUCKET(+ 選用 AWS_REGION / S3_PREFIX)。
 *   需安裝選用相依 @aws-sdk/client-s3。
 */
export class StorageManager {
  logger: Logger;
  provider: string;
  basePath: string = '';
  bucket: string = '';
  region?: string;
  prefix: string = '';

  constructor(logger: Logger) {
    this.logger = logger;
    this.provider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase();
    if (this.provider === 's3') {
      if (!process.env.S3_BUCKET) {
        throw new Error('[storage] STORAGE_PROVIDER=s3 需要 S3_BUCKET env(fail fast, Spec §2.2)');
      }
      this.bucket = process.env.S3_BUCKET;
      this.region = process.env.AWS_REGION;
      this.prefix = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '');
    } else {
      this.basePath = process.env.VIBE_STORAGE_PATH || '/tmp/vibe_storage';
      if (!fs.existsSync(this.basePath)) {
        fs.mkdirSync(this.basePath, { recursive: true });
      }
    }
  }

  private key(filename: string): string {
    return this.prefix ? `${this.prefix}/${filename}` : filename;
  }

  private async s3Client(): Promise<any> {
    // 預設憑證鏈(Spec §2.4);不讀 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
    // 用變數 specifier 讓 tsc 不做靜態解析(選用相依,未安裝時才在 runtime 報錯)
    const spec = '@aws-sdk/client-s3';
    const mod: any = await import(spec).catch(() => {
      throw new Error('[storage] 需要選用相依 @aws-sdk/client-s3(npm i @aws-sdk/client-s3)');
    });
    return { mod, client: new mod.S3Client(this.region ? { region: this.region } : {}) };
  }

  /** 上傳產出並回傳可存取位置(s3://... 或本機路徑)。 */
  async put(filename: string, content: string | Buffer, contentType?: string): Promise<string> {
    const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    if (this.provider === 's3') {
      const key = this.key(filename);
      const { mod, client } = await this.s3Client();
      await client.send(new mod.PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      }));
      const uri = `s3://${this.bucket}/${key}`;
      this.logger.info(`📝 [STORAGE:s3] 已上傳: ${uri}`);
      return uri;
    }
    const filePath = path.join(this.basePath, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body);
    this.logger.info(`📝 [STORAGE:local] 寫入 ${filePath}(暫存,勿當持久儲存;雲上請設 STORAGE_PROVIDER=s3)`);
    return filePath;
  }

  /** 相容舊介面 → 等同 put(text)。 */
  async writeText(filename: string, content: string): Promise<string> {
    return this.put(filename, content, 'text/plain; charset=utf-8');
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
