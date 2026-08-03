import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { settingsSectionOrder } from '../backendChrome'

/**
 * Settings section ordering guard (#4843).
 *
 * `buildSettingsSections` keys `settingsSectionOrder` by the untranslated group id — the
 * `pageGroupKey` a settings page declares, or its raw `pageGroup` label when it declares no key.
 * A key that matches no shipped settings page is silent: the section simply falls into the `999`
 * catch-all and the panel degrades to alphabetical order, which is how the map drifted out of sync
 * with the rendered labels in the first place.
 *
 * This test pins that invariant, so a renamed `pageGroupKey` or a typo in the map fails here
 * instead of quietly reordering everyone's Settings panel.
 */

const PACKAGES_DIR = join(__dirname, '../../../../../..')

function collectPageMetaFiles(dir: string, found: string[] = []): string[] {
  let dirEntries: string[]
  try {
    dirEntries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of dirEntries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      collectPageMetaFiles(fullPath, found)
    } else if (entry === 'page.meta.ts') {
      found.push(fullPath)
    }
  }
  return found
}

function collectDeclaredSettingsGroupIds(): Set<string> {
  const groupIds = new Set<string>()
  for (const file of collectPageMetaFiles(PACKAGES_DIR)) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes("pageContext: 'settings'")) continue
    const groupKey = /pageGroupKey:\s*'([^']+)'/.exec(source)?.[1]
    const groupLabel = /pageGroup:\s*'([^']+)'/.exec(source)?.[1]
    const groupId = groupKey ?? groupLabel
    if (groupId) groupIds.add(groupId)
  }
  return groupIds
}

describe('settingsSectionOrder', () => {
  const declaredGroupIds = collectDeclaredSettingsGroupIds()

  it('finds the settings group ids declared across the packages', () => {
    expect(declaredGroupIds.size).toBeGreaterThan(0)
  })

  it('only weights group ids that a shipped settings page actually declares', () => {
    const unknownKeys = Object.keys(settingsSectionOrder).filter((key) => !declaredGroupIds.has(key))
    expect(unknownKeys).toEqual([])
  })

  it('assigns a distinct weight to every ordered section', () => {
    const weights = Object.values(settingsSectionOrder)
    expect(new Set(weights).size).toBe(weights.length)
  })
})
