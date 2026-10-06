import type * as React from 'react'
import { STORE_LIST_HREF, type StoreAdminRecord } from './storeAdmin'

export const STORE_TAB_QUERY_PARAM = 'tab'

export const STORE_EDIT_TAB_IDS = ['general', 'branding', 'domains', 'channels', 'seo'] as const

export type StoreEditTabId = (typeof STORE_EDIT_TAB_IDS)[number]

export type StoreEditTabContext = {
  store: StoreAdminRecord
  reload: () => Promise<void>
}

export type StoreEditTabDefinition = {
  id: StoreEditTabId
  labelKey: string
  fallbackLabel: string
  render: (context: StoreEditTabContext) => React.ReactNode
}

export const STORE_EDIT_TABS: readonly StoreEditTabDefinition[] = []

export function isStoreEditTabId(value: unknown): value is StoreEditTabId {
  return typeof value === 'string' && (STORE_EDIT_TAB_IDS as readonly string[]).includes(value)
}

export function buildStoreEditHref(storeId: string, tab?: StoreEditTabId): string {
  const base = `${STORE_LIST_HREF}/${encodeURIComponent(storeId)}`
  return tab ? `${base}?${STORE_TAB_QUERY_PARAM}=${tab}` : base
}

export function resolveActiveStoreTab(
  requested: string | null | undefined,
  tabs: readonly StoreEditTabDefinition[],
): StoreEditTabId | null {
  if (!tabs.length) return null
  const match = tabs.find((tab) => tab.id === requested)
  return (match ?? tabs[0]).id
}
