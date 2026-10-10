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
 * response from the interceptor result and drops its headers fails here.
 */

const RUNNER_CALLS = ['runCustomRouteAfterInterceptors(', 'runApiInterceptorsAfter(']

// `const <name> = await run…AfterInterceptors({` / `run…After({`
const RESULT_BINDING = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:runCustomRouteAfterInterceptors|runApiInterceptorsAfter)\s*\(/g

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
    ]))
  })

  it.each(
    files.map((file) => [relative(packagesDir, file).split(sep).join('/'), file] as const),
  )('%s forwards the interceptor headers on every response built from the result', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    const variables = [...source.matchAll(RESULT_BINDING)].map((match) => match[1])
    expect(variables.length).toBeGreaterThan(0)

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
