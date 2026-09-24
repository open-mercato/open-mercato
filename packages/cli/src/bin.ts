/**
 * CLI binary entry point for @open-mercato/cli package.
 *
 * Called from within a Next.js app directory as: yarn mercato <command>
 * Uses dynamic app resolution to find generated files at .mercato/generated/
 */
import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'
import { resolveCliBootstrapMode, type CliBootstrapMode } from './lib/cli-bootstrap-mode.js'
import { flushTelemetry } from './lib/flush-telemetry.js'
// `run` is imported dynamically inside `main()` so telemetry can initialize
// before the mercato entry (and its Postgres driver) loads — see main().

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

async function tryBootstrap(mode: Exclude<CliBootstrapMode, 'none'>): Promise<boolean> {
  try {
    // Use the CLI resolver to find the app directory (handles monorepo detection)
    const { createResolver } = await import('./lib/resolver.js')
    const resolver = createResolver()
    const appDir = resolver.getAppDir()

    if (mode === 'dev-supervisor') {
      const {
        canUseLightweightDevSupervisor,
        loadDevSupervisorManifest,
        registerDevSupervisorManifest,
      } = await import(
        './lib/dev-supervisor-manifest.js'
      )
      const manifest = loadDevSupervisorManifest(appDir)
      if (canUseLightweightDevSupervisor(manifest)) {
        registerDevSupervisorManifest(manifest)
        return true
      }
    }

    const { bootstrapFromAppRoot } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    const { registerCliModules } = await import('./mercato.js')
    const data = await bootstrapFromAppRoot(appDir)
    // Register CLI modules directly to avoid module resolution issues
    registerCliModules(data.modules)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Check if the error is about missing generated files
    if (
      message.includes('dev-supervisor.generated.json') ||
      (
        message.includes('Cannot find module') &&
        (message.includes('/generated/') || message.includes('.generated') || message.includes('.mercato'))
      )
    ) {
      return false
    }
    // Re-throw other errors
    throw err
  }
}

async function main(): Promise<void> {
  assertNode24Runtime()
  const bootstrapMode = resolveCliBootstrapMode(process.argv)

  if (bootstrapMode !== 'none') {
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
    // spans (not just the bullmq-otel add/process envelope). The package itself
    // is not imported unless an explicit supported backend is selected.
    if (isTelemetryBackendEnabled()) {
      const { initTelemetry } = await import('@open-mercato/telemetry')
      await initTelemetry()
    }

    const bootstrapSucceeded = await tryBootstrap(bootstrapMode)
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
  // A returning command (seed, import, reindex) ends on the explicit exit below,
  // which Node skips `beforeExit` for — the same natural-exit path the
  // broadcast-coalescer shutdown hook relies on to flush a burst's trailing
  // browser delivery. `run()` above has already bootstrapped the app (and with
  // it the event bus), so this import is not the module the early
  // bootstrap-mode guards avoid loading. Runs BEFORE flushTelemetry() so the
  // final `pg_notify` and its telemetry are both still captured. Bounded at a
  // fixed 3000ms deadline — independent of and shorter than
  // OM_BROADCAST_COALESCE_INTERVAL_MS's own window — so a stalled Postgres
  // connection at exit degrades to the already-accepted dropped-tail case
  // instead of hanging the command. flushPendingBroadcasts() never rejects
  // (it settles every entry internally), so the deadline is the only guard
  // this call needs.
  const { flushPendingBroadcasts } = await import('@open-mercato/events')
  await Promise.race([
    flushPendingBroadcasts(),
    new Promise<void>((resolve) => setTimeout(resolve, 3000).unref()),
  ])
  // Flush spans/logs for commands that return (workers block forever and flush via
  // their own shutdown handler instead).
  await flushTelemetry()
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
