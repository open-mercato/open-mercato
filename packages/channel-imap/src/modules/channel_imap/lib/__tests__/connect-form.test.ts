import {
  IMAP_CONNECT_INITIAL_VALUES,
  buildImapConnectRequestBody,
  createImapConnectFormSchema,
} from '../connect-form'

const translate = (key: string, fallback: string) => `${key}|${fallback}`

function fieldErrorsOf(input: Record<string, unknown>): Record<string, string> {
  const result = createImapConnectFormSchema(translate).safeParse(input)
  if (result.success) return {}
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0])
    if (!errors[field]) errors[field] = issue.message
  }
  return errors
}

const VALID = {
  displayName: '',
  fromAddress: 'me@example.com',
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapTls: 'tls',
  imapUser: 'me@example.com',
  imapPassword: 'secret',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpTls: 'tls',
  smtpUser: '',
  smtpPassword: '',
}

describe('IMAP connect form schema', () => {
  it('reports a translated per-field error for every required field of an empty form (#5593)', () => {
    expect(fieldErrorsOf(IMAP_CONNECT_INITIAL_VALUES)).toEqual({
      fromAddress: 'communication_channels.profile.connect.errors.required|This field is required.',
      imapHost: 'communication_channels.profile.connect.errors.required|This field is required.',
      imapUser: 'communication_channels.profile.connect.errors.required|This field is required.',
      imapPassword: 'communication_channels.profile.connect.errors.required|This field is required.',
      smtpHost: 'communication_channels.profile.connect.errors.required|This field is required.',
    })
  })

  it('flags an invalid from address and out-of-range ports on their own fields', () => {
    expect(fieldErrorsOf({ ...VALID, fromAddress: 'not-an-email', imapPort: 0, smtpPort: 70000 })).toEqual({
      fromAddress: 'communication_channels.profile.connect.errors.invalidEmail|Enter a valid email address.',
      imapPort: 'communication_channels.profile.connect.errors.invalidPort|Enter a port between 1 and 65535.',
      smtpPort: 'communication_channels.profile.connect.errors.invalidPort|Enter a port between 1 and 65535.',
    })
  })

  it('accepts a form with only the required fields filled', () => {
    expect(fieldErrorsOf(VALID)).toEqual({})
  })
})

describe('buildImapConnectRequestBody', () => {
  it('falls back to the from address and IMAP login when optional fields are blank', () => {
    const values = createImapConnectFormSchema(translate).parse({ ...VALID, imapPort: '993' })
    const body = buildImapConnectRequestBody(values)

    expect(body.displayName).toBe('me@example.com')
    expect(body.credentials).toMatchObject({
      imapPort: 993,
      smtpUser: 'me@example.com',
      smtpPassword: 'secret',
    })
  })

  it('keeps explicit display name and SMTP credentials', () => {
    const values = createImapConnectFormSchema(translate).parse({
      ...VALID,
      displayName: 'Work mail',
      smtpUser: 'relay',
      smtpPassword: 'relay-secret',
    })
    const body = buildImapConnectRequestBody(values)

    expect(body.displayName).toBe('Work mail')
    expect(body.credentials).toMatchObject({ smtpUser: 'relay', smtpPassword: 'relay-secret' })
  })
})
