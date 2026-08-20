"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Context = exports.Notify = exports.Logger = exports.SecretManager = void 0;
const playwright_1 = require("playwright");
class SecretManager {
    allowedKeys;
    constructor(allowedKeys) {
        this.allowedKeys = allowedKeys;
    }
    get(key) {
        if (!this.allowedKeys.includes(key)) {
            throw new Error(`Permission Denied: Workflow not authorized to access secret '${key}'. Please declare it in manifest.yaml.`);
        }
        // TODO: In production, fetch from Vault. Currently fallback to process.env
        return process.env[key];
    }
}
exports.SecretManager = SecretManager;
class Logger {
    info(msg) {
        console.log(`[INFO] ${msg}`);
    }
    error(msg) {
        console.error(`[ERROR] ${msg}`);
    }
}
exports.Logger = Logger;
class Notify {
    slack(msg) {
        // Mock implementation for slack
        console.log(`[SLACK NOTIFY] ${msg}`);
    }
}
exports.Notify = Notify;
class Context {
    secrets;
    logger;
    notify;
    browser = null;
    _playwrightBrowser = null;
    constructor(allowedSecrets) {
        this.secrets = new SecretManager(allowedSecrets);
        this.logger = new Logger();
        this.notify = new Notify();
    }
    async initBrowser() {
        this._playwrightBrowser = await playwright_1.chromium.launch({ headless: true });
        this.browser = await this._playwrightBrowser.newContext();
    }
    async close() {
        if (this._playwrightBrowser) {
            await this._playwrightBrowser.close();
        }
    }
}
exports.Context = Context;
