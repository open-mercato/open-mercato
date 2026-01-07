#!/usr/bin/env tsx
/**
 * CLI entry point at root level to ensure correct tsconfig resolution.
 */
import { run } from './apps/cli/src/mercato'

async function main() {
  const code = await run(process.argv)
  process.exit(code || 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
