/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

const mockApiCall = jest.fn()
const capturedFormProps: Array<Record<string, unknown>> = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
}))

const translate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
}))

jest.mock('../../../../../../components/services/ServiceForm', () => {
  const actual = jest.requireActual('../../../../../../components/services/ServiceForm')
  return {
    ...actual,
    ServiceForm: (props: Record<string, unknown>) => {
      capturedFormProps.push(props)
      return <div data-testid="service-form" data-read-only={String(props.readOnly)} />
    },
  }
})

jest.mock('../../../../../../components/services/ServiceWorkRequirements', () => ({
  ServiceWorkRequirements: () => null,
}))

import EditCatalogServicePage from '../page'

const SERVICE_ID = '11111111-1111-4111-8111-111111111111'

function mockResponses(granted: string[]) {
  mockApiCall.mockImplementation(async (url: string) => {
    if (url === '/api/auth/feature-check') return { ok: true, status: 200, result: { ok: false, granted } }
    return { ok: true, status: 200, result: { items: [{ id: SERVICE_ID, title: 'Workshop', updated_at: '2026-11-06T00:00:00.000Z' }] } }
  })
}

const lastFormProps = () => capturedFormProps[capturedFormProps.length - 1]

describe('catalog service edit page access', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFormProps.length = 0
  })

  it('renders the form read-only without delete for a view-only user', async () => {
    mockResponses(['catalog.services.view'])

    render(<EditCatalogServicePage params={{ id: SERVICE_ID }} />)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('/api/auth/feature-check', expect.anything()))
    await waitFor(() => expect(screen.getByTestId('service-form')).toBeInTheDocument())
    expect(lastFormProps().readOnly).toBe(true)
    expect(lastFormProps().onDelete).toBeUndefined()
  })

  it('makes the form editable once a wildcard grant covers catalog.services.manage', async () => {
    mockResponses(['catalog.*'])

    render(<EditCatalogServicePage params={{ id: SERVICE_ID }} />)

    await waitFor(() => expect(lastFormProps()?.readOnly).toBe(false))
    expect(typeof lastFormProps().onDelete).toBe('function')
  })
})
