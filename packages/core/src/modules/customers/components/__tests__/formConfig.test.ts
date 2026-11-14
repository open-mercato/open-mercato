/** @jest-environment node */

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({}))
jest.mock('../AddressTiles', () => ({
  CustomerAddressTiles: () => null,
}))
jest.mock('../detail/RolesSection', () => ({
  RolesSection: () => null,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
  useOptionalLocale: () => undefined,
}))

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  buildCompanyEditPayload,
  buildCompanyPayload,
  buildPersonEditPayload,
  buildPersonPayload,
  createCompanyDaneFiremyGroups,
  createCompanyEditSchema,
  createCompanyFormFields,
  createCompanyFormSchema,
  createPersonEditSchema,
  createPersonFormFields,
  createPersonPersonalDataGroups,
  mapCompanyOverviewToFormValues,
  mapPersonOverviewToFormValues,
  type Translator,
} from '../formConfig'
import { parseCompanyAnnualRevenue } from '../../lib/parseCompanyAnnualRevenue'

const t: Translator = (_key, fallback) => fallback ?? _key

const PERSON_ID = '44444444-4444-4444-8444-444444444444'
const COMPANY_ID = '55555555-5555-4555-8555-555555555555'

describe('detail page zone1 group layouts', () => {
  it('keeps all company v2 zone1 groups in the sortable primary column', () => {
    const groups = createCompanyDaneFiremyGroups(t)

    expect(groups.map((group) => group.id)).toEqual([
      'identity',
      'contact',
      'classification',
      'businessProfile',
      'notes',
      'customFields',
    ])
    expect(groups.every((group) => group.column === 1)).toBe(true)
  })

  it('keeps all person v2 zone1 groups in the sortable primary column', () => {
    const groups = createPersonPersonalDataGroups(t)

    expect(groups.map((group) => group.id)).toEqual([
      'personalDataDisplay',
      'personalData',
      'companyRole',
      'customFields',
      'roles',
    ])
    expect(groups.every((group) => group.column === 1)).toBe(true)
  })

  it('keeps selected custom select values and omits untouched undefined custom fields', () => {
    const company = buildCompanyPayload({
      displayName: 'Acme',
      cf_relationship_health: 'monitor',
      cf_renewal_quarter: undefined,
    })

    expect(company.customFields).toEqual({
      relationship_health: 'monitor',
    })
  })

  it('submits explicit custom select clears as null', () => {
    const person = buildPersonPayload({
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      cf_buying_role: null,
    })

    expect(person.customFields).toEqual({
      buying_role: null,
    })
  })

  it('maps company custom fields to prefixed edit-form keys', () => {
    const values = mapCompanyOverviewToFormValues({
      company: {
        id: 'company-1',
        displayName: 'Acme',
        primaryPhone: null,
        primaryEmail: null,
        status: null,
        lifecycleStage: null,
        source: null,
        description: null,
      },
      profile: {
        legalName: null,
        brandName: null,
        domain: null,
        websiteUrl: null,
        industry: null,
        sizeBucket: null,
        annualRevenue: null,
      },
      customFields: {
        relationship_health: 'healthy',
        renewal_quarter: 'Q3',
        customer_marketing_case: true,
      },
    } as any)

    expect(values.cf_relationship_health).toBe('healthy')
    expect(values.cf_renewal_quarter).toBe('Q3')
    expect(values.cf_customer_marketing_case).toBe(true)
  })

  it('maps person custom fields to prefixed edit-form keys', () => {
    const values = mapPersonOverviewToFormValues({
      person: {
        id: 'person-1',
        displayName: 'Ada Lovelace',
        primaryPhone: null,
        primaryEmail: null,
        status: null,
        lifecycleStage: null,
        source: null,
        description: null,
      },
      profile: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        companyEntityId: null,
        jobTitle: null,
        department: null,
        linkedInUrl: null,
        twitterUrl: null,
      },
      customFields: {
        buying_role: 'champion',
      },
    } as any)

    expect(values.cf_buying_role).toBe('champion')
  })
})

describe('clearing v2 URL & email edit fields (#2526)', () => {
  it('transmits null when a previously-set person URL/email/phone is blanked', () => {
    const parsed = createPersonEditSchema().safeParse({
      id: PERSON_ID,
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      primaryEmail: '',
      primaryPhone: '',
      linkedInUrl: '',
      twitterUrl: '',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildPersonEditPayload(parsed.data as any)
    expect(payload.primaryEmail).toBeNull()
    expect(payload.primaryPhone).toBeNull()
    expect(payload.linkedInUrl).toBeNull()
    expect(payload.twitterUrl).toBeNull()
  })

  it('keeps non-empty person URL/email/phone values on edit', () => {
    const parsed = createPersonEditSchema().safeParse({
      id: PERSON_ID,
      displayName: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      primaryEmail: 'ada@example.com',
      primaryPhone: '+1 212 555 0101',
      linkedInUrl: 'https://linkedin.com/in/ada',
      twitterUrl: 'https://x.com/ada',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildPersonEditPayload(parsed.data as any)
    expect(payload.primaryEmail).toBe('ada@example.com')
    expect(payload.primaryPhone).toBe('+1 212 555 0101')
    expect(payload.linkedInUrl).toBe('https://linkedin.com/in/ada')
    expect(payload.twitterUrl).toBe('https://x.com/ada')
  })

  it('transmits null when a previously-set company website/email/phone is blanked', () => {
    const parsed = createCompanyEditSchema().safeParse({
      id: COMPANY_ID,
      displayName: 'Acme',
      primaryEmail: '',
      primaryPhone: '',
      websiteUrl: '',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildCompanyEditPayload(parsed.data as any)
    expect(payload.primaryEmail).toBeNull()
    expect(payload.primaryPhone).toBeNull()
    expect(payload.websiteUrl).toBeNull()
  })

  it('transmits null when a previously-set company domain is blanked (#2529)', () => {
    const parsed = createCompanyEditSchema().safeParse({
      id: COMPANY_ID,
      displayName: 'Acme',
      domain: '',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildCompanyEditPayload(parsed.data as any)
    expect(payload.domain).toBeNull()
  })

  it('keeps and lowercases a non-empty company domain on edit (#2529)', () => {
    const parsed = createCompanyEditSchema().safeParse({
      id: COMPANY_ID,
      displayName: 'Acme',
      domain: 'Acme.COM',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildCompanyEditPayload(parsed.data as any)
    expect(payload.domain).toBe('acme.com')
  })

  it('keeps non-empty company website/email/phone values on edit', () => {
    const parsed = createCompanyEditSchema().safeParse({
      id: COMPANY_ID,
      displayName: 'Acme',
      primaryEmail: 'hello@acme.com',
      primaryPhone: '+1 212 555 0202',
      websiteUrl: 'https://acme.com',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildCompanyEditPayload(parsed.data as any)
    expect(payload.primaryEmail).toBe('hello@acme.com')
    expect(payload.primaryPhone).toBe('+1 212 555 0202')
    expect(payload.websiteUrl).toBe('https://acme.com')
  })
})

describe('clearing v2 company plain-text & revenue edit fields (#3050)', () => {
  it('transmits null when previously-set legal/brand/size/revenue/description are blanked', () => {
    const parsed = createCompanyEditSchema().safeParse({
      id: COMPANY_ID,
      displayName: 'Acme',
      legalName: '',
      brandName: '',
      sizeBucket: '',
      annualRevenue: '',
      description: '',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildCompanyEditPayload(parsed.data as any)
    expect(payload.legalName).toBeNull()
    expect(payload.brandName).toBeNull()
    expect(payload.sizeBucket).toBeNull()
    expect(payload.annualRevenue).toBeNull()
    expect(payload.description).toBeNull()
  })

  it('keeps non-empty plain-text & revenue values on edit', () => {
    const parsed = createCompanyEditSchema().safeParse({
      id: COMPANY_ID,
      displayName: 'Acme',
      legalName: 'Acme Corp.',
      brandName: 'Acme',
      sizeBucket: '11-50',
      annualRevenue: '1,500,000',
      description: 'B2B widgets',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildCompanyEditPayload(parsed.data as any)
    expect(payload.legalName).toBe('Acme Corp.')
    expect(payload.brandName).toBe('Acme')
    expect(payload.sizeBucket).toBe('11-50')
    expect(payload.annualRevenue).toBe('1500000')
    expect(payload.description).toBe('B2B widgets')
  })

  it('leaves create-mode blanks as omitted (no clear semantics on create)', () => {
    const parsed = createCompanyFormSchema().safeParse({
      displayName: 'Acme',
      legalName: '',
      brandName: '',
      sizeBucket: '',
      annualRevenue: '',
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const payload = buildCompanyPayload(parsed.data as any)
    expect('legalName' in payload).toBe(false)
    expect('brandName' in payload).toBe(false)
    expect('sizeBucket' in payload).toBe(false)
    expect('annualRevenue' in payload).toBe(false)
    expect('description' in payload).toBe(false)
  })
})

describe('company annual revenue locale decimal comma (issue #9430)', () => {
  it('parses a Polish decimal comma instead of stripping it as a thousands separator', () => {
    expect(parseCompanyAnnualRevenue('1234,56', 'pl-PL')).toBe('1234.56')
    expect(parseCompanyAnnualRevenue('15,99', 'pl-PL')).toBe('15.99')
    expect(parseCompanyAnnualRevenue('150,5', 'pl-PL')).toBe('150.5')
    expect(parseCompanyAnnualRevenue('2500000,13', 'pl-PL')).toBe('2500000.13')
  })

  it('still accepts a dot, so the workaround users learned keeps working', () => {
    expect(parseCompanyAnnualRevenue('1234.56', 'pl-PL')).toBe('1234.56')
    expect(parseCompanyAnnualRevenue('15.99', 'pl-PL')).toBe('15.99')
    expect(parseCompanyAnnualRevenue('150.5', 'en-US')).toBe('150.5')
  })

  it('accepts large two-decimal amounts exactly, without floating-point residue (numeric(16,2))', () => {
    // 10000000000.03 * 100 leaves a float residue of ~1.2e-4; precision must be
    // judged on the decimal digits, not on a scaled float.
    expect(parseCompanyAnnualRevenue('10000000000.03', 'pl-PL')).toBe('10000000000.03')
    expect(parseCompanyAnnualRevenue('10000000000,03', 'pl-PL')).toBe('10000000000.03')
    expect(parseCompanyAnnualRevenue('10 000 000 000,03', 'pl-PL')).toBe('10000000000.03')
    expect(parseCompanyAnnualRevenue('10,000,000,000.03', 'en-US')).toBe('10000000000.03')
    expect(parseCompanyAnnualRevenue('99999999999999.99', 'pl-PL')).toBe('99999999999999.99')
    expect(parseCompanyAnnualRevenue('99999999999999,99', 'pl-PL')).toBe('99999999999999.99')
    expect(parseCompanyAnnualRevenue('0,01', 'pl-PL')).toBe('0.01')
    expect(parseCompanyAnnualRevenue('0', 'pl-PL')).toBe('0')
  })

  it('normalizes redundant zeros without changing the amount', () => {
    expect(parseCompanyAnnualRevenue('1234,50', 'pl-PL')).toBe('1234.5')
    expect(parseCompanyAnnualRevenue('1234,500', 'pl-PL')).toBe('1234.5')
    expect(parseCompanyAnnualRevenue('007,10', 'pl-PL')).toBe('7.1')
    expect(parseCompanyAnnualRevenue(',5', 'pl-PL')).toBe('0.5')
  })

  it('keeps the exact large amount in the create and edit payloads', () => {
    const created = buildCompanyPayload({ displayName: 'Acme', annualRevenue: '10000000000,03' }, null, 'pl-PL')
    expect(created.annualRevenue).toBe('10000000000.03')
    const edited = buildCompanyEditPayload(
      { id: COMPANY_ID, displayName: 'Acme', annualRevenue: '99999999999999.99' } as any,
      null,
      'pl-PL',
    )
    expect(edited.annualRevenue).toBe('99999999999999.99')
  })

  it('rejects genuinely over-precise amounts, including large ones', () => {
    expect(parseCompanyAnnualRevenue('1234.567', 'pl-PL')).toBeNull()
    expect(parseCompanyAnnualRevenue('1234,567', 'pl-PL')).toBeNull()
    expect(parseCompanyAnnualRevenue('10000000000.031', 'pl-PL')).toBeNull()
    expect(parseCompanyAnnualRevenue('0,001', 'pl-PL')).toBeNull()
    expect(() => buildCompanyPayload({ displayName: 'Acme', annualRevenue: '1234.567' }, null, 'pl-PL')).toThrow(
      'ANNUAL_REVENUE_INVALID',
    )
  })

  it('rejects exponent notation instead of storing a scaled amount', () => {
    expect(parseCompanyAnnualRevenue('1e3', 'pl-PL')).toBeNull()
    expect(parseCompanyAnnualRevenue('1,5e2', 'pl-PL')).toBeNull()
  })

  it('saves the locale-parsed amount on create and edit payloads', () => {
    const created = buildCompanyPayload({ displayName: 'Acme', annualRevenue: '1234,56' }, null, 'pl-PL')
    expect(created.annualRevenue).toBe('1234.56')

    const edited = buildCompanyEditPayload(
      { id: COMPANY_ID, displayName: 'Acme', annualRevenue: '15,99' } as any,
      null,
      'pl-PL',
    )
    expect(edited.annualRevenue).toBe('15.99')
  })

  it('keeps en-US thousands grouping working without a silent scale change', () => {
    const payload = buildCompanyPayload({ displayName: 'Acme', annualRevenue: '1,500,000' }, null, 'en-US')
    expect(payload.annualRevenue).toBe('1500000')
  })

  it('rejects unparseable or over-precise input instead of silently changing the amount', () => {
    expect(parseCompanyAnnualRevenue('abc', 'pl-PL')).toBeNull()
    expect(parseCompanyAnnualRevenue('15,999', 'pl-PL')).toBeNull()
    expect(parseCompanyAnnualRevenue('-10', 'pl-PL')).toBeNull()
    expect(() => buildCompanyPayload({ displayName: 'Acme', annualRevenue: 'abc' }, null, 'pl-PL')).toThrow(
      'ANNUAL_REVENUE_INVALID',
    )
  })
})

describe('PhoneNumberField defaultCountryIso2 forwarding', () => {
  const mockRenderProps = {
    value: null,
    setValue: () => {},
    error: undefined,
    disabled: false,
    autoFocus: false,
    recordId: undefined,
  }

  it('renders phone input with +48 country code in person form when defaultCountryIso2: PL is provided', () => {
    const fields = createPersonFormFields(t, { defaultCountryIso2: 'PL' })
    const phoneField = fields.find((f) => f.id === 'primaryPhone')
    expect(phoneField).toBeDefined()
    expect(phoneField?.type).toBe('custom')
    if (phoneField?.type === 'custom') expect(phoneField.rendersOwnError).toBe(true)

    const html = renderToStaticMarkup(React.createElement(phoneField!.component as any, mockRenderProps))
    expect(html).toContain('+48')
  })

  it('renders phone input with +48 country code in company form when defaultCountryIso2: PL is provided', () => {
    const fields = createCompanyFormFields(t, { defaultCountryIso2: 'PL' })
    const phoneField = fields.find((f) => f.id === 'primaryPhone')
    expect(phoneField).toBeDefined()
    expect(phoneField?.type).toBe('custom')
    if (phoneField?.type === 'custom') expect(phoneField.rendersOwnError).toBe(true)

    const html = renderToStaticMarkup(React.createElement(phoneField!.component as any, mockRenderProps))
    expect(html).toContain('+48')
  })

  it('renders phone input with default +1 country code when options are omitted', () => {
    const fields = createPersonFormFields(t)
    const phoneField = fields.find((f) => f.id === 'primaryPhone')
    expect(phoneField).toBeDefined()

    const html = renderToStaticMarkup(React.createElement(phoneField!.component as any, mockRenderProps))
    expect(html).toContain('+1')
  })
})


describe('CRM contributed form data', () => {
  it('hydrates person/company namespaces and excludes them from native payloads', () => {
    const namespace = { priority: 'high', priorityId: 'priority-1', priorityUpdatedAt: '2026-10-01T10:00:00.000Z' }
    const person = mapPersonOverviewToFormValues({ person: { id: PERSON_ID, displayName: 'Ada', _example: namespace }, profile: null, customFields: {} } as unknown as Parameters<typeof mapPersonOverviewToFormValues>[0])
    const company = mapCompanyOverviewToFormValues({ company: { id: COMPANY_ID, displayName: 'Acme', _example: namespace }, profile: null, customFields: {} } as unknown as Parameters<typeof mapCompanyOverviewToFormValues>[0])
    expect(person._example).toEqual(namespace)
    expect(company._example).toEqual(namespace)
    expect(buildPersonPayload({ ...person, displayName: 'Ada', '_example.priority': 'critical' })).not.toHaveProperty('_example')
    expect(buildCompanyPayload({ ...company, displayName: 'Acme', '_example.priority': 'critical' })).not.toHaveProperty('_example')
  })
})
