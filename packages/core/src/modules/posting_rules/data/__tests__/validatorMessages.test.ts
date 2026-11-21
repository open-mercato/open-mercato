import { readFileSync } from 'fs'
import { join } from 'path'
import {
  costCenterCreateSchema,
  costCenterUpdateSchema,
  defaultAccountPostingRuleCreateSchema,
  updatePostingRulesSettingsSchema,
} from '../validators'

const ORG = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'

function issuesOf(result: { success: boolean; error?: { issues: Array<{ message: string; params?: Record<string, unknown> }> } }) {
  return result.success ? [] : result.error?.issues ?? []
}

describe('posting_rules validator messages', () => {
  it.each([
    ['empty code', { code: '' }, 'posting_rules.errors.costCenterCodeRequired'],
    ['too long code', { code: 'x'.repeat(101) }, 'posting_rules.errors.costCenterCodeTooLong'],
    ['empty name', { name: '' }, 'posting_rules.errors.costCenterNameRequired'],
    ['too long name', { name: 'x'.repeat(201) }, 'posting_rules.errors.costCenterNameTooLong'],
  ])('a user-facing rule (%s) carries an i18nKey for translateZodIssues', (_label, override, key) => {
    const issues = issuesOf(costCenterCreateSchema.safeParse({ organizationId: ORG, tenantId: TENANT, code: 'MPK', name: 'Marketing', ...override }))
    expect(issues).toHaveLength(1)
    expect(issues[0].params).toMatchObject({ i18nKey: key, i18nFallback: expect.any(String) })
  })

  it('keeps the same rules on update', () => {
    const issues = issuesOf(costCenterUpdateSchema.safeParse({ id: ORG, code: '' }))
    expect(issues[0].params).toMatchObject({ i18nKey: 'posting_rules.errors.costCenterCodeRequired' })
  })

  it('still accepts code and name at their limits', () => {
    expect(costCenterCreateSchema.safeParse({ organizationId: ORG, tenantId: TENANT, code: 'x'.repeat(100), name: 'y'.repeat(200) }).success).toBe(true)
  })

  it.each([
    ['cost centre organizationId', () => costCenterCreateSchema.safeParse({ organizationId: 'x', tenantId: TENANT, code: 'MPK', name: 'Marketing' })],
    ['rule sourceAccountId', () => defaultAccountPostingRuleCreateSchema.safeParse({ organizationId: ORG, tenantId: TENANT, sourceAccountId: 'x', targetAccountId: ORG })],
    ['settings clearingAccountId', () => updatePostingRulesSettingsSchema.safeParse({ organizationId: ORG, tenantId: TENANT, clearingAccountId: 'x' })],
  ])('an id shape error (%s) is [internal]', (_label, parse) => {
    const issues = issuesOf(parse())
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) expect(issue.message.startsWith('[internal] ')).toBe(true)
  })

  it.each(['en', 'pl', 'de', 'es', 'ko'])('%s carries every validator i18nKey', (locale) => {
    const messages = JSON.parse(readFileSync(join(__dirname, '..', '..', 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>
    for (const key of [
      'posting_rules.errors.costCenterCodeRequired',
      'posting_rules.errors.costCenterCodeTooLong',
      'posting_rules.errors.costCenterNameRequired',
      'posting_rules.errors.costCenterNameTooLong',
    ]) {
      expect(messages[key]).toEqual(expect.any(String))
    }
  })
})
