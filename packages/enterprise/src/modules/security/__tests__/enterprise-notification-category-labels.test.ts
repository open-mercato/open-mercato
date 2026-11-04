import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { deriveCategory } from '@open-mercato/core/modules/notifications/lib/derive-category'

/**
 * Enterprise twin of `packages/core/src/modules/notifications/__tests__/category-labels-coverage.test.ts`.
 * Every notification category declared by a commercial module must resolve to a translated
 * `notifications.categories.<key>` heading on the delivery settings page in every locale
 * (issue #7095). Dictionaries merge flat across modules, so the label may live in any
 * module's `i18n/<locale>.json` — e.g. the shared `auth` heading lives in core.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const ENTERPRISE_MODULES_ROOT = join(REPO_ROOT, 'packages', 'enterprise', 'src', 'modules')
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const
const CATEGORY_KEY_PREFIX = 'notifications.categories.'

function listModuleDirs(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
}

const enterpriseModuleDirs = listModuleDirs(ENTERPRISE_MODULES_ROOT)

const allModuleDirs = [
  ...readdirSync(join(REPO_ROOT, 'packages')).map((pkg) => join(REPO_ROOT, 'packages', pkg, 'src', 'modules')),
  ...readdirSync(join(REPO_ROOT, 'apps')).map((app) => join(REPO_ROOT, 'apps', app, 'src', 'modules')),
].flatMap(listModuleDirs)

function loadEnterpriseCategories(): Map<string, string[]> {
  const categories = new Map<string, string[]>()
  for (const moduleDir of enterpriseModuleDirs) {
    const file = join(moduleDir, 'notifications.ts')
    if (!existsSync(file)) continue
    const loaded = require(file) as { notificationTypes?: NotificationTypeDefinition[]; default?: NotificationTypeDefinition[] }
    const definitions = loaded.notificationTypes ?? loaded.default ?? []
    for (const definition of definitions) {
      const category = definition.category ?? deriveCategory(definition.type)
      categories.set(category, [...(categories.get(category) ?? []), definition.type])
    }
  }
  return categories
}

function loadLocaleKeys(locale: string): Set<string> {
  const keys = new Set<string>()
  for (const moduleDir of allModuleDirs) {
    const file = join(moduleDir, 'i18n', `${locale}.json`)
    if (!existsSync(file)) continue
    const dictionary = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    for (const [key, value] of Object.entries(dictionary)) {
      if (key.startsWith(CATEGORY_KEY_PREFIX) && typeof value === 'string' && value.trim()) keys.add(key)
    }
  }
  return keys
}

describe('enterprise notification category labels', () => {
  const categories = loadEnterpriseCategories()

  it('discovers enterprise notification types', () => {
    expect(enterpriseModuleDirs.map((dir) => relative(REPO_ROOT, dir))).toEqual(
      expect.arrayContaining([
        'packages/enterprise/src/modules/agent_orchestrator',
        'packages/enterprise/src/modules/record_locks',
        'packages/enterprise/src/modules/security',
      ]),
    )
    expect([...categories.keys()]).toEqual(expect.arrayContaining(['agent_orchestrator', 'record_locks', 'auth']))
  })

  it.each(LOCALES)('every enterprise category has a translated heading in %s', (locale) => {
    const keys = loadLocaleKeys(locale)
    const missing = [...categories.keys()].filter((category) => !keys.has(`${CATEGORY_KEY_PREFIX}${category}`)).sort()
    expect(missing).toEqual([])
  })

  it('groups enterprise security notifications with auth under one Security heading', () => {
    expect(categories.has('security')).toBe(false)
    expect(categories.get('auth')).toEqual(
      expect.arrayContaining([
        'security.password.changed',
        'security.mfa.enrolled',
        'security.mfa.reset',
        'security.mfa.enforcement_deadline',
      ]),
    )
  })
})
