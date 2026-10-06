/**
 * @jest-environment jsdom
 */
import {
  STORE_EDIT_TABS,
  STORE_EDIT_TAB_IDS,
  buildStoreEditHref,
  isStoreEditTabId,
  resolveActiveStoreTab,
  type StoreEditTabDefinition,
} from '../storeEditTabs'

function tab(id: StoreEditTabDefinition['id']): StoreEditTabDefinition {
  return { id, labelKey: `test.${id}`, fallbackLabel: id, render: () => null }
}

describe('store edit tab contract', () => {
  it('fixes the tab ids that the list row actions and later steps address through ?tab=', () => {
    expect([...STORE_EDIT_TAB_IDS]).toEqual(['general', 'branding', 'domains', 'channels', 'seo'])
    expect(isStoreEditTabId('domains')).toBe(true)
    expect(isStoreEditTabId('overview')).toBe(false)
    expect(isStoreEditTabId(null)).toBe(false)
  })

  it('builds the edit route with an optional tab query parameter', () => {
    expect(buildStoreEditHref('abc')).toBe('/backend/config/ecommerce/abc')
    expect(buildStoreEditHref('abc', 'channels')).toBe('/backend/config/ecommerce/abc?tab=channels')
  })

  it('registers a tab only once its own step ships it', () => {
    expect(STORE_EDIT_TABS.map((registered) => registered.id)).toEqual(['general', 'branding'])
    expect(resolveActiveStoreTab('branding', STORE_EDIT_TABS)).toBe('branding')
    expect(resolveActiveStoreTab('domains', STORE_EDIT_TABS)).toBe('general')
    expect(resolveActiveStoreTab('general', [])).toBeNull()
  })

  it('resolves the requested tab and falls back to the first registered one', () => {
    const tabs = [tab('general'), tab('domains')]
    expect(resolveActiveStoreTab('domains', tabs)).toBe('domains')
    expect(resolveActiveStoreTab('channels', tabs)).toBe('general')
    expect(resolveActiveStoreTab(null, tabs)).toBe('general')
  })
})
