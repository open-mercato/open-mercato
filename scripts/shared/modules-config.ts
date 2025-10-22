import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

export type ModuleEntry = { id: string; from?: '@open-mercato/core' | '@app' | string }

export function loadEnabledModules(): ModuleEntry[] {
  const require = createRequire(import.meta.url)
  const cfgPath = path.resolve('src/modules.ts')
  if (fs.existsSync(cfgPath)) {
    const mod = require(cfgPath)
    const list = (mod.enabledModules || mod.default || []) as ModuleEntry[]
    if (Array.isArray(list) && list.length) return list
  }
  // Fallback: scan src/modules/* to keep backward compatibility
  const modulesRoot = path.resolve('src/modules')
  if (!fs.existsSync(modulesRoot)) return []
  return fs
    .readdirSync(modulesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ id: e.name, from: '@app' }))
}

function pkgDirFor(from?: string) {
  if (!from || from === '@open-mercato/core') return path.resolve('packages/core/src/modules')
  // Support other local packages like '@open-mercato/example' => packages/example/src/modules
  const m = from.match(/^@open-mercato\/(.+)$/)
  if (m) {
    const raw = path.resolve(`packages/${m[1]}/src/modules`)
    if (fs.existsSync(raw)) return raw
    const underscored = path.resolve(`packages/${m[1].replace(/-/g, '_')}/src/modules`)
    if (fs.existsSync(underscored)) return underscored
    return raw
  }
  // Fallback to core modules path
  return path.resolve('packages/core/src/modules')
}

export function moduleFsRoots(entry: ModuleEntry) {
  const appBase = path.resolve('src/modules', entry.id)
  const pkgModulesRoot = pkgDirFor(entry.from)
  const pkgBase = path.join(pkgModulesRoot, entry.id)
  return { appBase, pkgBase }
}

export function moduleImportBase(entry: ModuleEntry) {
  // Prefer @app overrides at import-time; fall back to provided package alias
  const from = entry.from || '@open-mercato/core'
  return { appBase: `@/modules/${entry.id}`, pkgBase: `${from}/modules/${entry.id}` }
}
