/**
 * @jest-environment jsdom
 *
 * The "Who" section's audience picker (design §7.1).
 *
 * `userTaskConfig.assigneeKind` has addressed a task to a portal customer since
 * the portal routes shipped, but it was authorable only through the Code view —
 * so the whole §6.4 portal branch was authorization over a set no Studio author
 * could put anything into. These drive the REAL inspector, like
 * `taskInspectorSections.test.tsx`, because what must not regress is that an
 * authored audience reaches `onSave` and comes back on reopen.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NodeEditDialogCrudForm } from '../NodeEditDialogCrudForm'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => '/backend/workflows',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

function renderInspector(data: Record<string, unknown>, nodeType = 'userTask') {
  const onSave = jest.fn()
  renderWithProviders(
    <NodeEditDialogCrudForm
      node={{ id: 'confirm-delivery', type: nodeType, position: { x: 0, y: 0 }, data } as any}
      isOpen
      onClose={jest.fn()}
      onSave={onSave}
      onDelete={jest.fn()}
    />,
  )
  return onSave
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'workflows.form.saveStep' }))
}

const audience = (kind: 'user' | 'customer') =>
  screen.getByRole('radio', { name: `workflows.tasks.inspector.who.audiences.${kind}` })

const modeTab = (mode: string) =>
  screen.queryByRole('tab', { name: `workflows.tasks.inspector.who.modes.${mode}` })

describe('Who — the portal audience picker', () => {
  it('offers both audiences on a user task, defaulting to the backoffice one', () => {
    renderInspector({ stepName: 'Confirm delivery' })

    expect(audience('user')).toBeChecked()
    expect(audience('customer')).not.toBeChecked()
    expect(screen.getByText('workflows.tasks.inspector.who.audienceUserHint')).toBeInTheDocument()
  })

  it('routing a task to a customer reaches onSave as assigneeKind', async () => {
    const onSave = renderInspector({
      stepName: 'Confirm delivery',
      assignedTo: '{{context.customer.userId}}',
      entityBindings: [{ entityType: 'customers:person', idPath: 'context.customer.personId' }],
      userTaskConfig: {
        assignedTo: '{{context.customer.userId}}',
        entityBindings: [{ entityType: 'customers:person', idPath: 'context.customer.personId' }],
      },
    })

    fireEvent.click(audience('customer'))
    save()

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [, updates] = onSave.mock.calls[0] as [string, Record<string, any>]
    expect(updates.userTaskConfig.assigneeKind).toBe('customer')
    expect(updates.userTaskConfig.assignedTo).toBe('{{context.customer.userId}}')
  })

  it('reopening a customer-addressed step shows the audience it was saved with', () => {
    renderInspector({
      stepName: 'Confirm delivery',
      assignedTo: '{{context.customer.userId}}',
      assigneeKind: 'customer',
      userTaskConfig: { assignedTo: '{{context.customer.userId}}', assigneeKind: 'customer' },
    })

    expect(audience('customer')).toBeChecked()
    expect(screen.getByText('workflows.tasks.inspector.who.audienceCustomerHint')).toBeInTheDocument()
  })

  it('a step left on the backoffice audience adds no assigneeKind to the save', async () => {
    const onSave = renderInspector({
      stepName: 'Approve invoice',
      assignedToRoles: ['finance_approver'],
      userTaskConfig: { assignedToRoles: ['finance_approver'] },
    })

    save()

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [, updates] = onSave.mock.calls[0] as [string, Record<string, any>]
    expect(updates.userTaskConfig).not.toHaveProperty('assigneeKind')
  })
})

describe('Who — what the customer audience gates', () => {
  it('drops the two modes that name no individual, and keeps the two that do', () => {
    renderInspector({ stepName: 'Confirm delivery' })

    expect(modeTab('role')).toBeInTheDocument()
    expect(modeTab('rule')).toBeInTheDocument()

    fireEvent.click(audience('customer'))

    // A role queue leaves `assignedTo` null so the row is created backoffice, and
    // `assignmentRule` is not read by `resolveTaskAssignment` at all.
    expect(modeTab('role')).not.toBeInTheDocument()
    expect(modeTab('rule')).not.toBeInTheDocument()
    expect(modeTab('user')).toBeInTheDocument()
    expect(modeTab('dynamic')).toBeInTheDocument()
  })

  it('a role-queue task switched to a customer lands on Dynamic and drops the inert rule', async () => {
    const onSave = renderInspector({
      stepName: 'Confirm delivery',
      assignmentRule: 'assign-by-region',
      userTaskConfig: { assignmentRule: 'assign-by-region' },
    })

    expect(modeTab('rule')).toHaveAttribute('data-state', 'active')

    fireEvent.click(audience('customer'))
    expect(modeTab('dynamic')).toHaveAttribute('data-state', 'active')

    save()
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const [, updates] = onSave.mock.calls[0] as [string, Record<string, any>]
    expect(updates.userTaskConfig.assigneeKind).toBe('customer')
    expect(updates.userTaskConfig).not.toHaveProperty('assignmentRule')
  })

  it('the shared Dynamic tab says the fallback queue is a backoffice one', () => {
    renderInspector({
      stepName: 'Confirm delivery',
      assignedTo: '{{context.customer.userId}}',
      assignedToRoles: ['support'],
      userTaskConfig: { assignedTo: '{{context.customer.userId}}', assignedToRoles: ['support'] },
    })

    expect(screen.getByText('workflows.tasks.inspector.who.fallbackRolesHint')).toBeInTheDocument()

    fireEvent.click(audience('customer'))

    expect(screen.queryByText('workflows.tasks.inspector.who.fallbackRolesHint')).not.toBeInTheDocument()
    expect(
      screen.getByText('workflows.tasks.inspector.who.customerFallbackRolesHint'),
    ).toBeInTheDocument()
  })

  it('warns at author time that a portal task nobody owns is invisible in the portal', () => {
    renderInspector({ stepName: 'Confirm delivery', assignedTo: '{{context.customer.userId}}' })

    fireEvent.click(audience('customer'))
    expect(
      screen.getByText('workflows.tasks.inspector.who.customerBindingRequired'),
    ).toBeInTheDocument()
  })

  it('the warning clears once the task is about a record', () => {
    renderInspector({
      stepName: 'Confirm delivery',
      assignedTo: '{{context.customer.userId}}',
      assigneeKind: 'customer',
      entityBindings: [{ entityType: 'customers:person', idPath: 'context.customer.personId' }],
      userTaskConfig: {
        assignedTo: '{{context.customer.userId}}',
        assigneeKind: 'customer',
        entityBindings: [{ entityType: 'customers:person', idPath: 'context.customer.personId' }],
      },
    })

    expect(
      screen.queryByText('workflows.tasks.inspector.who.customerBindingRequired'),
    ).not.toBeInTheDocument()
  })

  it('the Invoke Agent review section offers no audience — its task is always backoffice', () => {
    renderInspector(
      {
        stepName: 'Enrich deal',
        activities: [
          {
            activityId: 'invoke_agent',
            activityName: 'Invoke Agent',
            activityType: 'INVOKE_AGENT',
            config: { agentId: 'deal_enricher', review: { assignedToRoles: ['sales_lead'] } },
          },
        ],
      },
      'invokeAgent',
    )

    expect(screen.getByText('workflows.form.invokeAgent.review.whoTitle')).toBeInTheDocument()
    expect(
      screen.queryByRole('radio', { name: 'workflows.tasks.inspector.who.audiences.customer' }),
    ).not.toBeInTheDocument()
  })
})
