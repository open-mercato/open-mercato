/**
 * @jest-environment jsdom
 */
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivityLogTab } from '../ActivityLogTab'

type HistoryProbeProps = { refreshKey?: number; onDataRefresh?: () => void }
type CardProbeProps = { refreshKey?: number }

const activityHistorySectionMock = jest.fn((_props: HistoryProbeProps) => null)
const activitiesCardMock = jest.fn((_props: CardProbeProps) => null)

jest.mock('../ActivityHistorySection', () => ({
  ActivityHistorySection: (props: HistoryProbeProps) => activityHistorySectionMock(props),
}))

jest.mock('../ActivitiesCard', () => ({
  ActivitiesCard: (props: CardProbeProps) => activitiesCardMock(props),
}))

describe('ActivityLogTab', () => {
  beforeEach(() => {
    activityHistorySectionMock.mockClear()
    activitiesCardMock.mockClear()
  })

  it('lets a history change reach the host so the week strip reloads with the same refresh key (#9487)', () => {
    const onActivityCreated = jest.fn()

    renderWithProviders(
      <ActivityLogTab
        entityId="company-123"
        plannedActivities={[]}
        onActivityCreated={onActivityCreated}
        onScheduleRequested={jest.fn()}
        onEditActivity={jest.fn()}
        refreshKey={7}
      />,
    )

    const historyProps = activityHistorySectionMock.mock.calls.at(-1)?.[0]
    expect(historyProps?.refreshKey).toBe(7)
    expect(activitiesCardMock.mock.calls.at(-1)?.[0].refreshKey).toBe(7)

    historyProps?.onDataRefresh?.()

    expect(onActivityCreated).toHaveBeenCalledTimes(1)
  })
})
