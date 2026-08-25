/**
 * @jest-environment jsdom
 *
 * Regression coverage for #3173: the sales document form's custom field/group
 * renderers must be hoisted to module scope (stable component identity, hooks in
 * real React component boundaries) rather than defined inside SalesDocumentForm.
 *
 * - The "structural" block fails while the renderers are nested and passes once
 *   they are hoisted (the bug reproduction).
 * - The "behavior" block exercises document-number, billing-address and
 *   customer-selection rendering to prove the refactor preserves behavior.
 */
import * as React from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { render, screen, waitFor } from '@testing-library/react'

jest.setTimeout(20000)

const mockApiCall = jest.fn()

// #5126: the sentinel the mocked CrudForm feeds into the `lines` custom field so the
// duplicate-error regression is observable through the DOM.
const LINES_FIELD_ERROR = 'LINES_FIELD_ERROR_SENTINEL'

// #5126: the `lines` field declaration as the form handed it to CrudForm, so the tests can
// assert the error-ownership contract on the real object instead of scanning source text.
const mockCapturedLinesField: { current: any } = { current: null }

jest.mock('../useSalesChannelsEnabled', () => ({
  SALES_CHANNELS_TOGGLE_ID: 'sales_channels_enabled',
  useSalesChannelsEnabled: () => ({ enabled: true, isLoading: false }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
}))

// Render the captured field/group renderers so their behavior is exercised.
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ fields, groups, initialValues }: any) => {
    const docField = (fields ?? []).find((f: any) => f.id === 'documentNumber')
    const billingField = (fields ?? []).find((f: any) => f.id === 'billingAddressSection')
    const linesField = (fields ?? []).find((f: any) => f.id === 'lines')
    mockCapturedLinesField.current = linesField ?? null
    const customerGroup = (groups ?? []).find((g: any) => g.id === 'customer')
    const fieldProps = {
      value: '',
      setValue: () => {},
      setFormValue: () => {},
      values: initialValues ?? {},
    }
    return (
      <div>
        <div data-testid="doc-number">
          {docField ? docField.component({ ...fieldProps, id: 'documentNumber' }) : null}
        </div>
        <div data-testid="billing">
          {billingField ? billingField.component({ ...fieldProps, id: 'billingAddressSection' }) : null}
        </div>
        {/* Mirrors the real CrudForm field wrapper (CrudForm.tsx): it renders the custom
            component, then its own error node for the same field error — unless the field
            opted out with `rendersOwnError`, in which case the component owns the node. */}
        <div data-testid="lines">
          {linesField
            ? linesField.component({ ...fieldProps, id: 'lines', value: [], error: LINES_FIELD_ERROR })
            : null}
          {linesField?.type === 'custom' && linesField?.rendersOwnError ? null : (
            <div className="text-xs text-status-error-text">{LINES_FIELD_ERROR}</div>
          )}
        </div>
        <div data-testid="customer">
          {customerGroup?.component
            ? customerGroup.component({ values: initialValues ?? {}, setValue: () => {}, errors: {} })
            : null}
        </div>
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn().mockResolvedValue({ ok: true }),
  updateCrud: jest.fn().mockResolvedValue({ ok: true }),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true }),
  buildCrudExportUrl: () => '/export.csv',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: () => <div data-testid="lookup-select" />,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/email-input', () => ({
  EmailInput: (props: any) => <input type="email" {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}))

jest.mock('@open-mercato/ui/primitives/switch-field', () => ({
  SwitchField: ({ label }: any) => <label>{label}</label>,
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

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ emptyState }: any) => <div data-testid="data-table">{emptyState ?? null}</div>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => <div data-testid="row-actions" />,
}))

jest.mock('@open-mercato/ui/primitives/empty-state', () => ({
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
}))

jest.mock('../documents/LineItemDialog', () => ({
  LineItemDialog: () => <div data-testid="line-item-dialog" />,
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
  AddressEditor: () => <div data-testid="address-editor" />,
}))

jest.mock('@open-mercato/core/modules/customers/utils/addressFormat', () => ({
  formatAddressString: () => '',
}))

// `useLocale` belongs in this partial mock even though nothing here asserts a formatted
// string: the `lines` custom field renders the real `SalesOrderDraftLines`, which reads the
// application locale to format money (#5105), and a partial mock returns `undefined` for
// every hook it omits — so the component throws on render rather than failing an assertion.
// The pin is a non-en locale so a future money assertion in this suite cannot be satisfied
// by a component that ignores the locale on an en-default runner.
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => 'pl-PL',
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SalesDocumentForm } = require('../documents/SalesDocumentForm')

describe('SalesDocumentForm hoisted renderers — structural (#3173)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'documents', 'SalesDocumentForm.tsx'),
    'utf8',
  )

  it('declares DocumentNumberField at module scope, not nested in the form', () => {
    expect(source).toMatch(/^function DocumentNumberField\b/m)
    expect(source).not.toMatch(/\n[ \t]+function DocumentNumberField\b/)
  })

  it('declares BillingAddressSectionField at module scope, not as an inline renderer', () => {
    expect(source).toMatch(/^function BillingAddressSectionField\b/m)
    expect(source).not.toMatch(/component:\s*function BillingAddressSectionField\b/)
  })

  it('declares CustomerGroupComponent at module scope, not as an inline renderer', () => {
    expect(source).toMatch(/^function CustomerGroupComponent\b/m)
    expect(source).not.toMatch(/component:\s*function CustomerGroupComponent\b/)
  })

  it('passes the hoisted renderers to CrudForm as stable element references', () => {
    expect(source).toMatch(/<DocumentNumberField\b/)
    expect(source).toMatch(/<BillingAddressSectionField\b/)
    expect(source).toMatch(/<CustomerGroupComponent\b/)
  })
})

describe('SalesDocumentForm hoisted renderers — behavior (#3173)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/catalog/price-kinds')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [{ id: 'pk-1', code: 'regular', title: 'Regular', currency_code: 'EUR', is_promotion: false, is_active: true }],
          },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [], number: 'ORD-001' } })
    })
  })

  it('renders the document-number field and auto-requests a number on mount', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/sales/document-numbers',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('renders the billing address section', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)

    await waitFor(() => {
      expect(screen.getByText('Billing address')).toBeTruthy()
    })
  })

  it('renders the customer selection group with its email input', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email used for the document')).toBeTruthy()
    })
  })
})

describe('SalesDocumentForm lines error ownership (#5126)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCapturedLinesField.current = null
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [], number: 'ORD-001' } })
  })

  it('renders the lines validation message exactly once, from the component that owns it', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)

    await waitFor(() => {
      expect(screen.getByTestId('lines')).toBeTruthy()
    })

    // Guards against a vacuous pass: without this the assertion below is satisfied by the
    // wrapper's own node even when SalesOrderDraftLines never rendered at all.
    expect(screen.getByTestId('data-table')).toBeTruthy()

    const rendered = screen.getAllByText(LINES_FIELD_ERROR)
    expect(rendered).toHaveLength(1)
    expect(rendered[0].getAttribute('role')).toBe('alert')
  })

  it('keeps the message above the line-items table where the user is acting', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeTruthy()
    })

    const message = screen.getByText(LINES_FIELD_ERROR)
    const table = screen.getByTestId('data-table')

    expect(message.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('declares the lines field as the owner of its error node', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)

    await waitFor(() => {
      expect(mockCapturedLinesField.current).toBeTruthy()
    })

    // The contract the fix rests on: the field opts out of CrudForm's wrapper error node,
    // so SalesOrderDraftLines' own `role="alert"` node is the single renderer.
    expect(mockCapturedLinesField.current.type).toBe('custom')
    expect(mockCapturedLinesField.current.rendersOwnError).toBe(true)
  })
})
