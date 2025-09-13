#!/usr/bin/env node
import { run } from './mercato'

async function main() {
  const code = await run(process.argv)
  process.exit(code || 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

