import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '../../..')

/** Every private, Enterprise-licensed managed cache package (the shared kit and the three providers). */
export const COMMERCIAL_CACHE_PACKAGES = [
  '@open-mercato/cache-provider-managed-kit',
  '@open-mercato/cache-provider-azure-managed-redis',
  '@open-mercato/cache-provider-aws-elasticache',
  '@open-mercato/cache-provider-google-memorystore',
] as const

type PackageJson = {
  name: string
  private?: boolean
  license?: string
  files?: string[]
  publishConfig?: Record<string, unknown>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

type LockEntry = { deps: string[] }

/** Minimal yarn berry lockfile reader: descriptor -> resolved dependency descriptors. */
function readLockfile(): Map<string, LockEntry> {
  const entries = new Map<string, LockEntry>()
  let current: LockEntry | null = null
  let inDependencies = false
  for (const line of readFileSync(path.join(REPO_ROOT, 'yarn.lock'), 'utf8').split('\n')) {
    if (!line.startsWith(' ') && line.endsWith(':') && !line.startsWith('#')) {
      current = { deps: [] }
      for (const key of line.slice(0, -1).split(', ')) entries.set(key.replace(/^"|"$/g, ''), current)
      inDependencies = false
      continue
    }
    if (!current) continue
    if (line === '  dependencies:') {
      inDependencies = true
      continue
    }
    if (/^ {2}\S/.test(line)) {
      inDependencies = false
      continue
    }
    if (!inDependencies) continue
    const match = line.match(/^ {4}"?([^"]+?)"?: "?([^"]+)"?$/)
    if (match) current.deps.push(`${match[1]}@${match[2].includes(':') ? match[2] : `npm:${match[2]}`}`)
  }
  return entries
}

function closureOf(entries: Map<string, LockEntry>, workspace: string): Set<string> {
  const start = [...entries.keys()].find((key) => key.endsWith(`@workspace:${workspace}`))
  if (!start) throw new Error(`[internal] workspace ${workspace} not in yarn.lock`)
  const names = new Set<string>()
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const key = queue.pop()!
    if (seen.has(key)) continue
    seen.add(key)
    const entry = entries.get(key)
    if (!entry) continue
    names.add(key.replace(/@(npm|workspace|patch|virtual):.*$/, ''))
    queue.push(...entry.deps)
  }
  return names
}

export type CommercialPackagingSuiteOptions = {
  /** Absolute package directory. */
  packageDir: string
  /** Runtime dependencies the package may declare. */
  allowedRuntimeDependencies: string[]
  /** Entries `files` must list besides LICENSE.md, README.md and the test exclusion. */
  requiredFiles?: string[]
}

/**
 * Commercial packaging guard for a managed cache package: private (out of the
 * public publish set), Enterprise-licensed, out of the default app and
 * create-app template and out of every public package's dependency graph.
 */
export function defineCommercialPackagingSuite(options: CommercialPackagingSuiteOptions): void {
  const packageDir = options.packageDir
  const manifest = readJson<PackageJson>(path.join(packageDir, 'package.json'))

  describe(`${manifest.name} commercial packaging`, () => {
    it('is an Enterprise-licensed package excluded from the public publish set', () => {
      expect(COMMERCIAL_CACHE_PACKAGES).toContain(manifest.name)
      expect(manifest.private).toBe(true)
      expect(manifest.license).toBe('SEE LICENSE IN LICENSE.md')
      expect(manifest.publishConfig).toBeUndefined()
      expect(manifest.files).toEqual(expect.arrayContaining(['LICENSE.md', 'README.md', '!src/**/__tests__', ...(options.requiredFiles ?? [])]))
      expect(manifest.files).not.toContain('test-support')
      const license = readFileSync(path.join(packageDir, 'LICENSE.md'), 'utf8')
      expect(license).toBe(readFileSync(path.join(REPO_ROOT, 'packages/enterprise/LICENSE.md'), 'utf8'))
    })

    it('is not listed by the publish script workspace query', () => {
      const output = execFileSync('yarn', ['workspaces', 'list', '--json', '--no-private'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 })
      const published = output.trim().split('\n').map((line) => (JSON.parse(line) as { name: string }).name)
      expect(published).toContain('@open-mercato/cache')
      for (const name of COMMERCIAL_CACHE_PACKAGES) expect(published).not.toContain(name)
    })

    it('is not a dependency of the default app, the create-app template or any public package', () => {
      const appManifest = readFileSync(path.join(REPO_ROOT, 'apps/mercato/package.json'), 'utf8')
      const template = readFileSync(path.join(REPO_ROOT, 'packages/create-app/template/package.json.template'), 'utf8')
      for (const name of COMMERCIAL_CACHE_PACKAGES) {
        expect(appManifest).not.toContain(name)
        expect(template).not.toContain(name)
      }
      for (const dir of readdirSync(path.join(REPO_ROOT, 'packages'))) {
        let other: PackageJson
        try {
          other = readJson<PackageJson>(path.join(REPO_ROOT, 'packages', dir, 'package.json'))
        } catch {
          continue
        }
        if (other.private) continue
        const declared = { ...other.dependencies, ...other.devDependencies, ...other.peerDependencies, ...other.optionalDependencies }
        for (const name of COMMERCIAL_CACHE_PACKAGES) expect([other.name, Object.prototype.hasOwnProperty.call(declared, name)]).toEqual([other.name, false])
      }
    })

    it('stays out of the default app dependency graph resolved in yarn.lock', () => {
      const entries = readLockfile()
      const app = closureOf(entries, 'apps/mercato')
      expect(app.has('@open-mercato/cache')).toBe(true)
      expect(app.size).toBeGreaterThan(100)
      for (const name of COMMERCIAL_CACHE_PACKAGES) expect([name, app.has(name)]).toEqual([name, false])
      expect(app.has('@azure/identity')).toBe(false)
      const own = closureOf(entries, `packages/${path.basename(packageDir)}`)
      expect(own.has(manifest.name)).toBe(true)
    })

    it('declares only its allowed runtime dependencies and the cache host as a peer', () => {
      const runtime = Object.keys(manifest.dependencies ?? {}).sort()
      for (const name of runtime) expect(options.allowedRuntimeDependencies).toContain(name)
      expect(manifest.peerDependencies).toEqual({ '@open-mercato/cache': '>=0.11.0' })
    })
  })
}
