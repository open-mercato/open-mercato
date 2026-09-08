import appPolish from '../../../../../../../../apps/mercato/src/i18n/pl.json'
import authPolish from '../../../i18n/pl.json'
import { metadata as roleEditMetadata } from '../../roles/[id]/edit/page.meta'
import { metadata as userEditMetadata } from '../[id]/edit/page.meta'

type PageMetadata = {
  pageTitle: string
  pageTitleKey?: string
  breadcrumb: Array<{ label: string; labelKey?: string }>
}

const polishDictionary: Record<string, string> = { ...appPolish, ...authPolish }

function expectPolishMetadata(metadata: PageMetadata): void {
  expect(metadata.pageTitleKey).toEqual(expect.any(String))
  expect(polishDictionary[metadata.pageTitleKey!]).toEqual(expect.any(String))
  expect(polishDictionary[metadata.pageTitleKey!]).not.toBe(metadata.pageTitle)

  for (const item of metadata.breadcrumb) {
    expect(item.labelKey).toEqual(expect.any(String))
    expect(polishDictionary[item.labelKey!]).toEqual(expect.any(String))
    expect(polishDictionary[item.labelKey!]).not.toBe(item.label)
  }
}

describe('permission edit page metadata i18n', () => {
  it.each([
    ['user', userEditMetadata],
    ['role', roleEditMetadata],
  ])('resolves shipped Polish browser title and breadcrumb keys for %s editing', (_kind, metadata) => {
    expectPolishMetadata(metadata)
  })
})
