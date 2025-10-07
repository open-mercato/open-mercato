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
      const reinstall = rest.includes('--reinstall') || rest.includes('-r')

      if (reinstall) {
        // Load env variables so DATABASE_URL is available
        try { await import('dotenv/config') } catch {}
        console.log('♻️  Reinstall mode enabled: dropping all database tables...')
        const { Client } = await import('pg')
        const dbUrl = process.env.DATABASE_URL
        if (!dbUrl) {
          console.error('DATABASE_URL is not set. Aborting reinstall.')
          return 1
        }
        const client = new Client({ connectionString: dbUrl })
        try {
          await client.connect()
          // Collect all user tables in public schema
          const res = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
          const tables: string[] = (res.rows || []).map((r: any) => String(r.tablename))
          if (tables.length === 0) {
            console.log('   No tables found in public schema.')
          } else {
            // Drop all tables with CASCADE to remove constraints in one go
            await client.query('BEGIN')
            try {
              // Temporarily relax constraints to avoid dependency issues
              await client.query("SET session_replication_role = 'replica'")
              for (const t of tables) {
                await client.query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
              }
              await client.query("SET session_replication_role = 'origin'")
              await client.query('COMMIT')
              console.log(`   Dropped ${tables.length} tables.`)
            } catch (e) {
              await client.query('ROLLBACK')
              throw e
            }
          }
        } finally {
          try { await client.end() } catch {}
        }
        console.log('✅ Database cleared. Proceeding with fresh initialization...\n')
      }

      // Step 1: Install dependencies
      console.log('📦 Installing dependencies...')
      execSync('yarn install', { stdio: 'inherit' })
      console.log('✅ Dependencies installed\n')
      
      // Step 2: Prepare modules
      console.log('🔧 Preparing modules (registry, entities, DI)...')
      execSync('yarn modules:prepare', { stdio: 'inherit' })
      console.log('✅ Modules prepared\n')
      
      // Step 3: Generate migrations
//      console.log('🗄️  Generating database migrations...')
//      execSync('yarn db:generate', { stdio: 'inherit' })
//      console.log('✅ Migrations generated\n')
      
      // Step 3: Apply migrations
      console.log('📊 Applying database migrations...')
      execSync('yarn db:migrate', { stdio: 'inherit' })
      console.log('✅ Migrations applied\n')
      
      // Step 4: Seed roles
      console.log('👥 Seeding default roles...')
      execSync('yarn mercato auth seed-roles', { stdio: 'inherit' })
      console.log('✅ Roles seeded\n')
      
      // Step 5: Setup RBAC (tenant/org, users, ACLs)
      const orgName = rest.find(arg => arg.startsWith('--org='))?.split('=')[1] || 'Acme Corp'
      const email = rest.find(arg => arg.startsWith('--email='))?.split('=')[1] || 'admin@acme.com'
      const password = rest.find(arg => arg.startsWith('--password='))?.split('=')[1] || 'secret'
      const roles = rest.find(arg => arg.startsWith('--roles='))?.split('=')[1] || 'superadmin,owner,admin,employee'
      
      console.log('🔐 Setting up RBAC and users...')
      const setupOutput = execSync(`yarn mercato auth setup --orgName "${orgName}" --email ${email} --password ${password} --roles ${roles}`, { stdio: 'pipe' }).toString()
      console.log('✅ RBAC setup complete\n')
      

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
      
      // Detect additional users created/updated by setup (admin, employee)
      const adminEmailDerived = `admin@${(orgName || 'acme').toLowerCase()}.com`
      const employeeEmailDerived = `employee@${(orgName || 'acme').toLowerCase()}.com`
      const hasAdminUser = setupOutput.includes(adminEmailDerived)
      const hasEmployeeUser = setupOutput.includes(employeeEmailDerived)

      // Success message with admin info and optionally extra users
      console.log('🎉 App initialization complete!\n')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║  🚀 You\'re now ready to start development!                   ║')
      console.log('║                                                              ║')
      console.log('║  Start the dev server:                                       ║')
      console.log('║    yarn dev                                                  ║')
      console.log('║                                                              ║')
      console.log('║  Your admin user:                                            ║')
      console.log(`║    📧 Email: ${email.padEnd(47)} ║`)
      console.log(`║    🔑 Password: ${password.padEnd(44)} ║`)
      console.log(`║    🏢 Organization: ${orgName.padEnd(40)} ║`)
      console.log(`║    👑 Roles: ${roles.padEnd(47)} ║`)
      if (hasAdminUser || hasEmployeeUser) {
        console.log('║                                                              ║')
        console.log('║  Additional users:                                           ║')
        if (hasAdminUser) {
          console.log(`║    👤 Admin: ${adminEmailDerived.padEnd(47)} ║`)
          console.log(`║    🔑 Password: ${password.padEnd(44)} ║`)
          console.log('║    🧰 Roles: admin                                           ║')
        }
        if (hasEmployeeUser) {
          console.log('║                                                              ║')
          console.log(`║    👤 Employee: ${employeeEmailDerived.padEnd(44)} ║`)
          console.log(`║    🔑 Password: ${password.padEnd(44)} ║`)
          console.log('║    🧰 Roles: employee                                        ║')
        }
      }
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
  
  // Load optional app-level CLI commands lazily without static import resolution
  let appCli: any[] = []
  try {
    const dynImport: any = (Function('return import') as any)()
    const app = await dynImport.then((f: any) => f('@/cli')).catch(() => null)
    if (app && Array.isArray(app?.default)) appCli = app.default
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

  // Built-in CLI module: scaffold
  all.push({
    id: 'scaffold',
    cli: [
      {
        command: 'module',
        run: async (args: string[]) => {
          const name = (args[0] || '').trim()
          if (!name) {
            console.error('Usage: mercato scaffold module <name>')
            return
          }
          const fs = await import('node:fs')
          const path = await import('node:path')
          const { execSync } = await import('node:child_process')
          const base = path.resolve('src/modules', name)
          const folders = ['api', 'backend', 'frontend', 'data', 'subscribers']
          for (const f of folders) fs.mkdirSync(path.join(base, f), { recursive: true })
          const indexTs = `export const metadata = { title: '${name[0].toUpperCase()}${name.slice(1)}', group: 'Modules' }\n`
          fs.writeFileSync(path.join(base, 'index.ts'), indexTs, { flag: 'wx' })
          const fieldsTs = `import { defineFields } from '@/modules/dsl'\nimport type { CustomFieldSet } from '@/modules/entities'\nimport { E } from '@/generated/entities.ids.generated'\n\nexport const fieldSets: CustomFieldSet[] = [\n  // defineFields(E.${name}.your_entity, [ /* cf.* definitions */ ], '${name}')\n]\n\nexport default fieldSets\n`
          fs.writeFileSync(path.join(base, 'data', 'fields.ts'), fieldsTs, { flag: 'wx' })
          const entitiesTs = `import { Entity, PrimaryKey, Property } from '@mikro-orm/core'\n\n// Add your entities here. Example:\n// @Entity({ tableName: '${name}_items' })\n// export class ${name[0].toUpperCase()}${name.slice(1)}Item {\n//   @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string\n//   @Property({ type: 'text' }) title!: string\n//   @Property({ name: 'organization_id', type: 'uuid', nullable: true }) organizationId?: string | null\n//   @Property({ name: 'tenant_id', type: 'uuid', nullable: true }) tenantId?: string | null\n//   @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()\n//   @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt: Date = new Date()\n//   @Property({ name: 'deleted_at', type: Date, nullable: true }) deletedAt?: Date | null\n// }\n`
          fs.writeFileSync(path.join(base, 'data', 'entities.ts'), entitiesTs, { flag: 'wx' })
          console.log(`Created module at ${path.relative(process.cwd(), base)}`)
          execSync('yarn modules:prepare', { stdio: 'inherit' })
        },
      },
      {
        command: 'entity',
        run: async (_args: string[]) => {
          const fs = await import('node:fs')
          const path = await import('node:path')
          const readline = await import('node:readline/promises')
          const { stdin: input, stdout: output } = await import('node:process')
          const { execSync } = await import('node:child_process')
          const rl = readline.createInterface({ input, output })
          try {
            const moduleId = (await rl.question('Module id (folder under src/modules): ')).trim()
            const className = (await rl.question('Entity class name (e.g., Todo): ')).trim()
            const tableName = (await rl.question(`DB table name (default: ${className.toLowerCase()}s): `)).trim() || `${className.toLowerCase()}s`
            const extra = (await rl.question('Additional fields (comma list name:type, e.g., title:text,is_done:boolean): ')).trim()
            const extras = extra
              ? extra.split(',').map(s => s.trim()).filter(Boolean).map(s => {
                  const [n,t] = s.split(':').map(x=>x.trim()); return { n, t }
                })
              : []
            const base = path.resolve('src/modules', moduleId, 'data')
            fs.mkdirSync(base, { recursive: true })
            const file = path.join(base, 'entities.ts')
            let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `import { Entity, PrimaryKey, Property } from '@mikro-orm/core'\n\n`
            content += `\n@Entity({ tableName: '${tableName}' })\nexport class ${className} {\n  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })\n  id!: string\n\n  @Property({ name: 'organization_id', type: 'uuid', nullable: true })\n  organizationId?: string | null\n\n  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })\n  tenantId?: string | null\n\n  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })\n  createdAt: Date = new Date()\n\n  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })\n  updatedAt: Date = new Date()\n\n  @Property({ name: 'deleted_at', type: Date, nullable: true })\n  deletedAt?: Date | null\n`
            for (const f of extras) {
              const n = f.n
              const t = f.t
              if (!n || !t) continue
              const map: Record<string, { ts: string; db?: string }> = {
                text: { ts: 'text' },
                boolean: { ts: 'boolean' },
                integer: { ts: 'int' },
                float: { ts: 'float' },
                date: { ts: 'Date' },
              }
              const m = map[t] || map.text
              const col = n.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
              const tsType = m.ts === 'Date' ? 'Date' : (m.ts === 'int' || m.ts === 'float') ? 'number' : m.ts
              const dbType = m.ts === 'int' ? 'int' : m.ts === 'float' ? 'float' : m.ts === 'boolean' ? 'boolean' : m.ts === 'Date' ? 'Date' : 'text'
              content += `\n  @Property({ name: '${col}', type: ${dbType}${t === 'boolean' ? ', default: false' : ''} })\n  ${n}${t === 'boolean' ? ': boolean = false' : tsType === 'Date' ? ': Date = new Date()' : tsType === 'number' ? '?: number | null' : '!: string'}\n`
            }
            content += `}\n`
            fs.writeFileSync(file, content)
            console.log(`Updated ${path.relative(process.cwd(), file)}`)
            console.log('Generating and applying migrations...')
            execSync('yarn modules:prepare', { stdio: 'inherit' })
            execSync('yarn db:generate', { stdio: 'inherit' })
            execSync('yarn db:migrate', { stdio: 'inherit' })
          } finally {
            rl.close()
          }
        },
      },
      {
        command: 'crud',
        run: async (args: string[]) => {
          const fs = await import('node:fs')
          const path = await import('node:path')
          const { execSync } = await import('node:child_process')
          const mod = (args[0] || '').trim()
          const entity = (args[1] || '').trim() // ClassName
          const routeSeg = (args[2] || '').trim() || `${entity.toLowerCase()}s`
          if (!mod || !entity) {
            console.error('Usage: mercato scaffold crud <moduleId> <EntityClass> [routeSegment]')
            return
          }
          const baseDir = path.resolve('src/modules', mod, 'api', routeSeg)
          fs.mkdirSync(baseDir, { recursive: true })
          const entitySnake = entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
          const tmpl = `import { z } from 'zod'\nimport { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'\nimport { ${entity} } from '@/modules/${mod}/data/entities'\nimport { E } from '@/generated/entities.ids.generated'\nimport * as F from '@/generated/entities/${entitySnake}'\nimport fieldSets from '@/modules/${mod}/data/fields'\nimport { buildCustomFieldSelectorsForEntity, extractCustomFieldsFromItem, buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'\n\nconst querySchema = z.object({\n  id: z.string().uuid().optional(),\n  page: z.coerce.number().min(1).default(1),\n  pageSize: z.coerce.number().min(1).max(100).default(50),\n  sortField: z.string().optional().default('id'),\n  sortDir: z.enum(['asc','desc']).optional().default('asc'),\n  withDeleted: z.coerce.boolean().optional().default(false),\n}).passthrough()\n\nconst createSchema = z.object({}).passthrough()\nconst updateSchema = z.object({ id: z.string().uuid() }).passthrough()\n\ntype Query = z.infer<typeof querySchema>\n\nconst cfSel = buildCustomFieldSelectorsForEntity(E.${mod}.${entitySnake}, fieldSets)\nconst sortFieldMap: Record<string, unknown> = { id: F.id, created_at: F.created_at, ...Object.fromEntries(cfSel.keys.map(k => [\`cf_\${k}\`, \`cf:\${k}\`])) }\n\nexport const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({\n  metadata: { GET: { requireAuth: true }, POST: { requireAuth: true }, PUT: { requireAuth: true }, DELETE: { requireAuth: true } },\n  orm: { entity: ${entity}, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },\n  events: { module: '${mod}', entity: '${entitySnake}', persistent: true },\n  list: {\n    schema: querySchema,\n    entityId: E.${mod}.${entitySnake},\n    fields: [F.id, F.created_at, ...cfSel.selectors],\n    sortFieldMap,\n    buildFilters: async (q: Query, ctx) => ({ ...(await buildCustomFieldFiltersFromQuery({ entityId: E.${mod}.${entitySnake}, query: q as any, em: ctx.container.resolve('em'), orgId: ctx.auth.orgId, tenantId: ctx.auth.tenantId })) }),\n    transformItem: (item: any) => ({ id: item.id, created_at: item.created_at, ...extractCustomFieldsFromItem(item, cfSel.keys) }),\n  },\n  create: { schema: createSchema, mapToEntity: (input: any) => ({}), customFields: { enabled: true, entityId: E.${mod}.${entitySnake}, pickPrefixed: true } },\n  update: { schema: updateSchema, applyToEntity: (entity: ${entity}, input: any) => {}, customFields: { enabled: true, entityId: E.${mod}.${entitySnake}, pickPrefixed: true } },\n  del: { idFrom: 'query', softDelete: true },\n})\n`
          const file = path.join(baseDir, 'route.ts')
          fs.writeFileSync(file, tmpl, { flag: 'wx' })
          console.log(`Created CRUD route: ${path.relative(process.cwd(), file)}`)
          execSync('yarn modules:prepare', { stdio: 'inherit' })
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
