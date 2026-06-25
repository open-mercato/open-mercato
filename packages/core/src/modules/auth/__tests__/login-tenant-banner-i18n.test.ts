import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import en from '../i18n/en.json'
import es from '../i18n/es.json'
import pl from '../i18n/pl.json'
import de from '../i18n/de.json'

const locales: Record<string, Record<string, string>> = { en, es, pl, de }

const BANNER_KEY = 'auth.login.tenantBanner'

describe('login tenant banner i18n (#3127)', () => {
  it('keeps the {tenant} placeholder in every locale', () => {
    for (const [locale, dict] of Object.entries(locales)) {
      expect(dict[BANNER_KEY]).toContain('{tenant}')
    }
  })

  it('does not duplicate the word "tenant" when the tenant name already carries the provisioned " Tenant" suffix', () => {
    // Provisioning names tenants `${orgName} Tenant` (auth/lib/setup-app.ts, auth/cli.ts),
    // so the banner must not append its own generic "tenant" descriptor on top of that name.
    const provisionedTenantName = 'Acme Tenant'
    for (const [locale, dict] of Object.entries(locales)) {
      const translate = createTranslator(dict)
      const rendered = translate(BANNER_KEY, { tenant: provisionedTenantName })
      expect(rendered).toContain(provisionedTenantName)
      expect(rendered).not.toMatch(/tenant\s+tenant/i)
    }
  })

  it('renders the English banner as the tenant name only, with no trailing descriptor', () => {
    const translate = createTranslator(en)
    expect(translate(BANNER_KEY, { tenant: 'Qacorpo' })).toBe("You're logging in to Qacorpo.")
  })
})
