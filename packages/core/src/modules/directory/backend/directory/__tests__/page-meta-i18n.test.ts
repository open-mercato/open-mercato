/**
 * @jest-environment node
 */
import de from '../../../i18n/de.json'
import en from '../../../i18n/en.json'
import es from '../../../i18n/es.json'
import pl from '../../../i18n/pl.json'
import { metadata as organizationsCreateMeta } from '../organizations/create/page.meta'
import { metadata as organizationsEditMeta } from '../organizations/[id]/edit/page.meta'
import { metadata as tenantsEditMeta } from '../tenants/[id]/edit/page.meta'

type BreadcrumbEntry = { label?: string; labelKey?: string; href?: string }
type PageMeta = {
  pageTitle?: string
  pageTitleKey?: string
  pageGroup?: string
  pageGroupKey?: string
  breadcrumb?: BreadcrumbEntry[]
}

const dicts: Record<string, Record<string, string>> = {
  en: en as Record<string, string>,
  pl: pl as Record<string, string>,
  de: de as Record<string, string>,
  es: es as Record<string, string>,
}

const pages: Array<[string, PageMeta]> = [
  ['organizations/[id]/edit', organizationsEditMeta],
  ['organizations/create', organizationsCreateMeta],
  ['tenants/[id]/edit', tenantsEditMeta],
]

describe('directory backend page metadata i18n', () => {
  describe.each(pages)('%s', (_route, meta) => {
    it('declares a translation key for the page title', () => {
      expect(meta.pageTitle).toBeTruthy()
      expect(meta.pageTitleKey).toBeTruthy()
    })

    it('declares a translation key for the page group', () => {
      expect(meta.pageGroup).toBeTruthy()
      expect(meta.pageGroupKey).toBeTruthy()
    })

    it('declares a translation key for every breadcrumb entry', () => {
      const breadcrumb = meta.breadcrumb ?? []
      expect(breadcrumb.length).toBeGreaterThan(0)
      for (const entry of breadcrumb) {
        expect(entry.label).toBeTruthy()
        expect(entry.labelKey).toBeTruthy()
      }
    })

    it('resolves every directory-owned key in all shipped locales', () => {
      const keys = [
        meta.pageTitleKey,
        meta.pageGroupKey,
        ...(meta.breadcrumb ?? []).map((entry) => entry.labelKey),
      ].filter((key): key is string => Boolean(key) && key!.startsWith('directory.'))

      expect(keys.length).toBeGreaterThan(0)
      const missing: string[] = []
      for (const key of keys) {
        for (const [locale, dict] of Object.entries(dicts)) {
          const value = dict[key]
          if (typeof value !== 'string' || !value.trim()) missing.push(`${locale}:${key}`)
        }
      }
      expect(missing).toEqual([])
    })

    it('translates the directory-owned keys away from their English source', () => {
      const keys = [
        meta.pageTitleKey,
        ...(meta.breadcrumb ?? []).map((entry) => entry.labelKey),
      ].filter((key): key is string => Boolean(key) && key!.startsWith('directory.'))

      for (const key of keys) {
        expect(dicts.pl[key]).not.toBe(dicts.en[key])
      }
    })
  })
})
