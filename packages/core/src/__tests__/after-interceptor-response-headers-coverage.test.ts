import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * After-interceptor response-header coverage guard.
 *
 * `runApiInterceptorsAfter` / `runCustomRouteAfterInterceptors` return
 * `{ ok, statusCode, body, headers }`. Every caller must forward `headers` onto the response
 * it builds — on the interceptor-failure branch as well as the success one — or an interceptor
 * that returns a header gets no error and no effect.
 *
 * That is a per-call-site obligation with nothing structural behind it: the runner cannot make
 * a caller read its `headers`, and dropping it produces no type error, no failing route test
 * and no log line. Three of the four call sites this guard covers had exactly that shape, and
 * a route-level harness per site would pin only the sites that exist today.
 *
 * The rule: in a file that calls one of those runners, EVERY `NextResponse.json(...)` call that
 * mentions the result variable must also mention `<var>.headers`. A new caller that builds a
 * response from the interceptor result and drops its headers fails here. A result bound through
 * a local wrapper (`const runAfter = async (...) => runCustomRouteAfterInterceptors(...)`) counts,
 * so one level of indirection does not let a caller opt out.
 */

const RUNNER_CALLS = ['runCustomRouteAfterInterceptors(', 'runApiInterceptorsAfter(']

const RUNNER_NAMES = 'runCustomRouteAfterInterceptors|runApiInterceptorsAfter'

// The start of a local function, arrow or declaration, whose body may call a runner.
const LOCAL_FUNCTION = /(?:(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>|async\s+function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]*)?)\s*/g

const packagesDir = join(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next' || entry === '__tests__') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

function packageSourceRoots(): string[] {
  const roots: string[] = []
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, 'src')
    try {
      if (statSync(src).isDirectory()) roots.push(src)
    } catch {
      /* package without a src/ directory */
    }
  }
  return roots
}

/** The source from `start` until the bracket opened there closes, or the end of an arrow expression. */
function scanBody(source: string, start: number): string {
  let depth = 0
  let i = start
  const block = source[start] === '{'
  while (i < source.length) {
    const ch = source[i]
    if (ch === '(' || ch === '{' || ch === '[') depth += 1
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0 && block) return source.slice(start, i + 1)
      if (depth < 0) return source.slice(start, i)
    } else if (!block && depth === 0 && (ch === '\n' || ch === ';' || ch === ',')) {
      return source.slice(start, i)
    }
    i += 1
  }
  return source.slice(start)
}

/** Names of local functions in the file whose body calls a runner — one level of indirection. */
function runnerWrappers(source: string): string[] {
  const names: string[] = []
  const callsRunner = new RegExp(`\\b(?:${RUNNER_NAMES})\\s*\\(`)
  for (const match of source.matchAll(LOCAL_FUNCTION)) {
    const name = match[1] ?? match[2]
    if (name && callsRunner.test(scanBody(source, match.index! + match[0].length))) names.push(name)
  }
  return names
}

/** Variables bound to an awaited runner result, directly or through a local wrapper. */
function resultVariables(source: string): string[] {
  const callees = [RUNNER_NAMES, ...runnerWrappers(source)].join('|')
  const binding = new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+(?:${callees})\\s*\\(`, 'g')
  return Array.from(new Set([...source.matchAll(binding)].map((match) => match[1])))
}

/** Every `NextResponse.json(` / `json(` argument list in the source, balanced-paren scanned. */
function responseCalls(source: string): string[] {
  const calls: string[] = []
  const opener = /\bNextResponse\.json\s*\(/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source))) {
    let depth = 1
    let i = match.index + match[0].length
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') depth -= 1
      i += 1
    }
    calls.push(source.slice(match.index, i))
  }
  return calls
}

describe('after-interceptor response headers reach every caller\'s response', () => {
  const files = packageSourceRoots()
    .flatMap((root) => walk(root))
    .filter((file) => {
      const source = readFileSync(file, 'utf8')
      // The modules that DEFINE these runners mention the token without calling it.
      if (/export\s+async\s+function\s+(runApiInterceptorsAfter|runCustomRouteAfterInterceptors)\b/.test(source)) return false
      return RUNNER_CALLS.some((call) => source.includes(call))
    })

  it('finds the known call sites, so a broken scan cannot pass vacuously', () => {
    const relatives = files.map((file) => relative(packagesDir, file).split(sep).join('/'))
    expect(relatives).toEqual(expect.arrayContaining([
      'core/src/modules/auth/api/login.ts',
      'core/src/modules/wms/api/inventory/helpers.ts',
      'core/src/modules/wms/api/inventory/import/helpers.ts',
      'core/src/modules/wms/api/sales-orders/[salesOrderId]/warehouse-assignment/route.ts',
      'core/src/modules/integrations/api/umes-read.ts',
      'core/src/modules/staff/api/timesheets/_shared/withTimesheetInterceptors.ts',
    ]))
  })

  it.each(
    files.map((file) => [relative(packagesDir, file).split(sep).join('/'), file] as const),
  )('%s forwards the interceptor headers on every response built from the result', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    const variables = resultVariables(source)
    if (!variables.length) {
      throw new Error(
        `${_name} calls an after-interceptor runner but binds no result this guard can follow. ` +
        'Bind the runner result directly (`const after = await runCustomRouteAfterInterceptors(...)`), ' +
        'or through a local wrapper whose body calls it, or extend resultVariables().',
      )
    }

    const offenders: string[] = []
    for (const call of responseCalls(source)) {
      for (const variable of variables) {
        const mentionsResult = new RegExp(`\\b${variable}\\.(statusCode|body|headers)\\b`).test(call)
        if (!mentionsResult) continue
        if (!call.includes(`${variable}.headers`)) offenders.push(call.replace(/\s+/g, ' ').slice(0, 160))
      }
    }

    expect(offenders).toEqual([])
  })
})
