#!/usr/bin/env tsx
import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'
import { MikroORM } from '@mikro-orm/core'
import { Migrator } from '@mikro-orm/migrations'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { loadEnabledModules, moduleFsRoots, moduleImportBase, type ModuleEntry } from './shared/modules-config'

type Cmd = 'generate' | 'apply' | 'greenfield'

async function loadModuleEntities(entry: ModuleEntry) {
  const modId = entry.id
  // Prefer app overrides, then core; data/, fallback to legacy db/
  const roots = moduleFsRoots(entry)
  const bases = [
    path.join(roots.appBase, 'data'),
    path.join(roots.pkgBase, 'data'),
    path.join(roots.appBase, 'db'),
    path.join(roots.pkgBase, 'db'),
  ]
  const candidates = ['entities.ts', 'schema.ts']
  for (const base of bases) {
    for (const f of candidates) {
      const p = path.join(base, f)
      if (fs.existsSync(p)) {
        const sub = path.basename(base)
        const fromApp = base.startsWith(roots.appBase)
        const imps = moduleImportBase(entry)
        const importBase = fromApp ? imps.appBase : imps.pkgBase
        const mod = await import(pathToImport(`${importBase}/${sub}/${f.replace(/\.ts$/, '')}`))
        const entities = Object.values(mod).filter(v => typeof v === 'function')
        if (entities.length) return entities as any[]
      }
    }
  }
  return []
}

function pathToImport(p: string) { return p }

function getClientUrl() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

function sortModules(mods: ModuleEntry[]) {
  // Sort modules alphabetically since they are now isomorphic
  return mods.slice().sort((a, b) => a.id.localeCompare(b.id))
}

async function run(cmd: Cmd) {
  if (cmd === 'greenfield') {
    return await runGreenfield()
  }
  
  const modules = loadEnabledModules()
  const ordered = sortModules(modules)
  const results: string[] = []
  
  for (const entry of ordered) {
    const modId = entry.id
    const entities = await loadModuleEntities(entry)
    if (!entities.length) continue
    
    // Write migrations into the module's package when available; fallback to app overlay for @app modules
    const from = entry.from || '@open-mercato/core'
    let pkgModRoot: string
    if (from === '@open-mercato/core') {
      pkgModRoot = path.join('packages/core/src/modules', modId)
    } else if (/^@open-mercato\//.test(from)) {
      const segs = from.split('/')
      if (segs.length > 1 && segs[1]) {
        pkgModRoot = path.join(`packages/${segs[1]}/src/modules`, modId)
      } else {
        // fallback for malformed @open-mercato/ value
        pkgModRoot = path.join('packages/core/src/modules', modId)
      }
    } else if (from === '@app') {
      pkgModRoot = path.join('src/modules', modId)
    } else {
      pkgModRoot = path.join('packages/core/src/modules', modId)
    }
    const migrationsPath = path.join(pkgModRoot, 'migrations')
    fs.mkdirSync(migrationsPath, { recursive: true })
    
    const orm = await MikroORM.init<PostgreSqlDriver>({
      driver: PostgreSqlDriver,
      clientUrl: getClientUrl(),
      entities,
      migrations: {
        path: migrationsPath,
        glob: '!(*.d).{ts,js}',
        tableName: `mikro_orm_migrations_${modId}`,
      },
      schemaGenerator: {
        disableForeignKeys: true,
      },
      // Connection pooling for migrations
      pool: {
        min: 1,
        max: 3,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,
        destroyTimeoutMillis: 30000,
      },
    })
    
    const migrator = orm.getMigrator() as Migrator
    if (cmd === 'generate') {
      const diff = await migrator.createMigration()
      if (diff && diff.fileName) {
        try {
          const orig = diff.fileName
          const base = path.basename(orig)
          const dir = path.dirname(orig)
          const ext = path.extname(base)
          const stem = base.replace(ext, '')
          const suffix = `_${modId}`
          const newBase = stem.endsWith(suffix) ? base : `${stem}${suffix}${ext}`
          const newPath = path.join(dir, newBase)
          let content = fs.readFileSync(orig, 'utf8')
          // Rename class to ensure uniqueness as well
          content = content.replace(/export class (Migration\d+)/, `export class $1_${modId.replace(/[^a-zA-Z0-9]/g, '_')}`)
          fs.writeFileSync(newPath, content, 'utf8')
          if (newPath !== orig) fs.unlinkSync(orig)
          results.push(`${modId}: generated ${newBase}`)
        } catch (e) {
          results.push(`${modId}: generated ${path.basename(diff.fileName)} (rename failed)`)  
        }
      } else {
        results.push(`${modId}: no changes`)
      }
    } else if (cmd === 'apply') {
      await migrator.up()
      results.push(`${modId}: applied`)
    }
    await orm.close(true)
  }
  console.log(results.join('\n'))
}

async function runGreenfield() {
  console.log('🧹 Cleaning up migrations and snapshots for greenfield setup...')
  
  const modules = loadEnabledModules()
  const ordered = sortModules(modules)
  const results: string[] = []
  
  for (const entry of ordered) {
    const modId = entry.id
    const from = entry.from || '@open-mercato/core'
    let pkgModRoot: string
    
    // Use the same logic as the main migration functions to handle all packages
    if (from === '@open-mercato/core') {
      pkgModRoot = path.join('packages/core/src/modules', modId)
    } else if (/^@open-mercato\//.test(from)) {
      const segs = from.split('/')
      if (segs.length > 1 && segs[1]) {
        pkgModRoot = path.join(`packages/${segs[1]}/src/modules`, modId)
      } else {
        // fallback for malformed @open-mercato/ value
        pkgModRoot = path.join('packages/core/src/modules', modId)
      }
    } else if (from === '@app') {
      pkgModRoot = path.join('src/modules', modId)
    } else {
      pkgModRoot = path.join('packages/core/src/modules', modId)
    }
    
    const migrationsPath = path.join(pkgModRoot, 'migrations')
    
    if (fs.existsSync(migrationsPath)) {
      // Remove all migration files
      const migrationFiles = fs.readdirSync(migrationsPath)
        .filter(file => file.endsWith('.ts') && file.startsWith('Migration'))
      
      for (const file of migrationFiles) {
        fs.unlinkSync(path.join(migrationsPath, file))
      }
      
      // Remove snapshot files
      const snapshotFiles = fs.readdirSync(migrationsPath)
        .filter(file => file.endsWith('.json') && file.includes('snapshot'))
      
      for (const file of snapshotFiles) {
        fs.unlinkSync(path.join(migrationsPath, file))
      }
      
      if (migrationFiles.length > 0 || snapshotFiles.length > 0) {
        results.push(`${modId}: cleaned ${migrationFiles.length} migrations, ${snapshotFiles.length} snapshots`)
      } else {
        results.push(`${modId}: already clean`)
      }
      } else {
        results.push(`${modId}: no migrations directory`)
      }
            
            // Clean up checksum files using glob pattern
            const generatedDir = 'generated'
            if (fs.existsSync(generatedDir)) {
              const files = fs.readdirSync(generatedDir)
              const checksumFiles = files.filter(file => file.endsWith('.checksum'))
              
              for (const file of checksumFiles) {
                fs.unlinkSync(path.join(generatedDir, file))
              }
              
              if (checksumFiles.length > 0) {
                results.push(`${modId}: cleaned ${checksumFiles.length} checksum files`)
              }
            }
  }
  
  console.log(results.join('\n'))

  // Drop per-module MikroORM migration tables to ensure clean slate
  console.log('🧨 Dropping per-module migration tables...')
  try {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: getClientUrl() })
    await client.connect()
    try {
      await client.query('BEGIN')
      for (const entry of ordered) {
        const modId = entry.id
        const tableName = `mikro_orm_migrations_${modId}`
        await client.query(`DROP TABLE IF EXISTS "${tableName}"`)
        console.log(`   ${modId}: dropped table ${tableName}`)
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      try { await client.end() } catch {}
    }
  } catch (e) {
    console.error('❌ Failed to drop migration tables:', (e as any)?.message || e)
    throw e
  }

  // Drop all existing user tables to ensure fresh CREATE-only migrations
  console.log('🧨 Dropping ALL public tables for true greenfield...')
  try {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: getClientUrl() })
    await client.connect()
    try {
      const res = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
      const tables: string[] = (res.rows || []).map((r: any) => String(r.tablename))
      if (tables.length) {
        await client.query('BEGIN')
        try {
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
      } else {
        console.log('   No tables found to drop.')
      }
    } finally {
      try { await client.end() } catch {}
    }
  } catch (e) {
    console.error('❌ Failed to drop public tables:', (e as any)?.message || e)
    throw e
  }

  // Generate fresh migrations for all modules
  console.log('🗄️  Generating fresh migrations for all modules...')
  await run('generate')

  // Apply migrations
  console.log('📊 Applying migrations...')
  await run('apply')

  console.log('✅ Greenfield reset complete! Fresh migrations generated and applied.')
}

const [, , sub] = process.argv
if (sub !== 'generate' && sub !== 'apply' && sub !== 'greenfield') {
  console.log('Usage: mikro-modules <generate|apply|greenfield>')
  process.exit(1)
}
run(sub as Cmd).catch((e) => { console.error(e); process.exit(1) })
