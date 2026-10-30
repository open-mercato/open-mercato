/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import {
  clearPaymentGatewayDescriptors,
  registerPaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../../lib/defaults'
import { PAYER_FIELDS_NOT_COLLECTED_MESSAGE_KEY } from '../../lib/payerFieldRequirements'

const ORG_ID = '123e4567-e89b-12d3-a456-426614174000'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const LINK_ID = '123e4567-e89b-12d3-a456-426614174010'
const TEMPLATE_ID = '123e4567-e89b-12d3-a456-426614174020'
const FLUSH_SENTINEL = 'FLUSH_REACHED_AFTER_VALIDATION'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
}))

jest.mock('../../lib/gatewayProviderAvailability', () => ({
  ensureGatewayProviderConfigured: jest.fn(async () => undefined),
  getGatewayProviderConfigurationMessageKey: jest.fn(() => null),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  setCustomFieldsIfAny: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
  buildCustomFieldResetMap: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('../../events', () => ({
  emitCheckoutEvent: jest.fn(async () => undefined),
}))

import '../links'
import '../templates'

const mockEm = {
  flush: jest.fn(async () => {
    throw new Error(FLUSH_SENTINEL)
  }),
}

function makeContext(): CommandRuntimeContext {
  return {
    container: {
      resolve: (token: string) => {
        if (token === 'em') return mockEm
        if (token === 'dataEngine') return {}
        if (token === 'paymentGatewayDescriptorService') return {}
        throw new Error('not registered')
      },
    } as unknown as CommandRuntimeContext['container'],
    auth: { orgId: ORG_ID, tenantId: TENANT_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/checkout/links/x', { method: 'PUT' }),
  }
}

function storedRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Record',
    title: null,
    slug: 'record',
    templateId: null,
    status: 'draft',
    isLocked: false,
    pricingMode: 'fixed',
    gatewayProviderKey: 'payer_required',
    gatewaySettings: {},
    collectCustomerDetails: true,
    customerFieldsSchema: DEFAULT_CHECKOUT_CUSTOMER_FIELDS.map((field) => ({ ...field })),
    fixedPriceAmount: null,
    fixedPriceOriginalAmount: null,
    customAmountMin: null,
    customAmountMax: null,
    passwordHash: null,
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  }
}

async function runUpdate(commandId: string, input: Record<string, unknown>) {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`Command ${commandId} not registered`)
  return handler.execute(input, makeContext())
}

const payerFieldsRejection = {
  status: 422,
  body: { fieldErrors: { gatewayProviderKey: PAYER_FIELDS_NOT_COLLECTED_MESSAGE_KEY } },
}

describe.each([
  ['checkout.link.update', LINK_ID],
  ['checkout.template.update', TEMPLATE_ID],
])('%s payer-field validation on the merged state', (commandId, recordId) => {
  beforeAll(() => {
    clearPaymentGatewayDescriptors()
    registerPaymentGatewayDescriptor({
      providerKey: 'payer_required',
      label: 'Payer required',
      requiresPayerFields: ['email', 'name'],
    })
    registerPaymentGatewayDescriptor({ providerKey: 'no_payer', label: 'No payer data' })
  })

  afterAll(() => {
    clearPaymentGatewayDescriptors()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects a patch that turns off customer details for a provider requiring payer fields', async () => {
    mockFindOneWithDecryption.mockResolvedValue(storedRecord(recordId))
    await expect(runUpdate(commandId, { id: recordId, collectCustomerDetails: false }))
      .rejects.toMatchObject(payerFieldsRejection)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('rejects an unrelated patch while the stored record is still misconfigured', async () => {
    mockFindOneWithDecryption.mockResolvedValue(storedRecord(recordId, {
      customerFieldsSchema: DEFAULT_CHECKOUT_CUSTOMER_FIELDS.map((field) => (
        field.key === 'email' ? { ...field, required: false } : { ...field }
      )),
    }))
    await expect(runUpdate(commandId, { id: recordId, name: 'Renamed' }))
      .rejects.toMatchObject(payerFieldsRejection)
  })

  it('accepts a patch that fixes the stored misconfiguration', async () => {
    mockFindOneWithDecryption.mockResolvedValue(storedRecord(recordId, { collectCustomerDetails: false }))
    await expect(runUpdate(commandId, { id: recordId, collectCustomerDetails: true }))
      .rejects.toThrow(FLUSH_SENTINEL)
  })

  it('accepts a patch that switches to a provider declaring no payer fields', async () => {
    mockFindOneWithDecryption.mockResolvedValue(storedRecord(recordId, { collectCustomerDetails: false }))
    await expect(runUpdate(commandId, { id: recordId, gatewayProviderKey: 'no_payer' }))
      .rejects.toThrow(FLUSH_SENTINEL)
  })
})
