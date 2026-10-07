import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createDevRuntimeActionsRoute,
  createDevRuntimeLogsRoute,
  createDevRuntimeDiagnosticsRoute,
  createDevRuntimeStatusRoute,
} from '../routes'
import { readDevRuntimeStatus, resolveDevRuntimeServerConfig, type DevRuntimeServerConfig } from '../server'
import { DEV_RUNTIME_TOKEN_HEADER, type RuntimeStatus } from '../types'

const TOKEN = 'dev-runtime-token-fixture'

function createStatus(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    schemaVersion: 1,
    generation: 1,
    health: 'degraded',
    ready: true,
    failed: false,
    updatedAt: '2026-08-18T10:00:00.000Z',
    upstream: { configuredPort: 3000, publicUrl: 'http://localhost:3000' },
    incidents: [],
    legacy: { failureLines: [] },
    ...overrides,
  }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'om-dev-runtime-routes-'))
}

function createConfig(directory: string, overrides: Partial<DevRuntimeServerConfig> = {}): DevRuntimeServerConfig {
  return {
    enabled: true,
    bannerEnabled: true,
    token: TOKEN,
    statusFilePath: path.join(directory, 'status.json'),
    diagnosticsFilePath: path.join(directory, 'diagnostics.ndjson'),
    actionsFilePath: path.join(directory, 'actions.ndjson'),
    logsFilePath: path.join(directory, 'logs.json'),
    ...overrides,
  }
}

function writeStatusFile(config: DevRuntimeServerConfig, status: RuntimeStatus, token = TOKEN): void {
  fs.writeFileSync(config.statusFilePath!, JSON.stringify({ token, pid: process.pid, status }), 'utf8')
}

function statusRequest(headers: Record<string, string> = { [DEV_RUNTIME_TOKEN_HEADER]: TOKEN }): Request {
  return new Request('http://localhost:3000/api/dev-runtime/status', { headers })
}

function diagnosticsRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/dev-runtime/diagnostics', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [DEV_RUNTIME_TOKEN_HEADER]: TOKEN,
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('resolveDevRuntimeServerConfig', () => {
  const baseEnv = {
    NODE_ENV: 'development',
    OM_DEV_RUNTIME_DIAGNOSTICS: '1',
    OM_DEV_RUNTIME_TOKEN: TOKEN,
    OM_DEV_RUNTIME_STATUS_FILE: '/tmp/status.json',
    OM_DEV_RUNTIME_DIAGNOSTICS_FILE: '/tmp/diagnostics.ndjson',
  } as NodeJS.ProcessEnv

  it('enables diagnostics only for a supervised development process', () => {
    expect(resolveDevRuntimeServerConfig(baseEnv).enabled).toBe(true)
  })

  // `mercato dev` runs the Next.js dev server with NODE_ENV=production
  // (buildServerProcessEnvironment), so NODE_ENV cannot be the production guard
  // — the supervisor handshake is.
  it('stays enabled under NODE_ENV=production while the supervisor handshake is present', () => {
    expect(resolveDevRuntimeServerConfig({ ...baseEnv, NODE_ENV: 'production' }).enabled).toBe(true)
  })

  it('stays disabled for a deployed server that has no supervisor handshake', () => {
    // What a real `mercato server` process looks like: no token, no state files.
    expect(resolveDevRuntimeServerConfig({
      NODE_ENV: 'production',
      OM_DEV_RUNTIME_DIAGNOSTICS: '1',
    } as NodeJS.ProcessEnv).enabled).toBe(false)
  })

  it('stays disabled without an explicit flag', () => {
    const { OM_DEV_RUNTIME_DIAGNOSTICS: _flag, ...withoutFlag } = baseEnv
    expect(resolveDevRuntimeServerConfig(withoutFlag).enabled).toBe(false)
  })

  it('stays disabled when the supervisor did not supply a token or paths', () => {
    expect(resolveDevRuntimeServerConfig({ ...baseEnv, OM_DEV_RUNTIME_TOKEN: '' }).enabled).toBe(false)
    expect(resolveDevRuntimeServerConfig({ ...baseEnv, OM_DEV_RUNTIME_STATUS_FILE: '' }).enabled).toBe(false)
    expect(resolveDevRuntimeServerConfig({ ...baseEnv, OM_DEV_RUNTIME_DIAGNOSTICS_FILE: '' }).enabled).toBe(false)
  })

  it('honours the banner opt-out independently', () => {
    expect(resolveDevRuntimeServerConfig({ ...baseEnv, OM_DEV_RUNTIME_BANNER: '0' })).toMatchObject({
      enabled: true,
      bannerEnabled: false,
    })
  })
})

describe('readDevRuntimeStatus', () => {
  let directory: string

  beforeEach(() => { directory = createTempDir() })
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

  it('returns the supervisor status', () => {
    const config = createConfig(directory)
    writeStatusFile(config, createStatus())
    expect(readDevRuntimeStatus(config)?.health).toBe('degraded')
  })

  it('rejects a status file written by a different run', () => {
    const config = createConfig(directory)
    writeStatusFile(config, createStatus(), 'a-stale-token-of-len')
    expect(readDevRuntimeStatus(config)).toBeNull()
  })

  it('returns null for a missing or malformed file', () => {
    const config = createConfig(directory)
    expect(readDevRuntimeStatus(config)).toBeNull()
    fs.writeFileSync(config.statusFilePath!, 'not json', 'utf8')
    expect(readDevRuntimeStatus(config)).toBeNull()
    fs.writeFileSync(config.statusFilePath!, JSON.stringify({ token: TOKEN, status: { nope: true } }), 'utf8')
    expect(readDevRuntimeStatus(config)).toBeNull()
  })
})

describe('createDevRuntimeStatusRoute', () => {
  let directory: string

  beforeEach(() => { directory = createTempDir() })
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

  it('serves the supervisor status for a valid token', async () => {
    const config = createConfig(directory)
    writeStatusFile(config, createStatus())
    const GET = createDevRuntimeStatusRoute({ resolveConfig: () => config })

    const response = await GET(statusRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ health: 'degraded', generation: 1 })
  })

  it('returns 404 when diagnostics are disabled', async () => {
    const GET = createDevRuntimeStatusRoute({ resolveConfig: () => createConfig(directory, { enabled: false }) })
    const response = await GET(statusRequest())
    expect(response.status).toBe(404)
  })

  it('returns 403 for a missing or wrong token', async () => {
    const config = createConfig(directory)
    writeStatusFile(config, createStatus())
    const GET = createDevRuntimeStatusRoute({ resolveConfig: () => config })

    await expect(GET(statusRequest({})).then((r) => r.status)).resolves.toBe(403)
    await expect(
      GET(statusRequest({ [DEV_RUNTIME_TOKEN_HEADER]: 'wrong-token-value-xx' })).then((r) => r.status),
    ).resolves.toBe(403)
  })

  it('rejects a cross-origin request', async () => {
    const config = createConfig(directory)
    writeStatusFile(config, createStatus())
    const GET = createDevRuntimeStatusRoute({ resolveConfig: () => config })

    const response = await GET(statusRequest({
      [DEV_RUNTIME_TOKEN_HEADER]: TOKEN,
      origin: 'http://evil.example',
    }))
    expect(response.status).toBe(403)
  })

  it('returns 404 while the supervisor state is unavailable', async () => {
    const GET = createDevRuntimeStatusRoute({ resolveConfig: () => createConfig(directory) })
    const response = await GET(statusRequest())
    expect(response.status).toBe(404)
  })
})

describe('createDevRuntimeDiagnosticsRoute', () => {
  let directory: string
  let config: DevRuntimeServerConfig

  beforeEach(() => {
    directory = createTempDir()
    config = createConfig(directory)
  })
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

  function readSink(): Array<Record<string, unknown>> {
    if (!fs.existsSync(config.diagnosticsFilePath!)) return []
    return fs.readFileSync(config.diagnosticsFilePath!, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it('accepts a valid report and appends it to the local sink', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => config })
    const response = await POST(diagnosticsRequest({
      kind: 'global-error',
      message: 'TypeError: x is not a function',
      digest: 'abc123',
      path: '/backend/example',
    }))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ accepted: true })
    expect(readSink()).toEqual([expect.objectContaining({
      kind: 'global-error',
      message: 'TypeError: x is not a function',
      path: '/backend/example',
    })])
  })

  it('returns 404 when diagnostics are disabled', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => createConfig(directory, { enabled: false }) })
    const response = await POST(diagnosticsRequest({ kind: 'global-error', message: 'boom' }))
    expect(response.status).toBe(404)
    expect(readSink()).toEqual([])
  })

  it('returns 403 for a missing token', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => config })
    const request = new Request('http://localhost:3000/api/dev-runtime/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'global-error', message: 'boom' }),
    })
    expect((await POST(request)).status).toBe(403)
    expect(readSink()).toEqual([])
  })

  it('rejects a non-JSON content type', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => config })
    const request = new Request('http://localhost:3000/api/dev-runtime/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', [DEV_RUNTIME_TOKEN_HEADER]: TOKEN },
      body: 'boom',
    })
    expect((await POST(request)).status).toBe(400)
  })

  it('rejects an invalid schema', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => config })
    expect((await POST(diagnosticsRequest({ kind: 'shell-exec', message: 'boom' }))).status).toBe(400)
    expect((await POST(diagnosticsRequest({ kind: 'global-error' }))).status).toBe(400)
    expect((await POST(diagnosticsRequest({ kind: 'global-error', message: 'x', digest: 'a b' }))).status).toBe(400)
    expect((await POST(diagnosticsRequest('{not json'))).status).toBe(400)
    expect(readSink()).toEqual([])
  })

  it('rejects an oversized body before parsing it', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => config })
    const response = await POST(diagnosticsRequest({ kind: 'global-error', message: 'x'.repeat(20_000) }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'report_too_large' } })
  })

  it('redacts secrets before writing to the sink', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => config })
    await POST(diagnosticsRequest({
      kind: 'window-error',
      message: 'failed for postgres://admin:hunter2@localhost:5432/app',
      stack: 'cookie: om_session=super-secret',
    }))

    const written = JSON.stringify(readSink())
    expect(written).not.toContain('hunter2')
    expect(written).not.toContain('super-secret')
    expect(written).toContain('postgres://***')
  })

  it('rate limits a looping reporter', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({ resolveConfig: () => config })
    const statuses: number[] = []
    for (let index = 0; index < 35; index += 1) {
      statuses.push((await POST(diagnosticsRequest({ kind: 'global-error', message: `boom ${index}` }))).status)
    }
    expect(statuses.filter((status) => status === 202)).toHaveLength(30)
    expect(statuses.filter((status) => status === 429)).toHaveLength(5)
  })

  it('reports a collector failure instead of throwing', async () => {
    const POST = createDevRuntimeDiagnosticsRoute({
      resolveConfig: () => createConfig(directory, {
        diagnosticsFilePath: path.join(directory, 'missing-directory', 'diagnostics.ndjson'),
      }),
    })
    const response = await POST(diagnosticsRequest({ kind: 'global-error', message: 'boom' }))
    expect(response.status).toBe(503)
  })
})

describe('createDevRuntimeActionsRoute', () => {
  let directory: string
  let config: DevRuntimeServerConfig

  beforeEach(() => {
    directory = createTempDir()
    config = createConfig(directory)
  })
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

  function actionRequest(action: string, headers: Record<string, string> = { [DEV_RUNTIME_TOKEN_HEADER]: TOKEN }): [Request, { params: Promise<{ action: string }> }] {
    return [
      new Request(`http://localhost:3000/api/dev-runtime/actions/${action}`, { method: 'POST', headers }),
      { params: Promise.resolve({ action }) },
    ]
  }

  function readQueue(): Array<Record<string, unknown>> {
    if (!fs.existsSync(config.actionsFilePath!)) return []
    return fs.readFileSync(config.actionsFilePath!, 'utf8')
      .split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  it('queues an allowlisted action with the current generation', async () => {
    writeStatusFile(config, createStatus({ generation: 7 }))
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => config })

    const response = await POST(...actionRequest('migrate'))
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ accepted: true, generation: 7 })
    expect(readQueue()).toEqual([expect.objectContaining({ action: 'migrate', generation: 7 })])
  })

  it('rejects an action outside the allowlist without queueing anything', async () => {
    writeStatusFile(config, createStatus())
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => config })

    const response = await POST(...actionRequest('rm-rf'))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unknown_action' } })
    expect(readQueue()).toEqual([])
  })

  it('returns 403 for a missing or wrong token', async () => {
    writeStatusFile(config, createStatus())
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => config })

    expect((await POST(...actionRequest('restart', {}))).status).toBe(403)
    expect((await POST(...actionRequest('restart', { [DEV_RUNTIME_TOKEN_HEADER]: 'wrong-token-value-xx' }))).status).toBe(403)
    expect(readQueue()).toEqual([])
  })

  it('rejects a cross-origin request', async () => {
    writeStatusFile(config, createStatus())
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => config })
    const response = await POST(...actionRequest('restart', {
      [DEV_RUNTIME_TOKEN_HEADER]: TOKEN,
      origin: 'http://evil.example',
    }))
    expect(response.status).toBe(403)
  })

  it('returns 404 when diagnostics are disabled', async () => {
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => createConfig(directory, { enabled: false }) })
    expect((await POST(...actionRequest('restart'))).status).toBe(404)
  })

  it('reports a conflict while another action is running', async () => {
    writeStatusFile(config, createStatus({
      recovery: { action: 'generate', startedAt: '2026-08-18T10:00:00.000Z', busy: true },
    }))
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => config })

    const response = await POST(...actionRequest('migrate'))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'action_busy' } })
    expect(readQueue()).toEqual([])
  })

  it('reports 503 when the supervisor state is unavailable', async () => {
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => config })
    expect((await POST(...actionRequest('restart'))).status).toBe(503)
  })

  it('reports 503 when the supervisor exposed no action channel', async () => {
    const withoutChannel = createConfig(directory, { actionsFilePath: null })
    writeStatusFile(withoutChannel, createStatus())
    const POST = createDevRuntimeActionsRoute({ resolveConfig: () => withoutChannel })
    expect((await POST(...actionRequest('restart'))).status).toBe(503)
  })
})

describe('createDevRuntimeLogsRoute', () => {
  let directory: string
  let config: DevRuntimeServerConfig

  beforeEach(() => {
    directory = createTempDir()
    config = createConfig(directory)
  })
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

  function writeLogs(lines: Array<Record<string, unknown>>, token = TOKEN): void {
    fs.writeFileSync(config.logsFilePath!, JSON.stringify({ token, generation: 1, lines }), 'utf8')
  }

  function logsRequest(cursor?: number, headers: Record<string, string> = { [DEV_RUNTIME_TOKEN_HEADER]: TOKEN }): Request {
    const suffix = cursor === undefined ? '' : `?cursor=${cursor}`
    return new Request(`http://localhost:3000/api/dev-runtime/logs${suffix}`, { headers })
  }

  const LINES = [
    { seq: 1, at: '2026-08-18T10:00:01.000Z', generation: 1, source: 'log', text: 'first' },
    { seq: 2, at: '2026-08-18T10:00:02.000Z', generation: 1, source: 'log', text: 'second' },
  ]

  it('serves the bounded log tail', async () => {
    writeLogs(LINES)
    const GET = createDevRuntimeLogsRoute({ resolveConfig: () => config })
    const response = await GET(logsRequest())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ generation: 1, nextCursor: 2 })
  })

  it('honours the cursor so the view can poll incrementally', async () => {
    writeLogs(LINES)
    const GET = createDevRuntimeLogsRoute({ resolveConfig: () => config })
    const body = await (await GET(logsRequest(1))).json()
    expect(body.lines).toEqual([expect.objectContaining({ seq: 2, text: 'second' })])
  })

  it('restarts the snapshot on a malformed cursor instead of failing', async () => {
    writeLogs(LINES)
    const GET = createDevRuntimeLogsRoute({ resolveConfig: () => config })
    const response = await GET(new Request('http://localhost:3000/api/dev-runtime/logs?cursor=nope', {
      headers: { [DEV_RUNTIME_TOKEN_HEADER]: TOKEN },
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ nextCursor: 2 })
  })

  it('rejects a missing token, a wrong origin and a disabled runtime', async () => {
    writeLogs(LINES)
    const GET = createDevRuntimeLogsRoute({ resolveConfig: () => config })
    expect((await GET(logsRequest(0, {}))).status).toBe(403)
    expect((await GET(logsRequest(0, { [DEV_RUNTIME_TOKEN_HEADER]: TOKEN, origin: 'http://evil.example' }))).status).toBe(403)

    const disabled = createDevRuntimeLogsRoute({ resolveConfig: () => createConfig(directory, { enabled: false }) })
    expect((await disabled(logsRequest())).status).toBe(404)
  })

  it('rejects a log file written by a different run', async () => {
    writeLogs(LINES, 'a-stale-token-of-len')
    const GET = createDevRuntimeLogsRoute({ resolveConfig: () => config })
    expect((await GET(logsRequest())).status).toBe(404)
  })

  it('returns 404 when the supervisor published no logs', async () => {
    const GET = createDevRuntimeLogsRoute({ resolveConfig: () => config })
    expect((await GET(logsRequest())).status).toBe(404)
  })
})
