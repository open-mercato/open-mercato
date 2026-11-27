import { randomUUID } from 'node:crypto'
import { EntitySchema } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'

const mockGetAuth = jest.fn<Promise<AuthContext>, []>()
const mockResolve = jest.fn<unknown, [string]>()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: () => mockGetAuth(),
  getAuthFromRequest: () => mockGetAuth(),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolve }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async ({ auth }: { auth: NonNullable<AuthContext> }) => ({
    selectedId: auth.orgId,
    filterIds: [auth.orgId],
    allowedIds: [auth.orgId],
    tenantId: auth.tenantId,
  }),
}))
jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string | null, run: () => Promise<unknown>) => run(),
}))

class RecoveryRecord {
  id!: string
  organizationId!: string
  tenantId!: string
  deletedAt!: Date | null
}

const recoveryRecordSchema = new EntitySchema<RecoveryRecord>({
  class: RecoveryRecord,
  tableName: 'recovery_list_records',
  properties: {
    id: { type: 'uuid', primary: true },
    organizationId: { type: 'uuid' },
    tenantId: { type: 'uuid' },
    deletedAt: { type: 'datetime', nullable: true },
  },
})

const listResult = z.object({ items: z.array(z.object({ id: z.uuid() })) })
const exportResult = z.array(z.object({ Id: z.uuid() }))
const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

function makeRecoveryList(allowWithDeleted: boolean) {
  return makeCrudRoute({
    metadata: { GET: { requireAuth: true } },
    orm: {
      entity: RecoveryRecord,
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
    list: {
      schema: z.object({ withDeleted: z.string().optional() }),
      allowWithDeleted,
      disableListCache: true,
      export: { enabled: true, formats: ['json'] },
    },
  })
}

function recoveryRequest(fullExport = false) {
  const url = new URL('http://localhost/api/example/recovery-list')
  url.searchParams.set('withDeleted', 'true')
  if (fullExport) {
    url.searchParams.set('format', 'json')
    url.searchParams.set('exportScope', 'full')
  }
  return new Request(url)
}

describePostgres('persisted deleted-record list scope', () => {
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  const liveId = randomUUID()
  const deletedId = randomUUID()
  let postgres: StartedTestContainer | undefined
  let orm: Awaited<ReturnType<typeof MikroORM.init>> | undefined

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    const databaseName = 'deleted_list_scope_test'
    const password = randomUUID()
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: databaseName, POSTGRES_PASSWORD: password })
      .withLabels({ 'open-mercato.test': 'deleted-list-scope' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: databaseName,
      user: 'postgres',
      password,
      entities: [recoveryRecordSchema],
    })
    await orm.schema.create()
    const entityManager = orm.em.fork()
    const deletedAt = new Date()
    const records = [
      { id: liveId, tenantId, organizationId, deletedAt: null },
      { id: deletedId, tenantId, organizationId, deletedAt },
      { id: randomUUID(), tenantId, organizationId: randomUUID(), deletedAt },
      { id: randomUUID(), tenantId: randomUUID(), organizationId, deletedAt },
    ]
    entityManager.persist(records.map((record) => entityManager.create(RecoveryRecord, record)))
    await entityManager.flush()
  }, 120_000)

  beforeEach(() => {
    mockGetAuth.mockReset().mockResolvedValue({ sub: randomUUID(), tenantId, orgId: organizationId })
    const entityManager = orm?.em.fork()
    mockResolve.mockReset().mockImplementation((name) => name === 'em' ? entityManager : undefined)
  })

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  it.each([true, false])('applies route deletion policy without widening organization or tenant scope (%s)', async (allowWithDeleted) => {
    const result = await makeRecoveryList(allowWithDeleted).GET(recoveryRequest())
    expect(result.status).toBe(200)
    const { items } = listResult.parse(await result.json())
    const expected = allowWithDeleted ? [liveId, deletedId] : [liveId]
    expect(items.map(({ id }) => id).sort()).toEqual(expected.sort())
  })

  it('keeps the persisted full export within the opted-in recovery scope', async () => {
    const result = await makeRecoveryList(true).GET(recoveryRequest(true))
    expect(result.status).toBe(200)
    const records = exportResult.parse(await result.json())
    expect(records.map(({ Id }) => Id).sort()).toEqual([liveId, deletedId].sort())
  })

  it('requires authentication for a recovery list', async () => {
    mockGetAuth.mockResolvedValue(null)
    const result = await makeRecoveryList(true).GET(recoveryRequest())
    expect(result.status).toBe(401)
    expect(mockResolve).not.toHaveBeenCalledWith('em')
  })
})
