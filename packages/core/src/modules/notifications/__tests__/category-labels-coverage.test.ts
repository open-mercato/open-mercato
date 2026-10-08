import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'
import { deriveCategory } from '../lib/derive-category'

/**
 * Every notification category shown as a group heading on the delivery settings page
 * (`/backend/config/notifications`) must resolve to a translated
 * `notifications.categories.<key>` label in every locale. Without one, the heading
 * falls back to the raw module id (issue #7089). Dictionaries merge flat across
 * modules, so the label may live in any module's `i18n/<locale>.json`.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const
const CATEGORY_KEY_PREFIX = 'notifications.categories.'

function listModuleDirs(): string[] {
  const roots = [
    ...readdirSync(join(REPO_ROOT, 'packages')).map((pkg) => join(REPO_ROOT, 'packages', pkg, 'src', 'modules')),
    ...readdirSync(join(REPO_ROOT, 'apps')).map((app) => join(REPO_ROOT, 'apps', app, 'src', 'modules')),
  ].filter((root) => existsSync(root))
  return roots.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name)),
  )
}

const moduleDirs = listModuleDirs()

function loadCategories(): Map<string, string[]> {
  const categories = new Map<string, string[]>()
  for (const moduleDir of moduleDirs) {
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
  for (const moduleDir of moduleDirs) {
    const file = join(moduleDir, 'i18n', `${locale}.json`)
    if (!existsSync(file)) continue
    const dictionary = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    for (const [key, value] of Object.entries(dictionary)) {
      if (key.startsWith(CATEGORY_KEY_PREFIX) && typeof value === 'string' && value.trim()) keys.add(key)
    }
  }
  return keys
}

describe('notification category labels', () => {
  const categories = loadCategories()

  it('discovers notification types across the workspace', () => {
    expect(categories.size).toBeGreaterThan(5)
    expect(moduleDirs.map((dir) => relative(REPO_ROOT, dir))).toEqual(
      expect.arrayContaining(['packages/enterprise/src/modules/security', 'packages/core/src/modules/wms']),
    )
  })

  it.each(LOCALES)('every category has a translated heading in %s', (locale) => {
    const keys = loadLocaleKeys(locale)
    const missing = [...categories.keys()].filter((category) => !keys.has(`${CATEGORY_KEY_PREFIX}${category}`)).sort()
    expect(missing).toEqual([])
  })

  it('groups enterprise security notifications with auth under one Security heading', () => {
    expect(categories.has('security')).toBe(false)
    expect(categories.get('auth')).toEqual(
      expect.arrayContaining(['auth.account.locked', 'security.password.changed', 'security.mfa.enrolled']),
    )
  })
})
