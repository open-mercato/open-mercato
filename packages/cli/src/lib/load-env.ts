import fs from 'node:fs'
import path from 'node:path'
import { prepareEncryptionEnv } from '@open-mercato/shared/lib/encryption/prepareEnv'

export async function prepareAppEncryptionEnv(argv: readonly string[]): Promise<void> {
  const parts = argv.slice(2)
  const [command, subcommand] = parts
  if (
    !command || parts.some((part) => ['--help', '-h'].includes(part)) ||
    ['help', 'generate', 'module', 'deploy', 'telemetry', 'eject', 'agentic:init', 'test', 'umes:list', 'umes:inspect', 'umes:check'].includes(command) ||
    command.startsWith('test:') || (command === 'db' && subcommand === 'generate')
  ) return

  let appDir = process.cwd()
  try {
    const { createResolver } = await import('./resolver.js')
    appDir = createResolver().getAppDir()
  } catch {}
  const mode = command === 'server' && subcommand === 'start' ? 'production'
    : command === 'server' && subcommand === 'dev' ? 'development' : undefined
  const values = await prepareEncryptionEnv(appDir, { mode, envFileMode: 'dotenv' })
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value
  }
}

/**
 * Bootstrap-free `.env` loader for the CLI binary. `bin.ts` must load the app's
 * `.env` BEFORE `initTelemetry()` so `TELEMETRY_*` set only in `.env` resolves a
 * real backend for worker/scheduler processes — `run()`'s `ensureEnvLoaded()`
 * happens after telemetry init, which is too late. Deliberately read-only (no
 * `.env.example` copy — that UX stays in `ensureEnvLoaded`) and pulls in only the
 * bootstrap-free utilities, so nothing here loads `pg` and the OTEL instrumentation
 * load-order guarantee is preserved.
 */
export async function loadAppEnv(options: { cwd?: string } = {}): Promise<void> {
  try {
    const { createResolver } = await import('./resolver.js')
    const appDir = createResolver(options.cwd).getAppDir()
    const envPath = path.join(appDir, '.env')
    if (fs.existsSync(envPath)) {
      const dotenv = await import('dotenv')
      dotenv.config({ path: envPath, quiet: true })
      return
    }
  } catch {
    // Resolver can fail outside an app dir — fall through to plain cwd loading.
  }
  try {
    const dotenv = await import('dotenv')
    dotenv.config({ quiet: true })
  } catch {}
}
