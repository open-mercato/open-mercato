import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const ENV_KEY = 'OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED'

export function resolveDefaultAttachmentOcrEnabled(): boolean {
  const raw = process.env[ENV_KEY]
  if (typeof raw !== 'string') return true
  const parsed = parseBooleanToken(raw)
  return parsed === null ? true : parsed
}
