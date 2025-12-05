const ENV_KEY = 'OPENMERCATO_DEFAULT_ATTACHMENT_OCR_ENABLED'

export function resolveDefaultAttachmentOcrEnabled(): boolean {
  const raw = process.env[ENV_KEY]
  if (typeof raw !== 'string') return true
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'false') return false
  if (normalized === 'true') return true
  return true
}
