import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Context } from './context';

export async function runWorkflow(workflowName: string, inputs: any = {}): Promise<any> {
  const workflowDir = path.join(process.cwd(), 'workflows', workflowName);
  
  if (!fs.existsSync(workflowDir)) {
    throw new Error(`Workflow ${workflowName} does not exist at ${workflowDir}`);
  }

  const manifestPath = path.join(workflowDir, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.yaml not found for workflow ${workflowName}`);
  }

  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = yaml.load(manifestContent) as any;

  const credentials = manifest?.permissions?.credentials || [];
  const ctx = new Context(credentials);

  try {
    const flowModulePath = path.join(workflowDir, 'flow');
    // Using dynamic import
    const flowModule = await import(flowModulePath);
    
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

  } catch (error: any) {
    ctx.logger.error(`Workflow ${workflowName} failed: ${error.message}`);
    throw error;
  } finally {
    await ctx.close();
  }
}
