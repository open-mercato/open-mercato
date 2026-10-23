import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { postJournalEntrySchema } from '../validators'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const line = (side: 'debit' | 'credit', amount: string) => ({ accountId: uuid(3), [side]: amount })

const baseEntry = {
  organizationId: uuid(1),
  tenantId: uuid(2),
  operationDate: '2026-01-15',
  description: 'Test entry',
  currencyId: uuid(4),
}

function issueKeys(input: unknown): string[] {
  const result = postJournalEntrySchema.safeParse(input)
  if (result.success) return []
  return result.error.issues
    .map((issue) => (issue as { params?: { i18nKey?: string } }).params?.i18nKey)
    .filter((key): key is string => typeof key === 'string')
}

describe('postJournalEntrySchema messages', () => {
  it('accepts an entry with two balanced lines', () => {
    const result = postJournalEntrySchema.safeParse({
      ...baseEntry,
      lines: [line('debit', '10.00'), line('credit', '10.00')],
    })
    expect(result.success).toBe(true)
  })

  it('rejects an entry with fewer than two lines and carries an i18n key', () => {
    expect(issueKeys({ ...baseEntry, lines: [line('debit', '10.00')] })).toContain(
      'ledger.errors.journalEntryTooFewLines',
    )
  })

  it('still reports an unbalanced entry with its own i18n key', () => {
    expect(issueKeys({ ...baseEntry, lines: [line('debit', '10.00'), line('credit', '9.99')] })).toContain(
      'ledger.errors.journalEntryNotBalanced',
    )
  })
})

describe('validator i18n keys', () => {
  const moduleRoot = join(__dirname, '..', '..')
  const source = readFileSync(join(moduleRoot, 'data', 'validators.ts'), 'utf8')
  const keys = Array.from(source.matchAll(/i18nKey:\s*'([^']+)'/g)).map((match) => match[1])

  it('uses at least one i18n key', () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  it.each(['en', 'pl'])('has every key in %s.json', (locale) => {
    const messages = JSON.parse(readFileSync(join(moduleRoot, 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>
    const missing = keys.filter((key) => typeof messages[key] !== 'string' || messages[key].length === 0)
    expect(missing).toEqual([])
  })
})
