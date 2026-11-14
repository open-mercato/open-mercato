/**
 * @jest-environment jsdom
 */
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MiniWeekCalendar } from '../MiniWeekCalendar'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

function todayCall(title: string) {
  const scheduledAt = new Date()
  scheduledAt.setHours(12, 0, 0, 0)
  return {
    id: 'interaction-1',
    interactionType: 'call',
    title,
    body: null,
    status: 'planned',
    scheduledAt: scheduledAt.toISOString(),
    occurredAt: null,
    createdAt: scheduledAt.toISOString(),
    updatedAt: scheduledAt.toISOString(),
  }
}

describe('MiniWeekCalendar host refresh', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
  })

  it('reloads the week when the host refresh key changes so a deleted activity leaves the strip (#9487)', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [todayCall('Pricing call')] })

    const { rerender } = renderWithProviders(<MiniWeekCalendar entityId="person-1" refreshKey={0} />)

    expect(await screen.findByText('Pricing call')).toBeInTheDocument()
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)

    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
    rerender(<MiniWeekCalendar entityId="person-1" refreshKey={1} />)

    await waitFor(() => expect(screen.queryByText('Pricing call')).not.toBeInTheDocument())
    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(2)
  })

  it('does not reload while the host refresh key stays the same', async () => {
    readApiResultOrThrowMock.mockResolvedValue({ items: [todayCall('Pricing call')] })

    const { rerender } = renderWithProviders(<MiniWeekCalendar entityId="person-1" refreshKey={2} />)
    expect(await screen.findByText('Pricing call')).toBeInTheDocument()

    rerender(<MiniWeekCalendar entityId="person-1" refreshKey={2} />)

    expect(readApiResultOrThrowMock).toHaveBeenCalledTimes(1)
  })
})
