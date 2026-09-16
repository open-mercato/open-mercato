"use client"
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'

/**
 * Whether the current operator may start, retry, or cancel a sync run.
 *
 * The run endpoints have always required `data_sync.run`, but both Data Sync
 * pages declare only `data_sync.view`, so a viewer saw every action button and
 * got a 403 on click. This is the client-side half of that gate.
 *
 * It exists as a module-local hook rather than an inline `useBackendChrome`
 * call in each page for the same reason `customers` has `useDealsAccess`: one
 * place resolves the feature, and a page test mocks this file instead of the
 * shared backend-chrome module.
 */
export function useDataSyncRunAccess(): { canRunSync: boolean } {
  const { payload } = useBackendChrome()
  return { canRunSync: hasFeature(payload?.grantedFeatures, 'data_sync.run') }
}
