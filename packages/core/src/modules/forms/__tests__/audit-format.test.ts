import {
  formatAuditRow,
  formatAuditRows,
  isAccessAuditPurpose,
  type AccessAuditApiRow,
} from '../widgets/injection/audit-format'

function makeRow(overrides: Partial<AccessAuditApiRow> = {}): AccessAuditApiRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    accessedBy: 'abcdef0123456789',
    accessedAt: '2026-05-20T10:00:00.000Z',
    accessPurpose: 'view',
    ip: '203.0.113.7',
    revisionId: null,
    ...overrides,
  }
}

describe('audit-format', () => {
  it('shortens the actor id to 8 chars with an ellipsis', () => {
    expect(formatAuditRow(makeRow()).actorShort).toBe('abcdef01…')
  })

  it('keeps a short actor id verbatim and falls back to "system" when empty', () => {
    expect(formatAuditRow(makeRow({ accessedBy: 'short' })).actorShort).toBe('short')
    expect(formatAuditRow(makeRow({ accessedBy: '' })).actorShort).toBe('system')
  })

  it('builds the i18n purpose key and preserves the purpose', () => {
    const row = formatAuditRow(makeRow({ accessPurpose: 'anonymize' }))
    expect(row.purpose).toBe('anonymize')
    expect(row.purposeKey).toBe('forms.compliance.audit.purpose.anonymize')
  })

  it('coerces an unknown purpose to "view"', () => {
    const row = formatAuditRow(makeRow({ accessPurpose: 'bogus' as AccessAuditApiRow['accessPurpose'] }))
    expect(row.purpose).toBe('view')
  })

  it('parses the timestamp to ms and yields null for an invalid date', () => {
    expect(formatAuditRow(makeRow()).timestampMs).toBe(Date.parse('2026-05-20T10:00:00.000Z'))
    expect(formatAuditRow(makeRow({ accessedAt: 'not-a-date' })).timestampMs).toBeNull()
  })

  it('normalizes empty/whitespace IP to null', () => {
    expect(formatAuditRow(makeRow({ ip: null })).ip).toBeNull()
    expect(formatAuditRow(makeRow({ ip: '' })).ip).toBeNull()
    expect(formatAuditRow(makeRow({ ip: '203.0.113.7' })).ip).toBe('203.0.113.7')
  })

  it('maps an array of rows and tolerates a non-array input', () => {
    expect(formatAuditRows([makeRow(), makeRow({ id: '22222222-2222-2222-2222-222222222222' })])).toHaveLength(2)
    expect(formatAuditRows(undefined as unknown as AccessAuditApiRow[])).toEqual([])
  })

  it('recognizes valid access-audit purposes', () => {
    expect(isAccessAuditPurpose('export')).toBe(true)
    expect(isAccessAuditPurpose('reopen')).toBe(true)
    expect(isAccessAuditPurpose('nope')).toBe(false)
    expect(isAccessAuditPurpose(42)).toBe(false)
  })
})
