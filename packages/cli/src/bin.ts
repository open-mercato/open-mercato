/**
 * CLI binary entry point for @open-mercato/cli package.
 *
 * Called from within a Next.js app directory as: yarn mercato <command>
 * Uses dynamic app resolution to find generated files at .mercato/generated/
 */
import { initTelemetry, shutdownTelemetry } from '@open-mercato/telemetry'
// `run` is imported dynamically inside `main()` so telemetry can initialize
// before the mercato entry (and its Postgres driver) loads — see main().

// Commands that can run without bootstrap (without generated files)
// - generate: creates the generated files
// - db: uses resolver directly to find modules and migrations
// - init: runs yarn commands to set up the app
// - help: just shows help text
const BOOTSTRAP_FREE_COMMANDS = [
  'generate',
  'module',
  'deploy',
  'db',
  'init',
  'agentic:init',
  'telemetry',
  'eject',
  'test',
  'test:integration',
  'test:integration:coverage',
  'test:integration:spec-coverage',
  'test:ephemeral',
  'test:integration:interactive',
  'umes:list',
  'umes:inspect',
  'umes:check',
  'help',
  '--help',
  '-h',
]

function assertNode24Runtime(): void {
  const detectedNodeVersion = process.versions.node
  const majorVersion = Number.parseInt(detectedNodeVersion.split('.')[0] ?? '0', 10)
  if (majorVersion >= 24) {
    return
  }
  throw new Error(
    [
      'Unsupported Node.js runtime.',
      `Cause: Detected Node ${detectedNodeVersion}, but Open Mercato requires Node 24.x.`,
      'What to do: switch your shell to Node 24 (for example `nvm use 24`), run `yarn install`, then retry.',
    ].join(' '),
  )
}

function needsBootstrap(argv: string[]): boolean {
  const [, , first] = argv
  if (!first) return false // help screen
  return !BOOTSTRAP_FREE_COMMANDS.includes(first)
}

async function tryBootstrap(): Promise<boolean> {
  try {
    const { bootstrapFromAppRoot } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    const { registerCliModules } = await import('./mercato.js')
    // Use the CLI resolver to find the app directory (handles monorepo detection)
    const { createResolver } = await import('./lib/resolver.js')
    const resolver = createResolver()
    const appDir = resolver.getAppDir()
    const data = await bootstrapFromAppRoot(appDir)
    // Register CLI modules directly to avoid module resolution issues
    registerCliModules(data.modules)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Check if the error is about missing generated files
    if (
      message.includes('Cannot find module') &&
      (message.includes('/generated/') || message.includes('.generated') || message.includes('.mercato'))
    ) {
      return false
    }
    // Re-throw other errors
    throw err
  }
}

async function main(): Promise<void> {
  assertNode24Runtime()
  const requiresBootstrap = needsBootstrap(process.argv)

  if (requiresBootstrap) {
    // Load the app's `.env` BEFORE initTelemetry(): `run()` only dotenv-loads it
    // later (ensureEnvLoaded), which is too late — TELEMETRY_BACKEND set only in
    // `.env` would silently resolve to `noop` for worker/scheduler processes.
    // The loader touches only the resolver + dotenv (no `pg`), preserving the
    // instrumentation load-order guarantee below.
    const { loadAppEnv } = await import('./lib/load-env.js')
    await loadAppEnv()

    // Initialize telemetry BEFORE bootstrapping the app graph. Bootstrap and the
    // per-command handlers load MikroORM's Postgres driver → `pg`, and the
    // OpenTelemetry pg/undici auto-instrumentation only records spans for a
    // driver required AFTER the SDK has started. Registering here — ahead of any
    // app module — is what lets long-running worker/scheduler processes emit DB
    // spans (not just the bullmq-otel add/process envelope). No-op when telemetry
    // is disabled, so zero cost by default.
    await initTelemetry()

    const bootstrapSucceeded = await tryBootstrap()
    if (!bootstrapSucceeded) {
      console.error('╔═══════════════════════════════════════════════════════════════════╗')
      console.error('║  Generated files not found!                                       ║')
      console.error('║                                                                   ║')
      console.error('║  The CLI requires generated files to discover modules.           ║')
      console.error('║  Please run the following command first:                         ║')
      console.error('║                                                                   ║')
      console.error('║    yarn mercato generate                                         ║')
      console.error('║                                                                   ║')
      console.error('╚═══════════════════════════════════════════════════════════════════╝')
      process.exit(1)
    }
  }

  // Dynamic import (not a top-level static import) so the mercato entry — and the
  // Postgres driver it pulls in — loads only after initTelemetry() above.
  const { run } = await import('./mercato.js')
  const code = await run(process.argv)
  // Flush spans/logs for commands that return (workers block forever and flush via
  // their own shutdown handler instead).
  await shutdownTelemetry()
  process.exit(code ?? 0)
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(error)
  }
  process.exit(1)
})
