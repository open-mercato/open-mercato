/**
 * @jest-environment jsdom
 *
 * Step 2.9 (workflows UX Phase 3a, issue #4236): the inline business-rule
 * editor is owned by `business_rules` and embeddable by any module. Covers the
 * create round-trip (POST + `onSaved` with the new rule identity), the edit
 * round-trip (prefill from the rules API, PUT with the optimistic-lock header),
 * and the dependency-visibility slot the embedder fills.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { InlineRuleEditor } from '../InlineRuleEditor'

const mockScopedHeaders: Array<Record<string, string>> = []

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: jest.fn(),
  withScopedApiHeaders: jest.fn((headers: Record<string, string>, run: () => Promise<unknown>) => {
    mockScopedHeaders.push(headers)
    return run()
  }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ initialValues, onSubmit, submitLabel, extraActions }: {
    initialValues: Record<string, unknown>
    onSubmit: (values: Record<string, unknown>) => Promise<void>
    submitLabel: string
    extraActions?: React.ReactNode
  }) => (
    <div>
      <span data-testid="initial-rule-name">{String(initialValues.ruleName ?? '')}</span>
      <span data-testid="initial-entity-type">{String(initialValues.entityType ?? '')}</span>
      <button
        type="button"
        onClick={() => {
          void onSubmit({
            ...initialValues,
            ruleId: 'ORDER_LIMIT',
            ruleName: 'Order limit',
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
      {extraActions}
    </div>
  ),
}))

const apiFetchMock = apiFetch as jest.Mock

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  apiFetchMock.mockReset()
  mockScopedHeaders.length = 0
})

describe('InlineRuleEditor', () => {
  it('creates a rule and reports its identity back to the embedding module', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ id: 'rule-uuid-1' }, 201))
    const onSaved = jest.fn()
    const onOpenChange = jest.fn()

    renderWithProviders(
      <InlineRuleEditor
        open
        onOpenChange={onOpenChange}
        defaultEntityType="SalesOrder"
        onSaved={onSaved}
      />,
    )

    expect(screen.getByTestId('initial-entity-type')).toHaveTextContent('SalesOrder')

    fireEvent.click(screen.getByRole('button', { name: 'business_rules.rules.form.create' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const [url, init] = apiFetchMock.mock.calls[0]
    expect(url).toBe('/api/business_rules/rules')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ ruleId: 'ORDER_LIMIT', ruleName: 'Order limit', entityType: 'SalesOrder' })
    expect(onSaved).toHaveBeenCalledWith({ id: 'rule-uuid-1', ruleId: 'ORDER_LIMIT', ruleName: 'Order limit' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('prefills an existing rule and updates it with the optimistic-lock header', async () => {
    apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!init) {
        return jsonResponse({
          id: 'rule-uuid-2',
          ruleId: 'ORDER_LIMIT',
          ruleName: 'Existing rule',
          ruleType: 'GUARD',
          entityType: 'SalesOrder',
          enabled: true,
          priority: 100,
          version: 1,
          updatedAt: '2026-07-27T10:00:00.000Z',
        })
      }
      return jsonResponse({ ok: true })
    })
    const onSaved = jest.fn()

    renderWithProviders(
      <InlineRuleEditor open onOpenChange={jest.fn()} recordId="rule-uuid-2" onSaved={onSaved} />,
    )

    await waitFor(() => expect(screen.getByTestId('initial-rule-name')).toHaveTextContent('Existing rule'))

    fireEvent.click(screen.getByRole('button', { name: 'business_rules.rules.form.update' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const updateCall = apiFetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(updateCall).toBeDefined()
    expect(JSON.parse(updateCall![1].body)).toMatchObject({ id: 'rule-uuid-2' })
    expect(mockScopedHeaders.length).toBe(1)
    expect(Object.keys(mockScopedHeaders[0]).length).toBeGreaterThan(0)
  })

  it('renders the dependency-visibility slot supplied by the embedding module', () => {
    apiFetchMock.mockResolvedValue(jsonResponse({}))

    renderWithProviders(
      <InlineRuleEditor
        open
        onOpenChange={jest.fn()}
        usagePanel={<div data-testid="usage-slot">used by 3 workflows</div>}
      />,
    )

    expect(screen.getByTestId('usage-slot')).toBeInTheDocument()
  })
})
