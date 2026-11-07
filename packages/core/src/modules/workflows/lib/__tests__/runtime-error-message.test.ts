import { describe, test, expect } from '@jest/globals'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { TASK_DEADLINE_MESSAGES } from '../../data/task-primitives'
import {
  buildRuntimeErrorMessageDetail,
  formatRuntimeErrorFallback,
  localizeRuntimeErrorMessage,
  localizeStepErrorData,
  readRuntimeErrorMessageRef,
} from '../runtime-error-message'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'

/**
 * Issue #7181 review — a deadline that passes save-time validation can still
 * fail at runtime, and that failure reaches the run detail in the reader's
 * locale while the persisted text stays English.
 */

const { key, fallback } = TASK_DEADLINE_MESSAGES.invalidResolvedAt
const params = { authored: '{{context.dueDate}}', resolved: 'soon' }
const details = { stepId: 'review', ...buildRuntimeErrorMessageDetail(key, params) }
const english = formatRuntimeErrorFallback(fallback, params)
const polish = createFallbackTranslator(pl as Record<string, string>)
const noDictionary = createFallbackTranslator({})

describe('localizeRuntimeErrorMessage', () => {
  test('the persisted English message names both values', () => {
    expect(english).toBe(
      'Invalid user task deadline "at": "{{context.dueDate}}" resolved to "soon", which is not an ISO date (YYYY-MM-DD) or an ISO datetime with a timezone offset or Z',
    )
    expect((en as Record<string, string>)[key]).toBe(fallback)
  })

  test('renders the invalid resolved deadline in Polish, keeping both values', () => {
    const message = localizeRuntimeErrorMessage(english, details, polish)
    expect(message).toBe(
      'Nieprawidłowy termin zadania "at": "{{context.dueDate}}" dało wartość "soon", która nie jest datą ISO (RRRR-MM-DD) ani datą i godziną ISO ze strefą czasową lub Z',
    )
  })

  test('a value that looks like a placeholder is not substituted again', () => {
    const tricky = buildRuntimeErrorMessageDetail(key, { authored: '{resolved}', resolved: 'soon' })
    expect(localizeRuntimeErrorMessage('English', tricky, polish)).toContain('"{resolved}" dało wartość "soon"')
  })

  test('without the key in the dictionary the persisted English shows', () => {
    expect(localizeRuntimeErrorMessage(english, details, noDictionary)).toBe(english)
  })

  test('an error that names no key is left exactly as persisted', () => {
    expect(localizeRuntimeErrorMessage('Gateway timeout', null, polish)).toBe('Gateway timeout')
    expect(localizeRuntimeErrorMessage('Gateway timeout', { stepId: 'review' }, polish)).toBe('Gateway timeout')
    expect(localizeRuntimeErrorMessage('Gateway timeout', { i18n: { key: 7 } }, polish)).toBe('Gateway timeout')
  })
})

describe('readRuntimeErrorMessageRef', () => {
  test('survives a JSON round trip through the errorDetails column', () => {
    expect(readRuntimeErrorMessageRef(JSON.parse(JSON.stringify(details)))).toEqual({ key, params })
  })

  test('drops anything that is not a string argument', () => {
    expect(readRuntimeErrorMessageRef({ i18n: { key, params: { resolved: 'soon', depth: 3 } } })).toEqual({
      key,
      params: { resolved: 'soon' },
    })
  })
})

describe('localizeStepErrorData', () => {
  test('localizes the step inspector payload and keeps the details', () => {
    const data = { error: english, details }
    expect(localizeStepErrorData(data, polish)).toEqual({
      error: localizeRuntimeErrorMessage(english, details, polish),
      details,
    })
  })

  test('leaves any other payload untouched', () => {
    expect(localizeStepErrorData({ attempts: 2 }, polish)).toEqual({ attempts: 2 })
    expect(localizeStepErrorData(null, polish)).toBeNull()
  })
})
