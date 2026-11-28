import fs from 'node:fs'
import path from 'node:path'
import en from '../../../../../i18n/en.json'
import pl from '../../../../../i18n/pl.json'
import de from '../../../../../i18n/de.json'
import es from '../../../../../i18n/es.json'
import ko from '../../../../../i18n/ko.json'

type Dictionary = Record<string, string>

const PIPELINE_DIR = path.resolve(__dirname, '..')
const KEY_PATTERN = /['"](customers\.deals\.kanban\.[\w.]+)['"]/g
const NON_TRANSLATION_IDS = new Set(['customers.deals.kanban.quickDeal'])

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSourceFiles(entryPath)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [entryPath]
  })
}

function collectKanbanKeys(): string[] {
  const keys = new Set<string>()
  for (const file of listSourceFiles(PIPELINE_DIR)) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(KEY_PATTERN)) {
      if (!NON_TRANSLATION_IDS.has(match[1])) keys.add(match[1])
    }
  }
  return Array.from(keys).sort()
}

describe('deals kanban translation keys', () => {
  const usedKeys = collectKanbanKeys()
  const locales: Array<[string, Dictionary]> = [
    ['en', en],
    ['pl', pl],
    ['de', de],
    ['es', es],
    ['ko', ko],
  ]

  it('finds the keys the board renders', () => {
    expect(usedKeys.length).toBeGreaterThan(200)
  })

  it.each(locales)('%s: defines every key the board renders', (_locale, dictionary) => {
    const missing = usedKeys.filter((key) => typeof dictionary[key] !== 'string')
    expect(missing).toEqual([])
  })
})
