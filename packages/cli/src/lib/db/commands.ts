import path from 'node:path'
import fs from 'node:fs'
import { MikroORM, type Logger } from '@mikro-orm/core'
import { Migrator } from '@mikro-orm/migrations'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import type { PackageResolver, ModuleEntry } from '../resolver'

const QUIET_MODE = process.env.OM_CLI_QUIET === '1' || process.env.MERCATO_QUIET === '1'
const PROGRESS_EMOJI = ''

function formatResult(modId: string, message: string, emoji = '•') {
  return `${emoji} ${modId}: ${message}`
}

function createProgressRenderer(total: number) {
  const width = 20
  const normalizedTotal = total > 0 ? total : 1
  return (current: number) => {
    const clamped = Math.min(Math.max(current, 0), normalizedTotal)
    const filled = Math.round((clamped / normalizedTotal) * width)
    const bar = `${'='.repeat(filled)}${'.'.repeat(Math.max(width - filled, 0))}`
    return `[${bar}] ${clamped}/${normalizedTotal}`
  }
}

function createMinimalLogger(): Logger {
  return {
    log: () => {},
    error: (_namespace, message) => console.error(message),
    warn: (_namespace, message) => {
      if (!QUIET_MODE) console.warn(message)
    },
    logQuery: () => {},
    setDebugMode: () => {},
    isEnabled: () => false,
  }
}

function getClientUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

function sortModules(mods: ModuleEntry[]): ModuleEntry[] {
  // Sort modules alphabetically since they are now isomorphic
  return mods.slice().sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Sanitizes a module ID for use in SQL identifiers (table names).
 * Replaces non-alphanumeric characters with underscores to prevent SQL injection.
 * @public Exported for testing
 */
export function sanitizeModuleId(modId: string): string {
  return modId.replace(/[^a-z0-9_]/gi, '_')
}

/**
 * Validates that a table name is safe for use in SQL queries.
 * @throws Error if the table name contains invalid characters.
 * @public Exported for testing
 */
export function validateTableName(tableName: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}. Table names must start with a letter or underscore and contain only alphanumeric characters and underscores.`)
  }
}

async function loadModuleEntities(entry: ModuleEntry, resolver: PackageResolver): Promise<any[]> {
  const roots = resolver.getModulePaths(entry)
  const imps = resolver.getModuleImportBase(entry)
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
        const importBase = fromApp ? imps.appBase : imps.pkgBase
        const mod = await import(`${importBase}/${sub}/${f.replace(/\.ts$/, '')}`)
        const entities = Object.values(mod).filter((v) => typeof v === 'function')
        if (entities.length) return entities as any[]
      }
    }
  }
  return []
}

function getMigrationsPath(entry: ModuleEntry, resolver: PackageResolver): string {
  const from = entry.from || '@open-mercato/core'
  let pkgModRoot: string

  if (from === '@open-mercato/core') {
    pkgModRoot = path.join(resolver.getRootDir(), 'packages/core/src/modules', entry.id)
  } else if (/^@open-mercato\//.test(from)) {
    const segs = from.split('/')
    if (segs.length > 1 && segs[1]) {
      pkgModRoot = path.join(resolver.getRootDir(), `packages/${segs[1]}/src/modules`, entry.id)
    } else {
      pkgModRoot = path.join(resolver.getRootDir(), 'packages/core/src/modules', entry.id)
    }
  } else if (from === '@app') {
    pkgModRoot = path.join(resolver.getRootDir(), 'src/modules', entry.id)
  } else {
    pkgModRoot = path.join(resolver.getRootDir(), 'packages/core/src/modules', entry.id)
  }

  return path.join(pkgModRoot, 'migrations')
}

export interface DbOptions {
  quiet?: boolean
}

export interface GreenfieldOptions extends DbOptions {
  yes: boolean
}

export async function dbGenerate(resolver: PackageResolver, options: DbOptions = {}): Promise<void> {
  const modules = resolver.loadEnabledModules()
  const ordered = sortModules(modules)
  const results: string[] = []

  for (const entry of ordered) {
    const modId = entry.id
    const sanitizedModId = sanitizeModuleId(modId)
    const entities = await loadModuleEntities(entry, resolver)
    if (!entities.length) continue

    const migrationsPath = getMigrationsPath(entry, resolver)
    fs.mkdirSync(migrationsPath, { recursive: true })

    const tableName = `mikro_orm_migrations_${sanitizedModId}`
    validateTableName(tableName)

    const orm = await MikroORM.init<PostgreSqlDriver>({
      driver: PostgreSqlDriver,
      clientUrl: getClientUrl(),
      loggerFactory: () => createMinimalLogger(),
      entities,
      migrations: {
        path: migrationsPath,
        glob: '!(*.d).{ts,js}',
        tableName,
        dropTables: false,
      },
      schemaGenerator: {
        disableForeignKeys: true,
      },
      pool: {
        min: 1,
        max: 3,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,
        destroyTimeoutMillis: 30000,
      },
    })

    const migrator = orm.getMigrator() as Migrator
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
        content = content.replace(
          /export class (Migration\d+)/,
          `export class $1_${modId.replace(/[^a-zA-Z0-9]/g, '_')}`
        )
        fs.writeFileSync(newPath, content, 'utf8')
        if (newPath !== orig) fs.unlinkSync(orig)
        results.push(formatResult(modId, `generated ${newBase}`, ''))
      } catch {
        results.push(formatResult(modId, `generated ${path.basename(diff.fileName)} (rename failed)`, ''))
      }
    } else {
      results.push(formatResult(modId, 'no changes', ''))
    }

    await orm.close(true)
  }

  console.log(results.join('\n'))
}

export async function dbMigrate(resolver: PackageResolver, options: DbOptions = {}): Promise<void> {
  const modules = resolver.loadEnabledModules()
  const ordered = sortModules(modules)
  const results: string[] = []

  for (const entry of ordered) {
    const modId = entry.id
    const sanitizedModId = sanitizeModuleId(modId)
    const entities = await loadModuleEntities(entry, resolver)
    if (!entities.length) continue

    const migrationsPath = getMigrationsPath(entry, resolver)
    fs.mkdirSync(migrationsPath, { recursive: true })

    const tableName = `mikro_orm_migrations_${sanitizedModId}`
    validateTableName(tableName)

    const orm = await MikroORM.init<PostgreSqlDriver>({
      driver: PostgreSqlDriver,
      clientUrl: getClientUrl(),
      loggerFactory: () => createMinimalLogger(),
      entities,
      migrations: {
        path: migrationsPath,
        glob: '!(*.d).{ts,js}',
        tableName,
        dropTables: false,
      },
      schemaGenerator: {
        disableForeignKeys: true,
      },
      pool: {
        min: 1,
        max: 3,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,
        destroyTimeoutMillis: 30000,
      },
    })

    const migrator = orm.getMigrator() as Migrator
    const pending = await migrator.getPendingMigrations()
    if (!pending.length) {
      results.push(formatResult(modId, 'no pending migrations', ''))
    } else {
      const renderProgress = createProgressRenderer(pending.length)
      let applied = 0
      if (!QUIET_MODE) {
        process.stdout.write(`   ${PROGRESS_EMOJI} ${modId}: ${renderProgress(applied)}`)
      }
      for (const migration of pending) {
        const migrationName =
          typeof migration === 'string'
            ? migration
            : (migration as any).name ?? (migration as any).fileName
        await migrator.up(migrationName ? { migrations: [migrationName] } : undefined)
        applied += 1
        if (!QUIET_MODE) {
          process.stdout.write(`\r   ${PROGRESS_EMOJI} ${modId}: ${renderProgress(applied)}`)
        }
      }
      if (!QUIET_MODE) process.stdout.write('\n')
      results.push(
        formatResult(modId, `${pending.length} migration${pending.length === 1 ? '' : 's'} applied`, '')
      )
    }

    await orm.close(true)
  }

  console.log(results.join('\n'))
}

export async function dbGreenfield(resolver: PackageResolver, options: GreenfieldOptions): Promise<void> {
  if (!options.yes) {
    console.error('This command will DELETE all data. Use --yes to confirm.')
    process.exit(1)
  }

  console.log('Cleaning up migrations and snapshots for greenfield setup...')

  const modules = resolver.loadEnabledModules()
  const ordered = sortModules(modules)
  const results: string[] = []
  const outputDir = resolver.getOutputDir()

  for (const entry of ordered) {
    const modId = entry.id
    const migrationsPath = getMigrationsPath(entry, resolver)

    if (fs.existsSync(migrationsPath)) {
      // Remove all migration files
      const migrationFiles = fs
        .readdirSync(migrationsPath)
        .filter((file) => file.endsWith('.ts') && file.startsWith('Migration'))

      for (const file of migrationFiles) {
        fs.unlinkSync(path.join(migrationsPath, file))
      }

      // Remove snapshot files
      const snapshotFiles = fs
        .readdirSync(migrationsPath)
        .filter((file) => file.endsWith('.json') && file.includes('snapshot'))

      for (const file of snapshotFiles) {
        fs.unlinkSync(path.join(migrationsPath, file))
      }

      if (migrationFiles.length > 0 || snapshotFiles.length > 0) {
        results.push(
          formatResult(modId, `cleaned ${migrationFiles.length} migrations, ${snapshotFiles.length} snapshots`, '')
        )
      } else {
        results.push(formatResult(modId, 'already clean', ''))
      }
    } else {
      results.push(formatResult(modId, 'no migrations directory', ''))
    }

    // Clean up checksum files using glob pattern
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir)
      const checksumFiles = files.filter((file) => file.endsWith('.checksum'))

      for (const file of checksumFiles) {
        fs.unlinkSync(path.join(outputDir, file))
      }

      if (checksumFiles.length > 0) {
        results.push(formatResult(modId, `cleaned ${checksumFiles.length} checksum files`, ''))
      }
    }
  }

  console.log(results.join('\n'))

  // Drop per-module MikroORM migration tables to ensure clean slate
  console.log('Dropping per-module migration tables...')
  try {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: getClientUrl() })
    await client.connect()
    try {
      await client.query('BEGIN')
      for (const entry of ordered) {
        const modId = entry.id
        const sanitizedModId = sanitizeModuleId(modId)
        const tableName = `mikro_orm_migrations_${sanitizedModId}`
        validateTableName(tableName)
        await client.query(`DROP TABLE IF EXISTS "${tableName}"`)
        console.log(`   ${modId}: dropped table ${tableName}`)
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      try {
        await client.end()
      } catch {}
    }
  } catch (e) {
    console.error('Failed to drop migration tables:', (e as any)?.message || e)
    throw e
  }

  // Drop all existing user tables to ensure fresh CREATE-only migrations
  console.log('Dropping ALL public tables for true greenfield...')
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
      try {
        await client.end()
      } catch {}
    }
  } catch (e) {
    console.error('Failed to drop public tables:', (e as any)?.message || e)
    throw e
  }

  // Generate fresh migrations for all modules
  console.log('Generating fresh migrations for all modules...')
  await dbGenerate(resolver)

  // Apply migrations
  console.log('Applying migrations...')
  await dbMigrate(resolver)

  console.log('Greenfield reset complete! Fresh migrations generated and applied.')
}
