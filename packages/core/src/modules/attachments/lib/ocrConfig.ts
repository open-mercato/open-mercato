import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const ENV_KEYS = [
  'OM_DEFAULT_ATTACHMENT_OCR_ENABLED',
  'OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED',
] as const

export function resolveDefaultAttachmentOcrEnabled(): boolean {
  const raw = ENV_KEYS.map((key) => process.env[key]).find((value) => typeof value === 'string')
  if (typeof raw !== 'string') return true
  const parsed = parseBooleanToken(raw)
  return parsed === null ? true : parsed
}
