import fs from 'node:fs'
import path from 'node:path'

/**
 * Bootstrap-free `.env` loader for the CLI binary. `bin.ts` must load the app's
 * `.env` BEFORE `initTelemetry()` so `TELEMETRY_*` set only in `.env` resolves a
 * real backend for worker/scheduler processes — `run()`'s `ensureEnvLoaded()`
 * happens after telemetry init, which is too late. Deliberately read-only (no
 * `.env.example` copy — that UX stays in `ensureEnvLoaded`) and pulls in only the
 * resolver + dotenv, so nothing here loads `pg` and the OTEL instrumentation
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
