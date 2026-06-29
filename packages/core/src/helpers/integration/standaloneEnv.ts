import fs from 'fs';
import path from 'path';

const truthyValues = new Set(['1', 'true', 'yes', 'on']);
const falsyValues = new Set(['0', 'false', 'no', 'off']);

let cachedStandaloneEnv: Record<string, string> | null = null;

function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function readStandaloneEnv(): Record<string, string> {
  if (cachedStandaloneEnv) return cachedStandaloneEnv;
  const appRoot = process.env.OM_TEST_APP_ROOT?.trim();
  if (!appRoot) {
    cachedStandaloneEnv = {};
    return cachedStandaloneEnv;
  }

  const envPath = path.join(appRoot, '.env');
  try {
    cachedStandaloneEnv = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
  } catch {
    cachedStandaloneEnv = {};
  }
  return cachedStandaloneEnv;
}

export function readIntegrationEnv(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (typeof fromProcess === 'string') return fromProcess;
  return readStandaloneEnv()[name];
}

export function isStandaloneIntegration(): boolean {
  return Boolean(process.env.OM_TEST_APP_ROOT?.trim());
}

export function readIntegrationEnvFlag(name: string, defaultValue = false): boolean {
  const raw = readIntegrationEnv(name)?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (truthyValues.has(raw)) return true;
  if (falsyValues.has(raw)) return false;
  return defaultValue;
}
