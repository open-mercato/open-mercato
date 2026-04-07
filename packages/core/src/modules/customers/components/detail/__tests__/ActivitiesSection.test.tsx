/**
 * @jest-environment jsdom
 */
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesSection as CustomerActivitiesSection } from '../ActivitiesSection'

const sharedActivitiesSectionMock = jest.fn(() => null)
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 'scope-v1',
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  renderDictionaryColor: jest.fn(),
  renderDictionaryIcon: jest.fn(),
}))

jest.mock('../hooks/useCustomerDictionary', () => ({
  useCustomerDictionary: () => ({ data: { map: {} } }),
  ensureCustomerDictionary: jest.fn(async () => ({ entries: [], map: {} })),
  invalidateCustomerDictionary: jest.fn(async () => undefined),
}))

jest.mock('../hooks/useCustomFieldDisplay', () => ({
  useCustomFieldDisplay: () => ({
    definitions: [],
    dictionaryMapsByKey: {},
    isLoading: false,
    error: null,
  }),
}))

jest.mock('../CustomFieldValuesList', () => ({
  CustomFieldValuesList: () => null,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ActivitiesSection: (props: unknown) => {
    sharedActivitiesSectionMock(props)
    return null
  },
}))

describe('Customer ActivitiesSection wrapper', () => {
  beforeEach(() => {
    sharedActivitiesSectionMock.mockClear()
    readApiResultOrThrowMock.mockReset()
  })

  it('keeps the shared data adapter stable across rerenders and targets canonical interaction fields', () => {
    const props = {
      entityId: 'company-123',
      useCanonicalInteractions: true,
      addActionLabel: 'Log activity',
      emptyState: {
        title: 'No activities logged yet',
        actionLabel: 'Log activity',
      },
    }

    const { rerender } = renderWithProviders(<CustomerActivitiesSection {...props} />)
    const firstProps = sharedActivitiesSectionMock.mock.calls[sharedActivitiesSectionMock.mock.calls.length - 1]?.[0] as {
      dataAdapter: unknown
      customFieldEntityIds: string[]
    }

    rerender(<CustomerActivitiesSection {...props} />)
    const secondProps = sharedActivitiesSectionMock.mock.calls[sharedActivitiesSectionMock.mock.calls.length - 1]?.[0] as {
      dataAdapter: unknown
      customFieldEntityIds: string[]
    }

    expect(secondProps.dataAdapter).toBe(firstProps.dataAdapter)
    expect(secondProps.customFieldEntityIds).toEqual(['customers:customer_interaction'])
  })

  it('sorts upcoming canonical interactions ahead of historical activity items', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-30T12:00:00.000Z').getTime())
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'old-history',
          interactionType: 'call',
          status: 'done',
          occurredAt: '2026-03-20T10:00:00.000Z',
          scheduledAt: null,
          createdAt: '2026-03-20T10:00:00.000Z',
          updatedAt: '2026-03-20T10:00:00.000Z',
        },
        {
          id: 'upcoming-later',
          interactionType: 'meeting',
          status: 'planned',
          occurredAt: null,
          scheduledAt: '2026-04-02T09:00:00.000Z',
          createdAt: '2026-03-28T10:00:00.000Z',
          updatedAt: '2026-03-28T10:00:00.000Z',
        },
        {
          id: 'recent-history',
          interactionType: 'email',
          status: 'done',
          occurredAt: '2026-03-28T12:00:00.000Z',
          scheduledAt: null,
          createdAt: '2026-03-28T12:00:00.000Z',
          updatedAt: '2026-03-28T12:00:00.000Z',
        },
        {
          id: 'upcoming-soon',
          interactionType: 'note',
          status: 'planned',
          occurredAt: null,
          scheduledAt: '2026-03-31T09:00:00.000Z',
          createdAt: '2026-03-29T10:00:00.000Z',
          updatedAt: '2026-03-29T10:00:00.000Z',
        },
      ],
    })

    renderWithProviders(
      <CustomerActivitiesSection
        entityId="company-123"
        useCanonicalInteractions
        addActionLabel="Log activity"
        emptyState={{
          title: 'No activities logged yet',
          actionLabel: 'Log activity',
        }}
      />,
    )

    const props = sharedActivitiesSectionMock.mock.calls[sharedActivitiesSectionMock.mock.calls.length - 1]?.[0] as {
      dataAdapter: { list: (params: { entityId: string }) => Promise<Array<{ id: string }>> }
    }
    const items = await props.dataAdapter.list({ entityId: 'company-123' })

    expect(items.map((item) => item.id)).toEqual([
      'upcoming-soon',
      'upcoming-later',
      'recent-history',
      'old-history',
    ])

    nowSpy.mockRestore()
  })
})
