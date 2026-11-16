import { describe, it, expect } from '@jest/globals'
import {
  CUSTOMER_URL_INVALID_MESSAGE_KEY,
  personUpdateSchema,
  companyUpdateSchema,
} from '../data/validators'
import {
  createCompanyFormSchema,
  createCompanyEditSchema,
  createPersonEditSchema,
} from '../components/formConfig'
import de from '../i18n/de.json'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import ko from '../i18n/ko.json'
import pl from '../i18n/pl.json'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'

const INVALID_URL = 'notaurl'

const issueMessage = (
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string,
) => {
  if (result.success) return null
  return result.error?.issues.find((issue) => issue.path.includes(field))?.message ?? null
}

describe('URL validation surfaces a localizable message key (#6005)', () => {
  const scope = { organizationId: ORG_ID, tenantId: TENANT_ID }

  describe('server-side validators', () => {
    it('rejects a malformed company websiteUrl with the i18n key, not Zod’s English default', () => {
      const result = companyUpdateSchema.safeParse({ id: ENTITY_ID, ...scope, websiteUrl: INVALID_URL })
      expect(result.success).toBe(false)
      expect(issueMessage(result, 'websiteUrl')).toBe(CUSTOMER_URL_INVALID_MESSAGE_KEY)
    })

    it('rejects a malformed person linkedInUrl with the i18n key', () => {
      const result = personUpdateSchema.safeParse({ id: ENTITY_ID, ...scope, linkedInUrl: INVALID_URL })
      expect(result.success).toBe(false)
      expect(issueMessage(result, 'linkedInUrl')).toBe(CUSTOMER_URL_INVALID_MESSAGE_KEY)
    })

    it('still accepts a well-formed URL and still clears on empty (no acceptance change)', () => {
      const valid = companyUpdateSchema.safeParse({ id: ENTITY_ID, ...scope, websiteUrl: 'https://example.com' })
      expect(valid.success).toBe(true)

      const cleared = companyUpdateSchema.safeParse({ id: ENTITY_ID, ...scope, websiteUrl: '' })
      expect(cleared.success).toBe(true)
      if (cleared.success) expect(cleared.data.websiteUrl).toBeNull()
    })
  })

  describe('client-side form schemas', () => {
    it('createCompanyFormSchema reports the i18n key for a malformed websiteUrl', () => {
      const result = createCompanyFormSchema().safeParse({ displayName: 'Acme', websiteUrl: INVALID_URL })
      expect(result.success).toBe(false)
      expect(issueMessage(result, 'websiteUrl')).toBe(CUSTOMER_URL_INVALID_MESSAGE_KEY)
    })

    it('createCompanyEditSchema reports the i18n key for a malformed websiteUrl', () => {
      const result = createCompanyEditSchema().safeParse({ id: ENTITY_ID, displayName: 'Acme', websiteUrl: INVALID_URL })
      expect(result.success).toBe(false)
      expect(issueMessage(result, 'websiteUrl')).toBe(CUSTOMER_URL_INVALID_MESSAGE_KEY)
    })

    it('createPersonEditSchema reports the i18n key for a malformed linkedInUrl', () => {
      const result = createPersonEditSchema().safeParse({
        id: ENTITY_ID,
        displayName: 'Ada',
        firstName: 'Ada',
        lastName: 'Lovelace',
        linkedInUrl: INVALID_URL,
      })
      expect(result.success).toBe(false)
      expect(issueMessage(result, 'linkedInUrl')).toBe(CUSTOMER_URL_INVALID_MESSAGE_KEY)
    })

    it('createCompanyFormSchema still accepts a well-formed websiteUrl', () => {
      const result = createCompanyFormSchema().safeParse({ displayName: 'Acme', websiteUrl: 'https://example.com' })
      expect(result.success).toBe(true)
    })
  })

  describe('locale coverage', () => {
    // CrudForm resolves the message via t(key, key), so a locale missing this entry
    // renders the raw key to the user instead of a sentence.
    const locales = { de, en, es, ko, pl } as Record<string, Record<string, string>>

    it.each(Object.keys(locales))('%s defines a translated string for the key', (locale) => {
      const value = locales[locale][CUSTOMER_URL_INVALID_MESSAGE_KEY]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
      expect(value).not.toBe(CUSTOMER_URL_INVALID_MESSAGE_KEY)
    })
  })
})
