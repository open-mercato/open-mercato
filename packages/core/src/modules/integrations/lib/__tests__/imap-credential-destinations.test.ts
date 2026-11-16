import { integration as imapIntegration } from '@open-mercato/channel-imap/modules/channel_imap/integration'
import { MASKED_SECRET_VALUE, MaskedSecretDestinationChangedError, mergeMaskedSecretCredentials } from '../credentials-masking'

const existing = {
  imapHost: 'imap.trusted.example', imapPort: '993', imapTls: 'tls', imapPassword: 'stored-imap-password',
  smtpHost: 'smtp.trusted.example', smtpPort: '465', smtpTls: 'tls', smtpPassword: 'stored-smtp-password',
  fromAddress: 'sender@example.com',
}
const cases = ['imapHost', 'smtpHost', 'imapPort', 'smtpPort', 'imapTls', 'smtpTls'].flatMap((field) => (
  ['sentinel', 'list'].map((format) => ({ field, format }))
))

function imapRetainedCredentials(format: string): Record<string, unknown> {
  const incoming: Record<string, unknown> = { ...existing }
  for (const field of ['imapPassword', 'smtpPassword']) {
    if (format === 'sentinel') incoming[field] = MASKED_SECRET_VALUE
    else delete incoming[field]
  }
  return incoming
}

describe('real IMAP integration credential destinations', () => {
  it.each(cases)('refuses changed $field with $format secret preservation', ({ field, format }) => {
    const incoming = { ...imapRetainedCredentials(format), [field]: field.endsWith('Port') ? '1143' : field.endsWith('Tls') ? 'none' : 'attacker.example' }
    expect(() => mergeMaskedSecretCredentials(imapIntegration.credentials, incoming, existing, ['imapPassword', 'smtpPassword']))
      .toThrow(MaskedSecretDestinationChangedError)
  })

  it.each(['imapTls', 'smtpTls'])('refuses adding or omitting %s while retaining a password', (field) => {
    for (const format of ['sentinel', 'list']) {
      const omitted = imapRetainedCredentials(format)
      delete omitted[field]
      expect(() => mergeMaskedSecretCredentials(imapIntegration.credentials, omitted, existing, ['imapPassword', 'smtpPassword']))
        .toThrow(MaskedSecretDestinationChangedError)
      const legacy: Record<string, unknown> = { ...existing }
      delete legacy[field]
      expect(() => mergeMaskedSecretCredentials(imapIntegration.credentials, imapRetainedCredentials(format), legacy, ['imapPassword', 'smtpPassword']))
        .toThrow(MaskedSecretDestinationChangedError)
    }
  })

  it.each(['fromAddress', 'support', 'import', 'transport'])('preserves unchanged destinations while editing %s', (field) => {
    const incoming = { ...imapRetainedCredentials('sentinel'), [field]: 'changed' }
    expect(mergeMaskedSecretCredentials(imapIntegration.credentials, incoming, existing))
      .toEqual({ ...existing, [field]: 'changed' })
  })

  it('allows destination changes when both passwords are explicitly replaced', () => {
    const incoming = { ...existing, imapHost: 'imap.new.example', smtpHost: 'smtp.new.example', imapPassword: 'new-imap', smtpPassword: 'new-smtp' }
    expect(mergeMaskedSecretCredentials(imapIntegration.credentials, incoming, existing)).toEqual(incoming)
  })
})
