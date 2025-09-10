#!/usr/bin/env tsx
import { modules } from '@/modules/registry'

async function main() {
  const [, , modName, cmdName, ...rest] = process.argv
  if (!modName) {
    console.log('Usage: erp <module> <command> [args]')
    const list = modules
      .filter((m) => m.cli && m.cli.length)
      .map((m) => `${m.id}: ${m.cli!.map((c) => c.command).join(', ')}`)
    console.log(list.length ? list.join('\n') : '(no CLI available)')
    process.exit(1)
  }
  const mod = modules.find((m) => m.id === modName)
  if (!mod) {
    console.error(`Module '${modName}' not found`)
    process.exit(1)
  }
  if (!mod.cli || mod.cli.length === 0) {
    console.error(`Module '${modName}' has no CLI commands`)
    process.exit(1)
  }
  if (!cmdName) {
    console.log(`Commands for '${modName}': ${mod.cli.map((c) => c.command).join(', ')}`)
    process.exit(1)
  }
  const cmd = mod.cli.find((c) => c.command === cmdName)
  if (!cmd) {
    console.error(`Unknown command '${cmdName}'. Available: ${mod.cli.map((c) => c.command).join(', ')}`)
    process.exit(1)
  }
  await cmd.run(rest)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
