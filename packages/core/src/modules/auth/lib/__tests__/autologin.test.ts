import { resolveAutoLoginCredentials, isAutoLoginEnabled } from '@open-mercato/core/modules/auth/lib/autologin'

describe('resolveAutoLoginCredentials', () => {
  it('returns null when credentials are unset (default: disabled)', () => {
    expect(resolveAutoLoginCredentials({})).toBeNull()
    expect(isAutoLoginEnabled({})).toBe(false)
  })

  it('returns null when only one of email/password is set', () => {
    expect(resolveAutoLoginCredentials({ OM_AUTOLOGIN_EMAIL: 'a@b.com' })).toBeNull()
    expect(resolveAutoLoginCredentials({ OM_AUTOLOGIN_PASSWORD: 'secret' })).toBeNull()
  })

  it('returns null when email is blank/whitespace', () => {
    expect(
      resolveAutoLoginCredentials({ OM_AUTOLOGIN_EMAIL: '   ', OM_AUTOLOGIN_PASSWORD: 'secret' }),
    ).toBeNull()
  })

  it('resolves email + password with tenant omitted', () => {
    const env = { OM_AUTOLOGIN_EMAIL: ' a@b.com ', OM_AUTOLOGIN_PASSWORD: 'secret' }
    expect(resolveAutoLoginCredentials(env)).toEqual({ email: 'a@b.com', password: 'secret', tenantId: null })
    expect(isAutoLoginEnabled(env)).toBe(true)
  })

  it('preserves the password verbatim (no trimming of surrounding spaces)', () => {
    const env = { OM_AUTOLOGIN_EMAIL: 'a@b.com', OM_AUTOLOGIN_PASSWORD: ' spaced ' }
    expect(resolveAutoLoginCredentials(env)?.password).toBe(' spaced ')
  })

  it('includes tenant when provided', () => {
    const env = {
      OM_AUTOLOGIN_EMAIL: 'a@b.com',
      OM_AUTOLOGIN_PASSWORD: 'secret',
      OM_AUTOLOGIN_TENANT: ' tenant-1 ',
    }
    expect(resolveAutoLoginCredentials(env)).toEqual({
      email: 'a@b.com',
      password: 'secret',
      tenantId: 'tenant-1',
    })
  })
})
