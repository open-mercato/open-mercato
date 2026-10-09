import { z } from 'zod'

type Translate = (key: string, fallback: string) => string

const TLS_MODES = ['tls', 'starttls', 'none'] as const

export type ImapConnectTlsMode = (typeof TLS_MODES)[number]

export function createImapConnectFormSchema(t: Translate) {
  const required = t('communication_channels.profile.connect.errors.required', 'This field is required.')
  const invalidPort = t(
    'communication_channels.profile.connect.errors.invalidPort',
    'Enter a port between 1 and 65535.',
  )
  const requiredText = z.string().trim().min(1, required)
  const optionalText = z.string().trim().optional()
  const port = z.coerce.number(invalidPort).int(invalidPort).min(1, invalidPort).max(65535, invalidPort)

  return z.object({
    displayName: optionalText,
    fromAddress: z
      .string()
      .trim()
      .min(1, required)
      .email(t('communication_channels.profile.connect.errors.invalidEmail', 'Enter a valid email address.')),
    imapHost: requiredText,
    imapPort: port,
    imapTls: z.enum(TLS_MODES),
    imapUser: requiredText,
    imapPassword: z.string().min(1, required),
    smtpHost: requiredText,
    smtpPort: port,
    smtpTls: z.enum(TLS_MODES),
    smtpUser: optionalText,
    smtpPassword: z.string().optional(),
  })
}

export type ImapConnectFormValues = z.infer<ReturnType<typeof createImapConnectFormSchema>>

export const IMAP_CONNECT_INITIAL_VALUES: Partial<ImapConnectFormValues> = {
  displayName: '',
  fromAddress: '',
  imapHost: '',
  imapPort: 993,
  imapTls: 'tls',
  imapUser: '',
  imapPassword: '',
  smtpHost: '',
  smtpPort: 465,
  smtpTls: 'tls',
  smtpUser: '',
  smtpPassword: '',
}

export function buildImapConnectRequestBody(values: ImapConnectFormValues) {
  return {
    providerKey: 'imap',
    displayName: values.displayName || values.fromAddress,
    pollIntervalSeconds: 300,
    credentials: {
      imapHost: values.imapHost,
      imapPort: values.imapPort,
      imapTls: values.imapTls,
      imapUser: values.imapUser,
      imapPassword: values.imapPassword,
      smtpHost: values.smtpHost,
      smtpPort: values.smtpPort,
      smtpTls: values.smtpTls,
      smtpUser: values.smtpUser || values.imapUser,
      smtpPassword: values.smtpPassword || values.imapPassword,
      fromAddress: values.fromAddress,
    },
  }
}
