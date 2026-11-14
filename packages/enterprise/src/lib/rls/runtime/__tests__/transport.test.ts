import { installDatabaseTransportBoundary } from '../transport'
import { verifyRuntimeDatabaseRole } from '../roles'

jest.mock('../roles', () => ({ verifyRuntimeDatabaseRole: jest.fn() }))
const verifyRole = jest.mocked(verifyRuntimeDatabaseRole)
const descriptor = { id: 'fixture', kind: 'pool', mode: 'publish', channel: 'fixture_events' } as const
const command = ['SELECT pg_notify($1, $2)', ['fixture_events', '{}']] as const

beforeEach(() => { verifyRole.mockReset(); verifyRole.mockResolvedValue({} as Awaited<ReturnType<typeof verifyRuntimeDatabaseRole>>) })

function fixture() {
  const client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() }
  const pool = { query: jest.fn(async () => ({ rows: [] })), connect: jest.fn(async () => client) }
  const lifecycle = installDatabaseTransportBoundary(pool, descriptor, 'public')
  return { client, pool, lifecycle }
}

it('verifies the physical role and permits only the declared notification channel', async () => {
  const { pool, lifecycle, client } = fixture()
  await lifecycle.ready()
  expect(verifyRole).toHaveBeenCalledWith(client, ['public'])
  await expect(pool.query(...command)).resolves.toEqual({ rows: [] })
  for (const query of ['SELECT * FROM customer_entities', 'RESET ALL', 'LISTEN fixture_events']) {
    await expect(pool.query(query)).rejects.toThrow('rejects application SQL')
  }
  await expect(pool.query(command[0], ['other', '{}'])).rejects.toThrow('rejects application SQL')
  lifecycle.dispose()
})

it('bounds checked-out handles and refuses disposal until leases are released', async () => {
  const { pool, lifecycle } = fixture()
  const client = await pool.connect()
  await expect(client.query('SELECT 1')).rejects.toThrow('rejects application SQL')
  expect(() => lifecycle.dispose()).toThrow('drain')
  await client.query(...command)
  client.release()
  await expect(client.query(...command)).rejects.toThrow('released')
  expect(() => client.release()).toThrow('released')
  lifecycle.dispose()
})

it('returns callback errors without issuing application SQL', async () => {
  const { pool, lifecycle } = fixture()
  const query = pool.query as unknown as (text: string, callback: (error: Error | null) => void) => void
  const error = await new Promise<Error | null>((resolve) => query.call(pool, 'SELECT 1', resolve))
  expect(error?.message).toContain('rejects application SQL')
  lifecycle.dispose()
})

it('fails role readiness closed and releases the physical verification lease', async () => {
  verifyRole.mockRejectedValue(new Error('unsafe role'))
  const { pool, client, lifecycle } = fixture()
  await expect(pool.query(...command)).rejects.toThrow('unsafe role')
  expect(client.release).toHaveBeenCalledTimes(1)
  lifecycle.dispose()
})

it('verifies a dedicated listener and refuses publication or other SQL', async () => {
  const query = jest.fn(async () => ({ rows: [] }))
  const client = { query }
  const lifecycle = installDatabaseTransportBoundary(client, { ...descriptor, kind: 'client', mode: 'listen' }, 'public')
  await lifecycle.ready()
  await expect(client.query('LISTEN fixture_events')).resolves.toEqual({ rows: [] })
  await expect(client.query(...command)).rejects.toThrow('rejects application SQL')
  await expect(client.query('LISTEN other')).rejects.toThrow('rejects application SQL')
  lifecycle.dispose()
  expect(client.query).toBe(query)
})
