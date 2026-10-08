/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
}))

import RecordWhyWidget from '../record-why/widget.client'
import DealStatusWhyWidget from '../deal-status-why/widget.client'
import LogCauseWidget from '../log-cause/widget.client'
import AccessWhyWidget from '../access-why/widget.client'
import recordWhyModule from '../record-why/widget'
import dealStatusWhyModule from '../deal-status-why/widget'
import logCauseModule from '../log-cause/widget'
import accessWhyModule from '../access-why/widget'
import injectionTable from '../../injection-table'
import { resetExplainDescriptorsCache } from '../../../lib/client/useExplainDescriptors'
import {
  DEAL_ID,
  DICT,
  LOG_NEWEST,
  apiOk,
  dealDescriptor,
  fieldResponse,
  logResponse,
  overviewResponse,
} from '../../../components/__tests__/fixtures'

function renderUi(ui: React.ReactElement) {
  return renderWithProviders(ui, { dict: DICT })
}

function urlOf(callIndex: number): URL {
  return new URL(String(mockApiCall.mock.calls[callIndex][0]), 'http://localhost')
}

function routeByPath(responses: Record<string, unknown>) {
  mockApiCall.mockImplementation((input: unknown) => {
    const url = new URL(String(input), 'http://localhost')
    const field = url.searchParams.get('field')
    const key = field ? `${url.pathname}#${field}` : url.pathname
    const body = responses[key] ?? responses[url.pathname]
    return Promise.resolve(body === undefined ? { ok: false, status: 404, result: null, response: {}, cacheStatus: null } : apiOk(body))
  })
}

describe('insights injection widgets', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    resetExplainDescriptorsCache()
  })

  it('declares feature-gated widgets on the documented spots', () => {
    expect(Object.keys(injectionTable).sort((left, right) => left.localeCompare(right))).toEqual([
      'backend:access-denied:after',
      'backend:record:current',
      'crud-form:customers.company:field:*:after',
      'crud-form:customers.company:header',
      'crud-form:customers.customer_deal:field:*:after',
      'crud-form:customers.customer_deal:header',
      'crud-form:customers.deal:field:*:after',
      'crud-form:customers.deal:header',
      'crud-form:customers.person:field:*:after',
      'crud-form:customers.person:header',
      'detail:customers.deal:status-badges',
      'version-history:entry:after',
    ])
    expect(recordWhyModule.metadata.features).toEqual(['insights.explain.view'])
    expect(logCauseModule.metadata.features).toEqual(['insights.explain.view'])
    expect(dealStatusWhyModule.metadata.features).toEqual(['insights.explain.view', 'customers.deals.view'])
    expect(dealStatusWhyModule.metadata.requiredModules).toEqual(['customers'])
    expect(accessWhyModule.metadata.id).toBe('insights.injection.access-why')
  })

  describe('record-why', () => {
    it('renders nothing without a current record', () => {
      const { container } = renderUi(<RecordWhyWidget context={{ path: '/backend' }} />)
      expect(container).toBeEmptyDOMElement()
      expect(mockApiCall).not.toHaveBeenCalled()
    })

    it('renders nothing when the record kind has no descriptor', async () => {
      routeByPath({ '/api/insights/explain/descriptors': { resources: [dealDescriptor()] } })
      const { container } = renderUi(<RecordWhyWidget context={{ resourceKind: 'staff.team', resourceId: 'x' }} />)
      await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
      expect(container).toBeEmptyDOMElement()
    })

    it('opens the drawer for the current record and re-authorizes through the API', async () => {
      routeByPath({
        '/api/insights/explain/descriptors': { resources: [dealDescriptor()] },
        '/api/insights/explain': overviewResponse(),
      })
      renderUi(<RecordWhyWidget context={{ resourceKind: 'customers.deal', resourceId: DEAL_ID }} />)
      const trigger = await screen.findByRole('button', { name: 'Why?' })
      fireEvent.click(trigger)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: 'Explain Status' })).toBeInTheDocument()
      const explainCall = mockApiCall.mock.calls.findIndex((call) => String(call[0]).startsWith('/api/insights/explain?'))
      expect(urlOf(explainCall).searchParams.get('resourceId')).toBe(DEAL_ID)
    })
  })

  describe('deal-status-why', () => {
    it('renders nothing when the deal status is not explainable for the viewer', async () => {
      routeByPath({
        '/api/insights/explain/descriptors': {
          resources: [dealDescriptor({ fields: [{ key: 'title', labelKey: 'customers.insights.fields.title', valueKind: 'text', currentPath: 'title', derived: false, dependsOn: [], provider: null }] })],
        },
      })
      const { container } = renderUi(<DealStatusWhyWidget context={{ resourceKind: 'customers.deal', resourceId: DEAL_ID }} />)
      await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1))
      expect(container).toBeEmptyDOMElement()
    })

    it('opens the status chain for the deal', async () => {
      routeByPath({
        '/api/insights/explain/descriptors': { resources: [dealDescriptor()] },
        '/api/insights/explain#status': fieldResponse(),
      })
      renderUi(<DealStatusWhyWidget context={{ dealId: DEAL_ID }} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Why this status?' }))
      expect(await screen.findByTestId('insights-why-chain')).toBeInTheDocument()
    })
  })

  describe('log-cause', () => {
    it('renders nothing without a log id', () => {
      const { container } = renderUi(<LogCauseWidget context={{ resourceKind: 'customers.deal' }} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('fetches the entry cause only on demand', async () => {
      routeByPath({ '/api/insights/explain/log': logResponse() })
      renderUi(<LogCauseWidget context={{ logId: LOG_NEWEST, resourceKind: 'customers.deal', resourceId: DEAL_ID }} />)
      const trigger = screen.getByRole('button', { name: 'Why did this happen?' })
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(mockApiCall).not.toHaveBeenCalled()
      fireEvent.click(trigger)
      expect(await screen.findByText('Recorded cause')).toBeInTheDocument()
      expect(urlOf(0).searchParams.get('logId')).toBe(LOG_NEWEST)
      expect(screen.getByRole('button', { name: 'Hide cause' })).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('access-why', () => {
    it('renders nothing when the denial lists no features', () => {
      const { container } = renderUi(<AccessWhyWidget context={{ path: '/backend/x', requiredFeatures: [] }} />)
      expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing when a required feature cannot be explained one by one', () => {
      const { container } = renderUi(<AccessWhyWidget context={{ path: '/backend/x', requiredFeatures: ['sales.orders.view', 'sales.*'] }} />)
      expect(container).toBeEmptyDOMElement()
      expect(mockApiCall).not.toHaveBeenCalled()
    })

    it('explains the denial on demand with the path and required features', async () => {
      routeByPath({
        '/api/insights/explain/access': {
          decision: 'denied',
          required: [{ feature: 'sales.orders.view', granted: false }],
          reasons: ['missing_feature'],
          detail: null,
          confidence: 'proven',
        },
      })
      renderUi(<AccessWhyWidget context={{ path: '/backend/sales/orders', requiredFeatures: ['sales.orders.view', '', 7] }} />)
      expect(mockApiCall).not.toHaveBeenCalled()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: "Why can't I open this?" }))
      })
      expect(await screen.findByText('Access denied')).toBeInTheDocument()
      expect(urlOf(0).searchParams.get('features')).toBe('sales.orders.view')
      expect(urlOf(0).searchParams.get('path')).toBe('/backend/sales/orders')
    })
  })
})
