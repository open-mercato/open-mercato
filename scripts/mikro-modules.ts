#!/usr/bin/env tsx
import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'
import { MikroORM } from '@mikro-orm/core'
import { Migrator } from '@mikro-orm/migrations'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'

const modulesRoot = path.resolve('src/modules')

type Cmd = 'generate' | 'apply'

async function loadModuleEntities(modId: string) {
  // Prefer entities.ts, fallback to schema.ts for compatibility
  const base = path.join(modulesRoot, modId, 'db')
  const candidates = ['entities.ts', 'schema.ts']
  for (const f of candidates) {
    const p = path.join(base, f)
    if (fs.existsSync(p)) {
      const mod = await import(pathToImport(`@/modules/${modId}/db/${f.replace(/\.ts$/, '')}`))
      const entities = Object.values(mod).filter(v => typeof v === 'function')
      if (entities.length) return entities as any[]
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

function sortModules(mods: string[]) {
  // Ensure 'directory' runs first, as others may reference its tables
  return mods.slice().sort((a, b) => (a === 'directory' ? -1 : b === 'directory' ? 1 : a.localeCompare(b)))
}

async function run(cmd: Cmd) {
  const modules = fs.readdirSync(modulesRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)
  const ordered = sortModules(modules)
  const results: string[] = []
  for (const modId of ordered) {
    const entities = await loadModuleEntities(modId)
    if (!entities.length) continue
    const migrationsPath = path.join(modulesRoot, modId, 'migrations')
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
