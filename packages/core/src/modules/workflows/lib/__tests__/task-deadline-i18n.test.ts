import { describe, test, expect } from '@jest/globals'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { TASK_DEADLINE_MESSAGES } from '../../data/task-primitives'
import { userTaskConfigSchema, userTaskConfigSpecSchema, workflowStepSchema } from '../../data/validators'
import { normalizeDefinitionValidationIssues, readIssueMessageKey } from '../definition-error-body'
import { collectValidationIssues } from '../collect-validation-issues'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'

/**
 * Issue #7181 review — the deadline diagnostics are user-facing (definition API
 * `details[]`, Studio Problems panel, Code view), so they carry an i18n key and
 * every boundary localizes them.
 */

function userTaskStep(deadline: Record<string, unknown>) {
  return {
    stepId: 'review',
    stepName: 'Review',
    stepType: 'USER_TASK',
    userTaskConfig: { assignedTo: 'admin', deadline },
  }
}

function parseIssues(deadline: Record<string, unknown>) {
  const parsed = workflowStepSchema.safeParse(userTaskStep(deadline))
  if (parsed.success) throw new Error('[internal] expected the deadline to be rejected')
  return parsed.error
}

const polish = createFallbackTranslator(pl as Record<string, string>)

describe('deadline diagnostics are localized', () => {
  const cases = [
    ['bothForms', { duration: 'P1D', at: '2026-10-20' }],
    ['missingForm', {}],
    ['invalidAt', { at: 'next friday' }],
  ] as const

  test.each(cases)('%s carries its i18n key and the English fallback', (name, deadline) => {
    const [issue] = parseIssues(deadline).issues
    expect(readIssueMessageKey(issue)).toBe(TASK_DEADLINE_MESSAGES[name].key)
    expect(issue.message).toBe(TASK_DEADLINE_MESSAGES[name].fallback)
  })

  test.each(cases)('%s reaches the definition API body in Polish', (name, deadline) => {
    const [detail] = normalizeDefinitionValidationIssues(parseIssues(deadline), polish)
    expect(detail.message).toBe((pl as Record<string, string>)[TASK_DEADLINE_MESSAGES[name].key])
    expect(detail.message).not.toBe(TASK_DEADLINE_MESSAGES[name].fallback)
  })

  test('without a translator the API body keeps the English message', () => {
    const [detail] = normalizeDefinitionValidationIssues(parseIssues({ at: 'next friday' }))
    expect(detail.message).toBe(TASK_DEADLINE_MESSAGES.invalidAt.fallback)
  })

  test('the Studio Problems panel renders the Polish message', () => {
    const error = parseIssues({ duration: 'P1D', at: '2026-10-20' })
    const [problem] = collectValidationIssues({
      graphErrors: [],
      zodIssues: error.issues,
      nodes: [],
      edges: [],
      translate: (key, fallback, params) => polish(key, fallback, params),
    })
    expect(problem.message).toBe(
      `userTaskConfig.deadline.at - ${(pl as Record<string, string>)[TASK_DEADLINE_MESSAGES.bothForms.key]}`,
    )
  })

  test('every locale declares every deadline message, and English matches the fallback', () => {
    for (const dict of [en, pl, de, es, ko] as Array<Record<string, string>>) {
      for (const message of Object.values(TASK_DEADLINE_MESSAGES)) {
        expect(typeof dict[message.key]).toBe('string')
      }
    }
    for (const message of Object.values(TASK_DEADLINE_MESSAGES)) {
      expect((en as Record<string, string>)[message.key]).toBe(message.fallback)
    }
  })
})

describe('legacy userTaskConfigSchema keeps its duration-only deadline', () => {
  test('the extended schema accepts an absolute deadline the legacy one never did', () => {
    const config = { assignedTo: 'admin', deadline: { at: '2026-10-20' } }
    expect(userTaskConfigSpecSchema.safeParse(config).success).toBe(true)
    expect(userTaskConfigSchema.safeParse(config).success).toBe(false)
    expect(workflowStepSchema.safeParse(userTaskStep({ at: '2026-10-20' })).success).toBe(true)
  })

  test('every legacy config parses identically through both schemas', () => {
    const config = { assignedTo: 'admin', deadline: { duration: 'P3D' }, slaDuration: 'P1D' }
    expect(userTaskConfigSpecSchema.parse(config)).toEqual(userTaskConfigSchema.parse(config))
  })
})
