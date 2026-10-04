/**
 * Every `status-*` colour utility the module uses must map to a declared theme key.
 *
 * Tailwind v4 is CSS-first here: a utility exists only while its key is declared
 * in the app's `@theme inline` block. A misspelled key (#6344: the web-search
 * preview's `text-status-error-fg`) generates no CSS at all, so the element
 * silently keeps its inherited colour — nothing errors, nothing warns.
 */
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import fg from 'fast-glob'

const MODULE_ROOT = join(__dirname, '..')
const GLOBALS_CSS = join(__dirname, '../../../../../../apps/mercato/src/app/globals.css')

const COLOR_UTILITY_PREFIXES = ['text', 'bg', 'border', 'ring', 'fill', 'stroke', 'outline', 'divide', 'from', 'to', 'via', 'decoration', 'placeholder', 'caret', 'accent']

function declaredStatusColorKeys(): Set<string> {
  const css = readFileSync(GLOBALS_CSS, 'utf8')
  return new Set(Array.from(css.matchAll(/--color-(status-[a-z0-9-]+)\s*:/g), (match) => match[1]))
}

function usedStatusColorKeys(): Array<{ file: string; key: string }> {
  const files = fg.sync(['**/*.tsx'], { cwd: MODULE_ROOT, ignore: ['**/__tests__/**'] })
  const pattern = new RegExp(`(?<![\\w-])(?:${COLOR_UTILITY_PREFIXES.join('|')})-(status-[a-z]+-[a-z-]+?)(?:\\/\\d+)?(?![\\w-])`, 'g')
  const usages: Array<{ file: string; key: string }> = []
  for (const file of files) {
    const source = readFileSync(join(MODULE_ROOT, file), 'utf8')
    for (const match of source.matchAll(pattern)) {
      usages.push({ file: relative(MODULE_ROOT, join(MODULE_ROOT, file)), key: match[1] })
    }
  }
  return usages
}

describe('agent_orchestrator status colour tokens', () => {
  it('reads the declared status keys from the app theme', () => {
    const declared = declaredStatusColorKeys()
    expect(declared.has('status-error-text')).toBe(true)
    expect(declared.has('status-error-fg')).toBe(false)
  })

  it('uses only status colour utilities whose theme key is declared', () => {
    const declared = declaredStatusColorKeys()
    const undeclared = usedStatusColorKeys().filter(({ key }) => !declared.has(key))
    expect(undeclared).toEqual([])
  })

  it('renders the web-search preview error in the canonical error text colour', () => {
    const source = readFileSync(join(MODULE_ROOT, 'backend/settings/web-search/WebSearchPreview.tsx'), 'utf8')
    expect(source).toContain('text-status-error-text')
    expect(source).not.toContain('text-status-error-fg')
  })
})
