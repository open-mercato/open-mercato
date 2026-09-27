import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

/**
 * A URL the UI builds must be a URL the API answers.
 *
 * Two specifications meet here and nothing used to check that they agree:
 *
 *   - the client helpers (`fetchCrudList('hr_management/leave-requests')`, `apiCall('/api/…')`),
 *     which only concatenate strings;
 *   - the runtime route manifest, whose `metadata.path` is matched against the URL after `/api`
 *     verbatim (`matchRoutePattern` — case-insensitive, but separator- and prefix-sensitive).
 *
 * When they disagree the screen fails at the one moment nothing is watching: an empty list, no type
 * error, no build error, no dictionary gap. That is how every API call in three whole modules
 * shipped broken — routes declaring `/hr/...` while the screens asked for `/hr_management/…`, and
 * resources spelled `leave_requests` against route directories named `leave-requests`.
 *
 * The manifest is the source of truth here, because it is what the router uses:
 *
 *   1. every `/api/…` string the module sources build must be a path the app registers, a static
 *      Next.js route under `apps/mercato/src/app/api/`, or — for a module this app does not have
 *      installed — a path that package declares. A literal cut short by `${…}` may match a prefix,
 *      because the rest of it is only known at runtime;
 *   2. a route must not declare a path whose first segment is its own module id cut short at a
 *      separator (`/hr/...` for `hr_management`), which is the specific way the two lists drifted
 *      apart. Deliberate other namespaces are left alone: `storage_s3` serves
 *      `/storage-providers/s3/…` and `shipping_carriers` serves `/shipping-carriers/…`, and both are
 *      registered under those paths on purpose.
 *
 * An exception has to be written down: `// api-path-exempt: <reason>` on the line or the line above,
 * the same way the RTL audit marks a deliberately physical offset.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..')

const APP_MODULES_ROOT = join(repoRoot, 'apps', 'mercato', 'src', 'modules')
const TEMPLATE_MODULES_ROOT = join(repoRoot, 'packages', 'create-app', 'template', 'src', 'modules')
const STATIC_API_ROOT = join(repoRoot, 'apps', 'mercato', 'src', 'app', 'api')
const GENERATED_ROOT = join(repoRoot, 'apps', 'mercato', '.mercato', 'generated')

const SCAN_ROOTS = [APP_MODULES_ROOT, TEMPLATE_MODULES_ROOT]

/** Every tree that ships routes: the app, the template, and each package with modules. */
const MODULE_ROOTS = [
  ...SCAN_ROOTS,
  ...readdirSync(join(repoRoot, 'packages'))
    .map((name) => join(repoRoot, 'packages', name, 'src', 'modules'))
    .filter((dir) => existsSync(dir)),
]

const SKIP_DIRS = new Set([
  'node_modules',
  '__tests__',
  '__integration__',
  '__snapshots__',
  'generated',
  'dist',
  '.next',
  '.mercato',
  'coverage',
])

const SOURCE_EXTENSIONS = ['.ts', '.tsx']

const EXEMPT_MARKER = 'api-path-exempt'

const CRUD_HELPERS = [
  'fetchCrudList',
  'createCrud',
  'updateCrud',
  'deleteCrud',
  'buildCrudExportUrl',
  'buildCrudCsvUrl',
  'readApiResultOrThrow',
  'apiCallOrThrow',
  'apiCall',
]

/** `const RESOURCE = 'a/b'` and `const X_RESOURCE = 'a/b'`, the shape every module uses. */
const RESOURCE_CONSTANT = /^\s*(?:export\s+)?const\s+([A-Z0-9_]*RESOURCE[A-Z0-9_]*)\s*=\s*'([^']+)'/gm

const STRING_ARGUMENT = String.raw`'([^']+)'|"([^"]+)"|` + '`([^`]+)`'

function walk(dir: string, visit: (file: string) => void): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(full, visit)
      continue
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) visit(full)
  }
}

function normalizeApiPath(value: string): string | null {
  const withoutQuery = value.split('?')[0]
  const trimmed = withoutQuery.replace(/\/+$/, '')
  if (!trimmed) return null
  if (trimmed.startsWith('/api/')) return trimmed
  if (trimmed.startsWith('/')) return `/api${trimmed}`
  if (!trimmed.includes('/')) return null
  return `/api/${trimmed}`
}

/**
 * Every path the app registers, read from the generated request-scoped route shards — the same list
 * `findApiRouteManifestMatch` searches. The OpenAPI document is not a substitute: it only carries
 * routes that export `openApi`, while the `example` module's CRUD routes are registered and
 * undocumented.
 */
function registeredRoutePaths(): Set<string> | null {
  if (!existsSync(GENERATED_ROOT)) return null
  const shards = readdirSync(GENERATED_ROOT).filter((name) => /^api-route-shard\.\d.*\.generated\.ts$/.test(name))
  if (shards.length === 0) return null
  const paths = new Set<string>()
  for (const shard of shards) {
    const text = readFileSync(join(GENERATED_ROOT, shard), 'utf8')
    for (const match of text.matchAll(/^\s*path:\s*"([^"]+)",$/gm)) paths.add(`/api${match[1]}`)
  }
  return paths
}

/** Static Next.js route handlers under `src/app/api/**`, which never reach the module manifest. */
function staticApiPaths(): Set<string> {
  const paths = new Set<string>()
  const visit = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        visit(full, [...segments, entry])
        continue
      }
      // Only `route.ts` files serve anything; anything else is a shared helper.
      if (entry !== 'route.ts') continue
      const cleaned = segments.filter((segment) => !segment.startsWith('('))
      paths.add(`/api${cleaned.length ? '/' + cleaned.join('/') : ''}`)
    }
  }
  if (existsSync(STATIC_API_ROOT)) visit(STATIC_API_ROOT, [])
  return paths
}

function declaredPath(source: string): string | null {
  const match = /export const metadata = \{[\s\S]{0,400}?path:\s*'([^']+)'/.exec(source)
    ?? /metadata:\s*\{[\s\S]{0,400}?path:\s*'([^']+)'/.exec(source)
  return match ? match[1] : null
}

/**
 * Every route declared anywhere in the repository, whether or not this app has the module enabled.
 *
 * The app's manifest is the runtime truth for the paths it serves, but a screen may legitimately
 * call into an optional package that is not installed here (the widget that talks to
 * `agent_orchestrator`). Those references are checked against what the package itself declares, so a
 * typo still fails while a not-installed module passes.
 */
function declaredRoutePaths(): Set<string> {
  const paths = new Set<string>()
  for (const modulesRoot of MODULE_ROOTS) {
    if (!existsSync(modulesRoot)) continue
    for (const moduleId of readdirSync(modulesRoot)) {
      const apiDir = join(modulesRoot, moduleId, 'api')
      if (!existsSync(apiDir)) continue
      walk(apiDir, (file) => {
        const declared = declaredPath(readFileSync(file, 'utf8'))
        if (declared) {
          const normalized = normalizeApiPath(declared)
          if (normalized) paths.add(normalized)
          return
        }
        // The manifest generator's fallback for a route that declares no path, which only applies
        // to directory routes — a single-file route's URL cannot be derived without guessing.
        if (!file.endsWith(`${sep}route.ts`) && !file.endsWith('/route.ts')) return
        const segments = relative(apiDir, dirname(file)).split(sep).filter(Boolean)
        paths.add(`/api/${moduleId}${segments.length ? '/' + segments.join('/') : ''}`)
      })
    }
  }
  return paths
}

type ApiUsage = {
  file: string
  line: number
  source: string
  raw: string
  /** The literal continued past the captured text (a template literal with `${…}`). */
  truncated: boolean
}

function splitTemplate(value: string): { raw: string; truncated: boolean } {
  const marker = value.indexOf('${')
  if (marker < 0) return { raw: value, truncated: false }
  return { raw: value.slice(0, marker), truncated: true }
}

function collectUsages(): ApiUsage[] {
  const found: ApiUsage[] = []
  const seen = new Set<string>()

  const push = (file: string, text: string, index: number, source: string, value: string, truncated: boolean) => {
    const path = normalizeApiPath(value)
    if (!path) return
    const lines = text.split('\n')
    const line = text.slice(0, index).split('\n').length
    const lineIndex = line - 1
    // A justified exception is written next to the URL — allowing a few lines above it, because the
    // call that carries the literal often spans several lines. Reviewable instead of silent.
    const window = lines.slice(Math.max(0, lineIndex - 4), lineIndex + 1).join('\n')
    if (window.includes(EXEMPT_MARKER)) return
    const key = `${file}:${line}:${path}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ file, line, source, raw: value, truncated })
  }

  for (const root of SCAN_ROOTS) {
    walk(root, (file) => {
      const text = readFileSync(file, 'utf8')

      for (const match of text.matchAll(RESOURCE_CONSTANT)) {
        if (!match[2].includes('/')) continue
        push(file, text, match.index ?? 0, match[1], match[2], false)
      }

      for (const helper of CRUD_HELPERS) {
        const pattern = new RegExp(String.raw`\b${helper}\s*(?:<[^>]*>)?\s*\(\s*(?:${STRING_ARGUMENT})`, 'g')
        for (const match of text.matchAll(pattern)) {
          const value = match[1] ?? match[2] ?? match[3]
          if (!value) continue
          const { raw, truncated } = splitTemplate(value)
          push(file, text, match.index ?? 0, helper, raw, truncated)
        }
      }

      for (const match of text.matchAll(/['"](\/api\/[^'"\n]+)['"]/g)) {
        push(file, text, match.index ?? 0, 'literal', match[1], false)
      }
      for (const match of text.matchAll(/`(\/api\/[^`\n]+)`/g)) {
        const { raw, truncated } = splitTemplate(match[1])
        push(file, text, match.index ?? 0, 'literal', raw, truncated)
      }
    })
  }

  return found
}

describe('API paths the UI builds resolve to a registered route', () => {
  const usages = collectUsages()
  const registered = registeredRoutePaths()
  const statics = staticApiPaths()
  const declared = declaredRoutePaths()

  it('collects API usage from the module sources', () => {
    expect(usages.length).toBeGreaterThan(30)
  })

  it('uses a path the runtime route manifest registers', () => {
    if (!registered) {
      // A clean checkout without `yarn generate` cannot answer this; the repo's gate generates
      // before it tests, so it is only skipped in a bare checkout.
      console.warn('[api-paths] generated route shards are missing — run `yarn generate`')
      return
    }
    const known = [...registered, ...statics, ...declared]
    const knownExact = new Set(known)
    const offenders = usages.flatMap((usage) => {
      const path = normalizeApiPath(usage.raw)
      if (!path) return []
      if (knownExact.has(path)) return []
      // Only a literal cut short by `${…}` may match a prefix: for a complete path an exact match
      // is required, so a URL pointing at a collection endpoint that does not exist still fails.
      if (usage.truncated && known.some((candidate) => candidate.startsWith(`${path}/`))) return []
      return [`${relative(repoRoot, usage.file).split(sep).join('/')}:${usage.line} ${usage.source} -> ${path}`]
    })
    expect(offenders).toEqual([])
  })

  it('does not declare a route path that truncates its own module id', () => {
    const offenders: string[] = []
    let inspected = 0

    for (const modulesRoot of MODULE_ROOTS) {
      if (!existsSync(modulesRoot)) continue
      for (const moduleId of readdirSync(modulesRoot)) {
        const apiDir = join(modulesRoot, moduleId, 'api')
        if (!existsSync(apiDir)) continue
        walk(apiDir, (file) => {
          const declaredRoute = declaredPath(readFileSync(file, 'utf8'))
          // A route without a declared path is fine: the manifest generator falls back to
          // `<moduleId>/<route directories>`, which is the convention this check protects.
          if (!declaredRoute) return
          inspected += 1
          const segment = declaredRoute.split('/')[1] ?? ''
          if (!segment) return
          if (segment === moduleId || segment === moduleId.replaceAll('_', '-')) return
          // Only the truncation shape is a defect. A route deliberately served under another
          // namespace stays untouched — `storage_s3` owns `/storage-providers/s3/…` and
          // `shipping_carriers` owns `/shipping-carriers/…`, both registered as such.
          const truncatedAtSeparator = moduleId.startsWith(`${segment}_`) || moduleId.startsWith(`${segment}-`)
          if (!truncatedAtSeparator) return
          offenders.push(`${relative(repoRoot, file).split(sep).join('/')} declares ${declaredRoute} for module ${moduleId}`)
        })
      }
    }

    expect(inspected).toBeGreaterThan(50)
    expect(offenders).toEqual([])
  })
})
