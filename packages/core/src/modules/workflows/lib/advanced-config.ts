/**
 * Advanced Configuration value handling shared by the node and edge form transforms.
 *
 * The CrudForm dialogs render the Advanced Configuration field with JsonBuilder,
 * which emits the PARSED OBJECT on every valid edit. Legacy callers (and tests)
 * may still hand the transforms a JSON string. The transform boundary accepts
 * both: objects are used directly, strings are trimmed and parsed. Invalid
 * strings and non-object payloads surface the existing i18n validation key.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export type AdvancedConfigValue = Record<string, unknown> | string | undefined

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAdvancedConfigValue(value: AdvancedConfigValue): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object') {
    if (!isPlainRecord(value)) {
      logger.error('Advanced Configuration must be a JSON object', { received: Array.isArray(value) ? 'array' : typeof value })
      throw new Error('workflows.validation.invalidAdvancedConfigJson')
    }
    return Object.keys(value).length > 0 ? value : undefined
  }
  if (!value.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isPlainRecord(parsed)) {
      throw new Error('[internal] advanced configuration must parse to a JSON object')
    }
    return Object.keys(parsed).length > 0 ? parsed : undefined
  } catch (error) {
    logger.error('Invalid JSON in Advanced Configuration', { err: error })
    throw new Error('workflows.validation.invalidAdvancedConfigJson')
  }
}
