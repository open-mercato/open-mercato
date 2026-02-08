/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: Generated files and DI container are imported statically to avoid ESM/CJS interop issues.
// Commands that need to run before generation (e.g., `init`) handle missing modules gracefully.

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runWorker } from '@open-mercato/queue/worker'
import type { Module } from '@open-mercato/shared/modules/registry'
import { getCliModules, hasCliModules, registerCliModules } from './registry'
export { getCliModules, hasCliModules, registerCliModules }
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveInitDerivedSecrets } from './lib/init-secrets'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

let envLoaded = false

async function ensureEnvLoaded() {
  if (envLoaded) return
  envLoaded = true

  // Try to find and load .env from the app directory
  // First, try to find the app directory via resolver
  try {
    const { createResolver } = await import('./lib/resolver.js')
    const resolver = createResolver()
    const appDir = resolver.getAppDir()

    // Load .env from app directory if it exists
    const envPath = path.join(appDir, '.env')
    if (fs.existsSync(envPath)) {
      const dotenv = await import('dotenv')
      dotenv.config({ path: envPath })
      return
    }
  } catch {
    // Resolver might fail during early init, fall back to default behavior
  }

  // Fall back to default dotenv behavior (loads from cwd)
  try {
    await import('dotenv/config')
  } catch {}
}

// Helper to run a CLI command directly (without spawning a process)
async function runModuleCommand(
  allModules: Module[],
  moduleName: string,
  commandName: string,
  args: string[] = [],
  options: { optional?: boolean } = {},
): Promise<void> {
  const mod = allModules.find((m) => m.id === moduleName)
  if (!mod) {
    if (options.optional) {
      console.log(`⏭️  Skipping "${moduleName}:${commandName}" — module not enabled`)
      return
    }
    throw new Error(`Module not found: "${moduleName}"`)
  }
  if (!mod.cli || mod.cli.length === 0) {
    if (options.optional) {
      console.log(`⏭️  Skipping "${moduleName}:${commandName}" — module has no CLI commands`)
      return
    }
    throw new Error(`Module "${moduleName}" has no CLI commands`)
  }
  const cmd = mod.cli.find((c) => c.command === commandName)
  if (!cmd) {
    if (options.optional) {
      console.log(`⏭️  Skipping "${moduleName}:${commandName}" — command not found`)
      return
    }
    throw new Error(`Command "${commandName}" not found in module "${moduleName}"`)
  }
  await cmd.run(args)
}

// Build all CLI modules (registered + built-in)
async function buildAllModules(): Promise<Module[]> {
  const modules = getCliModules()

  // Load optional app-level CLI commands
  let appCli: any[] = []
  try {
    const dynImport: any = (Function('return import') as any)()
    const app = await dynImport.then((f: any) => f('@/cli')).catch(() => null)
    if (app && Array.isArray(app?.default)) appCli = app.default
  } catch {}

  const all = modules.slice()

  if (appCli.length) all.push({ id: 'app', cli: appCli } as any)

  return all
}

export async function run(argv = process.argv) {
  await ensureEnvLoaded()
  const [, , ...parts] = argv
  const [first, second, ...remaining] = parts
  
  // Handle init command directly
  if (first === 'init') {
    const { execSync } = await import('child_process')

    console.log('🚀 Initializing Open Mercato app...\n')

    try {
      const initArgs = parts.slice(1).filter(Boolean)
      const reinstall = initArgs.includes('--reinstall') || initArgs.includes('-r')
      process.env.OM_INIT_FLOW = 'true'
      if (reinstall) {
        process.env.OM_INIT_REINSTALL = 'true'
      } else if (process.env.OM_INIT_REINSTALL) {
        delete process.env.OM_INIT_REINSTALL
      }
      const skipExamples = initArgs.includes('--no-examples') || initArgs.includes('--no-exampls')
      const stressTestEnabled =
        initArgs.includes('--stresstest') || initArgs.includes('--stress-test')
      const stressTestLite =
        initArgs.includes('--lite') ||
        initArgs.includes('--stress-lite') ||
        initArgs.some((arg) => arg.startsWith('--payload=lite') || arg.startsWith('--mode=lite'))
      let stressTestCount = 6000
      for (let i = 0; i < initArgs.length; i += 1) {
        const arg = initArgs[i]
        const countPrefixes = ['--count=', '--stress-count=', '--stresstest-count=']
        const matchedPrefix = countPrefixes.find((prefix) => arg.startsWith(prefix))
        if (matchedPrefix) {
          const value = arg.slice(matchedPrefix.length)
          const parsed = Number.parseInt(value, 10)
          if (Number.isFinite(parsed) && parsed > 0) {
            stressTestCount = parsed
            break
          }
        }
        if (arg === '--count' || arg === '--stress-count' || arg === '--stresstest-count' || arg === '-n') {
          const next = initArgs[i + 1]
          if (next && !next.startsWith('-')) {
            const parsed = Number.parseInt(next, 10)
            if (Number.isFinite(parsed) && parsed > 0) {
              stressTestCount = parsed
              break
            }
          }
        }
        if (arg.startsWith('-n=')) {
          const value = arg.slice(3)
          const parsed = Number.parseInt(value, 10)
          if (Number.isFinite(parsed) && parsed > 0) {
            stressTestCount = parsed
            break
          }
        }
      }
      console.log(`🔄 Reinstall mode: ${reinstall ? 'enabled' : 'disabled'}`)
      console.log(`🎨 Example content: ${skipExamples ? 'skipped (--no-examples)' : 'enabled'}`)
      console.log(
        `🏋️ Stress test dataset: ${
          stressTestEnabled
            ? `enabled (target ${stressTestCount} contacts${stressTestLite ? ', lite payload' : ''})`
            : 'disabled'
        }`
      )

      if (reinstall) {
        // Load env variables so DATABASE_URL is available
        await ensureEnvLoaded()
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
          const dropTargets = new Set<string>((res.rows || []).map((r: any) => String(r.tablename)))
          for (const forced of ['vector_search', 'vector_search_migrations']) {
            const exists = await client.query(
              `SELECT to_regclass($1) AS regclass`,
              [`public.${forced}`],
            )
            const regclass = (exists as { rows?: Array<{ regclass: string | null }> }).rows?.[0]?.regclass ?? null
            if (regclass) {
              dropTargets.add(forced)
            }
          }
          if (dropTargets.size === 0) {
            console.log('   No tables found in public schema.')
          } else {
            let dropped = 0
            await client.query('BEGIN')
            try {
              for (const t of dropTargets) {
                await client.query(`DROP TABLE IF EXISTS "${t}" CASCADE`)
                dropped += 1
              }
              await client.query('COMMIT')
              console.log(`   Dropped ${dropped} tables.`)
            } catch (e) {
              await client.query('ROLLBACK')
              throw e
            }
          }
        } finally {
          try { await client.end() } catch {}
        }
        // Also flush Redis
        try {
          const Redis = (await import('ioredis')).default
          const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
          const redis = new Redis(redisUrl)
          await redis.flushall()
          await redis.quit()
          console.log('   Redis flushed.')
        } catch {}
        console.log('✅ Database cleared. Proceeding with fresh initialization...\n')
      }

      // Step 1: Run generators directly (no process spawn)
      console.log('🔧 Preparing modules (registry, entities, DI)...')
      const { createResolver } = await import('./lib/resolver')
      const { generateEntityIds, generateModuleRegistry, generateModuleRegistryCli, generateModuleEntities, generateModuleDi, generateOpenApi } = await import('./lib/generators')
      const resolver = createResolver()
      await generateEntityIds({ resolver, quiet: true })
      await generateModuleRegistry({ resolver, quiet: true })
      await generateModuleRegistryCli({ resolver, quiet: true })
      await generateModuleEntities({ resolver, quiet: true })
      await generateModuleDi({ resolver, quiet: true })
      await generateOpenApi({ resolver, quiet: true })
      console.log('✅ Modules prepared\n')

      // Step 3: Apply database migrations directly
      console.log('📊 Applying database migrations...')
      const { dbMigrate } = await import('./lib/db')
      await dbMigrate(resolver)
      console.log('✅ Migrations applied\n')

      // Step 4: Bootstrap to register modules and entity IDs
      // Use the shared dynamicLoader which compiles TypeScript files on-the-fly
      console.log('🔗 Bootstrapping application...')
      const { bootstrapFromAppRoot } = await import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
      const bootstrapData = await bootstrapFromAppRoot(resolver.getAppDir())
      // Register CLI modules directly (bootstrapFromAppRoot returns the data for this purpose)
      registerCliModules(bootstrapData.modules)
      console.log('✅ Bootstrap complete\n')

      // Step 5: Build all modules for CLI commands
      const allModules = await buildAllModules()

      // Step 6: Restore configuration defaults
      console.log('⚙️  Restoring module defaults...')
      await runModuleCommand(allModules, 'configs', 'restore-defaults', [])
      console.log('✅ Module defaults restored\n')

      // Step 7: Setup RBAC (tenant/org, users, ACLs)
      const findArgValue = (names: string[], fallback: string) => {
        for (const name of names) {
          const match = initArgs.find((arg) => arg.startsWith(name))
          if (match) {
            const value = match.slice(name.length)
            if (value) return value
          }
        }
        return fallback
      }
      const readEnvDefault = (key: string) => {
        const value = process.env[key]
        if (typeof value === 'string' && value.trim().length > 0) return value.trim()
        return undefined
      }
      const defaultEmail = readEnvDefault('OM_INIT_SUPERADMIN_EMAIL') ?? 'superadmin@acme.com'
      const defaultPassword = readEnvDefault('OM_INIT_SUPERADMIN_PASSWORD') ?? 'secret'
      const orgName = findArgValue(['--org=', '--orgName='], 'Acme Corp')
      const email = findArgValue(['--email='], defaultEmail)
      const password = findArgValue(['--password='], defaultPassword)
      const derivedSecrets = resolveInitDerivedSecrets({ email, env: process.env })
      const adminEmailDerived = derivedSecrets.adminEmail
      const employeeEmailDerived = derivedSecrets.employeeEmail
      if (adminEmailDerived && derivedSecrets.adminPassword) {
        process.env.OM_INIT_ADMIN_PASSWORD = derivedSecrets.adminPassword
      }
      if (employeeEmailDerived && derivedSecrets.employeePassword) {
        process.env.OM_INIT_EMPLOYEE_PASSWORD = derivedSecrets.employeePassword
      }
      const roles = findArgValue(['--roles='], 'superadmin,admin,employee')
      const skipPasswordPolicyRaw = initArgs.find((arg) =>
        arg === '--skip-password-policy' ||
        arg.startsWith('--skip-password-policy=') ||
        arg === '--allow-weak-password' ||
        arg.startsWith('--allow-weak-password=')
      )
      const skipPasswordPolicy = skipPasswordPolicyRaw
        ? parseBooleanToken(skipPasswordPolicyRaw.split('=')[1] ?? 'true') ?? true
        : true

      console.log('🔐 Setting up RBAC and users...')
      // Run auth setup command via CLI
      const setupArgs = [
        '--orgName', orgName,
        '--email', email,
        '--password', password,
        '--roles', roles,
      ]
      if (skipPasswordPolicy) {
        setupArgs.push('--skip-password-policy')
      }
      await runModuleCommand(allModules, 'auth', 'setup', setupArgs)
      // Query DB to get tenant/org IDs using pg directly
      const { Client } = await import('pg')
      const dbUrl = process.env.DATABASE_URL
      const pgClient = new Client({ connectionString: dbUrl })
      await pgClient.connect()
      const orgResult = await pgClient.query(
        `SELECT o.id as org_id, o.tenant_id FROM organizations o
         JOIN users u ON u.organization_id = o.id
         LIMIT 1`
      )
      await pgClient.end()
      const tenantId = orgResult?.rows?.[0]?.tenant_id ?? null
      const orgId = orgResult?.rows?.[0]?.org_id ?? null
      if (!tenantId || !orgId) {
        throw new Error('Auth setup failed to create a tenant/org. Aborting init.')
      }
      console.log('✅ RBAC setup complete:', { tenantId, organizationId: orgId }, '\n')

      console.log('🎛️  Seeding feature toggle defaults...')
      await runModuleCommand(allModules, 'feature_toggles', 'seed-defaults', [])
      console.log('🎛️  ✅ Feature toggle defaults seeded\n')

      if (tenantId) {
        console.log('👥 Seeding tenant-scoped roles...')
        await runModuleCommand(allModules, 'auth', 'seed-roles', ['--tenant', tenantId])
        console.log('🛡️ ✅ Roles seeded\n')
      } else {
        console.log('⚠️  Skipping role seeding because tenant ID was not available.\n')
      }

      if (orgId && tenantId) {
        if (reinstall) {
          console.log('🧩 Reinstalling custom field definitions...')
          await runModuleCommand(allModules, 'entities', 'reinstall', ['--tenant', tenantId])
          console.log('🧩 ✅ Custom field definitions reinstalled\n')
        }

        const parsedEncryption = parseBooleanToken(process.env.TENANT_DATA_ENCRYPTION ?? 'yes')
        const encryptionEnabled = parsedEncryption === null ? true : parsedEncryption
        if (encryptionEnabled) {
          console.log('🔒 Seeding encryption defaults...')
          await runModuleCommand(allModules, 'entities', 'seed-encryption', ['--tenant', tenantId, '--org', orgId])
          console.log('🔒 ✅ Encryption defaults seeded\n')
        } else {
          console.log('⚠️  TENANT_DATA_ENCRYPTION disabled; skipping encryption defaults.\n')
        }

        // Seed module defaults (structural data: dictionaries, tax rates, units, etc.)
        console.log('📚 Seeding module defaults...')
        const seedContainer = await createRequestContainer()
        const seedEm = seedContainer.resolve('em') as any
        const seedCtx = { em: seedEm, tenantId, organizationId: orgId, container: seedContainer }
        for (const mod of allModules) {
          if (mod.setup?.seedDefaults) {
            console.log(`  📦 ${mod.id}...`)
            await mod.setup.seedDefaults(seedCtx)
          }
        }
        console.log('✅ Module defaults seeded\n')

        if (skipExamples) {
          console.log('🚫 Example data seeding skipped (--no-examples)\n')
        } else {
          // Seed example data (demo products, customers, orders, etc.)
          console.log('🎨 Seeding example data...')
          for (const mod of allModules) {
            if (mod.setup?.seedExamples) {
              console.log(`  📦 ${mod.id}...`)
              await mod.setup.seedExamples(seedCtx)
            }
          }
          console.log('✅ Example data seeded\n')
        }

        if (stressTestEnabled) {
          console.log(
            `🏋️  Seeding stress test customers${stressTestLite ? ' (lite payload)' : ''}...`
          )
          const stressArgs = ['--tenant', tenantId, '--org', orgId, '--count', String(stressTestCount)]
          if (stressTestLite) stressArgs.push('--lite')
          await runModuleCommand(allModules, 'customers', 'seed-stresstest', stressArgs, { optional: true })
          console.log(`✅ Stress test customers seeded (requested ${stressTestCount})\n`)
        }

        console.log('🧩 Enabling default dashboard widgets...')
        await runModuleCommand(allModules, 'dashboards', 'seed-defaults', ['--tenant', tenantId], { optional: true })
        console.log('✅ Dashboard widgets enabled\n')

        console.log('📊 Enabling analytics widgets for admin and employee roles...')
        await runModuleCommand(allModules, 'dashboards', 'enable-analytics-widgets', [
          '--tenant',
          tenantId,
          '--roles',
          'admin,employee',
        ])
        console.log('✅ Analytics widgets enabled for roles\n')

      } else {
        console.log('⚠️  Could not get organization ID or tenant ID, skipping seeding steps\n')
      }

      console.log('🧠 Building search indexes...')
      const vectorArgs = tenantId
        ? ['--tenant', tenantId, ...(orgId ? ['--org', orgId] : [])]
        : ['--purgeFirst=false']
      await runModuleCommand(allModules, 'search', 'reindex', vectorArgs, { optional: true })
      console.log('✅ Search indexes built\n')

      console.log('🔍 Rebuilding query indexes...')
      const queryIndexArgs = ['--force', ...(tenantId ? ['--tenant', tenantId] : [])]
      await runModuleCommand(allModules, 'query_index', 'reindex', queryIndexArgs, { optional: true })
      console.log('✅ Query indexes rebuilt\n')

      const adminPasswordOverride = derivedSecrets.adminPassword
      const employeePasswordOverride = derivedSecrets.employeePassword
      const createdUsers: Array<{ label: string; icon: string; email: string }> = []
      const createdPasswords = new Map<string, string>()
      const pushUser = (label: string, icon: string, value: string | null, passwordValue: string) => {
        if (!value) return
        if (createdUsers.some((entry) => entry.email.toLowerCase() === value.toLowerCase())) return
        createdUsers.push({ label, icon, email: value })
        createdPasswords.set(value.toLowerCase(), passwordValue)
      }
      pushUser('Superadmin', '👑', email, password)
      pushUser('Admin', '🧰', adminEmailDerived, adminPasswordOverride ?? password)
      pushUser('Employee', '👷', employeeEmailDerived, employeePasswordOverride ?? password)

      // Simplified success message: we know which users were created
      console.log('🎉 App initialization complete!\n')
      console.log('╔══════════════════════════════════════════════════════════════╗')
      console.log('║  🚀 You\'re now ready to start development!                   ║')
      console.log('║                                                              ║')
      console.log('║  Start the dev server:                                       ║')
      console.log('║    yarn dev                                                  ║')
      console.log('║                                                              ║')
      console.log('║  Users created:                                              ║')
      for (const entry of createdUsers) {
        const label = `${entry.icon} ${entry.label}:`
        const labelPad = label.padEnd(13)
        const entryPassword = createdPasswords.get(entry.email.toLowerCase()) ?? password
        console.log(`║    ${labelPad}${entry.email.padEnd(42)} ║`)
        console.log(`║       Password: ${entryPassword.padEnd(44)} ║`)
      }
      console.log('║                                                              ║')
      console.log('║  Happy coding!                                               ║')
      console.log('╚══════════════════════════════════════════════════════════════╝')

      return 0
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.error('❌ Initialization failed:', error.message)
      } else {
        console.error('❌ Initialization failed:', error)
      }
      return 1
    }
  }

  // Handle eject command directly (bootstrap-free)
  if (first === 'eject') {
    try {
      const { createResolver } = await import('./lib/resolver')
      const { listEjectableModules, ejectModule } = await import('./lib/eject')
      const resolver = createResolver()

      const isList = second === '--list' || second === '-l'
      const moduleId = !isList ? second : undefined

      if (isList || !moduleId) {
        const ejectable = listEjectableModules(resolver)
        if (ejectable.length === 0) {
          console.log('No ejectable modules found.')
        } else {
          console.log('Ejectable modules:\n')
          for (const mod of ejectable) {
            const desc = mod.description ? ` — ${mod.description}` : ''
            console.log(`  ${mod.id} (from: ${mod.from})${desc}`)
          }
          console.log('\nUsage: yarn mercato eject <moduleId>')
        }
        return 0
      }

      console.log(`Ejecting module "${moduleId}"...`)
      ejectModule(resolver, moduleId)
      console.log(`\n✅ Module "${moduleId}" ejected successfully!\n`)
      console.log('Next steps:')
      console.log('  1. Run generators:  yarn mercato generate all')
      console.log(`  2. Customize:       edit src/modules/${moduleId}/`)
      console.log('  3. Start dev:       yarn dev')
      return 0
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ Eject failed: ${message}`)
      return 1
    }
  }

  let modName = first
  let cmdName = second
  let rest = remaining

  if (first === 'reindex') {
    modName = 'query_index'
    cmdName = 'reindex'
    rest = second !== undefined ? [second, ...remaining] : remaining
  }

  // Handle 'mercato generate' without subcommand - default to 'generate all'
  if (first === 'generate' && !second) {
    cmdName = 'all'
    rest = remaining
  }

  // Load modules from registered CLI modules
  const modules = getCliModules()
  
  // Load optional app-level CLI commands lazily without static import resolution
  let appCli: any[] = []
  try {
    const dynImport: any = (Function('return import') as any)()
    const app = await dynImport.then((f: any) => f('@/cli')).catch(() => null)
    if (app && Array.isArray(app?.default)) appCli = app.default
  } catch {}
  const all = modules.slice()
  
  // Built-in CLI module: queue
  all.push({
    id: 'queue',
    cli: [
      {
        command: 'worker',
        run: async (args: string[]) => {
          const isAllQueues = args.includes('--all')
          const queueName = isAllQueues ? null : args[0]

          // Collect all discovered workers from modules
          type WorkerEntry = {
            id: string
            queue: string
            concurrency: number
            handler: (job: unknown, ctx: unknown) => Promise<void> | void
          }
          const allWorkers: WorkerEntry[] = []
          for (const mod of getCliModules()) {
            const modWorkers = (mod as { workers?: WorkerEntry[] }).workers
            if (modWorkers) {
              allWorkers.push(...modWorkers)
            }
          }
          const discoveredQueues = [...new Set(allWorkers.map((w) => w.queue))]

          if (!queueName && !isAllQueues) {
            console.error('Usage: mercato queue worker <queueName> | --all')
            console.error('Example: mercato queue worker events')
            console.error('Example: mercato queue worker --all')
            if (discoveredQueues.length > 0) {
              console.error(`Discovered queues: ${discoveredQueues.join(', ')}`)
            }
            return
          }

          const concurrencyArg = args.find((a) => a.startsWith('--concurrency='))
          const concurrencyOverride = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : undefined

          if (isAllQueues) {
            // Run workers for all discovered queues
            if (discoveredQueues.length === 0) {
              console.error('[worker] No queues discovered from modules')
              return
            }

            const container = await createRequestContainer()
            console.log(`[worker] Starting workers for all queues: ${discoveredQueues.join(', ')}`)

            // Start all queue workers in background mode
            const workerPromises = discoveredQueues.map(async (queue) => {
              const queueWorkers = allWorkers.filter((w) => w.queue === queue)
              const concurrency = concurrencyOverride ?? Math.max(...queueWorkers.map((w) => w.concurrency), 1)

              console.log(`[worker] Starting "${queue}" with ${queueWorkers.length} handler(s), concurrency: ${concurrency}`)

              await runWorker({
                queueName: queue,
                connection: { url: process.env.REDIS_URL || process.env.QUEUE_REDIS_URL },
                concurrency,
                background: true,
                handler: async (job, ctx) => {
                  for (const worker of queueWorkers) {
                    await worker.handler(job, { ...ctx, resolve: container.resolve.bind(container) })
                  }
                },
              })
            })

            await Promise.all(workerPromises)

            console.log('[worker] All workers started. Press Ctrl+C to stop')

            // Keep the process alive
            await new Promise(() => {})
          } else {
            // Find workers for this specific queue
            const queueWorkers = allWorkers.filter((w) => w.queue === queueName)

            if (queueWorkers.length > 0) {
              // Use discovered workers
              const container = await createRequestContainer()
              const concurrency = concurrencyOverride ?? Math.max(...queueWorkers.map((w) => w.concurrency), 1)

              console.log(`[worker] Found ${queueWorkers.length} worker(s) for queue "${queueName}"`)

              await runWorker({
                queueName: queueName!,
                connection: { url: process.env.REDIS_URL || process.env.QUEUE_REDIS_URL },
                concurrency,
                handler: async (job, ctx) => {
                  for (const worker of queueWorkers) {
                    await worker.handler(job, { ...ctx, resolve: container.resolve.bind(container) })
                  }
                },
              })
            } else {
              console.error(`No workers found for queue "${queueName}"`)
              if (discoveredQueues.length > 0) {
                console.error(`Available queues: ${discoveredQueues.join(', ')}`)
              }
            }
          }
        },
      },
      {
        command: 'clear',
        run: async (args: string[]) => {
          const queueName = args[0]
          if (!queueName) {
            console.error('Usage: mercato queue clear <queueName>')
            return
          }

          const strategyEnv = process.env.QUEUE_STRATEGY || 'local'
          const { createQueue } = await import('@open-mercato/queue')

          const queue = strategyEnv === 'async'
            ? createQueue(queueName, 'async', {
                connection: { url: process.env.REDIS_URL || process.env.QUEUE_REDIS_URL },
              })
            : createQueue(queueName, 'local')

          const res = await queue.clear()
          await queue.close()
          console.log(`Cleared queue "${queueName}", removed ${res.removed} jobs`)
        },
      },
      {
        command: 'status',
        run: async (args: string[]) => {
          const queueName = args[0]
          if (!queueName) {
            console.error('Usage: mercato queue status <queueName>')
            return
          }

          const strategyEnv = process.env.QUEUE_STRATEGY || 'local'
          const { createQueue } = await import('@open-mercato/queue')

          const queue = strategyEnv === 'async'
            ? createQueue(queueName, 'async', {
                connection: { url: process.env.REDIS_URL || process.env.QUEUE_REDIS_URL },
              })
            : createQueue(queueName, 'local')

          const counts = await queue.getJobCounts()
          console.log(`Queue "${queueName}" status:`)
          console.log(`  Waiting:   ${counts.waiting}`)
          console.log(`  Active:    ${counts.active}`)
          console.log(`  Completed: ${counts.completed}`)
          console.log(`  Failed:    ${counts.failed}`)
          await queue.close()
        },
      },
    ],
  } as any)

  // Built-in CLI module: events
  all.push({
    id: 'events',
    cli: [
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
          const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
          const container = await createRequestContainer()
          const bus = (container.resolve('eventBus') as any)
          await bus.emit(eventName, payload, { persistent })
          console.log(`Emitted "${eventName}"${persistent ? ' (persistent)' : ''}`)
        },
      },
      {
        command: 'clear',
        run: async () => {
          const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
          const container = await createRequestContainer()
          const bus = (container.resolve('eventBus') as any)
          const res = await bus.clearQueue()
          console.log(`Cleared events queue, removed ${res.removed} events`)
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
          const moduleTitle = `${name[0].toUpperCase()}${name.slice(1)}`
          const indexTs = `export const metadata = { title: '${moduleTitle}', group: 'Modules' }\n`
          fs.writeFileSync(path.join(base, 'index.ts'), indexTs, { flag: 'wx' })
          const ceTs = `export const entities = [\n  {\n    id: '${name}:sample',\n    label: '${moduleTitle} Sample',\n    description: 'Describe your custom entity',\n    showInSidebar: true,\n    fields: [\n      // { key: 'priority', kind: 'integer', label: 'Priority' },\n    ],\n  },\n]\n\nexport default entities\n`
          fs.writeFileSync(path.join(base, 'ce.ts'), ceTs, { flag: 'wx' })
          const entitiesTs = `import { Entity, PrimaryKey, Property } from '@mikro-orm/core'\n\n// Add your entities here. Example:\n// @Entity({ tableName: '${name}_items' })\n// export class ${moduleTitle}Item {\n//   @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' }) id!: string\n//   @Property({ type: 'text' }) title!: string\n//   @Property({ name: 'organization_id', type: 'uuid', nullable: true }) organizationId?: string | null\n//   @Property({ name: 'tenant_id', type: 'uuid', nullable: true }) tenantId?: string | null\n//   @Property({ name: 'created_at', type: Date, onCreate: () => new Date() }) createdAt: Date = new Date()\n//   @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() }) updatedAt: Date = new Date()\n//   @Property({ name: 'deleted_at', type: Date, nullable: true }) deletedAt?: Date | null\n// }\n`
          fs.writeFileSync(path.join(base, 'data', 'entities.ts'), entitiesTs, { flag: 'wx' })
          console.log(`Created module at ${path.relative(process.cwd(), base)}`)
          execSync('yarn modules:prepare', { stdio: 'inherit' })
        },
      },
      {
        command: 'entity',
        run: async () => {
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
              const map = {
                text: { ts: 'string', db: 'text' },
                multiline: { ts: 'string', db: 'text' },
                integer: { ts: 'number', db: 'int' },
                float: { ts: 'number', db: 'float' },
                boolean: { ts: 'boolean', db: 'boolean' },
                date: { ts: 'Date', db: 'Date' },
              } as const
              const info = map[t as keyof typeof map]
              const fallback = { ts: 'string', db: 'text' }
              const resolved = info || fallback
              const propName = n.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
              const columnName = n.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
              const dbType = resolved.db
              const tsType = resolved.ts
              const defaultValue =
                resolved.ts === 'boolean' ? ' = false' :
                resolved.ts === 'Date' ? ' = new Date()' :
                ''
              content += `\n  @Property({ name: '${columnName}', type: ${dbType === 'Date' ? 'Date' : `'${dbType}'`}${resolved.ts === 'boolean' ? ', default: false' : ''} })\n  ${propName}${tsType === 'number' ? '?: number | null' : tsType === 'boolean' ? ': boolean' : tsType === 'Date' ? ': Date' : '!: string'}${defaultValue}\n`
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
          const entity = (args[1] || '').trim()
          const routeSeg = (args[2] || '').trim() || `${entity.toLowerCase()}s`
          if (!mod || !entity) {
            console.error('Usage: mercato scaffold crud <moduleId> <EntityClass> [routeSegment]')
            return
          }
          const baseDir = path.resolve('src/modules', mod, 'api', routeSeg)
          fs.mkdirSync(baseDir, { recursive: true })
          const entitySnake = entity.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
          const tmpl = `import { z } from 'zod'\nimport { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'\nimport { ${entity} } from '@open-mercato/shared/modules/${mod}/data/entities'\nimport { E } from '#generated/entities.ids.generated'\nimport ceEntities from '@open-mercato/shared/modules/${mod}/ce'\nimport { buildCustomFieldSelectorsForEntity, extractCustomFieldsFromItem, buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'\nimport type { CustomFieldSet } from '@open-mercato/shared/modules/entities'\n\n// Field constants - update these based on your entity's actual fields\nconst F = {\n  id: 'id',\n  tenant_id: 'tenant_id',\n  organization_id: 'organization_id',\n  created_at: 'created_at',\n  updated_at: 'updated_at',\n  deleted_at: 'deleted_at',\n} as const\n\nconst querySchema = z.object({\n  id: z.string().uuid().optional(),\n  page: z.coerce.number().min(1).default(1),\n  pageSize: z.coerce.number().min(1).max(100).default(50),\n  sortField: z.string().optional().default('id'),\n  sortDir: z.enum(['asc','desc']).optional().default('asc'),\n  withDeleted: z.coerce.boolean().optional().default(false),\n}).passthrough()\n\nconst createSchema = z.object({}).passthrough()\nconst updateSchema = z.object({ id: z.string().uuid() }).passthrough()\n\ntype Query = z.infer<typeof querySchema>\n\nconst fieldSets: CustomFieldSet[] = []\nconst ceEntity = Array.isArray(ceEntities) ? ceEntities.find((entity) => entity?.id === '${mod}:${entitySnake}') : undefined\nif (ceEntity?.fields?.length) {\n  fieldSets.push({ entity: ceEntity.id, fields: ceEntity.fields, source: '${mod}' })\n}\n\nconst cfSel = buildCustomFieldSelectorsForEntity(E.${mod}.${entitySnake}, fieldSets)\nconst sortFieldMap: Record<string, unknown> = { id: F.id, created_at: F.created_at, ...Object.fromEntries(cfSel.keys.map(k => [\`cf_\${k}\`, \`cf:\${k}\`])) }\n\nexport const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({\n  metadata: { GET: { requireAuth: true }, POST: { requireAuth: true }, PUT: { requireAuth: true }, DELETE: { requireAuth: true } },\n  orm: { entity: ${entity}, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },\n  events: { module: '${mod}', entity: '${entitySnake}', persistent: true },\n  indexer: { entityType: E.${mod}.${entitySnake} },\n  list: {\n    schema: querySchema,\n    entityId: E.${mod}.${entitySnake},\n    fields: [F.id, F.created_at, ...cfSel.selectors],\n    sortFieldMap,\n    buildFilters: async (q: Query, ctx) => ({\n      ...(await buildCustomFieldFiltersFromQuery({\n        entityId: E.${mod}.${entitySnake},\n        query: q as any,\n        em: ctx.container.resolve('em'),\n        tenantId: ctx.auth!.tenantId,\n      })),\n    }),\n    transformItem: (item: any) => ({ id: item.id, created_at: item.created_at, ...extractCustomFieldsFromItem(item, cfSel.keys) }),\n  },\n  create: { schema: createSchema, mapToEntity: (input: any) => ({}), customFields: { enabled: true, entityId: E.${mod}.${entitySnake}, pickPrefixed: true } },\n  update: { schema: updateSchema, applyToEntity: (entity: ${entity}, input: any) => {}, customFields: { enabled: true, entityId: E.${mod}.${entitySnake}, pickPrefixed: true } },\n  del: { idFrom: 'query', softDelete: true },\n})\n`
          const file = path.join(baseDir, 'route.ts')
          fs.writeFileSync(file, tmpl, { flag: 'wx' })
          console.log(`Created CRUD route: ${path.relative(process.cwd(), file)}`)
          execSync('yarn modules:prepare', { stdio: 'inherit' })
        },
      },
    ],
  } as any)

  // Built-in CLI module: generate
  all.push({
    id: 'generate',
    cli: [
      {
        command: 'all',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateEntityIds, generateModuleRegistry, generateModuleRegistryCli, generateModuleEntities, generateModuleDi, generateOpenApi } = await import('./lib/generators')
          const resolver = createResolver()
          const quiet = args.includes('--quiet') || args.includes('-q')

          console.log('Running all generators...')
          await generateEntityIds({ resolver, quiet })
          await generateModuleRegistry({ resolver, quiet })
          await generateModuleRegistryCli({ resolver, quiet })
          await generateModuleEntities({ resolver, quiet })
          await generateModuleDi({ resolver, quiet })
          await generateOpenApi({ resolver, quiet })
          console.log('All generators completed.')
        },
      },
      {
        command: 'entity-ids',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateEntityIds } = await import('./lib/generators')
          const resolver = createResolver()
          await generateEntityIds({ resolver, quiet: args.includes('--quiet') })
        },
      },
      {
        command: 'registry',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateModuleRegistry } = await import('./lib/generators')
          const resolver = createResolver()
          await generateModuleRegistry({ resolver, quiet: args.includes('--quiet') })
        },
      },
      {
        command: 'entities',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateModuleEntities } = await import('./lib/generators')
          const resolver = createResolver()
          await generateModuleEntities({ resolver, quiet: args.includes('--quiet') })
        },
      },
      {
        command: 'di',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { generateModuleDi } = await import('./lib/generators')
          const resolver = createResolver()
          await generateModuleDi({ resolver, quiet: args.includes('--quiet') })
        },
      },
    ],
  } as any)

  // Built-in CLI module: db
  all.push({
    id: 'db',
    cli: [
      {
        command: 'generate',
        run: async () => {
          const { createResolver } = await import('./lib/resolver')
          const { dbGenerate } = await import('./lib/db')
          const resolver = createResolver()
          await dbGenerate(resolver)
        },
      },
      {
        command: 'migrate',
        run: async () => {
          const { createResolver } = await import('./lib/resolver')
          const { dbMigrate } = await import('./lib/db')
          const resolver = createResolver()
          await dbMigrate(resolver)
        },
      },
      {
        command: 'greenfield',
        run: async (args: string[]) => {
          const { createResolver } = await import('./lib/resolver')
          const { dbGreenfield } = await import('./lib/db')
          const resolver = createResolver()
          const yes = args.includes('--yes') || args.includes('-y')
          await dbGreenfield(resolver, { yes })
        },
      },
    ],
  } as any)

  // Built-in CLI module: server (runs Next.js + workers)
  all.push({
    id: 'server',
    cli: [
      {
        command: 'dev',
        run: async () => {
          const { spawn } = await import('child_process')
          const path = await import('path')
          const { createResolver } = await import('./lib/resolver')
          const resolver = createResolver()
          const appDir = resolver.getAppDir()

          // In monorepo, packages are hoisted to root; in standalone, they're in app's node_modules
          const nodeModulesBase = resolver.isMonorepo() ? resolver.getRootDir() : appDir

          const processes: ChildProcess[] = []
          const autoSpawnWorkers = process.env.AUTO_SPAWN_WORKERS !== 'false'

          function cleanup() {
            console.log('[server] Shutting down...')
            for (const proc of processes) {
              if (!proc.killed) {
                proc.kill('SIGTERM')
              }
            }
          }

          process.on('SIGTERM', cleanup)
          process.on('SIGINT', cleanup)

          console.log('[server] Starting Open Mercato in dev mode...')

          // Resolve paths relative to where node_modules are located
          const nextBin = path.join(nodeModulesBase, 'node_modules/next/dist/bin/next')
          const mercatoBin = path.join(nodeModulesBase, 'node_modules/@open-mercato/cli/bin/mercato')

          // Start Next.js dev
          const nextProcess = spawn('node', [nextBin, 'dev', '--turbopack'], {
            stdio: 'inherit',
            env: process.env,
            cwd: appDir,
          })
          processes.push(nextProcess)

          // Start workers if enabled
          if (autoSpawnWorkers) {
            console.log('[server] Starting workers for all queues...')
            const workerProcess = spawn('node', [mercatoBin, 'queue', 'worker', '--all'], {
              stdio: 'inherit',
              env: process.env,
              cwd: appDir,
            })
            processes.push(workerProcess)
          }

          // Wait for any process to exit
          await Promise.race(
            processes.map(
              (proc) =>
                new Promise<void>((resolve) => {
                  proc.on('exit', () => resolve())
                })
            )
          )

          cleanup()
        },
      },
      {
        command: 'start',
        run: async () => {
          const { spawn } = await import('child_process')
          const path = await import('path')
          const { createResolver } = await import('./lib/resolver')
          const resolver = createResolver()
          const appDir = resolver.getAppDir()

          // In monorepo, packages are hoisted to root; in standalone, they're in app's node_modules
          const nodeModulesBase = resolver.isMonorepo() ? resolver.getRootDir() : appDir

          const processes: ChildProcess[] = []
          const autoSpawnWorkers = process.env.AUTO_SPAWN_WORKERS !== 'false'

          function cleanup() {
            console.log('[server] Shutting down...')
            for (const proc of processes) {
              if (!proc.killed) {
                proc.kill('SIGTERM')
              }
            }
          }

          process.on('SIGTERM', cleanup)
          process.on('SIGINT', cleanup)

          console.log('[server] Starting Open Mercato in production mode...')

          // Resolve paths relative to where node_modules are located
          const nextBin = path.join(nodeModulesBase, 'node_modules/next/dist/bin/next')
          const mercatoBin = path.join(nodeModulesBase, 'node_modules/@open-mercato/cli/bin/mercato')

          // Start Next.js production server
          const nextProcess = spawn('node', [nextBin, 'start'], {
            stdio: 'inherit',
            env: process.env,
            cwd: appDir,
          })
          processes.push(nextProcess)

          // Start workers if enabled
          if (autoSpawnWorkers) {
            console.log('[server] Starting workers for all queues...')
            const workerProcess = spawn('node', [mercatoBin, 'queue', 'worker', '--all'], {
              stdio: 'inherit',
              env: process.env,
              cwd: appDir,
            })
            processes.push(workerProcess)
          }

          // Wait for any process to exit
          await Promise.race(
            processes.map(
              (proc) =>
                new Promise<void>((resolve) => {
                  proc.on('exit', () => resolve())
                })
            )
          )

          cleanup()
        },
      },
    ],
  } as any)

  if (appCli.length) all.push({ id: 'app', cli: appCli } as any)

  const quietBanner = process.env.OM_CLI_QUIET === '1'
  const banner = '🧩 Open Mercato CLI'
  if (!quietBanner) {
    const header = [
      '╔═══════════════════════╗',
      `║  ${banner.padEnd(21)}║`,
      '╚═══════════════════════╝',
    ].join('\n')
    console.log(header)
  }
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
    return 0
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

  console.log('')
  const started = Date.now()
  console.log(`🚀 Running ${modName}:${cmdName} ${rest.join(' ')}`)
  try {
    await cmd.run(rest)
    const ms = Date.now() - started
    console.log(`⏱️ Done in ${ms}ms`)
    return 0
  } catch (e: any) {
    console.error(`💥 Failed: ${e?.message || e}`)
    return 1
  }
}
