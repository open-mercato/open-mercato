import { modules } from '@/generated/modules.generated'
import { createRequestContainer } from '@/lib/di/container'

export async function run(argv = process.argv) {
  const [, , modName, cmdName, ...rest] = argv
  // Load optional app-level CLI commands
  let appCli: any[] = []
  try {
    const app = await import('@/cli') as any
    if (Array.isArray(app?.default)) appCli = app.default
  } catch {}
  const all = modules.slice()
  // Built-in CLI module: events
  all.push({
    id: 'events',
    cli: [
      {
        command: 'process',
        run: async (args: string[]) => {
          const limitArg = args.find((a) => a.startsWith('--limit='))
          const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined
          const container = await createRequestContainer()
          const bus = container.resolve<any>('eventBus')
          const res = await bus.processOffline({ limit })
          console.log(`Processed ${res.processed} events${res.lastId ? `, lastId=${res.lastId}` : ''}`)
        },
      },
      {
        command: 'clear',
        run: async () => {
          const container = await createRequestContainer()
          const bus = container.resolve<any>('eventBus')
          const res = await bus.clearQueue()
          console.log(`Cleared queue, removed ${res.removed} events`)
        },
      },
      {
        command: 'clear-processed',
        run: async () => {
          const container = await createRequestContainer()
          const bus = container.resolve<any>('eventBus')
          const res = await bus.clearProcessed()
          console.log(`Cleared processed events, removed ${res.removed}${res.lastId ? ` up to id=${res.lastId}` : ''}`)
        },
      },
      {
        command: 'emit',
        run: async (args: string[]) => {
          const eventName = args[0]
          if (!eventName) {
            console.error('Usage: mercato events emit <event> [jsonPayload] [--persistent|-p]')
            return
          }
          const persistent = args.includes('--persistent') || args.includes('-p')
          const payloadArg = args[1] && !args[1].startsWith('--') ? args[1] : undefined
          let payload: any = {}
          if (payloadArg) {
            try { payload = JSON.parse(payloadArg) } catch { payload = payloadArg }
          }
          const container = await createRequestContainer()
          const bus = container.resolve<any>('eventBus')
          await bus.emitEvent(eventName, payload, { persistent })
          console.log(`Emitted "${eventName}"${persistent ? ' (persistent)' : ''}`)
        },
      },
    ],
  } as any)
  if (appCli.length) all.push({ id: 'app', cli: appCli } as any)

  const banner = '🧩 Open Mercato CLI'
  const header = [
    '╔═══════════════════════╗',
    `║  ${banner.padEnd(21)}║`,
    '╚═══════════════════════╝',
  ].join('\n')
  console.log(header)
  const pad = (s: string) => `  ${s}`

  if (!modName) {
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
