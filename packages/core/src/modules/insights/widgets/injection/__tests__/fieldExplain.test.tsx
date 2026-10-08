/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockApiCall = jest.fn()
const mockReadApiResultOrThrow = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
}))

import FieldWhyWidget from '../field-why/widget.client'
import FieldExplainToggleWidget from '../field-explain-toggle/widget.client'
import fieldWhyModule from '../field-why/widget'
import fieldExplainToggleModule from '../field-explain-toggle/widget'
import { resetExplainDescriptorsCache } from '../../../lib/client/useExplainDescriptors'
import { resetExplainModeState, setExplainMode } from '../../../lib/client/explainMode'
import { INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID } from '../../../lib/fieldExplainToggle'
import { DEAL_ID, DICT, apiOk, dealDescriptor, fieldResponse } from '../../../components/__tests__/fixtures'

const FORM_ENTITY_ID = 'customers.deal'
const FLAG_PATH = '/api/feature_toggles/check/boolean'

type FlagState = { kind: 'value'; value: boolean } | { kind: 'missing' } | { kind: 'pending' }

let flagState: FlagState = { kind: 'value', value: true }

function routeApi(responses: Record<string, unknown>) {
  mockApiCall.mockImplementation((input: unknown) => {
    const url = new URL(String(input), 'http://localhost')
    const field = url.searchParams.get('field')
    const key = field ? `${url.pathname}#${field}` : url.pathname
    const body = responses[key] ?? responses[url.pathname]
    return Promise.resolve(body === undefined ? { ok: false, status: 404, result: null, response: {}, cacheStatus: null } : apiOk(body))
  })
}

function explainCalls(): URL[] {
  return mockApiCall.mock.calls
    .map((call) => new URL(String(call[0]), 'http://localhost'))
    .filter((url) => url.pathname.startsWith('/api/insights/'))
}

function fieldContext(fieldId: string, overrides: Record<string, unknown> = {}) {
  return { entityId: FORM_ENTITY_ID, recordId: DEAL_ID, fieldId, ...overrides }
}

function headerContext(overrides: Record<string, unknown> = {}) {
  return {
    formId: 'deal-form',
    entityId: 'customers:customer_deal',
    injectionSpotId: `crud-form:${FORM_ENTITY_ID}`,
    recordId: DEAL_ID,
    operation: 'update',
    ...overrides,
  }
}

function renderUi(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(ui, { dict: DICT, queryClient })
}

function FormHarness({ fieldIds }: { fieldIds: string[] }) {
  return (
    <div>
      <FieldExplainToggleWidget context={headerContext()} />
      {fieldIds.map((fieldId) => (
        <div key={fieldId} data-field={fieldId}>
          <FieldWhyWidget context={fieldContext(fieldId)} />
        </div>
      ))}
    </div>
  )
}

describe('insights field explain widgets', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockReadApiResultOrThrow.mockReset()
    mockReadApiResultOrThrow.mockImplementation((input: unknown) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname !== FLAG_PATH || url.searchParams.get('identifier') !== INSIGHTS_FIELD_EXPLAIN_TOGGLE_ID) {
        return Promise.reject(new Error('unexpected flag request'))
      }
      if (flagState.kind === 'pending') return new Promise(() => {})
      if (flagState.kind === 'missing') return Promise.reject(Object.assign(new Error('missing'), { status: 404 }))
      return Promise.resolve({ ok: true, value: flagState.value })
    })
    flagState = { kind: 'value', value: true }
    resetExplainDescriptorsCache()
    resetExplainModeState()
    window.localStorage.clear()
    routeApi({
      '/api/insights/explain/descriptors': { resources: [dealDescriptor({ customFields: { entityId: 'customers:customer_deal', allowKeys: null } })] },
      '/api/insights/explain#status': fieldResponse(),
    })
  })

  it('declares feature-gated widgets bound to the customers forms', () => {
    expect(fieldWhyModule.metadata.id).toBe('insights.injection.field-why')
    expect(fieldWhyModule.metadata.features).toEqual(['insights.explain.view'])
    expect(fieldWhyModule.metadata.requiredModules).toEqual(['customers'])
    expect(fieldExplainToggleModule.metadata.id).toBe('insights.injection.field-explain-toggle')
    expect(fieldExplainToggleModule.metadata.features).toEqual(['insights.explain.view'])
  })

  it('keeps the field button hidden and silent until explain mode is on', async () => {
    const { container } = renderUi(<FieldWhyWidget context={fieldContext('status')} />)
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(explainCalls()).toEqual([])
  })

  it('renders nothing without a record, a field or a form entity', () => {
    setExplainMode(FORM_ENTITY_ID, true)
    const { container } = renderUi(
      <>
        <FieldWhyWidget context={fieldContext('status', { recordId: undefined })} />
        <FieldWhyWidget context={fieldContext('status', { fieldId: '' })} />
        <FieldWhyWidget context={fieldContext('status', { entityId: null })} />
      </>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(mockReadApiResultOrThrow).not.toHaveBeenCalled()
  })

  it('shows buttons only for explainable fields and opens the drawer on the clicked field', async () => {
    setExplainMode(FORM_ENTITY_ID, true)
    const { container } = renderUi(<FormHarness fieldIds={['status', 'description', 'cf_priority']} />)

    const trigger = await screen.findByRole('button', { name: 'Why does Status have this value?' })
    expect(container.querySelector('[data-field="status"] [data-testid="insights-field-why-trigger"]')).toBe(trigger)
    expect(container.querySelector('[data-field="description"] [data-testid="insights-field-why-trigger"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Why does Custom field: priority have this value?' })).toBeInTheDocument()

    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByTestId('insights-why-chain')).toBeInTheDocument()
    const explainRequest = explainCalls().find((url) => url.pathname === '/api/insights/explain')
    expect(explainRequest?.searchParams.get('resourceKind')).toBe('customers.deal')
    expect(explainRequest?.searchParams.get('resourceId')).toBe(DEAL_ID)
    expect(explainRequest?.searchParams.get('field')).toBe('status')
  })

  it('turns the field buttons on and off from the header switch and remembers the choice', async () => {
    renderUi(<FormHarness fieldIds={['status', 'title']} />)

    const explainSwitch = await screen.findByRole('switch', { name: 'Explain fields' })
    expect(explainSwitch).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('insights-field-why-trigger')).toBeNull()

    fireEvent.click(explainSwitch)
    expect(await screen.findAllByTestId('insights-field-why-trigger')).toHaveLength(2)
    expect(window.localStorage.getItem(`om:insights:explain-mode:${FORM_ENTITY_ID}`)).toBe('true')

    fireEvent.click(screen.getByRole('switch', { name: 'Explain fields' }))
    await waitFor(() => expect(screen.queryByTestId('insights-field-why-trigger')).toBeNull())
    expect(screen.getByRole('switch', { name: 'Explain fields' })).toHaveAttribute('aria-checked', 'false')
    expect(window.localStorage.getItem(`om:insights:explain-mode:${FORM_ENTITY_ID}`)).toBeNull()
  })

  it('hides the switch in create mode, on undeclared forms and without explainable fields', async () => {
    const { container } = renderUi(
      <>
        <FieldExplainToggleWidget context={headerContext({ recordId: undefined, operation: 'create' })} />
        <FieldExplainToggleWidget context={headerContext({ injectionSpotId: 'crud-form:catalog.product' })} />
        <FieldExplainToggleWidget context={headerContext({ injectionSpotId: null })} />
      </>,
    )
    await waitFor(() => expect(explainCalls().length).toBeGreaterThan(0))
    expect(container).toBeEmptyDOMElement()

    resetExplainDescriptorsCache()
    routeApi({ '/api/insights/explain/descriptors': { resources: [dealDescriptor({ fields: [] })] } })
    const empty = renderUi(<FieldExplainToggleWidget context={headerContext()} />)
    await waitFor(() => expect(explainCalls().length).toBeGreaterThan(0))
    expect(empty.container).toBeEmptyDOMElement()
  })

  it('hides the switch and the buttons when the kill switch is off', async () => {
    flagState = { kind: 'value', value: false }
    setExplainMode(FORM_ENTITY_ID, true)
    const { container } = renderUi(<FormHarness fieldIds={['status']} />)
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalled())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(container.querySelector('[data-testid="insights-field-explain-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="insights-field-why-trigger"]')).toBeNull()
    expect(explainCalls()).toEqual([])
  })

  it('keeps everything hidden while the kill switch is being checked', async () => {
    flagState = { kind: 'pending' }
    setExplainMode(FORM_ENTITY_ID, true)
    const { container } = renderUi(<FormHarness fieldIds={['status']} />)
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="insights-field-explain-toggle"]')).toBeNull()
    expect(container.querySelector('[data-testid="insights-field-why-trigger"]')).toBeNull()
  })

  it('fails open when the toggle cannot be resolved (feature_toggles disabled or toggle missing)', async () => {
    flagState = { kind: 'missing' }
    setExplainMode(FORM_ENTITY_ID, true)
    renderUi(<FormHarness fieldIds={['status']} />)
    expect(await screen.findByRole('switch', { name: 'Explain fields' })).toHaveAttribute('aria-checked', 'true')
    expect(await screen.findByRole('button', { name: 'Why does Status have this value?' })).toBeInTheDocument()
  })
})
