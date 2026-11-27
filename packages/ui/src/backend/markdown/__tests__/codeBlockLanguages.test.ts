import { resolveMarkdownCodeBlockLanguages, type MarkdownCodeBlockLanguages } from '../codeBlockLanguages'

const translate = (key: string, fallback: string) => key === 'custom.languages.script' ? 'Skrypt' : fallback

const defaults = {
  '': 'Plain text', js: 'JavaScript', jsx: 'JavaScript (React)', ts: 'TypeScript',
  tsx: 'TypeScript (React)', json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL',
  python: 'Python', bash: 'Bash', sh: 'Shell', yaml: 'YAML', markdown: 'Markdown',
}

describe('Markdown code-block languages', () => {
  it('preserves every default option and its order', () => {
    expect(Object.entries(resolveMarkdownCodeBlockLanguages(translate))).toEqual(Object.entries(defaults))
  })

  it('adds, renames and hides options without mutating configuration or defaults', () => {
    const patch = Object.freeze({ rust: 'Rust', php: 'PHP', js: 'ECMAScript', sql: null })
    const resolved = resolveMarkdownCodeBlockLanguages(translate, patch)
    expect(resolved).toEqual({ ...defaults, rust: 'Rust', php: 'PHP', js: 'ECMAScript', sql: undefined })
    expect(Object.hasOwn(resolved, 'sql')).toBe(false)
    expect(Object.keys(resolved).slice(-2)).toEqual(['rust', 'php'])
    expect(resolveMarkdownCodeBlockLanguages(translate)).toEqual(defaults)
    expect(patch.sql).toBeNull()
  })

  it('translates configured labels with a fallback', () => {
    expect(resolveMarkdownCodeBlockLanguages(translate, {
      js: { label: 'Script', labelKey: 'custom.languages.script' },
      rust: { label: 'Rust', labelKey: 'custom.languages.rust' },
      php: { label: 'PHP' },
    })).toMatchObject({ js: 'Skrypt', rust: 'Rust', php: 'PHP' })
  })

  it('keeps the plain-text fallback when hidden and permits renaming it', () => {
    expect(resolveMarkdownCodeBlockLanguages(translate, { '': null })['']).toBe('Plain text')
    expect(resolveMarkdownCodeBlockLanguages(translate, { '': { label: 'Text' } })['']).toBe('Text')
    expect(resolveMarkdownCodeBlockLanguages((key, fallback) => key === 'ui.forms.richtext.plainText' ? 'Tekst' : fallback)['']).toBe('Tekst')
  })

  it('ignores inherited entries and returns independent snapshots', () => {
    const patch: MarkdownCodeBlockLanguages = Object.assign(Object.create({ sql: null }), { rust: 'Rust' })
    const first = resolveMarkdownCodeBlockLanguages(translate, patch)
    first.js = 'Changed'
    expect(resolveMarkdownCodeBlockLanguages(translate, patch)).toMatchObject({ js: 'JavaScript', sql: 'SQL', rust: 'Rust' })
  })
})
