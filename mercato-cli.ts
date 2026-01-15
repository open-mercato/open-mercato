#!/usr/bin/env tsx
/**
 * CLI entry point at root level to ensure correct tsconfig resolution.
 *
 * IMPORTANT: The `generate` and `init` commands MUST work without generated files.
 * Other commands require bootstrap (which imports generated files).
 */
import { run } from './packages/cli/src/mercato'

// Commands that can run without bootstrap (without generated files)
// - generate: creates the generated files
// - db: uses resolver directly to find modules and migrations
// - init: runs yarn commands to set up the app
// - help: just shows help text
const BOOTSTRAP_FREE_COMMANDS = ['generate', 'db', 'init', 'help', '--help', '-h']

function needsBootstrap(argv: string[]): boolean {
  const [, , first] = argv
  if (!first) return false // help screen
  return !BOOTSTRAP_FREE_COMMANDS.includes(first)
}

async function tryBootstrap(): Promise<boolean> {
  try {
    const { bootstrap } = await import('./src/bootstrap')
    bootstrap()
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Check if the error is about missing generated files
    if (
      message.includes('Cannot find module') &&
      (message.includes('/generated/') || message.includes('.generated'))
    ) {
      return false
    }
    // Re-throw other errors
    throw err
  }
}

async function main() {
  const requiresBootstrap = needsBootstrap(process.argv)

  if (requiresBootstrap) {
    const bootstrapSucceeded = await tryBootstrap()
    if (!bootstrapSucceeded) {
      console.error('╔═══════════════════════════════════════════════════════════════════╗')
      console.error('║  ❌ Generated files not found!                                     ║')
      console.error('║                                                                   ║')
      console.error('║  The CLI requires generated files to discover modules.            ║')
      console.error('║  Please run the following command first:                          ║')
      console.error('║                                                                   ║')
      console.error('║    yarn modules:prepare                                           ║')
      console.error('║                                                                   ║')
      console.error('║  Or if using mercato CLI directly:                                ║')
      console.error('║                                                                   ║')
      console.error('║    mercato generate                                               ║')
      console.error('║                                                                   ║')
      console.error('╚═══════════════════════════════════════════════════════════════════╝')
      process.exit(1)
    }
  }

  const code = await run(process.argv)
  process.exit(code || 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
