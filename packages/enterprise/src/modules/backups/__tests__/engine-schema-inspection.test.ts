/** @jest-environment node */
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from 'pg'
import { createPostgresSchemaInspector } from '../lib/engine/schema-inspection'
import { parsePassword, parseService } from '../lib/engine/postgres'
async function* bytes(value: Buffer) { yield value }
const fixture = process.env.OM_BACKUP_PG_FIXTURE
const integration = fixture ? describe : describe.skip
integration('offline PostgreSQL schema TOC inspector', () => {
  let workspace: string, bin: string, archive: Buffer, admin: Client, database: string
  beforeAll(async () => {
    workspace = await mkdtemp(join(fixture!, 'toc-inspection-')); await chmod(workspace, 0o700)
    bin = join(workspace, 'bin'); await mkdir(bin, { mode: 0o700 })
    const service = parseService(await readFile(join(fixture!, 'service.conf'), 'utf8'), 'source')
    const password = parsePassword(await readFile(join(fixture!, 'password'), 'utf8'), { host: service.host, port: service.port, dbname: service.dbname, user: service.user })
    admin = new Client({ host: service.host, port: Number(service.port), user: service.user, password, database: service.dbname, ssl: false }); await admin.connect()
    database = `toc_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`)
    const source = new Client({ host: service.host, port: Number(service.port), user: service.user, password, database, ssl: false }); await source.connect()
    try { await source.query('CREATE TABLE toc_test(id int PRIMARY KEY, body text)') } finally { await source.end() }
    const docker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim()
    const container = process.env.OM_BACKUP_PG_CONTAINER ?? 'om-pg-9333-fixture'
    if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error('Unsafe fixture container')
    await writeFile(join(bin, 'pg_restore'), `#!/bin/sh\nexec '${docker}' exec -i '${container}' pg_restore "$@"\n`, { mode: 0o700 })
    // Database use belongs only to fixture setup, never to the inspector.
    archive = execFileSync(docker, ['exec', container, 'pg_dump', '-U', service.user, '-d', database, '--schema-only', '--format=custom'], { maxBuffer: 1024 * 1024 })
  }, 30000)
  afterAll(async () => { if (admin) { await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`); await admin.end() }; if (workspace) await rm(workspace, { recursive: true, force: true }) })
  test('native pg_restore parses a real archive without reading connection credentials', async () => {
    const spy = jest.spyOn(Client.prototype, 'connect').mockImplementation(() => { throw new Error('Offline verification attempted a database connection') })
    try {
      await createPostgresSchemaInspector({ workspace, binariesDir: bin })(bytes(archive), 16)
      expect(spy).not.toHaveBeenCalled()
      expect((await readdir(workspace)).filter((name) => name.startsWith('schema-inspection-'))).toEqual([])
    } finally { spy.mockRestore() }
  })
  test('hash-valid malformed archive fails TOC parsing and removes plaintext staging', async () => {
    const malformed = Buffer.from('PGDMP malformed but externally hash-valid archive')
    expect(createHash('sha256').update(malformed).digest('hex')).toHaveLength(64)
    await expect(createPostgresSchemaInspector({ workspace, binariesDir: bin })(bytes(malformed),16)).rejects.toMatchObject({ code: 'BACKUP_SCHEMA_INSPECTION_FAILED', exitCode: 4 })
    expect((await readdir(workspace)).filter((name) => name.startsWith('schema-inspection-'))).toEqual([])
  })
  test('staging quota refuses before native TOC parsing and cleans plaintext', async () => {
    await expect(createPostgresSchemaInspector({ workspace, binariesDir: bin, maxStagingBytes: 8 })(bytes(archive),16)).rejects.toMatchObject({ code: 'BACKUP_OUTPUT_LIMIT' })
    expect((await readdir(workspace)).filter((name) => name.startsWith('schema-inspection-'))).toEqual([])
  })
  test('mismatched native major and unsafe workspace refuse before staging', async () => {
    await expect(createPostgresSchemaInspector({ workspace, binariesDir: bin })(bytes(archive),17)).rejects.toMatchObject({ code: 'BACKUP_CLIENT_MAJOR_MISMATCH' })
    const unsafe = await mkdtemp(join(tmpdir(), 'unsafe-toc-')); await chmod(unsafe,0o755)
    try { await expect(createPostgresSchemaInspector({ workspace:unsafe,binariesDir:bin })(bytes(archive),16)).rejects.toMatchObject({ code:'BACKUP_PRIVATE_DIRECTORY_REQUIRED' }) } finally { await rm(unsafe,{recursive:true,force:true}) }
  })
})
