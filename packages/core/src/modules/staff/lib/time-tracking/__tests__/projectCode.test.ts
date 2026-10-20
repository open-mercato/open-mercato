import {
  PROJECT_CODE_FALLBACK,
  PROJECT_CODE_MAX_LENGTH,
  PROJECT_CODE_TARGET_LENGTH,
  deriveProjectCode,
  deriveProjectCodeBase,
} from '../projectCode'

const PROJECT_CODE_PATTERN = /^[a-zA-Z0-9-]+$/

function expectValidCode(code: string): void {
  expect(code).toMatch(PROJECT_CODE_PATTERN)
  expect(code.length).toBeGreaterThan(0)
  expect(code.length).toBeLessThanOrEqual(PROJECT_CODE_MAX_LENGTH)
}

describe('deriveProjectCodeBase', () => {
  it('reduces a multi-word name to its initials', () => {
    // `EHK` is recognisable as Ergo Hestia Korpo in a way `ERG` is not.
    expect(deriveProjectCodeBase('Ergo Hestia Korpo')).toBe('EHK')
    expect(deriveProjectCodeBase('Nordvik — portal serwisowy')).toBe('NPS')
    expect(deriveProjectCodeBase('Apollo — Website Redesign')).toBe('AWR')
  })

  it('takes the first letters of a one or two word name', () => {
    expect(deriveProjectCodeBase('Apollo')).toBe('APO')
    expect(deriveProjectCodeBase('Data Platform')).toBe('DAT')
  })

  it('leaves a name already at or under three characters alone', () => {
    expect(deriveProjectCodeBase('HBH')).toBe('HBH')
    expect(deriveProjectCodeBase('Ax')).toBe('AX')
  })

  it('transliterates before reducing', () => {
    expect(deriveProjectCodeBase('Łódź')).toBe('LOD')
    expect(deriveProjectCodeBase('Żółw wodny miejski')).toBe('ZWM')
  })

  it('falls back when the name slugifies to nothing', () => {
    expect(deriveProjectCodeBase('!!!')).toBe(PROJECT_CODE_FALLBACK)
    expect(deriveProjectCodeBase('')).toBe(PROJECT_CODE_FALLBACK)
    expect(deriveProjectCodeBase('   ')).toBe(PROJECT_CODE_FALLBACK)
  })
})

describe('deriveProjectCode', () => {
  it('returns the three-letter base when nothing has claimed it', () => {
    expect(deriveProjectCode('Apollo', new Set())).toBe('APO')
    expect(deriveProjectCode('Ergo Hestia Korpo', new Set())).toBe('EHK')
    expect(deriveProjectCode('Audit')).toBe('AUD')
  })

  it('extends rather than substitutes on a collision', () => {
    // Three letters collide constantly, so the rule has to be predictable.
    // `APO2` is still readable; `APQ` would look like a different project.
    expect(deriveProjectCode('Apollo', new Set(['APO']))).toBe('APO2')
    expect(deriveProjectCode('Apollo', new Set(['APO', 'APO2']))).toBe('APO3')
  })

  it('dedupes case-insensitively', () => {
    expect(deriveProjectCode('Audit', new Set(['aud']))).toBe('AUD2')
  })

  it('keeps every derived code inside the cap under sustained collision', () => {
    const taken = new Set<string>()
    for (let index = 0; index < 30; index += 1) {
      const code = deriveProjectCode('Migracja danych klienta', taken)
      expectValidCode(code)
      expect(taken.has(code)).toBe(false)
      taken.add(code)
    }
    expect(taken.size).toBe(30)
  })

  it('stays at the target length until it has to grow', () => {
    expect(deriveProjectCode('Apollo', new Set())).toHaveLength(PROJECT_CODE_TARGET_LENGTH)
  })

  it('falls back to the long form rather than failing when short codes run out', () => {
    // A save that refuses to happen is worse than a long code.
    const taken = new Set<string>(['APO'])
    for (let counter = 2; counter < 10000; counter += 1) taken.add(`APO${counter}`)
    const code = deriveProjectCode('Apollo Programme', taken)
    expectValidCode(code)
    expect(taken.has(code)).toBe(false)
  })

  it('always produces a code the schema accepts', () => {
    const names = [
      'Łódź',
      'Nordvik — portal serwisowy',
      '!!!',
      'Supercalifragilisticexpialidocious',
      'Ærøskøbing straße',
      '2026',
      'a',
    ]
    for (const name of names) expectValidCode(deriveProjectCode(name, new Set()))
  })
})
