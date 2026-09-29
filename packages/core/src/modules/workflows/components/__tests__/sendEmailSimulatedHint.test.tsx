/**
 * @jest-environment jsdom
 *
 * SEND_EMAIL authoring-path warning (PR #4532 review): without a configured
 * email service the runtime only simulates delivery, so the activity editors
 * must surface a muted hint on SEND_EMAIL activities in both the legacy
 * ActivitiesEditor and the CrudForm ActivityArrayEditor path.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesEditor } from '../ActivitiesEditor'
import { ActivityArrayEditor } from '../fields/ActivityArrayEditor'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

const HINT_KEY = 'workflows.activities.sendEmailSimulatedHint'

const sendEmailActivity = {
  activityId: 'send_welcome',
  activityName: 'Welcome Email',
  activityType: 'SEND_EMAIL' as const,
  config: { to: 'user@example.com', subject: 'Welcome' },
}

const callApiActivity = {
  activityId: 'call_api',
  activityName: 'Call API',
  activityType: 'CALL_API' as const,
  config: {},
}

describe('ActivitiesEditor SEND_EMAIL simulated-delivery hint', () => {
  it('shows the hint on SEND_EMAIL activities only', () => {
    renderWithProviders(
      <ActivitiesEditor value={[sendEmailActivity, callApiActivity]} onChange={jest.fn()} />,
    )
    expect(screen.getAllByText(HINT_KEY)).toHaveLength(1)
  })
})

describe('ActivityArrayEditor SEND_EMAIL simulated-delivery hint', () => {
  it('shows the hint when a SEND_EMAIL activity is expanded', () => {
    renderWithProviders(
      <ActivityArrayEditor
        id="activities"
        value={[sendEmailActivity]}
        setValue={jest.fn()}
        disabled={false}
      />,
    )

    expect(screen.queryByText(HINT_KEY)).toBeNull()
    fireEvent.click(screen.getByText('Welcome Email'))
    expect(screen.getByText(HINT_KEY)).toBeTruthy()
  })
})
