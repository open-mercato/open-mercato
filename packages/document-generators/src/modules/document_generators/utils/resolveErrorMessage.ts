import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

const errorCodes = new Set(['invalid_json', 'invalid_request', 'invalid_query', 'unknown_template', 'forbidden', 'organization_required', 'render_failed'])

export function resolveErrorMessage(payload: unknown, translate: TranslateFn): string {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' && errorCodes.has(payload.error)) {
    return translate(`document_generators.errors.${payload.error}`)
  }
  return translate('document_generators.errors.render_failed')
}
