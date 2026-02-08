/**
 * CLI binary entry point for @open-mercato/cli package.
 *
 * Called from within a Next.js app directory as: yarn mercato <command>
 * Uses dynamic app resolution to find generated files at .mercato/generated/
 */
import { run } from './mercato.js'

// Commands that can run without bootstrap (without generated files)
// - generate: creates the generated files
// - db: uses resolver directly to find modules and migrations
// - init: runs yarn commands to set up the app
// - help: just shows help text
const BOOTSTRAP_FREE_COMMANDS = ['generate', 'db', 'init', 'eject', 'help', '--help', '-h']

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
  const requiresBootstrap = needsBootstrap(process.argv)

  if (requiresBootstrap) {
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

  const code = await run(process.argv)
  process.exit(code ?? 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
