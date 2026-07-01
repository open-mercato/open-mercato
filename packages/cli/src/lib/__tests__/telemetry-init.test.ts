import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { runTelemetryInit } from '../telemetry-init'

const DISPATCHER = `import { NextResponse, type NextRequest } from 'next/server'
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

const NEXT_CONFIG = `import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'esbuild',
  ],
}

export default nextConfig
`

function writeFixtureApp(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src', 'app', 'api', '[...slug]'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'modules.ts'), 'export const enabledModules = []\n')
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'my-app', dependencies: { '@open-mercato/shared': '1.2.3' } }, null, 2) + '\n',
  )
  fs.writeFileSync(path.join(dir, '.env.example'), 'DATABASE_URL=postgres://localhost/app\n')
  fs.writeFileSync(path.join(dir, 'next.config.ts'), NEXT_CONFIG)
  fs.writeFileSync(path.join(dir, 'src', 'app', 'api', '[...slug]', 'route.ts'), DISPATCHER)
}

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

  it('rejects a directory that is not an Open Mercato app', async () => {
    const code = await runTelemetryInit([])
    expect(code).toBe(1)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('wires all files in a pre-telemetry app', async () => {
    writeFixtureApp(tmpDir)
    const code = await runTelemetryInit([])
    expect(code).toBe(0)

    // package.json — dep pinned to the app's existing @open-mercato version + optional bullmq-otel
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.dependencies['@open-mercato/telemetry']).toBe('1.2.3')
    expect(pkg.optionalDependencies['bullmq-otel']).toBe('^1.3.1')

    // .env.example — commented block appended
    expect(read('.env.example')).toContain('TELEMETRY_BACKEND')
    expect(read('.env.example')).toContain('OTEL_EXPORTER_OTLP_ENDPOINT')

    // instrumentation.ts — created (did not exist)
    expect(read('src/instrumentation.ts')).toContain('registerTelemetryForNextjs')

    // next.config.ts — import + spread
    const nextConfig = read('next.config.ts')
    expect(nextConfig).toContain("@open-mercato/telemetry/nextjs")
    expect(nextConfig).toContain('...telemetryServerExternalPackages')

    // dispatcher — both imports + metric on success + reportError in catch
    const route = read('src/app/api/[...slug]/route.ts')
    expect(route).toContain("import { reportError } from '@open-mercato/telemetry'")
    expect(route).toContain("import { recordHttpDuration } from '@open-mercato/telemetry/nextjs'")
    expect(route).toContain('recordHttpDuration(method, match.route.path, finalResponse.status, startedAt)')
    expect(route).toContain('recordHttpDuration(method, match.route.path, 500, startedAt)')
    expect(route).toContain('reportError(error, {')
  })

  it('is idempotent — a second run changes nothing and does not double-insert', async () => {
    writeFixtureApp(tmpDir)
    await runTelemetryInit([])
    const after1 = {
      pkg: read('package.json'),
      env: read('.env.example'),
      instrumentation: read('src/instrumentation.ts'),
      nextConfig: read('next.config.ts'),
      route: read('src/app/api/[...slug]/route.ts'),
    }

    await runTelemetryInit([])
    expect(read('package.json')).toBe(after1.pkg)
    expect(read('.env.example')).toBe(after1.env)
    expect(read('src/instrumentation.ts')).toBe(after1.instrumentation)
    expect(read('next.config.ts')).toBe(after1.nextConfig)
    expect(read('src/app/api/[...slug]/route.ts')).toBe(after1.route)

    // single insertions, not doubled
    const route = read('src/app/api/[...slug]/route.ts')
    expect(route.match(/telemetryServerExternalPackages/g) ?? []).toBeTruthy()
    expect((read('next.config.ts').match(/@open-mercato\/telemetry\/nextjs/g) ?? []).length).toBe(1)
    expect((route.match(/from '@open-mercato\/telemetry'/g) ?? []).length).toBe(1)
  })

  it('flags a customized dispatcher as manual instead of editing it', async () => {
    writeFixtureApp(tmpDir)
    // A dispatcher without the recognizable anchors.
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app', 'api', '[...slug]', 'route.ts'),
      `export async function GET() { return new Response('custom') }\n`,
    )
    await runTelemetryInit([])
    const route = read('src/app/api/[...slug]/route.ts')
    expect(route).not.toContain('@open-mercato/telemetry')
    // the guidance snippet is printed for the manual step
    const printed = logSpy.mock.calls.flat().join('\n')
    expect(printed).toContain('manual step for src/app/api/[...slug]/route.ts')
  })

  it('dry run writes nothing', async () => {
    writeFixtureApp(tmpDir)
    const before = read('next.config.ts')
    await runTelemetryInit(['--dry-run'])
    expect(read('next.config.ts')).toBe(before)
    expect(fs.existsSync(path.join(tmpDir, 'src', 'instrumentation.ts'))).toBe(false)
    expect(JSON.parse(read('package.json')).dependencies['@open-mercato/telemetry']).toBeUndefined()
  })
})
