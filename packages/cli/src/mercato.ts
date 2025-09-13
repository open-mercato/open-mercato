import { modules } from '@/generated/modules.generated'

export async function run(argv = process.argv) {
  const [, , modName, cmdName, ...rest] = argv
  // Load optional app-level CLI commands
  let appCli: any[] = []
  try {
    const app = await import('@/cli') as any
    if (Array.isArray(app?.default)) appCli = app.default
  } catch {}
  const all = modules.slice()
  if (appCli.length) all.push({ id: 'app', cli: appCli } as any)
  if (!modName) {
    console.log('Usage: mercato <module> <command> [args]')
    const list = all
      .filter((m) => m.cli && m.cli.length)
      .map((m) => `${m.id}: ${m.cli!.map((c) => c.command).join(', ')}`)
    console.log(list.length ? list.join('\n') : '(no CLI available)')
    return 1
  }
  const mod = all.find((m) => m.id === modName)
  if (!mod) {
    console.error(`Module '${modName}' not found`)
    return 1
  }
  if (!mod.cli || mod.cli.length === 0) {
    console.error(`Module '${modName}' has no CLI commands`)
    return 1
  }
  if (!cmdName) {
    console.log(`Commands for '${modName}': ${mod.cli.map((c) => c.command).join(', ')}`)
    return 1
  }
  const cmd = mod.cli.find((c) => c.command === cmdName)
  if (!cmd) {
    console.error(`Unknown command '${cmdName}'. Available: ${mod.cli.map((c) => c.command).join(', ')}`)
    return 1
  }
  await cmd.run(rest)
  return 0
}
