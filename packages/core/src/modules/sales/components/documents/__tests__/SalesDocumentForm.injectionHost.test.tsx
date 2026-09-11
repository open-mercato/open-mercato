/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { extensionSpotChildId } from '@open-mercato/shared/modules/widgets/extension-points'
import { extensionPoints as customersExtensionPoints } from '@open-mercato/core/modules/customers/extension-points'

jest.setTimeout(20000)

type CapturedCrudFormProps = {
  injectionSpotId?: string
  entityIds?: string[]
}

const capturedCrudFormProps: CapturedCrudFormProps[] = []
const mockApiCall = jest.fn()
const mockSetValue = jest.fn()
const mockT = (key: string, fallback?: string) => fallback ?? key

jest.mock('../../useSalesChannelsEnabled', () => ({
  SALES_CHANNELS_TOGGLE_ID: 'sales_channels_enabled',
  useSalesChannelsEnabled: () => ({ enabled: true, isLoading: false }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn().mockResolvedValue({ items: [] }),
  readApiResultOrThrow: jest.fn().mockResolvedValue({ items: [] }),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: any) => {
    capturedCrudFormProps.push(props)
    const customerGroup = (props.groups ?? []).find((group: any) => group.id === 'customer')
    if (!customerGroup?.component) return <div data-testid="crud-form" />
    return (
      <div data-testid="crud-form">
        {customerGroup.component({
          values: props.initialValues ?? {},
          setValue: mockSetValue,
          errors: {},
        })}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn().mockResolvedValue({ ok: true, result: {} }),
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
  buildPersonPayload: () => ({}),
  buildCompanyPayload: () => ({}),
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
jest.mock('@open-mercato/shared/lib/logger', () => {
  const createLogger = () => {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: () => logger,
    }
    return logger
  }
  return { createLogger }
})
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
const { SalesDocumentForm } = require('../SalesDocumentForm')

async function renderQuickCreateDialogs(): Promise<{
  person: CapturedCrudFormProps
  company: CapturedCrudFormProps
}> {
  capturedCrudFormProps.length = 0
  render(<SalesDocumentForm onCreated={jest.fn()} initialKind="order" />)
  await waitFor(() => expect(mockApiCall).toHaveBeenCalled())

  const person = capturedCrudFormProps.find((props) =>
    props.entityIds?.includes('customers:customer_person_profile'),
  )
  const company = capturedCrudFormProps.find((props) =>
    props.entityIds?.includes('customers:customer_company_profile'),
  )
  expect(person).toBeDefined()
  expect(company).toBeDefined()
  return { person: person as CapturedCrudFormProps, company: company as CapturedCrudFormProps }
}

describe('SalesDocumentForm customer quick-create injection hosts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [], number: 'ORD-001' } })
  })

  it('binds the declared customers hosts rather than the entity-derived fallback', async () => {
    const { person, company } = await renderQuickCreateDialogs()

    expect(person.injectionSpotId).toBe(customersExtensionPoints.hosts.personForm.spotId)
    expect(person.injectionSpotId).toBe('crud-form:customers.person')
    expect(company.injectionSpotId).toBe(customersExtensionPoints.hosts.companyForm.spotId)
    expect(company.injectionSpotId).toBe('crud-form:customers.company')

    expect(person.injectionSpotId).not.toBe('crud-form:customers.customer_entity')
    expect(company.injectionSpotId).not.toBe('crud-form:customers.customer_entity')
  })

  it('exposes the same field-widget slots the customers edit surfaces expose', async () => {
    const { person, company } = await renderQuickCreateDialogs()

    expect(extensionSpotChildId(person.injectionSpotId as string, 'fields')).toBe(
      'crud-form:customers.person:fields',
    )
    expect(extensionSpotChildId(company.injectionSpotId as string, 'fields')).toBe(
      'crud-form:customers.company:fields',
    )
  })

  it('keeps the existing entity ids so custom-field resolution is unchanged', async () => {
    const { person, company } = await renderQuickCreateDialogs()

    expect(person.entityIds).toEqual([
      'customers:customer_entity',
      'customers:customer_person_profile',
    ])
    expect(company.entityIds).toEqual([
      'customers:customer_entity',
      'customers:customer_company_profile',
    ])
  })
})
