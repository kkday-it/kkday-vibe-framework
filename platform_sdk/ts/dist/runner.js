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
exports.runWorkflow = runWorkflow;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const context_1 = require("./context");
async function runWorkflow(workflowName, inputs = {}) {
    const workflowDir = path.join(process.cwd(), 'workflows', workflowName);
    if (!fs.existsSync(workflowDir)) {
        throw new Error(`Workflow ${workflowName} does not exist at ${workflowDir}`);
    }
    const manifestPath = path.join(workflowDir, 'manifest.yaml');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`manifest.yaml not found for workflow ${workflowName}`);
    }
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = yaml.load(manifestContent);
    const credentials = manifest?.permissions?.credentials || [];
    const ctx = new context_1.Context(credentials);
    try {
        const flowModulePath = path.join(workflowDir, 'flow');
        // Using dynamic import
        const flowModule = await Promise.resolve(`${flowModulePath}`).then(s => __importStar(require(s)));
        if (typeof flowModule.flow !== 'function') {
            throw new Error(`Workflow ${workflowName} must export a 'flow' function.`);
        }
        if (manifest?.permissions?.needs_browser) {
            await ctx.initBrowser();
        }
        ctx.logger.info(`Starting workflow: ${workflowName}`);
        const result = await flowModule.flow(ctx, inputs);
        ctx.logger.info(`Workflow ${workflowName} completed successfully.`);
        return result;
    }
    catch (error) {
        ctx.logger.error(`Workflow ${workflowName} failed: ${error.message}`);
        throw error;
    }
    finally {
        await ctx.close();
    }
}
