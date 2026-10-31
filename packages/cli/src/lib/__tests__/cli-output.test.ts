import { redactCliArgs, redactCliText } from '../cli-output'

describe('CLI output redaction', () => {
  it.each([
    '--password', '--admin-password', '--passwd', '--passphrase', '--token',
    '--client-secret', '--api-key', '--apiKey', '--API_KEY', '--private-key',
    '--credentials', '--authorization', '--database-url', '--redis_url',
    '--signing-key', '--encryption-key', '--access-key', '--bearer',
  ])('redacts both value forms for %s without changing the execution arguments', (flag) => {
    const args = [flag, 'fixture-sensitive-value', `${flag}=fixture-other-value`, '--email', 'owner@example.test']
    const original = [...args]

    expect(redactCliArgs(args)).toEqual([flag, '****', `${flag}=****`, '--email', 'owner@example.test'])
    expect(args).toEqual(original)
  })

  it('handles repeated options, equals signs, dash-prefixed values and missing values', () => {
    expect(redactCliArgs(['--token=one=two', '--password', '-value', '--token', '--token', 'value', '--secret']))
      .toEqual(['--token=****', '--password', '****', '--token', '****', '****', '--secret'])
  })

  it('preserves non-secret flags and positional values', () => {
    expect(redactCliArgs(['--tenant', 'tenant-1', '--count=10', 'positional']))
      .toEqual(['--tenant', 'tenant-1', '--count=10', 'positional'])
  })

  it('preserves token counts, presence-cache settings and credential-related configuration', () => {
    const args = ['--max-tokens', '5000', '--token-cache-ms=30000', '--dry-run=false', '--password-mode', 'required']
    const env = {
      OM_SEARCH_STORE_RAW_TOKENS: 'false',
      OM_SEARCH_MAX_TOKENS_PER_FIELD: '5000',
      OM_SEARCH_MAX_TOKENS_PER_RECORD: '10000',
      OM_SEARCH_TOKEN_PRESENCE_CACHE_MS: '30000',
      RATE_LIMIT_KEY_PREFIX: 'rate-limit',
    }
    const text = 'Query timed out after 30000ms; expected true, got false; max 5000/10000; rate-limit'

    expect(redactCliArgs(args)).toEqual(args)
    expect(redactCliText(text, args, env)).toBe(text)
  })

  it.each(['1', 'false', 'a'])('still redacts the actual short credential %s', (credential) => {
    expect(redactCliArgs(['--password', credential, `--token=${credential}`]))
      .toEqual(['--password', '****', '--token=****'])
    expect(redactCliText(`[${credential}]`, [], { OM_INIT_ADMIN_PASSWORD: credential }))
      .toBe('[****]')
    expect(redactCliText(`[${credential}]`, ['--token', credential], {}))
      .toBe('[****]')
  })

  it('redacts versioned and fallback credential keys', () => {
    expect(redactCliText('Rejected fixture-versioned-secret fixture-fallback-key', [], {
      DOCUMENTS_COLLAB_JWT_SECRET_V2: 'fixture-versioned-secret',
      TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'fixture-fallback-key',
    })).toBe('Rejected **** ****')
  })

  it('redacts known CLI and environment credentials from exception messages', () => {
    const env = {
      OM_INIT_SUPERADMIN_PASSWORD: 'fixture-owner-password',
      OM_INIT_ADMIN_PASSWORD: 'fixture-admin-password',
      OM_INIT_EMPLOYEE_PASSWORD: 'fixture-staff-password',
      DATABASE_URL: 'postgres://owner:fixture-db-password@db/app',
      PUBLIC_LABEL: 'keep-me',
    }
    const args = ['--password=fixture-cli-password', '--token', 'fixture-token']
    const text = `Failed fixture-owner-password fixture-admin-password fixture-staff-password fixture-cli-password fixture-token ${env.DATABASE_URL} keep-me`

    expect(redactCliText(text, args, env)).toBe('Failed **** **** **** **** **** **** keep-me')
  })

  it('redacts connection-string passwords while retaining diagnostic targets', () => {
    expect(redactCliText('connect postgres://owner:fixture-db-password@db:5432/app refused', [], {}))
      .toBe('connect postgres://owner:****@db:5432/app refused')
  })

  it('replaces longer secrets first and ignores empty values', () => {
    expect(redactCliText('prefix-value prefix', ['--token=', '--token', 'prefix'], { API_KEY: 'prefix-value', PASSWORD: '' }))
      .toBe('**** ****')
  })
})
