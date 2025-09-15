#!/usr/bin/env tsx
import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'
import { MikroORM } from '@mikro-orm/core'
import { Migrator } from '@mikro-orm/migrations'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { loadEnabledModules, moduleFsRoots, type ModuleEntry } from './shared/modules-config'

type Cmd = 'generate' | 'apply'

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
        const importBase = fromApp ? `@/app/modules/${modId}` : `${entry.from || '@open-mercato/core'}/modules/${modId}`
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
  // Ensure 'directory' runs first, as others may reference its tables
  return mods.slice().sort((a, b) => (a.id === 'directory' ? -1 : b.id === 'directory' ? 1 : a.id.localeCompare(b.id)))
}

async function run(cmd: Cmd) {
  const modules = loadEnabledModules()
  const ordered = sortModules(modules)
  const results: string[] = []
  for (const entry of ordered) {
    const modId = entry.id
    const entities = await loadModuleEntities(entry)
    if (!entities.length) continue
    // Always write migrations into app overlay to avoid mutating core packages
    const migrationsPath = path.join('src/modules', modId, 'migrations')
    fs.mkdirSync(migrationsPath, { recursive: true })
    const orm = await MikroORM.init<PostgreSqlDriver>({
      driver: PostgreSqlDriver,
      clientUrl: getClientUrl(),
      entities,
      migrations: {
        path: migrationsPath,
        glob: '!(*.d).{ts,js}',
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

const [, , sub] = process.argv
if (sub !== 'generate' && sub !== 'apply') {
  console.log('Usage: mikro-modules <generate|apply>')
  process.exit(1)
}
run(sub as Cmd).catch((e) => { console.error(e); process.exit(1) })
