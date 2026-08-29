'use client'
import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export type SalesDocumentPermissions = {
  canEditNumber: boolean
  canManageOrders: boolean | null
  canManageQuotes: boolean | null
  canManagePayments: boolean | null
  canManageShipments: boolean | null
  canCreateReturns: boolean | null
  canManageReturns: boolean | null
}

const LOCKED: SalesDocumentPermissions = {
  canEditNumber: false,
  canManageOrders: null,
  canManageQuotes: null,
  canManagePayments: null,
  canManageShipments: null,
  canCreateReturns: null,
  canManageReturns: null,
}

/**
 * Resolves the sales document detail page's edit permissions in one `/api/auth/feature-check`
 * round trip. The `boolean | null` flags are three-state on purpose: an affordance needs a
 * *granted* answer (`true`) to appear, while only a *denied* one (`false`) may be stated to the
 * user as a reason — a failed check must not tell a manager they lack a permission nobody managed
 * to check, so both failure transports (a rejected fetch and a resolved non-2xx) land on `null`.
 *
 * The answer is trusted only for the organization scope that produced it. A scope switch re-runs
 * the check, and until the new answer arrives every flag reads as locked — returning the stored
 * values would offer the previous organization's edits for a full round trip, and resetting them
 * inside the effect would still let one render through.
 */
export function useSalesDocumentPermissions(): SalesDocumentPermissions {
  const scopeVersion = useOrganizationScopeVersion()
  const [resolved, setResolved] = React.useState<{
    scopeVersion: number
    permissions: SalesDocumentPermissions
  } | null>(null)

  React.useEffect(() => {
    let active = true
    async function loadPermissions() {
      try {
        const call = await apiCall<{ granted?: unknown[] }>(
          '/api/auth/feature-check',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              features: [
                'sales.documents.number.edit',
                'sales.orders.manage',
                'sales.quotes.manage',
                'sales.payments.manage',
                'sales.shipments.manage',
                'sales.returns.create',
                'sales.returns.manage',
              ],
            }),
          }
        )
        if (!active) return
        if (!call.ok) {
          // apiCall resolves non-2xx rather than throwing, so an expired session or a 500 would
          // otherwise read as an empty `granted` list — i.e. as a decided denial.
          setResolved({ scopeVersion, permissions: LOCKED })
          return
        }
        const granted = Array.isArray(call.result?.granted)
          ? call.result?.granted.map((item) => String(item))
          : []
        const hasFeature = (wanted: string) => granted.includes(wanted)
        setResolved({
          scopeVersion,
          permissions: {
            canEditNumber: hasFeature('sales.documents.number.edit'),
            canManageOrders: hasFeature('sales.orders.manage'),
            canManageQuotes: hasFeature('sales.quotes.manage'),
            canManagePayments: hasFeature('sales.payments.manage'),
            canManageShipments: hasFeature('sales.shipments.manage'),
            canCreateReturns: hasFeature('sales.returns.create'),
            canManageReturns: hasFeature('sales.returns.manage'),
          },
        })
      } catch {
        if (active) setResolved({ scopeVersion, permissions: LOCKED })
      }
    }
    loadPermissions().catch(() => {})
    return () => {
      active = false
    }
  }, [scopeVersion])

  return resolved && resolved.scopeVersion === scopeVersion ? resolved.permissions : LOCKED
}
