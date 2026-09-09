import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import * as ts from 'typescript'
import { runTelemetryInit } from '../telemetry-init'

const TEMPLATE_DIR = path.join(__dirname, '../../../../../packages/create-app/template')
const TEMPLATE_DISPATCHER = path.join(TEMPLATE_DIR, 'src/app/api/[...slug]/route.ts')
const TEMPLATE_NEXT_CONFIG = path.join(TEMPLATE_DIR, 'next.config.ts')
const TEMPLATE_INSTRUMENTATION = path.join(TEMPLATE_DIR, 'src/instrumentation.ts')
const TEMPLATE_LAYOUT = path.join(TEMPLATE_DIR, 'src/app/(backend)/backend/layout.tsx')
const TEMPLATE_MODULES = path.join(TEMPLATE_DIR, 'src/modules.ts')

const LAYOUT_FILE = 'src/app/(backend)/backend/layout.tsx'

// The telemetry statements the shipped scaffold wires into the dispatcher — the
// oracle for "did the command reproduce the real wiring?". Read from the live
// template so this test fails loudly if the scaffold's wiring changes and the
// command doesn't keep up.
const TELEMETRY_DISPATCHER_LINES = [
  "import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'",
  'getTelemetryRuntime()?.recordHttpDuration(method, match.route.path, finalResponse.status, startedAt)',
  'getTelemetryRuntime()?.recordHttpDuration(method, match.route.path, 500, startedAt)',
  'getTelemetryRuntime()?.reportError(error, {',
]

/** Assert a string is syntactically valid TypeScript (parse errors, not types). */
function assertParses(code: string, label: string, extension: '.ts' | '.tsx' = '.ts'): void {
  const sf = ts.createSourceFile(`${label}${extension}`, code, ts.ScriptTarget.Latest, true)
  const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
  const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
  expect({ label, messages }).toEqual({ label, messages: [] })
}

/** Turn the live wired template dispatcher back into a pre-telemetry one. */
function stripTelemetry(src: string): string {
  return src
    .replace(/\n[ \t]*getTelemetryRuntime\(\)\?\.reportError\(error, \{[\s\S]*?\n[ \t]*\}\)/, '')
    .split('\n')
    .filter(
      (line) =>
        !line.includes("from '@open-mercato/telemetry'") &&
        !line.includes("from '@open-mercato/telemetry/nextjs'") &&
        !line.includes("from '@open-mercato/shared/lib/telemetry/runtime'") &&
        !line.includes('recordHttpDuration('),
    )
    .join('\n')
}

/** Turn the live wired template layout back into one from before browser RUM shipped. */
function stripBrowserTelemetry(src: string): string {
  return src
    .replace(/\n[ \t]*\/\/ Resolved per request[\s\S]*?const browserTelemetryConfig = resolveBrowserTelemetryConfig\(\)\n/, '\n')
    .split('\n')
    .filter(
      (line) =>
        !line.includes("from '@open-mercato/telemetry/browser'") &&
        !line.includes("from '@open-mercato/telemetry/browser/server'") &&
        !line.includes('<BrowserTelemetry'),
    )
    .join('\n')
}

const NEXT_CONFIG = `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'esbuild',
  ],
}

export default nextConfig
`

function baseFixture(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src', 'app', 'api', '[...slug]'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'my-app', dependencies: { '@open-mercato/shared': '1.2.3' } }, null, 2) + '\n',
  )
  fs.writeFileSync(path.join(dir, '.env.example'), 'DATABASE_URL=postgres://localhost/app\n')
  fs.writeFileSync(path.join(dir, 'next.config.ts'), NEXT_CONFIG)
}

const SIMPLE_DISPATCHER = `import { NextResponse, type NextRequest } from 'next/server'
import { findApiRouteManifestMatch } from '@open-mercato/shared/modules/registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

async function handleRequest(method: string, req: NextRequest): Promise<Response> {
  const startedAt = Date.now()
  const match = { route: { path: '/api/thing' } }
  try {
    const finalResponse = NextResponse.json({ ok: true })
    return finalResponse
  } catch (error) {
    throw error
  }
}
`

describe('mercato telemetry init', () => {
  let tmpDir: string
  let cwd: string
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-init-'))
    cwd = process.cwd()
    process.chdir(tmpDir)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.chdir(cwd)
    logSpy.mockRestore()
    errorSpy.mockRestore()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const read = (rel: string) => fs.readFileSync(path.join(tmpDir, rel), 'utf8')
  const dispatcherPath = 'src/app/api/[...slug]/route.ts'

  it('rejects a directory that is not an Open Mercato app', async () => {
    const code = await runTelemetryInit([])
    expect(code).toBe(1)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('wires all files in a pre-telemetry app', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    const code = await runTelemetryInit([])
    expect(code).toBe(0)

    const pkg = JSON.parse(read('package.json'))
    expect(pkg.dependencies['@open-mercato/telemetry']).toBe('1.2.3')
    expect(pkg.optionalDependencies['bullmq-otel']).toBe('^1.3.1')

    expect(read('.env.example')).toContain('TELEMETRY_BACKEND')
    expect(read('.env.example')).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')
    expect(read('src/instrumentation.ts')).toContain('registerTelemetryForNextjs')

    const nextConfig = read('next.config.ts')
    expect(nextConfig).toContain('@open-mercato/telemetry/nextjs-config')
    expect(nextConfig).toContain('...telemetryServerExternalPackages')

    const route = read(dispatcherPath)
    for (const line of TELEMETRY_DISPATCHER_LINES) expect(route).toContain(line)
  })

  it('every patched file is syntactically valid TypeScript', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    await runTelemetryInit([])
    assertParses(read('next.config.ts'), 'next.config')
    assertParses(read('src/instrumentation.ts'), 'instrumentation')
    assertParses(read(dispatcherPath), 'dispatcher')
    JSON.parse(read('package.json')) // valid JSON
  })

  it('reproduces the live template dispatcher wiring (round-trip)', async () => {
    baseFixture(tmpDir)
    const wired = fs.readFileSync(TEMPLATE_DISPATCHER, 'utf8')
    const preTelemetry = stripTelemetry(wired)
    // sanity: the derived pre-telemetry file no longer imports telemetry but still parses
    expect(preTelemetry).not.toContain('@open-mercato/telemetry')
    assertParses(preTelemetry, 'stripped-template')
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), preTelemetry)

    await runTelemetryInit([])

    const patched = read(dispatcherPath)
    assertParses(patched, 'patched-template')
    for (const line of TELEMETRY_DISPATCHER_LINES) expect(patched).toContain(line)
    // the success metric lands before the response return, the 500 funnel in the catch
    expect(patched.indexOf('finalResponse.status, startedAt')).toBeLessThan(patched.indexOf('return finalResponse'))
    expect(patched.indexOf('reportError(error, {')).toBeLessThan(patched.indexOf(', 500, startedAt'))
  })

  it('is a no-op on the real (already-wired) template files', async () => {
    baseFixture(tmpDir)
    fs.copyFileSync(TEMPLATE_DISPATCHER, path.join(tmpDir, dispatcherPath))
    fs.copyFileSync(TEMPLATE_NEXT_CONFIG, path.join(tmpDir, 'next.config.ts'))
    fs.copyFileSync(TEMPLATE_INSTRUMENTATION, path.join(tmpDir, 'src', 'instrumentation.ts'))
    const before = {
      route: read(dispatcherPath),
      nextConfig: read('next.config.ts'),
      instrumentation: read('src/instrumentation.ts'),
    }
    await runTelemetryInit([])
    expect(read(dispatcherPath)).toBe(before.route)
    expect(read('next.config.ts')).toBe(before.nextConfig)
    expect(read('src/instrumentation.ts')).toBe(before.instrumentation)
  })

  it('patches a recognizable-but-modified dispatcher (extra imports/code, anchors intact)', async () => {
    baseFixture(tmpDir)
    const modified = SIMPLE_DISPATCHER.replace(
      "import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'",
      "import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'\nimport { auditLog } from '@/lib/audit'",
    ).replace('const match = { route: { path: \'/api/thing\' } }', 'const match = { route: { path: \'/api/thing\' } }\n  auditLog(method)')
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), modified)

    await runTelemetryInit([])
    const patched = read(dispatcherPath)
    assertParses(patched, 'modified-dispatcher')
    for (const line of TELEMETRY_DISPATCHER_LINES) expect(patched).toContain(line)
    expect(patched).toContain("import { auditLog } from '@/lib/audit'") // preserved custom code
  })

  it('leaves an unrecognizable dispatcher untouched and prints the manual snippet', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), `export async function GET() { return new Response('custom') }\n`)
    await runTelemetryInit([])
    const route = read(dispatcherPath)
    expect(route).not.toContain('@open-mercato/telemetry')
    expect(route).toBe(`export async function GET() { return new Response('custom') }\n`)
    const printed = logSpy.mock.calls.flat().join('\n')
    expect(printed).toContain('manual step for src/app/api/[...slug]/route.ts')
  })

  it('handles next.config variations (single-line array, no trailing comma) and stays valid', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    fs.writeFileSync(
      path.join(tmpDir, 'next.config.ts'),
      `import type { NextConfig } from 'next'\nconst nextConfig: NextConfig = { serverExternalPackages: ['esbuild'] }\nexport default nextConfig\n`,
    )
    await runTelemetryInit([])
    const nextConfig = read('next.config.ts')
    assertParses(nextConfig, 'single-line-next-config')
    expect(nextConfig).toContain('...telemetryServerExternalPackages')
    expect(nextConfig).toContain('@open-mercato/telemetry/nextjs-config')
  })

  it('migrates the legacy nextjs import before adding the missing spread', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    fs.writeFileSync(
      path.join(tmpDir, 'next.config.ts'),
      `import type { NextConfig } from 'next'\nimport { telemetryServerExternalPackages } from '@open-mercato/telemetry/nextjs'\nconst nextConfig: NextConfig = { serverExternalPackages: ['esbuild', 'bullmq'] }\nexport default nextConfig\n`,
    )

    await runTelemetryInit([])

    const nextConfig = read('next.config.ts')
    assertParses(nextConfig, 'legacy-next-config')
    expect(nextConfig).toContain("from '@open-mercato/telemetry/nextjs-config'")
    expect(nextConfig).not.toContain("from '@open-mercato/telemetry/nextjs'")
    expect(nextConfig).toContain("['esbuild', 'bullmq', ...telemetryServerExternalPackages]")
  })

  it('flags next.config as manual when serverExternalPackages is absent', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    fs.writeFileSync(
      path.join(tmpDir, 'next.config.ts'),
      `import type { NextConfig } from 'next'\nconst nextConfig: NextConfig = { distDir: '.next' }\nexport default nextConfig\n`,
    )
    await runTelemetryInit([])
    expect(read('next.config.ts')).not.toContain('telemetryServerExternalPackages')
    const printed = logSpy.mock.calls.flat().join('\n')
    expect(printed).toContain('manual step for next.config.ts')
  })

  it('inserts into a pre-existing custom instrumentation.ts and preserves its body', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'instrumentation.ts'),
      `export async function register(): Promise<void> {\n  console.log('custom warmup')\n}\n`,
    )
    await runTelemetryInit([])
    const instrumentation = read('src/instrumentation.ts')
    assertParses(instrumentation, 'custom-instrumentation')
    expect(instrumentation).toContain('registerTelemetryForNextjs')
    expect(instrumentation).toContain("console.log('custom warmup')") // preserved
  })

  it('is idempotent — a second run changes nothing and does not double-insert', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    await runTelemetryInit([])
    const after1 = {
      pkg: read('package.json'),
      env: read('.env.example'),
      instrumentation: read('src/instrumentation.ts'),
      nextConfig: read('next.config.ts'),
      route: read(dispatcherPath),
      modules: read('src/modules.ts'),
    }

    await runTelemetryInit([])
    expect(read('package.json')).toBe(after1.pkg)
    expect(read('.env.example')).toBe(after1.env)
    expect(read('src/instrumentation.ts')).toBe(after1.instrumentation)
    expect(read('next.config.ts')).toBe(after1.nextConfig)
    expect(read(dispatcherPath)).toBe(after1.route)
    expect(read('src/modules.ts')).toBe(after1.modules)

    const route = read(dispatcherPath)
    expect((read('next.config.ts').match(/@open-mercato\/telemetry\/nextjs-config/g) ?? []).length).toBe(1)
    expect((route.match(/from '@open-mercato\/shared\/lib\/telemetry\/runtime'/g) ?? []).length).toBe(1)
  })

  /**
   * The adoption path the first RUM release has to serve: an app that already ran
   * `mercato telemetry init` before browser RUM existed. Everything server-side is
   * wired; none of the RUM wiring is.
   */
  describe('an app already initialized before browser RUM shipped', () => {
    function legacyFixture(): void {
      baseFixture(tmpDir)
      fs.copyFileSync(TEMPLATE_DISPATCHER, path.join(tmpDir, dispatcherPath))
      fs.copyFileSync(TEMPLATE_NEXT_CONFIG, path.join(tmpDir, 'next.config.ts'))
      fs.copyFileSync(TEMPLATE_INSTRUMENTATION, path.join(tmpDir, 'src', 'instrumentation.ts'))
      // The core env block as the pre-RUM command wrote it: no TELEMETRY_BROWSER_* keys.
      fs.writeFileSync(
        path.join(tmpDir, '.env.example'),
        'DATABASE_URL=postgres://localhost/app\n\n# TELEMETRY_BACKEND=otlp\n# OTEL_SERVICE_NAME=open-mercato\n',
      )
      fs.mkdirSync(path.join(tmpDir, 'src', 'app', '(backend)', 'backend'), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, LAYOUT_FILE),
        stripBrowserTelemetry(fs.readFileSync(TEMPLATE_LAYOUT, 'utf8')),
      )
      fs.writeFileSync(
        path.join(tmpDir, 'src', 'modules.ts'),
        `import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'\n\nexport type ModuleEntry = { id: string; from?: string; overrides?: ModuleOverrides }\n\nexport const enabledModules: ModuleEntry[] = [\n  { id: 'auth', from: '@open-mercato/core' },\n]\n`,
      )
    }

    it('appends the missing browser env keys instead of skipping the whole block', async () => {
      legacyFixture()

      await runTelemetryInit([])

      const env = read('.env.example')
      expect(env).toContain('TELEMETRY_BROWSER_ENABLED')
      expect(env).toContain('TELEMETRY_BROWSER_SAMPLING_RATIO')
      // The core block the app already had must not be duplicated.
      expect((env.match(/^#?\s*TELEMETRY_BACKEND=/gm) ?? []).length).toBe(1)
    })

    it('registers the telemetry module, without which the browser exports into a 404', async () => {
      legacyFixture()

      await runTelemetryInit([])

      const modules = read('src/modules.ts')
      assertParses(modules, 'legacy-modules')
      expect(modules).toContain("{ id: 'telemetry', from: '@open-mercato/telemetry' },")
      expect(modules).toContain("{ id: 'auth', from: '@open-mercato/core' },") // preserved
    })

    it('renders the client bootstrap in the backoffice shell', async () => {
      legacyFixture()

      await runTelemetryInit([])

      const layout = read(LAYOUT_FILE)
      assertParses(layout, 'legacy-layout', '.tsx')
      expect(layout).toContain("import { BrowserTelemetry } from '@open-mercato/telemetry/browser'")
      // The credential-reading half stays on the server entry.
      expect(layout).toContain("import { resolveBrowserTelemetryConfig } from '@open-mercato/telemetry/browser/server'")
      expect(layout).toContain('const browserTelemetryConfig = resolveBrowserTelemetryConfig()')
      expect(layout).toContain('<BrowserTelemetry config={browserTelemetryConfig} />')
      // Resolved before it is used, and rendered inside the shell.
      expect(layout.indexOf('const browserTelemetryConfig')).toBeLessThan(layout.indexOf('<BrowserTelemetry'))
      expect(layout.indexOf('<BrowserTelemetry')).toBeLessThan(layout.indexOf('</AppShell>'))
    })

    it('reproduces the live template layout wiring (round-trip)', async () => {
      legacyFixture()
      const wired = fs.readFileSync(TEMPLATE_LAYOUT, 'utf8')

      await runTelemetryInit([])

      const patched = read(LAYOUT_FILE)
      for (const line of [
        "import { BrowserTelemetry } from '@open-mercato/telemetry/browser'",
        "import { resolveBrowserTelemetryConfig } from '@open-mercato/telemetry/browser/server'",
        'const browserTelemetryConfig = resolveBrowserTelemetryConfig()',
        '<BrowserTelemetry config={browserTelemetryConfig} />',
      ]) {
        expect(wired).toContain(line)
        expect(patched).toContain(line)
      }
    })

    it('is idempotent across the RUM steps too', async () => {
      legacyFixture()
      await runTelemetryInit([])
      const afterFirst = { env: read('.env.example'), modules: read('src/modules.ts'), layout: read(LAYOUT_FILE) }

      await runTelemetryInit([])

      expect(read('.env.example')).toBe(afterFirst.env)
      expect(read('src/modules.ts')).toBe(afterFirst.modules)
      expect(read(LAYOUT_FILE)).toBe(afterFirst.layout)
    })
  })

  it('is a no-op on the already-wired template layout and modules', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    fs.mkdirSync(path.join(tmpDir, 'src', 'app', '(backend)', 'backend'), { recursive: true })
    fs.copyFileSync(TEMPLATE_LAYOUT, path.join(tmpDir, LAYOUT_FILE))
    fs.copyFileSync(TEMPLATE_MODULES, path.join(tmpDir, 'src', 'modules.ts'))
    const before = { layout: read(LAYOUT_FILE), modules: read('src/modules.ts') }

    await runTelemetryInit([])

    expect(read(LAYOUT_FILE)).toBe(before.layout)
    expect(read('src/modules.ts')).toBe(before.modules)
  })

  it('leaves an unrecognizable backend layout untouched and prints the manual snippet', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    fs.mkdirSync(path.join(tmpDir, 'src', 'app', '(backend)', 'backend'), { recursive: true })
    const custom = `export default function Layout() { return null }\n`
    fs.writeFileSync(path.join(tmpDir, LAYOUT_FILE), custom)

    await runTelemetryInit([])

    expect(read(LAYOUT_FILE)).toBe(custom)
    const printed = logSpy.mock.calls.flat().join('\n')
    expect(printed).toContain(`manual step for ${LAYOUT_FILE}`)
    expect(printed).toContain('<BrowserTelemetry config={browserTelemetryConfig} />')
  })

  it('dry run writes nothing', async () => {
    baseFixture(tmpDir)
    fs.writeFileSync(path.join(tmpDir, dispatcherPath), SIMPLE_DISPATCHER)
    const before = { nextConfig: read('next.config.ts'), modules: read('src/modules.ts') }
    await runTelemetryInit(['--dry-run'])
    expect(read('next.config.ts')).toBe(before.nextConfig)
    expect(read('src/modules.ts')).toBe(before.modules)
    expect(fs.existsSync(path.join(tmpDir, 'src', 'instrumentation.ts'))).toBe(false)
    expect(JSON.parse(read('package.json')).dependencies['@open-mercato/telemetry']).toBeUndefined()
  })
})
