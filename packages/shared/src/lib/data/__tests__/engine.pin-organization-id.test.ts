import { registerEntityIds } from '../../encryption/entityIds'

const setRecordCustomFieldsMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: (...args: unknown[]) => setRecordCustomFieldsMock(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DefaultDataEngine, clearDataEngineTableExistsCache } = require('../engine')

const ENTITY_ID = 'example:todo'
const RECORD_ID = '11111111-1111-4111-8111-111111111111'

function buildDb() {
  const chain = {
    select: (_s: unknown) => chain,
    values: (_v: unknown) => chain,
    set: (_v: unknown) => chain,
    where: (_c: string, _o: string, _v: unknown) => chain,
    onConflict: (callback: (builder: { columns: (c: string[]) => { doUpdateSet: (v: unknown) => unknown } }) => unknown) => {
      callback({ columns: (_c) => ({ doUpdateSet: (_v) => ({}) }) })
      return chain
    },
    executeTakeFirst: async () => ({ present: 1, doc: { id: RECORD_ID }, numUpdatedRows: 1n }),
    execute: async () => [],
  }
  return {
    selectFrom: (_table: string) => chain,
    insertInto: (_table: string) => chain,
    updateTable: (_table: string) => chain,
    deleteFrom: (_table: string) => chain,
  }
}

function buildEngine() {
  const em = {
    getKysely: () => buildDb(),
    getMetadata: () => ({ find: () => undefined, getAll: () => [] }),
    find: async () => [],
    persist: () => undefined,
    flush: async () => undefined,
  }
  return new DefaultDataEngine(em as never, {} as never)
}

describe('DataEngine EAV backcompat pins organizationId (#6034 review)', () => {
  const previousFlag = process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM

  beforeEach(() => {
    registerEntityIds({ example: { todo: ENTITY_ID } })
    clearDataEngineTableExistsCache()
    setRecordCustomFieldsMock.mockClear()
    process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = 'true'
  })

  afterEach(() => {
    registerEntityIds({})
    if (previousFlag === undefined) delete process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM
    else process.env.ENTITIES_BACKCOMPAT_EAV_FOR_CUSTOM = previousFlag
  })

  // custom_entities_storage upserts on (entity_type, entity_id, organization_id), so the same
  // recordId can be a live record in two organizations of one tenant — the recordId-is-globally-
  // unique invariant `setRecordCustomFields` otherwise relies on does not hold here. Both backcompat
  // call sites must pin the reconciling delete/lookup to their own organization.
  test('createCustomEntityRecord passes pinOrganizationId: true to setRecordCustomFields', async () => {
    const engine = buildEngine()

    await engine.createCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: 'org-a',
      tenantId: 'tenant-1',
      values: { priority: 3 },
    })

    expect(setRecordCustomFieldsMock).toHaveBeenCalledTimes(1)
    expect(setRecordCustomFieldsMock.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-a',
      pinOrganizationId: true,
    })
  })

  test('updateCustomEntityRecord passes pinOrganizationId: true to setRecordCustomFields', async () => {
    const engine = buildEngine()

    await engine.updateCustomEntityRecord({
      entityId: ENTITY_ID,
      recordId: RECORD_ID,
      organizationId: 'org-a',
      tenantId: 'tenant-1',
      values: { priority: 3 },
    })

    expect(setRecordCustomFieldsMock).toHaveBeenCalledTimes(1)
    expect(setRecordCustomFieldsMock.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-a',
      pinOrganizationId: true,
    })
  })
})
