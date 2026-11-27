import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MaintenanceConfig } from '../lib/config'

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'om-maint-'))
}

export function makeConfig(stateDir: string, overrides: Partial<MaintenanceConfig> = {}): MaintenanceConfig {
  return {
    storeKind: 'file',
    stateDir,
    pollMs: 1,
    heartbeatMs: 50,
    force: false,
    expectedProcesses: null,
    timezone: 'UTC',
    logoUrl: null,
    supportUrl: null,
    templatePath: null,
    host: os.hostname(),
    ...overrides,
  }
}
