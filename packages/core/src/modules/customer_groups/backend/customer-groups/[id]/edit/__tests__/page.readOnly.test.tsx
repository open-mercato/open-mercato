/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import EditCustomerGroupPage from '../page'
import { metadata } from '../page.meta'

const apiCallMock = jest.fn()
let grantedFeatures: string[] = []

jest.mock('#generated/entities.ids.generated', () => ({
  E: { customer_groups: { customer_group: 'customer_groups:customer_group' } },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures }, isReady: true }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const stableTranslate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => stableTranslate }
})

const crudFormPropsCapture: { current: Record<string, unknown> | null } = { current: null }
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, unknown>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

const termsPropsCapture: { current: Record<string, unknown> | null } = { current: null }
jest.mock('../../../../../components/CustomerGroupTermsSection', () => ({
  CustomerGroupTermsSection: (props: Record<string, unknown>) => {
    termsPropsCapture.current = props
    return <div>terms</div>
  },
}))

jest.mock('../../../../../components/CustomerGroupParentField', () => ({
  CustomerGroupParentField: () => null,
}))

jest.mock('../../../../../components/CustomerGroupDefaultField', () => ({
  CustomerGroupDefaultField: () => null,
}))

const GROUP_ID = '83b4d7ff-d67f-49a1-ab03-b7abeec17d85'

function mockApi() {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.includes('/terms')) return { ok: true, status: 200, result: { terms: null } }
    if (url.includes('isDefault=true')) return { ok: true, status: 200, result: { items: [] } }
    return {
      ok: true,
      status: 200,
      result: {
        items: [
          {
            id: GROUP_ID,
            code: 'wholesale',
            name: 'Wholesale',
            kind: 'b2b',
            priority: 100,
            isActive: true,
            updatedAt: '2026-09-29T00:00:00.000Z',
          },
        ],
      },
    }
  })
}

describe('customer group edit page — access', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    crudFormPropsCapture.current = null
    termsPropsCapture.current = null
    mockApi()
  })

  it('is reachable with the view feature, not only manage', () => {
    expect(metadata.requireFeatures).toEqual(['customer_groups.groups.view'])
  })

  it('renders the group read-only for view-only staff and still shows the terms section', async () => {
    grantedFeatures = ['customer_groups.groups.view', 'customer_groups.terms.view']
    render(<EditCustomerGroupPage params={{ id: GROUP_ID }} />)
    await waitFor(() => expect(crudFormPropsCapture.current?.isLoading).toBe(false))
    expect(crudFormPropsCapture.current?.readOnly).toBe(true)
    expect(termsPropsCapture.current?.canManage).toBe(false)
  })

  it('keeps the form editable for managers', async () => {
    grantedFeatures = ['customer_groups.groups.manage', 'customer_groups.terms.manage']
    render(<EditCustomerGroupPage params={{ id: GROUP_ID }} />)
    await waitFor(() => expect(crudFormPropsCapture.current?.isLoading).toBe(false))
    expect(crudFormPropsCapture.current?.readOnly).toBe(false)
    expect(termsPropsCapture.current?.canManage).toBe(true)
  })
})
