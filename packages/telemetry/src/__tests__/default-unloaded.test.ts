import fs from 'node:fs'
import path from 'node:path'
import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'

const repoRoot = path.resolve(__dirname, '../../../..')

const runtimeHosts = [
  'apps/mercato/src/instrumentation.ts',
  'apps/mercato/src/app/api/[...slug]/route.ts',
  'packages/create-app/template/src/instrumentation.ts',
  'packages/create-app/template/src/app/api/[...slug]/route.ts',
  'packages/cli/src/bin.ts',
  'packages/queue/src/tracing.ts',
  'packages/queue/src/strategies/async.ts',
  'packages/queue/src/worker/runner.ts',
]

describe('default-unloaded host wiring', () => {
  const originalBackend = process.env.TELEMETRY_BACKEND

  beforeAll(() => {
    delete process.env.TELEMETRY_BACKEND
  })

  afterAll(() => {
    if (originalBackend === undefined) delete process.env.TELEMETRY_BACKEND
    else process.env.TELEMETRY_BACKEND = originalBackend
  })

  it.each([
    [undefined, false],
    ['', false],
    ['noop', false],
    ['unknown', false],
    ['console', true],
    ['otlp', true],
    ['signoz', true],
    ['newrelic', true],
  ])('resolves backend %s to enabled=%s', (raw, expected) => {
    expect(isTelemetryBackendEnabled(raw)).toBe(expected)
  })

  it.each(runtimeHosts)('%s has no static telemetry runtime import', (relativePath) => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    expect(source).not.toMatch(/\bfrom\s+['"]@open-mercato\/telemetry(?:['"/])/)
  })

  it('Next config imports only the runtime-free telemetry config entrypoint', () => {
    for (const relativePath of [
      'apps/mercato/next.config.ts',
      'packages/create-app/template/next.config.ts',
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
      expect(source).toContain("from '@open-mercato/telemetry/nextjs-config'")
      expect(source).not.toContain("from '@open-mercato/telemetry/nextjs'")
    }
  })
})
