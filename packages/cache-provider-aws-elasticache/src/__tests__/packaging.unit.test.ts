import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const PACKAGE_DIR = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(PACKAGE_DIR, '../..')
const OFFICIAL_PACKAGES = [
  '@open-mercato/cache-provider-azure-managed-redis',
  '@open-mercato/cache-provider-aws-elasticache',
  '@open-mercato/cache-provider-google-memorystore',
]

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

const manifest = readJson<PackageJson>(path.join(PACKAGE_DIR, 'package.json'))

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

describe(`${manifest.name} commercial packaging`, () => {
  it('is an Enterprise-licensed package excluded from the public publish set', () => {
    expect(OFFICIAL_PACKAGES).toContain(manifest.name)
    expect(manifest.private).toBe(true)
    expect(manifest.license).toBe('SEE LICENSE IN LICENSE.md')
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.files).toEqual(expect.arrayContaining(['LICENSE.md', 'README.md', 'RUNBOOK.md', '!src/**/__tests__']))
    expect(manifest.files).not.toContain('test-support')
    const license = readFileSync(path.join(PACKAGE_DIR, 'LICENSE.md'), 'utf8')
    expect(license).toBe(readFileSync(path.join(REPO_ROOT, 'packages/enterprise/LICENSE.md'), 'utf8'))
  })

  it('is not listed by the publish script workspace query', () => {
    const output = execFileSync('yarn', ['workspaces', 'list', '--json', '--no-private'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 })
    const published = output.trim().split('\n').map((line) => (JSON.parse(line) as { name: string }).name)
    expect(published).toContain('@open-mercato/cache')
    for (const name of OFFICIAL_PACKAGES) expect(published).not.toContain(name)
  })

  it('is not a dependency of the default app, the create-app template or any public package', () => {
    const appManifest = readFileSync(path.join(REPO_ROOT, 'apps/mercato/package.json'), 'utf8')
    const template = readFileSync(path.join(REPO_ROOT, 'packages/create-app/template/package.json.template'), 'utf8')
    for (const name of OFFICIAL_PACKAGES) {
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
      for (const name of OFFICIAL_PACKAGES) expect([other.name, Object.prototype.hasOwnProperty.call(declared, name)]).toEqual([other.name, false])
    }
  })

  it('stays out of the default app dependency graph resolved in yarn.lock', () => {
    const entries = readLockfile()
    const app = closureOf(entries, 'apps/mercato')
    expect(app.has('@open-mercato/cache')).toBe(true)
    expect(app.size).toBeGreaterThan(100)
    for (const name of OFFICIAL_PACKAGES) expect(app.has(name)).toBe(false)
    expect(app.has('@azure/identity')).toBe(false)
    const own = closureOf(entries, `packages/${path.basename(PACKAGE_DIR)}`)
    expect(own.has(manifest.name)).toBe(true)
  })

  it('declares only the protocol library, its engine client, zod and its own cloud identity SDK at runtime', () => {
    const runtime = Object.keys(manifest.dependencies ?? {}).sort()
    const allowedCloud = ['@azure/identity', '@aws-sdk/credential-provider-node', '@smithy/signature-v4', 'google-auth-library']
    for (const name of runtime) expect(['@open-mercato/cache-redis-protocol', 'ioredis', 'zod', ...allowedCloud]).toContain(name)
    expect(manifest.peerDependencies).toEqual({ '@open-mercato/cache': '>=0.11.0' })
  })

  it('keeps the shared enterprise gate, credential and managed RESP modules identical across the three packages', () => {
    const shared = [
      'src/enterprise.ts',
      'src/credentials.ts',
      'src/managed.ts',
      'src/__tests__/enterprise-gate.unit.test.ts',
      'src/__tests__/packaging.unit.test.ts',
      'src/__tests__/live-harness.unit.test.ts',
      'src/__tests__/provider.live.test.ts',
      'test-support/live.ts',
      'test-support/preflight.ts',
      'jest.config.cjs',
      'LICENSE.md',
    ]
    for (const file of shared) {
      const contents = OFFICIAL_PACKAGES.map((name) => readFileSync(path.join(REPO_ROOT, 'packages', name.replace('@open-mercato/', ''), file), 'utf8'))
      expect(new Set(contents).size).toBe(1)
    }
  })
})
