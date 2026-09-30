import { describe, it, expect } from '@jest/globals'
import {
  CUSTOMER_EMAIL_INVALID_MESSAGE_KEY,
  personUpdateSchema,
  companyUpdateSchema,
} from '../data/validators'
import {
  createPersonFormSchema,
  createCompanyFormSchema,
  createPersonEditSchema,
  createCompanyEditSchema,
} from '../components/formConfig'
import de from '../i18n/de.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'
import pl from '../i18n/pl.json'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'

const INVALID_EMAIL = 'not-an-email'

const emailIssueMessage = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => {
  if (result.success) return null
  return result.error?.issues.find((issue) => issue.path.includes('primaryEmail'))?.message ?? null
}

describe('email validation surfaces a localizable message key (#5925)', () => {
  const personBase = { id: ENTITY_ID, organizationId: ORG_ID, tenantId: TENANT_ID }

  describe('server-side validators', () => {
    it('rejects a malformed person primaryEmail with the i18n key, not Zod’s English default', () => {
      const result = personUpdateSchema.safeParse({ ...personBase, primaryEmail: INVALID_EMAIL })
      expect(result.success).toBe(false)
      expect(emailIssueMessage(result)).toBe(CUSTOMER_EMAIL_INVALID_MESSAGE_KEY)
    })

    it('rejects a malformed company primaryEmail with the i18n key', () => {
      const result = companyUpdateSchema.safeParse({ ...personBase, primaryEmail: INVALID_EMAIL })
      expect(result.success).toBe(false)
      expect(emailIssueMessage(result)).toBe(CUSTOMER_EMAIL_INVALID_MESSAGE_KEY)
    })

    it('still accepts a well-formed address and still clears on empty (no acceptance change)', () => {
      const valid = personUpdateSchema.safeParse({ ...personBase, primaryEmail: 'ada@example.com' })
      expect(valid.success).toBe(true)

      const cleared = personUpdateSchema.safeParse({ ...personBase, primaryEmail: '' })
      expect(cleared.success).toBe(true)
      if (cleared.success) expect(cleared.data.primaryEmail).toBeNull()
    })
  })

  describe('client-side form schemas', () => {
    const cases = [
      ['createPersonFormSchema', () => createPersonFormSchema(), { displayName: 'Ada', firstName: 'Ada', lastName: 'Lovelace' }],
      ['createCompanyFormSchema', () => createCompanyFormSchema(), { displayName: 'Acme' }],
      ['createPersonEditSchema', () => createPersonEditSchema(), { id: ENTITY_ID, displayName: 'Ada', firstName: 'Ada', lastName: 'Lovelace' }],
      ['createCompanyEditSchema', () => createCompanyEditSchema(), { id: ENTITY_ID, displayName: 'Acme' }],
    ] as const

    it.each(cases)('%s reports the i18n key for a malformed primaryEmail', (_name, buildSchema, base) => {
      const result = buildSchema().safeParse({ ...base, primaryEmail: INVALID_EMAIL })
      expect(result.success).toBe(false)
      expect(emailIssueMessage(result)).toBe(CUSTOMER_EMAIL_INVALID_MESSAGE_KEY)
    })

    it.each(cases)('%s still accepts a well-formed primaryEmail', (_name, buildSchema, base) => {
      const result = buildSchema().safeParse({ ...base, primaryEmail: 'ada@example.com' })
      expect(result.success).toBe(true)
    })
  })

  describe('locale coverage', () => {
    // CrudForm resolves the message via t(key, key), so a locale missing this entry
    // renders the raw key to the user instead of a sentence.
    const locales = { de, en, es, ko, pl } as Record<string, Record<string, string>>

    it.each(Object.keys(locales))('%s defines a translated string for the key', (locale) => {
      const value = locales[locale][CUSTOMER_EMAIL_INVALID_MESSAGE_KEY]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
      expect(value).not.toBe(CUSTOMER_EMAIL_INVALID_MESSAGE_KEY)
    })
  })
})
