import fs from 'node:fs'
import path from 'node:path'
import { prepareEncryptionEnv } from '@open-mercato/shared/lib/encryption/prepareEnv'

function isApplicationRoot(directory: string): boolean {
  return fs.existsSync(path.join(directory, 'package.json')) &&
    ['src/modules.ts', 'src/modules.js', 'next.config.ts', 'next.config.js', 'next.config.mjs']
      .some((marker) => fs.existsSync(path.join(directory, marker)))
}

/** @internal Resolve the active app without following installed workspace-package symlinks. */
export function resolveAppEnvDir(cwd = process.cwd()): string {
  const originalDirectory = path.resolve(cwd)
  let directory = originalDirectory
  while (true) {
    if (isApplicationRoot(directory)) return directory
    const appsDirectory = path.join(directory, 'apps')
    if (fs.existsSync(appsDirectory)) {
      const appNames = ['mercato', 'app', ...fs.readdirSync(appsDirectory).filter((name) => name !== 'docs')]
      const appDirectory = appNames.map((name) => path.join(appsDirectory, name)).find(isApplicationRoot)
      if (appDirectory) return appDirectory
    }
    if (fs.existsSync(path.join(directory, '.git'))) return originalDirectory
    const parentDirectory = path.dirname(directory)
    if (parentDirectory === directory) return originalDirectory
    directory = parentDirectory
  }
}

export async function prepareAppEncryptionEnv(argv: readonly string[]): Promise<void> {
  const parts = argv.slice(2)
  const [command, subcommand] = parts
  if (
    !command || parts.some((part) => ['--help', '-h'].includes(part)) ||
    ['help', 'generate', 'module', 'deploy', 'telemetry', 'eject', 'agentic:init', 'test', 'umes:list', 'umes:inspect', 'umes:check'].includes(command) ||
    command.startsWith('test:') || (command === 'db' && subcommand === 'generate')
  ) return

  const appDir = resolveAppEnvDir()
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
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const envPath = [path.join(resolveAppEnvDir(cwd), '.env'), path.join(cwd, '.env')]
    .find((candidate) => fs.existsSync(candidate))
  if (envPath) {
    const dotenv = await import('dotenv')
    dotenv.config({ path: envPath, quiet: true })
  }
}
