"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Context = exports.StorageManager = exports.Notify = exports.Logger = exports.SecretManager = void 0;
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class Notify {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    async slack(msg) {
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
                }
                else {
                    this.logger.error(`❌ [SLACK NOTIFY FAILED] HTTP ${response.status}`);
                }
            }
            catch (e) {
                this.logger.error(`❌ [SLACK NOTIFY FAILED] ${e.message}`);
            }
        }
        else {
            this.logger.info(`🔔 [SLACK NOTIFY MOCKED] ${msg}`);
        }
    }
}
exports.Notify = Notify;
class StorageManager {
    logger;
    basePath;
    constructor(logger) {
        this.logger = logger;
        this.basePath = process.env.VIBE_STORAGE_PATH || '/tmp/vibe_storage';
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }
    }
    writeText(filename, content) {
        const filePath = path.join(this.basePath, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        this.logger.info(`📝 [STORAGE] 檔案已寫入: ${filePath}`);
        return filePath;
    }
}
exports.StorageManager = StorageManager;
class Context {
    secrets;
    logger;
    notify;
    storage;
    browser = null;
    _playwrightBrowser = null;
    constructor(allowedSecrets) {
        this.secrets = new SecretManager(allowedSecrets);
        this.logger = new Logger();
        this.notify = new Notify(this.logger);
        this.storage = new StorageManager(this.logger);
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
