import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  clearPaymentGatewayDescriptors,
  registerPaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../defaults'
import {
  ensurePayerFieldsCollected,
  findUncollectedPayerFields,
  PAYER_FIELDS_NOT_COLLECTED_MESSAGE_KEY,
  resolveRequiredPayerFields,
} from '../payerFieldRequirements'

function fieldsWith(overrides: Record<string, boolean | null>) {
  return DEFAULT_CHECKOUT_CUSTOMER_FIELDS
    .filter((field) => overrides[field.key] !== null)
    .map((field) => (field.key in overrides ? { ...field, required: overrides[field.key] === true } : field))
}

describe('findUncollectedPayerFields', () => {
  it('returns nothing when the provider requires no payer fields', () => {
    expect(findUncollectedPayerFields({
      requiredPayerFields: undefined,
      collectCustomerDetails: false,
      customerFieldsSchema: [],
    })).toEqual([])
  })

  it('accepts the default customer fields, which require email and both name parts', () => {
    expect(findUncollectedPayerFields({
      requiredPayerFields: ['email', 'name'],
      collectCustomerDetails: true,
      customerFieldsSchema: DEFAULT_CHECKOUT_CUSTOMER_FIELDS,
    })).toEqual([])
  })

  it('flags every required payer field when customer details are not collected', () => {
    expect(findUncollectedPayerFields({
      requiredPayerFields: ['email', 'name'],
      collectCustomerDetails: false,
      customerFieldsSchema: DEFAULT_CHECKOUT_CUSTOMER_FIELDS,
    })).toEqual(['email', 'name'])
  })

  it('flags email when the email field is optional or missing', () => {
    expect(findUncollectedPayerFields({
      requiredPayerFields: ['email'],
      collectCustomerDetails: true,
      customerFieldsSchema: fieldsWith({ email: false }),
    })).toEqual(['email'])
    expect(findUncollectedPayerFields({
      requiredPayerFields: ['email'],
      collectCustomerDetails: true,
      customerFieldsSchema: fieldsWith({ email: null }),
    })).toEqual(['email'])
  })

  it('flags name unless both first and last name are required', () => {
    expect(findUncollectedPayerFields({
      requiredPayerFields: ['email', 'name'],
      collectCustomerDetails: true,
      customerFieldsSchema: fieldsWith({ lastName: false }),
    })).toEqual(['name'])
  })

  it('treats a missing customer field list as collecting nothing and ignores unknown or duplicate entries', () => {
    expect(findUncollectedPayerFields({
      requiredPayerFields: ['name', 'name', 'phone'],
      collectCustomerDetails: true,
      customerFieldsSchema: null,
    })).toEqual(['name'])
  })
})

describe('ensurePayerFieldsCollected', () => {
  beforeEach(() => {
    clearPaymentGatewayDescriptors()
    registerPaymentGatewayDescriptor({
      providerKey: 'payer_required',
      label: 'Payer required',
      requiresPayerFields: ['email', 'name'],
    })
    registerPaymentGatewayDescriptor({ providerKey: 'no_payer', label: 'No payer data' })
  })

  afterAll(() => {
    clearPaymentGatewayDescriptors()
  })

  it('resolves the declared payer fields from the descriptor registry', () => {
    expect(resolveRequiredPayerFields(' payer_required ')).toEqual(['email', 'name'])
    expect(resolveRequiredPayerFields('no_payer')).toEqual([])
    expect(resolveRequiredPayerFields('unknown')).toEqual([])
    expect(resolveRequiredPayerFields(null)).toEqual([])
  })

  it('throws a field-level 422 when the provider needs payer fields the link does not collect', () => {
    let caught: unknown
    try {
      ensurePayerFieldsCollected({
        gatewayProviderKey: 'payer_required',
        collectCustomerDetails: false,
        customerFieldsSchema: DEFAULT_CHECKOUT_CUSTOMER_FIELDS,
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(CrudHttpError)
    expect(caught).toMatchObject({
      status: 422,
      body: {
        fieldErrors: { gatewayProviderKey: PAYER_FIELDS_NOT_COLLECTED_MESSAGE_KEY },
        missingPayerFields: ['email', 'name'],
      },
    })
  })

  it('passes for a correctly configured link and for providers that declare nothing', () => {
    expect(() => ensurePayerFieldsCollected({
      gatewayProviderKey: 'payer_required',
      collectCustomerDetails: true,
      customerFieldsSchema: DEFAULT_CHECKOUT_CUSTOMER_FIELDS,
    })).not.toThrow()
    expect(() => ensurePayerFieldsCollected({
      gatewayProviderKey: 'no_payer',
      collectCustomerDetails: false,
      customerFieldsSchema: [],
    })).not.toThrow()
    expect(() => ensurePayerFieldsCollected({
      gatewayProviderKey: null,
      collectCustomerDetails: false,
      customerFieldsSchema: [],
    })).not.toThrow()
  })
})
