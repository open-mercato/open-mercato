import {
  TASK_STATUS_SLUG_MAX_LENGTH,
  deriveTaskStatusSlug,
  slugifyTaskStatusName,
} from '../statusSlug'

const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('slugifyTaskStatusName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTaskStatusName('In progress')).toBe('in-progress')
  })

  it('transliterates Polish diacritics instead of dropping them', () => {
    expect(slugifyTaskStatusName('Do przeglądu')).toBe('do-przegladu')
    expect(slugifyTaskStatusName('Wdrożenie łatki')).toBe('wdrozenie-latki')
  })

  it('caps at the slug ceiling without a trailing hyphen', () => {
    const slug = slugifyTaskStatusName('a'.repeat(80))
    expect(slug).toHaveLength(TASK_STATUS_SLUG_MAX_LENGTH)
    expect(slug).toMatch(SLUG_SHAPE)
  })

  it('returns an empty string when nothing survives the transliteration', () => {
    expect(slugifyTaskStatusName('— · —')).toBe('')
  })
})

describe('deriveTaskStatusSlug', () => {
  it('uses the plain slug when the board has no collision', () => {
    expect(deriveTaskStatusSlug('Done', ['backlog'])).toBe('done')
  })

  it('suffixes a collision instead of failing the unique index', () => {
    expect(deriveTaskStatusSlug('Done', ['done'])).toBe('done-2')
    expect(deriveTaskStatusSlug('Done', ['done', 'done-2'])).toBe('done-3')
  })

  it('compares case-insensitively against the taken set', () => {
    expect(deriveTaskStatusSlug('Done', ['DONE'])).toBe('done-2')
  })

  it('falls back to a usable slug for a name with no slug characters', () => {
    const slug = deriveTaskStatusSlug('—', [])
    expect(slug).toBe('status')
    expect(slug).toMatch(SLUG_SHAPE)
  })

  it('keeps a suffixed slug inside the ceiling', () => {
    const slug = deriveTaskStatusSlug('a'.repeat(80), ['a'.repeat(TASK_STATUS_SLUG_MAX_LENGTH)])
    expect(slug.length).toBeLessThanOrEqual(TASK_STATUS_SLUG_MAX_LENGTH)
    expect(slug).toMatch(SLUG_SHAPE)
  })
})
