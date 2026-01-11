#!/usr/bin/env tsx
/**
 * CLI entry point at root level to ensure correct tsconfig resolution.
 */
import { bootstrap } from './src/bootstrap'
import { run } from './packages/cli/src/mercato'

// Bootstrap all package registrations before running CLI
bootstrap()

async function main() {
  const code = await run(process.argv)
  process.exit(code || 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
