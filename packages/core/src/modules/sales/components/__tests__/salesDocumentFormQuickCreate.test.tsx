/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.setTimeout(20000)

const mockApiCall = jest.fn()
const mockCreateCrud = jest.fn()
const mockSetValue = jest.fn()
const mockT = (key: string, fallback?: string) => fallback ?? key
const mockRefetchCurrencyDictionary = jest.fn()
const personValues = {
  displayName: 'Jane Doe',
  firstName: 'Jane',
  lastName: 'Doe',
  primaryEmail: 'jane@example.com',
  addresses: [
    {
      id: 'draft-address',
      name: ' Home ',
      purpose: ' billing ',
      companyName: ' Not serialized by the reference flow ',
      addressLine1: '  Main Street 1  ',
      addressLine2: '  Apartment 2  ',
      buildingNumber: ' 1 ',
      flatNumber: ' 2 ',
      city: ' Warsaw ',
      region: '   ',
      postalCode: ' 00-001 ',
      country: ' pl ',
      latitude: 52.2297,
      longitude: 21.0122,
      isPrimary: true,
    },
  ],
}

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ entityIds, groups, initialValues, onSubmit }: any) => {
    if (entityIds?.includes('customers:customer_person_profile')) {
      return (
        <button type="button" onClick={() => void onSubmit(personValues)}>
          Submit inline person
        </button>
      )
    }
    const customerGroup = (groups ?? []).find((group: any) => group.id === 'customer')
    return (
      <div data-testid="crud-form">
        {customerGroup?.component?.({
          values: initialValues ?? {},
          setValue: mockSetValue,
          errors: {},
        })}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: any[]) => mockCreateCrud(...args),
  updateCrud: jest.fn().mockResolvedValue({ ok: true }),
  deleteCrud: jest.fn().mockResolvedValue({ ok: true }),
  buildCrudExportUrl: () => '/export.csv',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/inputs', () => ({
  LookupSelect: ({ actionSlot }: any) => <div>{actionSlot}</div>,
}))
jest.mock('@open-mercato/ui/primitives/input', () => ({ Input: (props: any) => <input {...props} /> }))
jest.mock('@open-mercato/ui/primitives/email-input', () => ({ EmailInput: (props: any) => <input {...props} /> }))
jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))
jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}))
jest.mock('@open-mercato/ui/primitives/switch-field', () => ({ SwitchField: () => <div /> }))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
  DialogTrigger: ({ children }: any) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/utils/customFieldValues', () => ({
  collectCustomFieldValues: jest.fn().mockReturnValue({}),
}))
jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: (message: string) => new Error(message),
}))
jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: () => <select />,
}))
jest.mock('@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({ data: { entries: [] }, refetch: mockRefetchCurrencyDictionary }),
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
  buildPersonPayload: () => ({ displayName: 'Jane Doe' }),
  buildCompanyPayload: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/customers/components/AddressEditor', () => ({ AddressEditor: () => <div /> }))
jest.mock('@open-mercato/core/modules/customers/utils/addressFormat', () => ({ formatAddressString: () => '' }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockT,
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
  useOrganizationScopeDetail: () => ({ organizationId: 'organization-1', tenantId: 'tenant-1' }),
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}))
jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    sales: { sales_quote: 'sales:sales_quote', sales_order: 'sales:sales_order' },
    customers: {
      customer_entity: 'customers:customer_entity',
      customer_person_profile: 'customers:customer_person_profile',
      customer_company_profile: 'customers:customer_company_profile',
    },
  },
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

describe('SalesDocumentForm person quick create', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [], number: 'ORD-001' } })
    mockCreateCrud.mockImplementation((resource: string) => {
      if (resource === 'customers/people') {
        return Promise.resolve({ ok: true, result: { entityId: 'customer-entity-1' } })
      }
      return Promise.resolve({ ok: true, result: { id: 'address-1' } })
    })
  })

  it('persists normalized addresses against the created customer entity', async () => {
    render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Submit inline person' }))

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalledTimes(2))
    expect(mockCreateCrud).toHaveBeenNthCalledWith(
      1,
      'customers/people',
      { displayName: 'Jane Doe' },
      { errorMessage: 'Failed to create customer.' },
    )
    expect(mockCreateCrud).toHaveBeenNthCalledWith(2, 'customers/addresses', {
      entityId: 'customer-entity-1',
      organizationId: 'organization-1',
      addressLine1: 'Main Street 1',
      isPrimary: true,
      name: 'Home',
      purpose: 'billing',
      addressLine2: 'Apartment 2',
      buildingNumber: '1',
      flatNumber: '2',
      city: 'Warsaw',
      postalCode: '00-001',
      country: 'PL',
      latitude: 52.2297,
      longitude: 21.0122,
    })
    expect(mockSetValue).toHaveBeenCalledWith('customerEntityId', 'customer-entity-1')
    expect(mockCreateCrud.mock.invocationCallOrder[1]).toBeLessThan(
      mockSetValue.mock.invocationCallOrder[0],
    )
  })
})
