import { buildSeoBlockMessage, evaluateProductSeo } from '../validation'

const LEGACY_GENERIC_MESSAGE = 'SEO helper blocked save. Improve the highlighted fields.'
const VALID_DESCRIPTION = 'A sufficiently long product description for good SEO ranking.'
const VALID_TITLE = 'A perfectly good product title'

describe('buildSeoBlockMessage', () => {
  test('single issue shows the exact issue with the SEO helper prefix', () => {
    expect(buildSeoBlockMessage(['Title is too short (min 10 characters).'])).toBe(
      'SEO helper: Title is too short (min 10 characters).',
    )
  })

  test('two issues are listed space-separated', () => {
    expect(buildSeoBlockMessage(['First issue.', 'Second issue.'])).toBe(
      'SEO helper: First issue. Second issue.',
    )
  })

  test('three issues are all listed', () => {
    expect(buildSeoBlockMessage(['First issue.', 'Second issue.', 'Third issue.'])).toBe(
      'SEO helper: First issue. Second issue. Third issue.',
    )
  })

  test('more than three issues summarize the count and show the first two', () => {
    expect(
      buildSeoBlockMessage(['First issue.', 'Second issue.', 'Third issue.', 'Fourth issue.']),
    ).toBe('SEO helper: 4 issues found. First issue. Second issue.')
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
})
