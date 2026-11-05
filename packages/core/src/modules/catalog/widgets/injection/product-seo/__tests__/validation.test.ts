import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { buildSeoBlockMessage, evaluateProductSeo } from '../validation'

const LEGACY_GENERIC_MESSAGE = 'SEO helper blocked save. Improve the highlighted fields.'
const VALID_DESCRIPTION = 'A sufficiently long product description for good SEO ranking.'
const VALID_TITLE = 'A perfectly good product title'

// Dict-backed stub proving the strings are routed through `t(key, fallback, params)`
// (#3299): known keys are "translated", unknown keys fall back, and `{{param}}`
// placeholders interpolate.
const K = 'catalog.products.create.seoWidget.validation'
const DICT: Record<string, string> = {
  [`${K}.issue.titleTooShort`]: 'PL:tytuł-za-krótki',
  [`${K}.issue.descriptionMissing`]: 'PL:dodaj-opis',
  [`${K}.fieldError.titleTooShort`]: 'PL:pole-tytuł-za-krótkie',
  [`${K}.block.list`]: 'PL: {{issues}}',
  [`${K}.block.summary`]: 'PL: {{count}} — {{issues}}',
}
const fakeT: TranslateFn = (key, fallbackOrParams, params) => {
  const resolvedParams = typeof fallbackOrParams === 'string' ? params : fallbackOrParams
  const template = DICT[key] ?? (typeof fallbackOrParams === 'string' ? fallbackOrParams : key)
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(resolvedParams?.[name] ?? ''))
}

describe('buildSeoBlockMessage', () => {
  test('single issue shows the exact issue with the SEO helper prefix (English fallback)', () => {
    expect(buildSeoBlockMessage(['Title is too short (min 10 characters).'])).toBe(
      'SEO helper: Title is too short (min 10 characters).',
    )
  })

  test('two issues are listed space-separated (English fallback)', () => {
    expect(buildSeoBlockMessage(['First issue.', 'Second issue.'])).toBe(
      'SEO helper: First issue. Second issue.',
    )
  })

  test('three issues are all listed (English fallback)', () => {
    expect(buildSeoBlockMessage(['First issue.', 'Second issue.', 'Third issue.'])).toBe(
      'SEO helper: First issue. Second issue. Third issue.',
    )
  })

  test('more than three issues summarize the count and show the first two (English fallback)', () => {
    expect(
      buildSeoBlockMessage(['First issue.', 'Second issue.', 'Third issue.', 'Fourth issue.']),
    ).toBe('SEO helper: 4 issues found. First issue. Second issue.')
  })

  test('routes the list format through i18n with interpolated issues', () => {
    expect(buildSeoBlockMessage(['A', 'B'], fakeT)).toBe('PL: A B')
  })

  test('routes the summary format through i18n with count and first two issues', () => {
    expect(buildSeoBlockMessage(['A', 'B', 'C', 'D'], fakeT)).toBe('PL: 4 — A B')
  })
})

describe('evaluateProductSeo', () => {
  test('blocks a short title with a specific, non-generic message mapped to the title field', () => {
    const result = evaluateProductSeo({ title: 'Short', description: VALID_DESCRIPTION })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.title).toBeDefined()
    expect(result.message).toContain('Title')
    expect(result.message).not.toBe(LEGACY_GENERIC_MESSAGE)
  })

  test('blocks a missing description and maps the error to the description field', () => {
    const result = evaluateProductSeo({ title: VALID_TITLE, description: '' })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.description).toBeDefined()
    expect(result.message).toContain('SEO helper:')
  })

  test('accepts a valid title and description', () => {
    const result = evaluateProductSeo({ title: VALID_TITLE, description: VALID_DESCRIPTION })
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  test('falls back to the name field when title is absent', () => {
    const result = evaluateProductSeo({ name: 'Short', description: VALID_DESCRIPTION })
    expect(result.ok).toBe(false)
    expect(result.fieldErrors.title).toBeDefined()
  })

  test('routes issues, field errors, and the block message through the provided translator', () => {
    const result = evaluateProductSeo({ title: 'Short', description: VALID_DESCRIPTION }, fakeT)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(['PL:tytuł-za-krótki'])
    expect(result.fieldErrors.title).toBe('PL:pole-tytuł-za-krótkie')
    expect(result.message).toBe('PL: PL:tytuł-za-krótki')
  })

  test('translates a missing-description issue via the translator', () => {
    const result = evaluateProductSeo({ title: VALID_TITLE, description: '' }, fakeT)
    expect(result.ok).toBe(false)
    expect(result.issues).toContain('PL:dodaj-opis')
  })
})
