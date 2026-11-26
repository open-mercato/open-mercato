import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely'
import { MAX_CONTAINMENT_WORDS } from '../containment'
import { buildTokenContainmentPatterns, buildTokenContainmentPredicate } from '../tokenContainment'
import { NON_DECOMPOSING_FOLDS, tokenizeText } from '../tokenize'
import type { SearchConfig } from '../config'

const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: {
  createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler(),
} })

const config: SearchConfig = {
  enabled: true, minTokenLength: 3, enablePartials: true, hashAlgorithm: 'sha256',
  storeRawTokens: false, blocklistedFields: [],
}

describe('buildTokenContainmentPatterns (#5803)', () => {
  test('keeps the fragments tokenization drops, so neighbouring periods no longer collide', () => {
    expect(tokenizeText('2026-08', config).tokens).toEqual(tokenizeText('2026-01', config).tokens)
    expect(buildTokenContainmentPatterns('%2026-08%')).toEqual(['%2026%08%'])
    expect(buildTokenContainmentPatterns('%2026-01%')).toEqual(['%2026%01%'])
  })

  test('a term too short to tokenize still yields a pattern', () => {
    expect(tokenizeText('08', config).hashes).toEqual([])
    expect(buildTokenContainmentPatterns('%08%')).toEqual(['%08%'])
  })

  test('words stay independent, preserving word-order independence (TC-RESO-009)', () => {
    expect(buildTokenContainmentPatterns('%Warehouse 1757%')).toEqual(['%warehouse%', '%1757%'])
  })

  test('folds case and diacritics exactly like the tokenizer', () => {
    expect(buildTokenContainmentPatterns('%Łukasz Müller%')).toEqual(['%lukasz%', '%muller%'])
    expect(buildTokenContainmentPatterns('%Straße%')).toEqual(['%strasse%'])
  })

  test('drops LIKE escapes and wildcards instead of comparing them', () => {
    expect(buildTokenContainmentPatterns('%50\\% off\\_sale%')).toEqual(['%50%', '%off%', '%sale%'])
  })

  test('returns no patterns for a term with no alphanumerics', () => {
    expect(buildTokenContainmentPatterns('%--%')).toEqual([])
  })

  test('bounds the SQL an attacker-controlled term can compile into', () => {
    const tooManyWords = Array.from({ length: MAX_CONTAINMENT_WORDS + 1 }, (_, i) => `w${i}`).join(' ')
    expect(buildTokenContainmentPatterns(`%${tooManyWords}%`)).toEqual([])
    const tooManyRuns = Array.from({ length: MAX_CONTAINMENT_WORDS + 1 }, (_, i) => `r${i}`).join('-')
    expect(buildTokenContainmentPatterns(`%${tooManyRuns}%`)).toEqual([])
  })
})

describe('buildTokenContainmentPredicate (#5803)', () => {
  const compile = (patterns: string[]) =>
    database.selectFrom('t').select('t.id').where(buildTokenContainmentPredicate('t.name', patterns)).compile()

  test('compares the folded column case-insensitively against one pattern', () => {
    const query = compile(['%2026%08%'])
    expect(query.sql).toContain('regexp_replace(normalize(("t"."name")::text, NFKD)')
    expect(query.sql).toMatch(/\) ilike \$\d+$/)
    expect(query.parameters).toContain('%2026%08%')
  })

  test('ANDs several words through ilike all, folding the column once', () => {
    const query = compile(['%warehouse%', '%1757%'])
    expect(query.sql.match(/normalize\(/g)).toHaveLength(1)
    expect(query.sql).toMatch(/ ilike all \(array\[\$\d+, \$\d+\]::text\[\]\)$/)
  })

  test('mirrors every non-decomposing fold of the tokenizer', () => {
    const query = compile(['%x%'])
    for (const [char, fold] of Object.entries(NON_DECOMPOSING_FOLDS)) {
      if (fold.length > 1) {
        expect(query.parameters).toEqual(expect.arrayContaining([char, fold]))
      } else {
        const from = query.parameters.find((param) => typeof param === 'string' && param.includes('ł')) as string
        const to = query.parameters[query.parameters.indexOf(from) + 1] as string
        expect(to[from.indexOf(char)]).toBe(fold)
      }
    }
  })

  test('an empty pattern list is a no-op predicate', () => {
    expect(compile([]).sql).toMatch(/where true$/)
  })
})
