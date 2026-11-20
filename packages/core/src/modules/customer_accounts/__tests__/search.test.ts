jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback: string) => fallback }),
}))

import { searchConfig } from '../search'

describe('customer account search privacy', () => {
  test.each(['display_name', 'displayName'])('keeps email out of vector text and presenters with %s', async (nameField) => {
    const config = searchConfig.entities.find((entity) => entity.entityId === 'customer_accounts:customer_user')!
    const context = {
      tenantId: 'tenant-privacy',
      record: {
        id: 'account-privacy',
        [nameField]: 'Encrypted Account Name',
        email: 'private-account@example.com',
        password_hash: 'private-password-hash',
      },
      customFields: { summary: 'private-summary', email: 'private-custom@example.com' },
    }
    const source = await config.buildSource!(context)
    expect(source).not.toBeNull()
    expect(JSON.stringify(source)).not.toContain('private-')
    expect(JSON.stringify(source!.text)).not.toContain('Encrypted Account Name')
    expect(source!.presenter?.title).toBe('Encrypted Account Name')
    expect(await config.formatResult!(context)).not.toHaveProperty('subtitle', expect.stringContaining('private-'))
    expect(config.fieldPolicy?.searchable).not.toContain('email')
    expect(config.fieldPolicy?.hashOnly).toContain('email')
  })

  test('indexes a nameless account using its ID without falling back to email', async () => {
    const config = searchConfig.entities.find((entity) => entity.entityId === 'customer_accounts:customer_user')!
    const source = await config.buildSource!({
      record: { id: 'nameless-account', email: 'private-nameless@example.com' },
      customFields: {},
    })
    expect(source?.text).toEqual(['Customer user ID: nameless-account'])
    expect(source?.presenter?.title).toBe('nameless-account')
    expect(JSON.stringify(source)).not.toContain('private-')
  })
})
