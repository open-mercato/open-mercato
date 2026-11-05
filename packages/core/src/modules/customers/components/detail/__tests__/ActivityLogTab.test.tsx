/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

const composerMock = jest.fn()
const plannedMock = jest.fn()
const timelineMock = jest.fn()
jest.mock('../InlineActivityComposer', () => ({
  InlineActivityComposer: (props: Record<string, unknown>) => { composerMock(props); return <div>composer</div> },
}))
jest.mock('../PlannedActivitiesSection', () => ({
  PlannedActivitiesSection: (props: Record<string, unknown>) => { plannedMock(props); return <div>planned</div> },
}))
jest.mock('../ActivitiesSection', () => ({
  ActivitiesSection: (props: Record<string, unknown>) => { timelineMock(props); return <div>timeline</div> },
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

import { ActivityLogTab } from '../ActivityLogTab'

function lastProps(mock: jest.Mock): Record<string, unknown> {
  return mock.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

describe('ActivityLogTab', () => {
  beforeEach(() => {
    composerMock.mockClear()
    plannedMock.mockClear()
    timelineMock.mockClear()
  })

  it('renders the deal activity layout in order and scopes every section to the record', () => {
    const onActivityCreated = jest.fn()
    const onScheduleRequested = jest.fn()
    const onEditActivity = jest.fn()
    const runGuardedMutation = jest.fn()
    const onActionChange = jest.fn()
    render(
      <ActivityLogTab
        entityType="person"
        entityId="person-1"
        entityName="Jane Doe"
        plannedActivities={[{ id: 'int-1', interactionType: 'call', status: 'planned' } as never]}
        onActivityCreated={onActivityCreated}
        onScheduleRequested={onScheduleRequested}
        onEditActivity={onEditActivity}
        runGuardedMutation={runGuardedMutation}
        refreshKey={3}
        useCanonicalInteractions
        onActionChange={onActionChange}
      />,
    )

    const order = ['composer', 'planned', 'timeline'].map((text) => screen.getByText(text))
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(lastProps(composerMock)).toMatchObject({
      entityType: 'person',
      entityId: 'person-1',
      onActivityCreated,
      onScheduleRequested,
      runGuardedMutation,
      useCanonicalInteractions: true,
    })
    expect(lastProps(composerMock).dealId).toBeUndefined()
    expect(lastProps(plannedMock)).toMatchObject({ onSchedule: onScheduleRequested, onEdit: onEditActivity })
    expect((lastProps(plannedMock).activities as unknown[])).toHaveLength(1)
    expect(lastProps(plannedMock).onComplete).toBeUndefined()
    expect(lastProps(plannedMock).onCancel).toBeUndefined()
    expect(lastProps(timelineMock)).toMatchObject({
      entityId: 'person-1',
      entityName: 'Jane Doe',
      useCanonicalInteractions: true,
      runGuardedMutation,
      onDataRefresh: onActivityCreated,
      refreshKey: 3,
      onActionChange,
      onEditActivity,
      addActionLabel: 'customers.people.detail.activities.add',
      emptyState: {
        title: 'customers.people.detail.emptyState.activities.title',
        actionLabel: 'customers.people.detail.emptyState.activities.action',
      },
    })
    expect(lastProps(timelineMock).dealId).toBeUndefined()
  })

  it('defaults to company labels and forwards complete and cancel to the planned section', async () => {
    const onMarkDone = jest.fn(async () => {})
    const onCancelActivity = jest.fn(async () => {})
    render(
      <ActivityLogTab
        entityId="company-1"
        plannedActivities={[]}
        onScheduleRequested={() => {}}
        onEditActivity={() => {}}
        onMarkDone={onMarkDone}
        onCancelActivity={onCancelActivity}
      />,
    )
    expect(lastProps(composerMock).entityType).toBe('company')
    expect(lastProps(timelineMock).addActionLabel).toBe('customers.companies.detail.activities.add')
    ;(lastProps(plannedMock).onComplete as (id: string) => void)('int-1')
    ;(lastProps(plannedMock).onCancel as (id: string) => void)('int-2')
    expect(onMarkDone).toHaveBeenCalledWith('int-1')
    expect(onCancelActivity).toHaveBeenCalledWith('int-2')
  })

  it('lets the page override the timeline labels', () => {
    render(
      <ActivityLogTab
        entityType="company"
        entityId="company-1"
        plannedActivities={[]}
        onScheduleRequested={() => {}}
        onEditActivity={() => {}}
        addActionLabel="Custom add"
        emptyState={{ title: 'Nothing here', actionLabel: 'Add one' }}
      />,
    )
    expect(lastProps(timelineMock)).toMatchObject({ addActionLabel: 'Custom add', emptyState: { title: 'Nothing here', actionLabel: 'Add one' } })
  })
})
