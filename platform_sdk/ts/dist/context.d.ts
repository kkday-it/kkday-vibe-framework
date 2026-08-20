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
export declare class StorageManager {
    logger: Logger;
    basePath: string;
    constructor(logger: Logger);
    writeText(filename: string, content: string): string;
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
