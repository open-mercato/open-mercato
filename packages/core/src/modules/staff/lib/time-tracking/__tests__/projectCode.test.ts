import { PROJECT_CODE_FALLBACK, PROJECT_CODE_MAX_LENGTH, deriveProjectCode } from '../projectCode'

const PROJECT_CODE_PATTERN = /^[a-zA-Z0-9-]+$/

function expectValidCode(code: string): void {
  expect(code).toMatch(PROJECT_CODE_PATTERN)
  expect(code.length).toBeGreaterThan(0)
  expect(code.length).toBeLessThanOrEqual(PROJECT_CODE_MAX_LENGTH)
  expect(code.length).toBeLessThanOrEqual(50)
}

describe('deriveProjectCode', () => {
  it('transliterates Polish diacritics', () => {
    expect(deriveProjectCode('Łódź', new Set())).toBe('LODZ')
    expect(deriveProjectCode('Żółw', new Set())).toBe('ZOLW')
    expect(deriveProjectCode('ąćęłńóśźż', new Set())).toBe('ACELNOSZZ')
  })

  it('uppercases and collapses non-alphanumerics into single dashes', () => {
    expect(deriveProjectCode('acme // web', new Set())).toBe('ACME-WEB')
    expect(deriveProjectCode('  --acme--  ', new Set())).toBe('ACME')
    expect(deriveProjectCode('B2B 2026', new Set())).toBe('B2B-2026')
  })

  it('truncates at a word boundary within the 20-character cap', () => {
    expect(deriveProjectCode('Nordvik — portal serwisowy', new Set())).toBe('NORDVIK-PORTAL')
    expect(deriveProjectCode('Nordvik — migracja B2B', new Set())).toBe('NORDVIK-MIGRACJA')
  })

  it('hard-truncates a single word longer than the cap', () => {
    const code = deriveProjectCode('Supercalifragilisticexpialidocious', new Set())
    expectValidCode(code)
    expect(code.startsWith('SUPERCALIFRAGILIST')).toBe(true)
  })

  it('leaves a short name untouched', () => {
    expect(deriveProjectCode('Audit', new Set())).toBe('AUDIT')
  })

  it('dedupes with a numeric suffix', () => {
    expect(deriveProjectCode('Nordvik portal', new Set(['NORDVIK-PORTAL']))).toBe('NORDVIK-PORTAL-2')
    expect(deriveProjectCode('Nordvik portal', new Set(['NORDVIK-PORTAL', 'NORDVIK-PORTAL-2']))).toBe(
      'NORDVIK-PORTAL-3',
    )
  })

  it('keeps the dedupe suffix inside the 20-character cap', () => {
    const taken = new Set<string>()
    for (let index = 0; index < 12; index += 1) {
      const code = deriveProjectCode('Migracja danych klienta', taken)
      expectValidCode(code)
      expect(taken.has(code)).toBe(false)
      taken.add(code)
    }
    expect(taken.size).toBe(12)
  })

  it('dedupes case-insensitively against taken codes', () => {
    expect(deriveProjectCode('Audit', new Set(['audit']))).toBe('AUDIT-2')
  })

  it('falls back to a stable valid code when the name slugifies to empty', () => {
    expect(deriveProjectCode('!!!', new Set())).toBe(PROJECT_CODE_FALLBACK)
    expect(deriveProjectCode('', new Set())).toBe(PROJECT_CODE_FALLBACK)
    expect(deriveProjectCode('   ', new Set())).toBe(PROJECT_CODE_FALLBACK)
    expect(deriveProjectCode('!!!', new Set([PROJECT_CODE_FALLBACK]))).toBe(`${PROJECT_CODE_FALLBACK}-2`)
  })

  it('defaults the taken set so a caller may omit it', () => {
    expect(deriveProjectCode('Audit')).toBe('AUDIT')
  })

  it('always produces a code accepted by projectCodeSchema', () => {
    const names = [
      'Łódź',
      'Nordvik — portal serwisowy',
      '!!!',
      'Supercalifragilisticexpialidocious',
      'Ærøskøbing straße',
      '2026',
      'a',
    ]
    for (const name of names) {
      expectValidCode(deriveProjectCode(name, new Set()))
      expectValidCode(deriveProjectCode(name, new Set([deriveProjectCode(name, new Set())])))
    }
  })
})
