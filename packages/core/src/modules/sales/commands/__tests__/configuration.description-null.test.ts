/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import {
  deliveryWindowCreateSchema,
  deliveryWindowUpdateSchema,
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
} from '../../data/validators'

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: {
      sales_delivery_window: 'sales.sales_delivery_window',
      sales_payment_method: 'sales.sales_payment_method',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const TEST_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TEST_ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const RECORD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type PersistedRecord = Record<string, unknown>

function buildHarness(existing: PersistedRecord | null = null) {
  const persisted: PersistedRecord[] = []
  let em: Record<string, unknown>
  em = {
    fork: () => em,
    create: (_entity: unknown, data: PersistedRecord) => ({ id: RECORD_ID, ...data }),
    persist: (entity: PersistedRecord) => {
      persisted.push(entity)
    },
    findOne: async () => existing,
    flush: async () => undefined,
  }

  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ setCustomFields: jest.fn(async () => undefined) }),
  })

  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: TEST_ORG_ID,
    organizationIds: [TEST_ORG_ID],
  }

  return { persisted, ctx }
}

function getHandler(commandId: string) {
  const handler = commandRegistry.get<unknown, Record<string, unknown>>(commandId)
  expect(handler).toBeTruthy()
  return handler!
}

const scope = { organizationId: TEST_ORG_ID, tenantId: TEST_TENANT_ID }

beforeAll(async () => {
  commandRegistry.clear?.()
  await import('../configuration')
})

describe.each([
  {
    label: 'delivery window',
    createCommand: 'sales.delivery-windows.create',
    updateCommand: 'sales.delivery-windows.update',
    createSchema: deliveryWindowCreateSchema,
    updateSchema: deliveryWindowUpdateSchema,
    createBody: { ...scope, name: 'Next day', code: 'next-day' },
  },
  {
    label: 'payment method',
    createCommand: 'sales.payment-methods.create',
    updateCommand: 'sales.payment-methods.update',
    createSchema: paymentMethodCreateSchema,
    updateSchema: paymentMethodUpdateSchema,
    createBody: { ...scope, name: 'Bank transfer', code: 'bank-transfer' },
  },
])('$label commands store a null description as null', ({ createCommand, updateCommand, createSchema, updateSchema, createBody }) => {
  function buildExisting(): PersistedRecord {
    return {
      id: RECORD_ID,
      ...scope,
      name: createBody.name,
      code: createBody.code,
      description: 'Existing description',
      metadata: null,
      isActive: true,
    }
  }

  it('creates a record with a null description', async () => {
    const { persisted, ctx } = buildHarness()
    const input = createSchema.parse({ ...createBody, description: null })

    await getHandler(createCommand).execute(input, ctx)

    expect(persisted[0]?.description).toBeNull()
  })

  it('clears the description on an update with null', async () => {
    const existing = buildExisting()
    const { ctx } = buildHarness(existing)
    const input = updateSchema.parse({ id: RECORD_ID, ...scope, description: null })

    await getHandler(updateCommand).execute(input, ctx)

    expect(existing.description).toBeNull()
  })

  it('leaves the description untouched when the update omits it', async () => {
    const existing = buildExisting()
    const { ctx } = buildHarness(existing)
    const input = updateSchema.parse({ id: RECORD_ID, ...scope, name: 'Renamed' })

    await getHandler(updateCommand).execute(input, ctx)

    expect(existing.name).toBe('Renamed')
    expect(existing.description).toBe('Existing description')
  })
})
