import * as fs from 'fs'
import * as path from 'path'
import { metadata as globalListMeta } from '../backend/feature-toggles/global/page.meta'
import { metadata as globalCreateMeta } from '../backend/feature-toggles/global/create/page.meta'
import { metadata as globalDetailMeta } from '../backend/feature-toggles/global/[id]/page.meta'
import { metadata as globalEditMeta } from '../backend/feature-toggles/global/[id]/edit/page.meta'

type NavMetadata = {
  pageTitleKey?: string
  pageGroupKey?: string
  breadcrumb?: Array<{ labelKey?: string }>
}

const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

function moduleKeys(meta: NavMetadata): string[] {
  const keys = [meta.pageTitleKey, meta.pageGroupKey, ...(meta.breadcrumb ?? []).map((item) => item.labelKey)]
  return keys.filter((key): key is string => typeof key === 'string' && key.startsWith('feature_toggles.'))
}

const referencedKeys = Array.from(
  new Set([globalListMeta, globalCreateMeta, globalDetailMeta, globalEditMeta].flatMap((meta) => moduleKeys(meta as NavMetadata))),
)

describe('feature_toggles global page titles and breadcrumbs are translated', () => {
  it.each(LOCALES)('every module key referenced by page metadata exists in %s', (locale) => {
    const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${locale}.json`), 'utf8')) as Record<string, string>
    expect(referencedKeys.filter((key) => typeof dict[key] !== 'string')).toEqual([])
  })

  it('translates the create form title', () => {
    const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', 'pl.json'), 'utf8')) as Record<string, string>
    const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'feature-toggles', 'global', 'create', 'page.tsx'), 'utf8')
    expect(source).toContain("t('feature_toggles.form.title.create', 'Create Feature Toggle')")
    expect(dict['feature_toggles.form.title.create']).toBe('Utwórz przełącznik funkcji')
  })
})
