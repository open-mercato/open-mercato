/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'

jest.setTimeout(20000)

const mockApiCall = jest.fn()
let capturedFields: Array<{ id: string }> | undefined
let capturedGroups: Array<{ id: string; fields?: string[] }> | undefined
let mockChannelsEnabled = true

jest.mock('../useSalesChannelsEnabled', () => ({
  SALES_CHANNELS_TOGGLE_ID: 'sales_channels_enabled',
  useSalesChannelsEnabled: () => ({ enabled: mockChannelsEnabled, isLoading: false }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ fields, groups }: any) => {
    capturedFields = fields
    capturedGroups = groups
    return <div data-testid="crud-form" />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn().mockResolvedValue({ ok: true }),
  updateCrud: jest.fn().mockResolvedValue({ ok: true }),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true }),
  buildCrudExportUrl: () => '/export.csv',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: () => <div />,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: () => <input type="checkbox" />,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
  DialogTrigger: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({
  collectCustomFieldValues: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
  createCrudFormError: (msg: string) => new Error(msg),
  normalizeCrudServerError: (err: any) => ({ message: err?.message ?? 'error' }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: () => <select />,
}))

jest.mock('@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({ data: { entries: [] }, refetch: jest.fn() }),
}))

jest.mock('@open-mercato/core/modules/customers/backend/hooks/useEmailDuplicateCheck', () => ({
  useEmailDuplicateCheck: () => ({ checking: false, duplicate: false, check: jest.fn() }),
}))

jest.mock('@open-mercato/core/modules/customers/components/formConfig', () => ({
  createPersonFormFields: () => [],
  createPersonFormGroups: () => [],
  createPersonFormSchema: () => ({}),
  createCompanyFormFields: () => [],
  createCompanyFormGroups: () => [],
  createCompanyFormSchema: () => ({}),
  buildPersonPayload: jest.fn(),
  buildCompanyPayload: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/customers/components/AddressEditor', () => ({
  AddressEditor: () => <div />,
}))

jest.mock('@open-mercato/core/modules/customers/utils/addressFormat', () => ({
  formatAddressString: () => '',
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
  useOrganizationScopeDetail: () => ({ organizationId: 'org', tenantId: 'tenant' }),
}))

jest.mock('@open-mercato/shared/lib/custom-fields/normalize', () => ({
  normalizeCustomFieldResponse: (input: any) => input,
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: { sales_quote: 'sales:sales_quote', sales_order: 'sales:sales_order' },
    customers: { customer_entity: 'customers:customer_entity', customer_company_profile: 'customers:company' },
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

jest.mock('lucide-react', () => ({
  Building2: () => <span />,
  Mail: () => <span />,
  Plus: () => <span />,
  Store: () => <span />,
  UserRound: () => <span />,
}))

const { SalesDocumentForm } = require('../documents/SalesDocumentForm')

describe('SalesDocumentForm channel picker toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = undefined
    capturedGroups = undefined
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [], number: 'ORD-001' } })
  })

  it('renders the channel picker when sales channels are enabled', async () => {
    mockChannelsEnabled = true
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)
    await waitFor(() => expect(capturedFields).toBeDefined())
    expect(capturedFields!.map((f) => f.id)).toContain('channelId')
    const group = capturedGroups!.find((g) => g.id === 'channels-comments')
    expect(group?.fields).toEqual(['channelId', 'comments'])
  })

  it('hides the channel picker when sales channels are disabled', async () => {
    mockChannelsEnabled = false
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)
    await waitFor(() => expect(capturedFields).toBeDefined())
    expect(capturedFields!.map((f) => f.id)).not.toContain('channelId')
    const group = capturedGroups!.find((g) => g.id === 'channels-comments')
    expect(group?.fields).toEqual(['comments'])
  })
})
