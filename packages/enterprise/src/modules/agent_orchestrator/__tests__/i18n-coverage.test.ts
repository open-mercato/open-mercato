/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'

/**
 * Locale invariants for the whole module (issue #5979).
 *
 * QA found the agent detail tabs, the Overview attention panel, the
 * Configuration token card and the Playground provider error rendering in
 * English on a Polish backoffice. Every one of those already went through
 * `t(...)` — the keys existed, and every non-English locale file simply
 * carried the ENGLISH value. Key-parity checks (`yarn i18n:check-sync`) pass on
 * that state, which is why it survived: the defect is in the values.
 *
 * So this file guards three things at once:
 *  1. every `agent_orchestrator.*` key a source file names resolves in ALL five
 *     locales — a key referenced but never added is the other half of the bug;
 *  2. the locale files stay a single, identically-ordered key set;
 *  3. the count of values still byte-identical to English cannot grow.
 *
 * (3) is the honest form of "everything is translated". A handful of values are
 * legitimately identical — product names (OpenCode), acronyms, format-only
 * strings like `#{rank}` — so the invariant is a ceiling, not zero. Lowering a
 * ceiling after a translation pass is expected; raising one means untranslated
 * copy shipped, and the reviewer has to say why.
 */
describe('agent_orchestrator locale coverage', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const locales = ['en', 'pl', 'de', 'es', 'ko'] as const
  type Locale = (typeof locales)[number]

  const dictionaries = Object.fromEntries(
    locales.map((locale) => [
      locale,
      JSON.parse(fs.readFileSync(path.join(moduleRoot, `i18n/${locale}.json`), 'utf8')) as Record<
        string,
        string
      >,
    ]),
  ) as Record<Locale, Record<string, string>>

  const sourceFiles = fg.sync(['**/*.{ts,tsx}'], {
    cwd: moduleRoot,
    absolute: true,
    ignore: ['**/__tests__/**', '**/__integration__/**', '**/generated/**'],
  })

  /**
   * Keys named as whole string literals. Template literals
   * (`` `agent_orchestrator.caseload.status.${status}` ``) are deliberately not
   * resolved — a static scan cannot know their arms, and guessing would either
   * miss real gaps or invent keys that do not exist.
   */
  const referencedKeys = new Set<string>()
  const KEY_LITERAL = /['"](agent_orchestrator(?:\.[A-Za-z0-9_]+)+)['"]/g
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(KEY_LITERAL)) referencedKeys.add(match[1])
  }

  /**
   * `agent_orchestrator.<feature>` strings that are NOT translation keys: ACL
   * feature ids, DI keys, event ids and the module id itself all share the
   * prefix. A key absent from `en.json` is one of those, not a gap — `en.json`
   * is the definition of what a key is.
   */
  const translationKeys = [...referencedKeys].filter((key) => key in dictionaries.en).sort()

  it('scans a meaningful number of module sources and keys', () => {
    expect(sourceFiles.length).toBeGreaterThan(100)
    expect(translationKeys.length).toBeGreaterThan(300)
  })

  it.each(locales)('locale %s resolves every key the module names', (locale) => {
    const missing = translationKeys.filter((key) => {
      const value = dictionaries[locale][key]
      return typeof value !== 'string' || value.trim().length === 0
    })

    expect(missing).toEqual([])
  })

  it.each(locales)('locale %s holds exactly the English key set', (locale) => {
    expect(Object.keys(dictionaries[locale]).sort()).toEqual(Object.keys(dictionaries.en).sort())
  })

  it.each(locales)('locale %s stays sorted by key', (locale) => {
    const keys = Object.keys(dictionaries[locale])
    expect(keys).toEqual([...keys].sort())
  })

  it.each(locales)('locale %s keeps every {placeholder} the English value declares', (locale) => {
    const placeholdersOf = (value: string) =>
      [...value.matchAll(/\{\{?(\w+)\}?\}/g)].map((match) => match[1]).sort()

    const drifted = Object.keys(dictionaries.en).filter((key) => {
      const expected = placeholdersOf(dictionaries.en[key])
      if (expected.length === 0) return false
      return placeholdersOf(dictionaries[locale][key]).join('|') !== expected.join('|')
    })

    expect(drifted).toEqual([])
  })

  /**
   * Ceilings measured after the issue #5979 translation pass. Lower them freely;
   * raising one means untranslated English shipped in that locale.
   */
  const UNTRANSLATED_CEILING: Record<Exclude<Locale, 'en'>, number> = {
    pl: 67,
    de: 84,
    es: 55,
    ko: 105,
  }

  it.each(Object.keys(UNTRANSLATED_CEILING) as Exclude<Locale, 'en'>[])(
    'locale %s ships no more English values than its ceiling',
    (locale) => {
      const identical = Object.keys(dictionaries.en).filter(
        (key) => dictionaries[locale][key] === dictionaries.en[key],
      )

      expect(identical.length).toBeLessThanOrEqual(UNTRANSLATED_CEILING[locale])
    },
  )

  /**
   * The exact strings issue #5979 reported, pinned so the specific screens QA
   * walked cannot silently go back to English.
   */
  const REPORTED_KEYS = [
    'agent_orchestrator.agentDetail.tabs.overview',
    'agent_orchestrator.agentDetail.tabs.activity',
    'agent_orchestrator.agentDetail.tabs.evaluation',
    'agent_orchestrator.agentDetail.tabs.configuration',
    'agent_orchestrator.agentDetail.runVolume.title',
    'agent_orchestrator.agentDetail.attention.title',
    'agent_orchestrator.agentDetail.attention.clear',
    'agent_orchestrator.agentDetail.tokens.title',
    'agent_orchestrator.agentDetail.tokens.runtimeTitle',
    'agent_orchestrator.agentDetail.tokens.none',
    'agent_orchestrator.agentDetail.config.resultKind',
    'agent_orchestrator.errors.no_provider_configured',
    'agent_orchestrator.workInbox.disposition.title',
  ]

  it.each(['pl', 'de', 'es', 'ko'] as const)(
    'locale %s translates every string issue #5979 reported',
    (locale) => {
      const stillEnglish = REPORTED_KEYS.filter(
        (key) => dictionaries[locale][key] === dictionaries.en[key],
      )

      expect(stillEnglish).toEqual([])
    },
  )
})
