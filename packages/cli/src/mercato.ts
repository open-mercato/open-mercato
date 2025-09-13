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

  const banner = '🧩 Mercato CLI'
  const pad = (s: string) => `  ${s}`

  if (!modName) {
    console.log(`${banner}\n`)
    console.log(pad('Usage: ✨ mercato <module> <command> [args]'))
    const list = all
      .filter((m) => m.cli && m.cli.length)
      .map((m) => `• ${m.id}: ${m.cli!.map((c) => `"${c.command}"`).join(', ')}`)
    if (list.length) {
      console.log('\n' + pad('Available:'))
      console.log(list.map(pad).join('\n'))
    } else {
      console.log(pad('🌀 No CLI commands available'))
    }
    return 1
  }

  const mod = all.find((m) => m.id === modName)
  if (!mod) {
    console.error(`❌ Module not found: "${modName}"`)
    return 1
  }
  if (!mod.cli || mod.cli.length === 0) {
    console.error(`🚫 Module "${modName}" has no CLI commands`)
    return 1
  }
  if (!cmdName) {
    console.log(`${banner}\n`)
    console.log(pad(`Commands for "${modName}": ${mod.cli.map((c) => c.command).join(', ')}`))
    return 1
  }
  const cmd = mod.cli.find((c) => c.command === cmdName)
  if (!cmd) {
    console.error(`🤔 Unknown command "${cmdName}". Available: ${mod.cli.map((c) => c.command).join(', ')}`)
    return 1
  }

  const started = Date.now()
  console.log(`🚀 Running ${modName}:${cmdName} ${rest.join(' ')}`)
  try {
    await cmd.run(rest)
    const ms = Date.now() - started
    console.log(`✅ Done in ${ms}ms`)
    return 0
  } catch (e: any) {
    console.error(`💥 Failed: ${e?.message || e}`)
    return 1
  }
}
