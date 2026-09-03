/**
 * @jest-environment jsdom
 *
 * Step 2.9 (workflows UX Phase 3a, issue #4236): the Studio embeds the
 * business_rules-owned inline editor next to `BusinessRulesSelector`. Covers
 * the "New rule" affordance, the selector refreshing so the freshly created
 * rule is picked up and selected, and the workflows-owned usage panel that
 * fills the editor's dependency-visibility slot.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { BusinessRulesSelector } from '../BusinessRulesSelector'
import { BusinessRuleUsagePanel } from '../BusinessRuleUsagePanel'

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: jest.fn(),
  withScopedApiHeaders: jest.fn((_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ onSubmit, submitLabel }: {
    onSubmit: (values: Record<string, unknown>) => Promise<void>
    submitLabel: string
  }) => (
    <button
      type="button"
      onClick={() => {
        void onSubmit({
          ruleId: 'NEW_RULE',
          ruleName: 'Freshly authored',
          ruleType: 'GUARD',
          entityType: 'SalesOrder',
          enabled: true,
          priority: 100,
          version: 1,
        })
      }}
    >
      {submitLabel}
    </button>
  ),
}))

const apiFetchMock = apiFetch as jest.Mock

const EXISTING_RULE = {
  id: 'existing-uuid',
  ruleId: 'EXISTING_RULE',
  ruleName: 'Existing rule',
  description: null,
  ruleType: 'GUARD',
  ruleCategory: null,
  entityType: 'SalesOrder',
  eventType: null,
  enabled: true,
}

const CREATED_RULE = {
  id: 'new-uuid',
  ruleId: 'NEW_RULE',
  ruleName: 'Freshly authored',
  description: null,
  ruleType: 'GUARD',
  ruleCategory: null,
  entityType: 'SalesOrder',
  eventType: null,
  enabled: true,
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
})

beforeEach(() => {
  apiFetchMock.mockReset()
})

describe('inline business-rule editing from the workflow Studio', () => {
  it('creates a rule inline and the selector refreshes to include it', async () => {
    let listCallCount = 0
    apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ id: 'new-uuid' }, 201)
      if (String(url).startsWith('/api/business_rules/rules?')) {
        listCallCount += 1
        return jsonResponse({ items: listCallCount === 1 ? [EXISTING_RULE] : [EXISTING_RULE, CREATED_RULE] })
      }
      return jsonResponse({})
    })

    const onSelect = jest.fn()
    renderWithProviders(
      <BusinessRulesSelector isOpen onClose={jest.fn()} onSelect={onSelect} filterEntityType="SalesOrder" />,
    )

    await waitFor(() => expect(screen.getByText('Existing rule')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /workflows\.businessRules\.newRule/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'business_rules.rules.form.create' }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('NEW_RULE', expect.objectContaining({ id: 'new-uuid' })))
    expect(listCallCount).toBe(2)
  })

  it('renders the workflows usage panel for a rule', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({
      ruleId: 'EXISTING_RULE',
      workflowCount: 2,
      references: [
        { workflowId: 'order-approval', version: 1, workflowName: 'Order approval', kind: 'transitionPreCondition', locationId: 'e_a_b' },
        { workflowId: 'refund-flow', version: 1, kind: 'startPreCondition', locationId: 'start' },
      ],
    }))

    renderWithProviders(<BusinessRuleUsagePanel ruleId="EXISTING_RULE" />)

    await waitFor(() => expect(screen.getByText('workflows.businessRules.usage.workflowCount')).toBeInTheDocument())
    expect(screen.getByText('Order approval')).toBeInTheDocument()
    expect(screen.getByText('refund-flow')).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith('/api/workflows/rule-usage?ruleId=EXISTING_RULE')
  })

  it('degrades to a hint when the usage lookup fails', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500))

    renderWithProviders(<BusinessRuleUsagePanel ruleId="EXISTING_RULE" />)

    await waitFor(() => expect(screen.getByText('workflows.businessRules.usage.unavailable')).toBeInTheDocument())
  })
})
