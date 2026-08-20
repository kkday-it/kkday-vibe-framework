import { BrowserContext } from 'playwright';
export declare class SecretManager {
    private allowedKeys;
    constructor(allowedKeys: string[]);
    get(key: string): string | undefined;
}
export declare class Logger {
    info(msg: string): void;
    error(msg: string): void;
}
export declare class Notify {
    logger: Logger;
    constructor(logger: Logger);
    slack(msg: string): Promise<void>;
}
/**
 * ctx.storage — 產出檔案儲存 adapter(Spec §2.4 / §2.8),用 env 切換實作。
 *
 * STORAGE_PROVIDER=local(預設,開發用)| s3(雲上)。
 * - local:寫 /tmp(暫存;重啟即失、多 pod 不共享)—— 僅供本機開發,不可當持久儲存。
 * - s3:走 AWS SDK 預設憑證鏈(pod 綁 IAM role),程式內零 key;只需 S3_BUCKET(+ 選用 AWS_REGION / S3_PREFIX)。
 *   需安裝選用相依 @aws-sdk/client-s3。
 */
export declare class StorageManager {
    logger: Logger;
    provider: string;
    basePath: string;
    bucket: string;
    region?: string;
    prefix: string;
    constructor(logger: Logger);
    private key;
    private s3Client;
    /** 上傳產出並回傳可存取位置(s3://... 或本機路徑)。 */
    put(filename: string, content: string | Buffer, contentType?: string): Promise<string>;
    /** 相容舊介面 → 等同 put(text)。 */
    writeText(filename: string, content: string): Promise<string>;
}
export declare class Context {
    secrets: SecretManager;
    logger: Logger;
    notify: Notify;
    storage: StorageManager;
    browser: BrowserContext | null;
    private _playwrightBrowser;
    constructor(allowedSecrets: string[]);
    initBrowser(): Promise<void>;
    close(): Promise<void>;
}
