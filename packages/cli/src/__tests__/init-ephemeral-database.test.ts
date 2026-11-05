import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('guarded init uses the effective child database before mutation', () => {
  const ownedUrl = 'postgresql://owned:private-test-value@127.0.0.1:6543/owned_fixture'
  const marker = 'open-mercato-ephemeral:38ee43df-19e4-444e-b5c5-8e56b55c9d0c'
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalNodeEnv = process.env.NODE_ENV
  const originalRedisUrl = process.env.REDIS_URL
  const originalInitFlow = process.env.OM_INIT_FLOW
  const originalReinstall = process.env.OM_INIT_REINSTALL
  let directory: string
  let proofPath: string
  const query = jest.fn()
  const connect = jest.fn()
  const end = jest.fn()
  const clientConstructor = jest.fn()
  const generatorBoundary = jest.fn()

  beforeEach(() => {
    jest.resetModules()
    jest.restoreAllMocks()
    directory = mkdtempSync(path.join(os.tmpdir(), 'init-owned-database-'))
    proofPath = path.join(directory, 'guard.json')
    writeFileSync(proofPath, JSON.stringify({ version: 1, databaseName: 'owned_fixture', connectionDigest: createHash('sha256').update(ownedUrl).digest('hex'), ownershipMarker: marker }), { mode: 0o600 })
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = ownedUrl
    process.env.REDIS_URL = ''
    connect.mockReset().mockResolvedValue(undefined)
    end.mockReset().mockResolvedValue(undefined)
    query.mockReset().mockResolvedValue({ rows: [{ database_name: 'owned_fixture', ownership_marker: 'not-owned' }] })
    clientConstructor.mockReset().mockImplementation(() => ({ connect, query, end }))
    jest.doMock('pg', () => ({ Client: clientConstructor }))
    jest.doMock('../lib/resolver', () => ({ createResolver: () => ({ getAppDir: () => directory }) }))
    generatorBoundary.mockReset().mockRejectedValue(new Error('[internal] Test boundary prevents initialization writes.'))
    jest.doMock('../lib/generators', () => ({ generateEntityIds: generatorBoundary }))
    jest.doMock('../lib/db', () => ({ dbMigrate: jest.fn().mockRejectedValue(new Error('[internal] Test boundary prevents database migrations.')) }))
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.dontMock('pg')
    jest.dontMock('../lib/resolver')
    jest.dontMock('../lib/generators')
    jest.dontMock('../lib/db')
    jest.dontMock('ioredis')
    jest.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
    for (const [key, value] of Object.entries({ NODE_ENV: originalNodeEnv, REDIS_URL: originalRedisUrl, OM_INIT_FLOW: originalInitFlow, OM_INIT_REINSTALL: originalReinstall })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it.each([undefined, 'postgresql://control:other-test-value@127.0.0.1:6544/control_fixture'])('refuses stripped or replaced effective database configuration: %s', async (databaseUrl) => {
    if (databaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = databaseUrl
    const { run } = await import('../mercato')
    await expect(run(['node', 'mercato', 'init', '--reinstall', `--ephemeral-database-guard=${proofPath}`])).resolves.toBe(1)
    expect(clientConstructor).not.toHaveBeenCalled()
  })

  it('refuses the fallback loaded through the normal app dotenv path before any connection', async () => {
    delete process.env.DATABASE_URL
    writeFileSync(path.join(directory, '.env'), 'DATABASE_URL=postgresql://control:other-test-value@127.0.0.1:6544/control_fixture\n')
    const { run } = await import('../mercato')
    await expect(run(['node', 'mercato', 'init', '--reinstall', `--ephemeral-database-guard=${proofPath}`])).resolves.toBe(1)
    expect(clientConstructor).not.toHaveBeenCalled()
  })

  it('checks the actual connected ownership marker and never drops on a mismatch', async () => {
    const { run } = await import('../mercato')
    await expect(run(['node', 'mercato', 'init', '--reinstall', `--ephemeral-database-guard=${proofPath}`])).resolves.toBe(1)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    expect(query.mock.calls).toHaveLength(1)
    expect(query.mock.calls[0][0]).toMatch(/^SELECT current_database\(\)/)
  })

  it('rechecks ownership on the connection that would perform DROP', async () => {
    query.mockResolvedValueOnce({ rows: [{ database_name: 'owned_fixture', ownership_marker: marker }] })
    const { run } = await import('../mercato')
    await expect(run(['node', 'mercato', 'init', '--reinstall', `--ephemeral-database-guard=${proofPath}`])).resolves.toBe(1)
    expect(clientConstructor).toHaveBeenCalledTimes(2)
    expect(end).toHaveBeenCalledTimes(2)
    expect(query.mock.calls).toHaveLength(2)
    expect(query.mock.calls.every(([statement]) => String(statement).startsWith('SELECT'))).toBe(true)
  })

  it('does not flush an unowned Redis service after verifying the disposable database', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6533/0'
    const redisConstructor = jest.fn()
    jest.doMock('ioredis', () => ({ default: redisConstructor }))
    query.mockImplementation(async (statement: string) => ({
      rows: statement.startsWith('SELECT current_database')
        ? [{ database_name: 'owned_fixture', ownership_marker: marker }]
        : [],
    }))
    const { run } = await import('../mercato')
    await expect(run(['node', 'mercato', 'init', '--reinstall', `--ephemeral-database-guard=${proofPath}`])).resolves.toBe(1)
    expect(generatorBoundary).toHaveBeenCalledTimes(1)
    expect(redisConstructor).not.toHaveBeenCalled()
    expect(clientConstructor).toHaveBeenCalledTimes(2)
  })
})
