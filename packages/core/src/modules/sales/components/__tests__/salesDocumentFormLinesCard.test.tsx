/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.setTimeout(20000)

const mockApiCall = jest.fn()
type KindField = { id: string; component?: (props: { value: string; setValue: (next: string) => void }) => React.ReactElement }
type CapturedCrudFormProps = { fields: KindField[]; hiddenGroupIds?: readonly string[] }
type WrapperProps = { children?: React.ReactNode }
let capturedFields: KindField[] | undefined
let capturedHiddenGroupIds: readonly string[] | undefined
let mockChannelsEnabled = true

jest.mock('../useSalesChannelsEnabled', () => ({
  SALES_CHANNELS_TOGGLE_ID: 'sales_channels_enabled',
  useSalesChannelsEnabled: () => ({ enabled: mockChannelsEnabled, isLoading: false }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ fields, hiddenGroupIds }: CapturedCrudFormProps) => {
    capturedFields = fields
    capturedHiddenGroupIds = hiddenGroupIds
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
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/switch', () => ({
  Switch: () => <input type="checkbox" />,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: WrapperProps) => <div>{children}</div>,
  DialogContent: ({ children }: WrapperProps) => <div>{children}</div>,
  DialogDescription: ({ children }: WrapperProps) => <p>{children}</p>,
  DialogFooter: ({ children }: WrapperProps) => <div>{children}</div>,
  DialogHeader: ({ children }: WrapperProps) => <div>{children}</div>,
  DialogTitle: ({ children }: WrapperProps) => <h3>{children}</h3>,
  DialogTrigger: ({ children }: WrapperProps) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/badge', () => ({
  Badge: ({ children }: WrapperProps) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({
  collectCustomFieldValues: jest.fn().mockReturnValue({}),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
  createCrudFormError: (msg: string) => new Error(msg),
  normalizeCrudServerError: (err: unknown) => ({ message: err instanceof Error ? err.message : 'error' }),
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

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
  useOrganizationScopeDetail: () => ({ organizationId: 'org', tenantId: 'tenant' }),
}))

jest.mock('@open-mercato/shared/lib/custom-fields/normalize', () => ({
  normalizeCustomFieldResponse: (input: unknown) => input,
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
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

jest.mock('lucide-react', () => ({
  Building2: () => <span />,
  Mail: () => <span />,
  Plus: () => <span />,
  Store: () => <span />,
  UserRound: () => <span />,
}))

const { SalesDocumentForm } = require('../documents/SalesDocumentForm')

function renderKindToggle(value: string) {
  const field = capturedFields!.find((entry) => entry.id === 'documentKind')
  return render(field!.component!({ value, setValue: jest.fn() }))
}

describe('SalesDocumentForm order lines card', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = undefined
    capturedHiddenGroupIds = undefined
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [], number: 'ORD-001' } })
  })

  it.each([[undefined], ['quote']])('hides the lines group for a quote (initialKind %s)', async (initialKind) => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind={initialKind} />)
    await waitFor(() => expect(capturedFields).toBeDefined())
    expect(capturedHiddenGroupIds).toEqual(['lines'])
  })

  it('shows the lines group for an order', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)
    await waitFor(() => expect(capturedFields).toBeDefined())
    expect(capturedHiddenGroupIds).toBeUndefined()
  })

  it('follows the document type toggle both ways', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} />)
    await waitFor(() => expect(capturedFields).toBeDefined())

    const toggle = renderKindToggle('quote')
    fireEvent.click(screen.getByText('Order'))
    await waitFor(() => expect(capturedHiddenGroupIds).toBeUndefined())

    toggle.unmount()
    renderKindToggle('order')
    fireEvent.click(screen.getByText('Quote'))
    await waitFor(() => expect(capturedHiddenGroupIds).toEqual(['lines']))
  })
})
