/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesDayStrip } from '../ActivitiesDayStrip'
import type { InteractionSummary } from '../types'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

const loggerWarnMock = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }),
}))

function makeScheduledActivity(scheduledAt: Date): InteractionSummary {
  return {
    id: 'act-1',
    interactionType: 'meeting',
    title: 'Q2 review meeting',
    body: null,
    status: 'planned',
    scheduledAt: scheduledAt.toISOString(),
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: null,
    entityId: 'entity-1',
    dealId: null,
    organizationId: null,
    tenantId: null,
    authorName: null,
    authorEmail: null,
    dealTitle: null,
    customValues: null,
    duration: 25,
    createdAt: scheduledAt.toISOString(),
    updatedAt: scheduledAt.toISOString(),
  }
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

describe('ActivitiesDayStrip — aborted refreshes', () => {
  const selectedDate = (() => {
    const date = new Date()
    date.setHours(10, 0, 0, 0)
    return date
  })()

  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    loggerWarnMock.mockReset()
  })

  async function renderWithLoadedEvent() {
    readApiResultOrThrowMock.mockResolvedValueOnce({ items: [makeScheduledActivity(selectedDate)] })
    const view = renderWithProviders(
      <ActivitiesDayStrip entityId="person-1" selectedDate={selectedDate} onSelectDate={() => {}} refreshKey={0} />,
    )
    await screen.findByText(/1 event/)
    return view
  }

  function queueDeferredReload() {
    let rejectReload: (reason: unknown) => void = () => {}
    readApiResultOrThrowMock.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectReload = reject }),
    )
    return (reason: unknown) => rejectReload(reason)
  }

  it('keeps the loaded events and stays quiet when a refresh is aborted', async () => {
    const { rerender } = await renderWithLoadedEvent()
    const failReload = queueDeferredReload()

    rerender(
      <ActivitiesDayStrip entityId="person-1" selectedDate={selectedDate} onSelectDate={() => {}} refreshKey={1} />,
    )
    await act(async () => { failReload(createAbortError()) })

    expect(screen.getByText(/1 event/)).toBeInTheDocument()
    expect(loggerWarnMock).not.toHaveBeenCalled()
  })

  it('clears the events and reports the failure on a real load error', async () => {
    const { rerender } = await renderWithLoadedEvent()
    const failReload = queueDeferredReload()

    rerender(
      <ActivitiesDayStrip entityId="person-1" selectedDate={selectedDate} onSelectDate={() => {}} refreshKey={1} />,
    )
    await act(async () => { failReload(new Error('[internal] boom')) })

    expect(screen.queryByText(/1 event/)).toBeNull()
    expect(loggerWarnMock).toHaveBeenCalledTimes(1)
  })
})
