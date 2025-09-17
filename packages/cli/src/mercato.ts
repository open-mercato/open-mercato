// Note: Avoid top-level imports of generated files or DI container.
// Some commands (e.g., `init`) must run before generation occurs.
// We'll lazy-load modules and DI only when required by a specific command.

export async function run(argv = process.argv) {
  const [, , modName, cmdName, ...rest] = argv
  
  // Handle init command directly
  if (modName === 'init') {
    const { execSync } = await import('child_process')
    
    console.log('🚀 Initializing Open Mercato app...\n')
    
    try {
      // Step 1: Install dependencies
      console.log('📦 Installing dependencies...')
      execSync('yarn install', { stdio: 'inherit' })
      console.log('✅ Dependencies installed\n')
      
      // Step 2: Prepare modules
      console.log('🔧 Preparing modules (registry, entities, DI)...')
      execSync('yarn modules:prepare', { stdio: 'inherit' })
      console.log('✅ Modules prepared\n')
      
      // Step 3: Generate migrations
      console.log('🗄️  Generating database migrations...')
      execSync('yarn db:generate', { stdio: 'inherit' })
      console.log('✅ Migrations generated\n')
      
      // Step 4: Apply migrations
      console.log('📊 Applying database migrations...')
      execSync('yarn db:migrate', { stdio: 'inherit' })
      console.log('✅ Migrations applied\n')
      
      // Step 5: Seed roles
      console.log('👥 Seeding default roles...')
      execSync('yarn mercato auth seed-roles', { stdio: 'inherit' })
      console.log('✅ Roles seeded\n')
      
      // Step 6: Setup admin user
      const orgName = rest.find(arg => arg.startsWith('--org='))?.split('=')[1] || 'Acme Corp'
      const email = rest.find(arg => arg.startsWith('--email='))?.split('=')[1] || 'admin@acme.com'
      const password = rest.find(arg => arg.startsWith('--password='))?.split('=')[1] || 'secret'
      const roles = rest.find(arg => arg.startsWith('--roles='))?.split('=')[1] || 'owner,admin'
      
      console.log('👤 Setting up admin user...')
      const setupOutput = execSync(`yarn mercato auth setup --orgName "${orgName}" --email ${email} --password ${password} --roles ${roles}`, { stdio: 'pipe' }).toString()
      console.log('✅ Admin user created\n')
      

      // Extract organization ID and tenant ID from setup output
      const orgIdMatch = setupOutput.match(/organizationId: '([^']+)'/)
      const tenantIdMatch = setupOutput.match(/tenantId: '([^']+)'/)
      const orgId = orgIdMatch ? orgIdMatch[1] : null
      const tenantId = tenantIdMatch ? tenantIdMatch[1] : null
      
      if (orgId && tenantId) {
        console.log('📝 Seeding example todos...')
        execSync(`yarn mercato example seed-todos --org ${orgId} --tenant ${tenantId}`, { stdio: 'inherit' })
        console.log('✅ Example todos seeded\n')
      } else {
        console.log('⚠️  Could not extract organization ID or tenant ID, skipping todo seeding\n')
      }
      
      // Success message with admin info
      console.log('🎉 App initialization complete!\n')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║  🚀 You\'re now ready to start development!                   ║')
      console.log('║                                                              ║')
      console.log('║  Start the dev server:                                       ║')
      console.log('║    yarn dev                                                  ║')
      console.log('║                                                              ║')
      console.log('║  Your admin user:                                            ║')
      console.log(`║    📧 Email: ${email.padEnd(44)} ║`)
      console.log(`║    🔑 Password: ${password.padEnd(44)} ║`)
      console.log(`║    🏢 Organization: ${orgName.padEnd(40)} ║`)
      console.log(`║    👑 Roles: ${roles.padEnd(47)} ║`)
      console.log('║                                                              ║')
      console.log('║  Happy coding!                                               ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')
      
      return 0
    } catch (error: any) {
      console.error('❌ Initialization failed:', error.message)
      return 1
    }
  }
  
  // Load modules lazily, after init handling
  const { modules } = await import('@/generated/modules.generated')
  
  // Load optional app-level CLI commands lazily
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
          const { createRequestContainer } = await import('@/lib/di/container')
          const container = await createRequestContainer()
          const bus = container.resolve<any>('eventBus')
          const res = await bus.processOffline({ limit })
          console.log(`Processed ${res.processed} events${res.lastId ? `, lastId=${res.lastId}` : ''}`)
        },
      },
      {
        command: 'clear',
        run: async () => {
          const { createRequestContainer } = await import('@/lib/di/container')
          const container = await createRequestContainer()
          const bus = container.resolve<any>('eventBus')
          const res = await bus.clearQueue()
          console.log(`Cleared queue, removed ${res.removed} events`)
        },
      },
      {
        command: 'clear-processed',
        run: async () => {
          const { createRequestContainer } = await import('@/lib/di/container')
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
          const { createRequestContainer } = await import('@/lib/di/container')
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

  if (!modName || modName === 'help' || modName === '--help' || modName === '-h') {
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
