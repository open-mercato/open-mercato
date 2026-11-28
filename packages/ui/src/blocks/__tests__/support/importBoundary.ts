import path from 'node:path'

const SPECIFIER_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g

const NAMED_IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?[^'"{};]*?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g

const FETCH_CALL_PATTERN = /(?:(?<![\w.'"])|(?<=\b(?:window|globalThis|self)\.))fetch\s*\(/g

const FORBIDDEN_BINDINGS = new Set([
  'apiCall',
  'apiCallOrThrow',
  'readApiResultOrThrow',
  'useGuardedMutation',
  'fetchWithTimeout',
  'fetchCrudList',
  'useQuery',
  'useQueries',
  'useMutation',
  'useQueryClient',
  'useInfiniteQuery',
])

const FORBIDDEN_SHARED_MODULES = ['lib/http/fetchWithTimeout']

const ALLOWED_OPEN_MERCATO_PACKAGES = new Set(['ui', 'shared'])

const FORBIDDEN_PACKAGES = ['@tanstack/react-query']

const FORBIDDEN_UI_MODULES = [
  'backend/utils/apiCall',
  'backend/utils/api',
  'backend/utils/crud',
  'backend/utils/fetchAllPages',
  'backend/injection/useGuardedMutation',
  'backend/utils/customFieldDefs',
  'backend/utils/customFieldFilters',
  'backend/utils/customFieldRelationDisplay',
  'backend/utils/useCurrentUserId',
  'backend/utils/nav',
]

function stripExtension(value: string): string {
  return value.replace(/\.(ts|tsx|js|jsx)$/, '')
}

function uiModuleOf(specifier: string, filePath: string, uiSrcRoot: string): string | null {
  if (specifier.startsWith('@open-mercato/ui/')) return stripExtension(specifier.slice('@open-mercato/ui/'.length))
  if (!specifier.startsWith('.')) return null
  const resolved = path.resolve(path.dirname(filePath), specifier)
  const relative = path.relative(uiSrcRoot, resolved)
  if (relative.startsWith('..')) return null
  return stripExtension(relative.split(path.sep).join('/'))
}

function violationFor(specifier: string, filePath: string, uiSrcRoot: string): string | null {
  const scoped = /^@open-mercato\/([^/]+)/.exec(specifier)
  if (scoped && !ALLOWED_OPEN_MERCATO_PACKAGES.has(scoped[1])) return `domain package import: ${specifier}`
  if (FORBIDDEN_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
    return `data client import: ${specifier}`
  }
  const shared = /^@open-mercato\/shared\/(.+)$/.exec(specifier)
  if (shared && FORBIDDEN_SHARED_MODULES.includes(stripExtension(shared[1]))) {
    return `data or guard import: ${specifier}`
  }
  const uiModule = uiModuleOf(specifier, filePath, uiSrcRoot)
  if (uiModule && FORBIDDEN_UI_MODULES.includes(uiModule)) return `data or guard import: ${specifier}`
  return null
}

export function findBoundaryViolations(source: string, filePath: string, uiSrcRoot: string): string[] {
  const violations: string[] = []
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (!specifier) continue
    const violation = violationFor(specifier, filePath, uiSrcRoot)
    if (violation) violations.push(violation)
  }
  const fetchCallCount = (source.match(FETCH_CALL_PATTERN) ?? []).length
  for (let index = 0; index < fetchCallCount; index += 1) violations.push('direct fetch call')
  for (const match of source.matchAll(NAMED_IMPORT_PATTERN)) {
    const specifier = match[2]
    if (violationFor(specifier, filePath, uiSrcRoot)) continue
    for (const entry of match[1].split(',')) {
      const imported = entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (FORBIDDEN_BINDINGS.has(imported)) violations.push(`forbidden binding: ${imported} from ${specifier}`)
    }
  }
  return violations
}
