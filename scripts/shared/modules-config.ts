import path from 'node:path'
import fs from 'node:fs'

export type ModuleEntry = { id: string; from?: '@mercato-core' | '@app' | string }

export function loadEnabledModules(): ModuleEntry[] {
  const cfgPath = path.resolve('src/modules.ts')
  if (fs.existsSync(cfgPath)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
  if (!from || from === '@mercato-core') return path.resolve('packages/core/src/modules')
  // Support other local packages like '@mercato-example' => packages/example/src/modules
  const m = from.match(/^@mercato-(.+)$/)
  if (m) return path.resolve(`packages/${m[1]}/src/modules`)
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
  const from = entry.from || '@mercato-core'
  return { appBase: `@/modules/${entry.id}`, pkgBase: `${from}/modules/${entry.id}` }
}
