/**
 * @jest-environment jsdom
 *
 * Endpoint picker for CALL_API (issue #4235, spec section 5.3): free-text
 * endpoint input stays first-class, a Browse popover lists the
 * /api/workflows/endpoints catalog searchable and grouped by tag, picking
 * fills endpoint + method, a matched endpoint renders typed path/query
 * parameter rows that recompose the endpoint string, and a declared request
 * schema surfaces as a body-field hint. Catalog lookup failure degrades to
 * free text with a hint.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  EndpointPicker,
  requestBodyFieldHints,
  type EndpointPickerItem,
} from '../fields/EndpointPicker'
import {
  composeEndpointValue,
  findMatchingEndpoint,
  matchEndpointTemplate,
  splitEndpointValue,
} from '../../lib/endpoint-path'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock

const BROWSE_KEY = 'workflows.endpointPicker.browse'
const SEARCH_KEY = 'workflows.endpointPicker.searchPlaceholder'
const NO_RESULTS_KEY = 'workflows.endpointPicker.noResults'
const LOOKUP_UNAVAILABLE_KEY = 'workflows.endpointPicker.lookupUnavailable'
const PARAMS_KEY = 'workflows.endpointPicker.params'
const BODY_FIELDS_KEY = 'workflows.endpointPicker.bodyFields'

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
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

const catalogItems: EndpointPickerItem[] = [
  {
    path: '/api/customers/people',
    method: 'GET',
    summary: 'List people',
    tag: 'Customers',
    params: [
      { name: 'search', in: 'query', required: false, type: 'string' },
      { name: 'page', in: 'query', required: true, type: 'number' },
    ],
    hasRequestSchema: false,
  },
  {
    path: '/api/customers/people',
    method: 'POST',
    summary: 'Create person',
    tag: 'Customers',
    params: [],
    hasRequestSchema: true,
    requestSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, email: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    path: '/api/sales/orders/{id}',
    method: 'GET',
    summary: 'Get order',
    tag: 'Sales',
    params: [{ name: 'id', in: 'path', required: true, type: 'string' }],
    hasRequestSchema: false,
  },
]

function mockCatalog(items: EndpointPickerItem[], ok = true) {
  apiCallMock.mockImplementation(async (url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/api/workflows/endpoints')) {
      return { ok, status: ok ? 200 : 500, result: ok ? { items } : {}, response: {}, cacheStatus: null }
    }
    return { ok: true, status: 200, result: {}, response: {}, cacheStatus: null }
  })
}

function Harness({
  initialEndpoint = '',
  initialMethod = '',
  onApplySpy,
}: {
  initialEndpoint?: string
  initialMethod?: string
  onApplySpy?: jest.Mock
}) {
  const [state, setState] = React.useState({ endpoint: initialEndpoint, method: initialMethod })
  return (
    <EndpointPicker
      id="ep-endpoint"
      endpoint={state.endpoint}
      method={state.method}
      onApply={(patch) => {
        onApplySpy?.(patch)
        setState((prev) => ({
          endpoint: typeof patch.endpoint === 'string' ? patch.endpoint : prev.endpoint,
          method: typeof patch.method === 'string' ? patch.method : prev.method,
        }))
      }}
    />
  )
}

beforeEach(() => {
  apiCallMock.mockReset()
  mockCatalog(catalogItems)
})

describe('endpoint-path helpers', () => {
  it('splits an endpoint value into path and raw query pairs', () => {
    expect(splitEndpointValue('/api/customers/people?search={{context.q}}&page=2')).toEqual({
      path: '/api/customers/people',
      query: { search: '{{context.q}}', page: '2' },
    })
    expect(splitEndpointValue('/api/customers/people/')).toEqual({
      path: '/api/customers/people',
      query: {},
    })
  })

  it('matches literal and templated segments, treating unfilled placeholders as empty values', () => {
    expect(matchEndpointTemplate('/api/sales/orders/o-1', '/api/sales/orders/{id}')).toEqual({
      pathParams: { id: 'o-1' },
    })
    expect(matchEndpointTemplate('/api/sales/orders/{id}', '/api/sales/orders/{id}')).toEqual({
      pathParams: { id: '' },
    })
    expect(matchEndpointTemplate('/api/sales/orders', '/api/sales/orders/{id}')).toBeNull()
    expect(matchEndpointTemplate('/api/other/o-1', '/api/sales/orders/{id}')).toBeNull()
  })

  it('prefers exact literal matches over templates and fewer params over more', () => {
    const items = [
      { path: '/api/{module}/{resource}', method: 'GET' },
      { path: '/api/sales/{resource}', method: 'GET' },
      { path: '/api/sales/orders', method: 'GET' },
    ]
    const matched = findMatchingEndpoint('/api/sales/orders', 'GET', items)
    expect(matched?.item.path).toBe('/api/sales/orders')

    const templated = findMatchingEndpoint('/api/sales/quotes', 'get', items)
    expect(templated?.item.path).toBe('/api/sales/{resource}')

    expect(findMatchingEndpoint('/api/sales/orders', 'DELETE', items)).toBeNull()
  })

  it('composes endpoint values keeping unfilled placeholders and skipping empty query values', () => {
    expect(
      composeEndpointValue('/api/sales/orders/{id}', { id: 'o-1' }, { expand: 'lines', empty: '' }),
    ).toBe('/api/sales/orders/o-1?expand=lines')
    expect(composeEndpointValue('/api/sales/orders/{id}', {}, {})).toBe('/api/sales/orders/{id}')
    expect(
      composeEndpointValue('/api/sales/orders/{id}', { id: '{{context.orderId}}' }, {}),
    ).toBe('/api/sales/orders/{{context.orderId}}')
  })

  it('extracts request body field hints from a JSON schema', () => {
    expect(requestBodyFieldHints(catalogItems[1].requestSchema)).toEqual([
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'string', required: false },
    ])
    expect(requestBodyFieldHints(undefined)).toEqual([])
    expect(requestBodyFieldHints({ type: 'object' })).toEqual([])
  })
})

describe('EndpointPicker', () => {
  it('keeps free text first-class and forwards edits', async () => {
    const onApplySpy = jest.fn()
    renderWithProviders(<Harness onApplySpy={onApplySpy} />)

    const input = screen.getByPlaceholderText('workflows.endpointPicker.placeholder')
    fireEvent.change(input, { target: { value: '/api/custom/thing' } })

    expect(onApplySpy).toHaveBeenCalledWith({ endpoint: '/api/custom/thing' })
    await act(async () => {})
  })

  it('browses the catalog grouped by tag and picking fills endpoint and method', async () => {
    const onApplySpy = jest.fn()
    renderWithProviders(<Harness onApplySpy={onApplySpy} />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(BROWSE_KEY) }))

    await waitFor(() => {
      expect(screen.getByText('Customers')).toBeInTheDocument()
    })
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Create person')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Create person'))

    expect(onApplySpy).toHaveBeenCalledWith({ endpoint: '/api/customers/people', method: 'POST' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(SEARCH_KEY)).not.toBeInTheDocument()
    })
  })

  it('filters the catalog by search across path, summary, and tag', async () => {
    renderWithProviders(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(BROWSE_KEY) }))
    await waitFor(() => {
      expect(screen.getByText('Sales')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText(SEARCH_KEY), { target: { value: 'order' } })
    expect(screen.getByText('Get order')).toBeInTheDocument()
    expect(screen.queryByText('List people')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(SEARCH_KEY), { target: { value: 'zzz' } })
    expect(screen.getByText(NO_RESULTS_KEY)).toBeInTheDocument()
  })

  it('renders typed query parameter rows for a matched endpoint, required first, and recomposes the endpoint', async () => {
    const onApplySpy = jest.fn()
    renderWithProviders(
      <Harness initialEndpoint="/api/customers/people" initialMethod="GET" onApplySpy={onApplySpy} />,
    )

    await waitFor(() => {
      expect(screen.getByText(PARAMS_KEY)).toBeInTheDocument()
    })
    expect(screen.getByText('List people')).toBeInTheDocument()

    const paramLabels = screen
      .getAllByText(/page|search/, { selector: 'label' })
      .map((label) => label.textContent?.trim())
    expect(paramLabels).toEqual(['page *', 'search'])

    fireEvent.change(screen.getByLabelText('search'), { target: { value: '{{context.q}}' } })
    expect(onApplySpy).toHaveBeenLastCalledWith({ endpoint: '/api/customers/people?search={{context.q}}' })

    await waitFor(() => {
      expect(screen.getByLabelText('search')).toHaveValue('{{context.q}}')
    })
  })

  it('fills path template placeholders from the parameter row', async () => {
    const onApplySpy = jest.fn()
    renderWithProviders(
      <Harness initialEndpoint="/api/sales/orders/{id}" initialMethod="GET" onApplySpy={onApplySpy} />,
    )

    await waitFor(() => {
      expect(screen.getByText(PARAMS_KEY)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('id *'), { target: { value: 'o-123' } })
    expect(onApplySpy).toHaveBeenLastCalledWith({ endpoint: '/api/sales/orders/o-123' })

    await waitFor(() => {
      expect(screen.getByLabelText('id *')).toHaveValue('o-123')
    })
  })

  it('shows request-body field hints from the declared request schema', async () => {
    renderWithProviders(<Harness initialEndpoint="/api/customers/people" initialMethod="POST" />)

    await waitFor(() => {
      expect(screen.getByText(BODY_FIELDS_KEY)).toBeInTheDocument()
    })
    expect(screen.getByText('name* (string), email (string)')).toBeInTheDocument()
  })

  it('degrades to free text with a hint when the catalog lookup fails', async () => {
    mockCatalog([], false)
    renderWithProviders(<Harness initialEndpoint="/api/custom/thing" initialMethod="GET" />)

    await waitFor(() => {
      expect(screen.getByText(LOOKUP_UNAVAILABLE_KEY)).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('workflows.endpointPicker.placeholder')).toHaveValue('/api/custom/thing')
  })
})
