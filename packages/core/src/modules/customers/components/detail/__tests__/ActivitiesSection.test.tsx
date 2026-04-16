/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesSection as CustomerActivitiesSection } from '../ActivitiesSection'

const activityTimelineMock = jest.fn(() => null)
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

jest.mock('../ActivityTimelineFilters', () => ({
  ActivityTimelineFilters: () => null,
}))

jest.mock('../ActivityTimeline', () => ({
  ActivityTimeline: (props: unknown) => {
    activityTimelineMock(props)
    return null
  },
}))

describe('Customer ActivitiesSection wrapper', () => {
  beforeEach(() => {
    activityTimelineMock.mockClear()
    readApiResultOrThrowMock.mockReset()
  })

  it('loads canonical interactions without hitting the legacy activities route', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
    const props = {
      entityId: 'company-123',
      useCanonicalInteractions: true,
      addActionLabel: 'Log activity',
      emptyState: {
        title: 'No activities logged yet',
        actionLabel: 'Log activity',
      },
    }

    renderWithProviders(<CustomerActivitiesSection {...props} />)

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/interactions?entityId=company-123&limit=50&sortField=occurredAt&sortDir=desc&excludeInteractionType=task',
      )
    })
    expect(readApiResultOrThrowMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/customers/activities?'))
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

    await waitFor(() => {
      const latestProps = activityTimelineMock.mock.calls[activityTimelineMock.mock.calls.length - 1]?.[0] as {
        activities: Array<{ id: string }>
      }
      expect(latestProps.activities).toHaveLength(4)
    })
    const timelineProps = activityTimelineMock.mock.calls[activityTimelineMock.mock.calls.length - 1]?.[0] as {
      activities: Array<{ id: string }>
    }

    expect(timelineProps.activities.map((item) => item.id)).toEqual([
      'upcoming-soon',
      'upcoming-later',
      'recent-history',
      'old-history',
    ])

    nowSpy.mockRestore()
  })

  it('loads additional canonical pages when the timeline requests more activity history', async () => {
    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url.includes('cursor=cursor-2')) {
        return Promise.resolve({
          items: [
            {
              id: 'page-2',
              interactionType: 'email',
              status: 'done',
              occurredAt: '2026-03-27T09:00:00.000Z',
              scheduledAt: null,
              createdAt: '2026-03-27T09:00:00.000Z',
              updatedAt: '2026-03-27T09:00:00.000Z',
            },
          ],
        })
      }

      return Promise.resolve({
        items: [
          {
            id: 'page-1',
            interactionType: 'call',
            status: 'done',
            occurredAt: '2026-03-29T09:00:00.000Z',
            scheduledAt: null,
            createdAt: '2026-03-29T09:00:00.000Z',
            updatedAt: '2026-03-29T09:00:00.000Z',
          },
        ],
        nextCursor: 'cursor-2',
      })
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

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        expect.stringContaining('cursor=cursor-2'),
      )
    })

    const timelineProps = activityTimelineMock.mock.calls[activityTimelineMock.mock.calls.length - 1]?.[0] as {
      activities: Array<{ id: string }>
    }

    expect(timelineProps.activities.map((item) => item.id)).toEqual(['page-1', 'page-2'])
  })
})
