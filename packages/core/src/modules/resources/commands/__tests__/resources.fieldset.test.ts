/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudSideEffects: jest.fn().mockResolvedValue(undefined),
    emitCrudUndoSideEffects: jest.fn().mockResolvedValue(undefined),
    setCustomFieldsIfAny: jest.fn().mockResolvedValue(undefined),
  }
})

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const TEST_RESOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ROOM_FIELDSET = 'resources_resource_room'

function buildFakeEm() {
  return {
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: TEST_RESOURCE_ID, ...data })),
  }
}

function buildEnvelope(em: ReturnType<typeof buildFakeEm>) {
  const container = {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name === 'em') return { fork: jest.fn().mockReturnValue(em) }
      if (name === 'dataEngine') return {}
      return {}
    }),
  }
  const ctx = {
    container,
    auth: { tenantId: TEST_TENANT_ID, orgId: TEST_ORG_ID, isSuperAdmin: true, sub: 'user-1' },
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
    request: {} as Request,
    organizationScope: null,
  }
  return { container, ctx }
}

describe('resources commands — fieldset persistence (issue #2646)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../resources')
  })

  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset().mockResolvedValue(null)
  })

  it('create persists the chosen customFieldsetCode on the new record', async () => {
    const em = buildFakeEm()
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.create')

    await handler!.execute(
      { tenantId: TEST_TENANT_ID, organizationId: TEST_ORG_ID, name: 'Conference Room', customFieldsetCode: ROOM_FIELDSET },
      ctx as any,
    )

    const created = em.create.mock.calls.find(([, data]) => data && 'customFieldsetCode' in data)
    expect(created).toBeTruthy()
    expect(created![1]).toMatchObject({ customFieldsetCode: ROOM_FIELDSET })
  })

  it('update writes the chosen customFieldsetCode onto the existing record', async () => {
    const em = buildFakeEm()
    const record: Record<string, unknown> = {
      id: TEST_RESOURCE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      name: 'Conference Room',
      customFieldsetCode: null,
    }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.update')

    await handler!.execute(
      { id: TEST_RESOURCE_ID, customFieldsetCode: ROOM_FIELDSET },
      ctx as any,
    )

    expect(record.customFieldsetCode).toBe(ROOM_FIELDSET)
  })

  it('update leaves customFieldsetCode untouched when the field is omitted', async () => {
    const em = buildFakeEm()
    const record: Record<string, unknown> = {
      id: TEST_RESOURCE_ID,
      tenantId: TEST_TENANT_ID,
      organizationId: TEST_ORG_ID,
      name: 'Conference Room',
      customFieldsetCode: ROOM_FIELDSET,
    }
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(record)
    const { ctx } = buildEnvelope(em)
    const handler = commandRegistry.get('resources.resources.update')

    await handler!.execute({ id: TEST_RESOURCE_ID, name: 'Renamed Room' }, ctx as any)

    expect(record.customFieldsetCode).toBe(ROOM_FIELDSET)
    expect(record.name).toBe('Renamed Room')
  })
})
