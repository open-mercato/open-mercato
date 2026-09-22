"use client"

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customer_groups').child({ component: 'OrphanBanner' })

type ReconcileResponse = {
  orphans?: Array<{ groupId: string }>
}

// Mirrors `packages/ui/src/backend/indexes/PartialIndexBanner.tsx`'s shape
// (status-warning tokens, AlertTriangle icon, no hardcoded colors). Renders
// nothing while loading and nothing once loaded with zero orphans — the empty
// state lives on the report page (`backend/customer-groups/orphans/page.tsx`),
// not here.
export function OrphanBanner() {
  const t = useT()
  const [orphanCount, setOrphanCount] = React.useState<number | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const fallback: ReconcileResponse = { orphans: [] }
        const call = await apiCall<ReconcileResponse>('/api/customer-groups/reconcile', undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          setOrphanCount(null)
          return
        }
        const orphans = Array.isArray(call.result?.orphans) ? call.result.orphans : []
        setOrphanCount(orphans.length)
      } catch (err) {
        if (!cancelled) {
          logger.error('customer_groups.orphanBanner.load failed', { err })
          setOrphanCount(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Intentionally silent while loading and once resolved with zero orphans —
  // a warning banner that flashes in then disappears reads as a bug, so this
  // banner only ever renders in the "found N orphans" state.
  if (isLoading || !orphanCount) return null

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-status-warning-border bg-status-warning-bg px-3 py-3 text-sm text-status-warning-text md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2 font-medium text-status-warning-text">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <span>
          {t(
            'customer_groups.groups.orphanBanner.title',
            '{count} orphaned customer-group reference(s) found',
            { count: orphanCount },
          )}
        </span>
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="border-status-warning-border text-status-warning-text hover:bg-status-warning-bg"
      >
        <Link href="/backend/customer-groups/orphans">
          {t('customer_groups.groups.orphanBanner.viewReport', 'View report')}
        </Link>
      </Button>
    </div>
  )
}

export default OrphanBanner
