import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const businessAgentRuntimeCliPath = resolve(packageRoot, 'dist', 'cli.js');
export const businessAgentRuntimeHostConfigPath = resolve(packageRoot, 'harness.config.host.json');
