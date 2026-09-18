/** @jest-environment node */

import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { CustomFieldDefDto } from '@open-mercato/ui/backend/utils/customFieldDefs'
import {
  getRecordListRelationDisplays,
  resolveRecordListRelationDisplays,
  resolveRelationOptionsUrl,
} from '../recordListRelationDisplays'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const readApiResultMock = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>

function relationDefinition(overrides: Partial<CustomFieldDefDto> = {}): CustomFieldDefDto {
  return {
    key: 'related_order',
    kind: 'relation',
    optionsUrl: '/api/entities/relations/options?entityId=sales%3Asales_order',
    ...overrides,
  }
}

function readIdsFromUrl(url: string): string[] {
  return new URL(url, 'http://localhost').searchParams.get('ids')?.split(',') ?? []
}

describe('record-list relation displays', () => {
  beforeAll(() => {
    registerEntityIds({
      sales: { sales_order: 'sales:sales_order' },
      customers: { customer_entity: 'customers:customer_entity' },
    })
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('batches fields sharing a target while keeping display maps field-scoped', async () => {
    readApiResultMock.mockImplementation(async (url) => ({
      items: readIdsFromUrl(String(url)).map((recordId) => ({
        value: recordId,
        label: `Order ${recordId}`,
      })),
    }))
    const definitions = [
      relationDefinition(),
      relationDefinition({ key: 'alternate_orders' }),
    ]

    const displays = await resolveRecordListRelationDisplays(definitions, [
      { related_order: 'order-1', alternate_orders: ['order-2', 'order-1'] },
    ])

    expect(readApiResultMock).toHaveBeenCalledTimes(1)
    expect(displays.related_order).toEqual({
      'order-1': {
        label: 'Order order-1',
        href: '/backend/sales/orders/order-1',
      },
    })
    expect(displays.alternate_orders).toEqual({
      'order-1': {
        label: 'Order order-1',
        href: '/backend/sales/orders/order-1',
      },
      'order-2': {
        label: 'Order order-2',
        href: '/backend/sales/orders/order-2',
      },
    })
    expect(getRecordListRelationDisplays(['order-2', 'order-1'], displays.alternate_orders)).toEqual([
      { id: 'order-2', label: 'Order order-2', href: '/backend/sales/orders/order-2' },
      { id: 'order-1', label: 'Order order-1', href: '/backend/sales/orders/order-1' },
    ])
  })

  it('synthesizes the shared relation-options URL from relatedEntityId', async () => {
    readApiResultMock.mockResolvedValue({
      items: [{ value: 'case-1', label: 'Migration case study' }],
    })
    const definition = relationDefinition({
      key: 'case_study',
      optionsUrl: undefined,
      relatedEntityId: 'virtual:case_study',
    })

    const displays = await resolveRecordListRelationDisplays(
      [definition],
      [{ case_study: 'case-1' }],
    )

    expect(resolveRelationOptionsUrl(definition)).toBe(
      '/api/entities/relations/options?entityId=virtual%3Acase_study',
    )
    expect(readApiResultMock).toHaveBeenCalledWith(
      '/api/entities/relations/options?entityId=virtual%3Acase_study&ids=case-1',
      undefined,
      expect.any(Object),
    )
    expect(displays.case_study['case-1']).toEqual({
      label: 'Migration case study',
      href: '/backend/entities/user/virtual%3Acase_study/records/case-1',
    })
  })

  it('does not mix labels when different targets contain the same record id', async () => {
    readApiResultMock.mockImplementation(async (url) => {
      const entityId = new URL(String(url), 'http://localhost').searchParams.get('entityId')
      return {
        items: [{
          value: 'shared-id',
          label: entityId === 'sales:sales_order' ? 'Sales order' : 'Customer',
        }],
      }
    })
    const definitions = [
      relationDefinition({ key: 'order' }),
      relationDefinition({
        key: 'customer',
        optionsUrl: '/api/entities/relations/options?entityId=customers%3Acustomer_entity',
      }),
    ]

    const displays = await resolveRecordListRelationDisplays(definitions, [
      { order: 'shared-id', customer: 'shared-id' },
    ])

    expect(readApiResultMock).toHaveBeenCalledTimes(2)
    expect(displays.order['shared-id'].label).toBe('Sales order')
    expect(displays.customer['shared-id'].label).toBe('Customer')
  })

  it('chunks more than one hundred unique relation ids', async () => {
    readApiResultMock.mockImplementation(async (url) => ({
      items: readIdsFromUrl(String(url)).map((recordId) => ({ value: recordId, label: recordId })),
    }))
    const recordIds = Array.from({ length: 205 }, (_, index) => `order-${index + 1}`)

    const displays = await resolveRecordListRelationDisplays(
      [relationDefinition({ key: 'related_orders' })],
      [{ related_orders: recordIds }],
    )

    expect(readApiResultMock).toHaveBeenCalledTimes(3)
    expect(readIdsFromUrl(String(readApiResultMock.mock.calls[0]?.[0]))).toHaveLength(100)
    expect(readIdsFromUrl(String(readApiResultMock.mock.calls[1]?.[0]))).toHaveLength(100)
    expect(readIdsFromUrl(String(readApiResultMock.mock.calls[2]?.[0]))).toHaveLength(5)
    expect(Object.keys(displays.related_orders)).toHaveLength(205)
  })

  it('keeps raw ids when relation resolution fails', async () => {
    readApiResultMock.mockRejectedValue(new Error('lookup failed'))

    const displays = await resolveRecordListRelationDisplays(
      [relationDefinition({ key: 'related_orders' })],
      [{ related_orders: ['order-1', 'order-2'] }],
    )

    expect(getRecordListRelationDisplays(['order-1', 'order-2'], displays.related_orders)).toEqual([
      { id: 'order-1', label: 'order-1', href: '/backend/sales/orders/order-1' },
      { id: 'order-2', label: 'order-2', href: '/backend/sales/orders/order-2' },
    ])
  })
})
