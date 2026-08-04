import fs from 'node:fs'
import path from 'node:path'
import { enabledModules } from '../modules'

// A `entry.overrides.acl.features` key that no enabled module declares is silently
// skipped by `applyModuleOverridesToModules` and logs a stale-override warning on every
// module registration (including each HMR pass in dev). Worse, an integration test that
// asserts such a feature is denied passes vacuously — the feature never existed. Keep
// every live ACL override key anchored to a declared feature.

// Resolved from this file rather than `process.cwd()`, so the guard behaves the same
// whether jest is invoked from the app workspace or the repository root.
const APP_ROOT = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')

const SOURCE_ROOTS = [
  path.join(APP_ROOT, 'src', 'modules'),
  path.join(REPO_ROOT, 'packages'),
]

// `packages/create-app/template` mirrors app modules that this app does not register,
// so its declarations must not vouch for an override key here.
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.mercato', 'template'])

function findAclFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
        continue
      }
      if (entry.name === 'acl.ts') found.push(abs)
    }
  }
  walk(root)
  return found
}

function collectDeclaredFeatureIds(): Set<string> {
  const ids = new Set<string>()
  const idPattern = /(?:^|[\s{,])id:\s*'([^']+)'|^\s*'([^']+)',?\s*$/gm
  for (const root of SOURCE_ROOTS) {
    for (const file of findAclFiles(root)) {
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(idPattern)) {
        const id = match[1] ?? match[2]
        if (id && id.includes('.')) ids.add(id)
      }
    }
  }
  return ids
}

describe('module ACL feature overrides', () => {
  it('only nulls or replaces features that a module actually declares', () => {
    const declared = collectDeclaredFeatureIds()
    expect(declared.size).toBeGreaterThan(0)

    const stale: string[] = []
    for (const entry of enabledModules) {
      const overrides = entry.overrides?.acl?.features
      if (!overrides) continue
      for (const key of Object.keys(overrides)) {
        if (!declared.has(key)) stale.push(`${entry.id}: ${key}`)
      }
    }

    expect(stale).toEqual([])
  })
})
