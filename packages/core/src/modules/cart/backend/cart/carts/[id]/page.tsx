"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ArrowLeft } from 'lucide-react'

const CART_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  active: 'info',
  locked: 'warning',
  converted: 'success',
  abandoned: 'neutral',
  expired: 'neutral',
  merged: 'neutral',
}

type CartLineRow = {
  id: string
  name: string
  quantity: string
  unitPriceGross: string | null
  // A line's `lineTotals` is `SalesLineCalculationResult` (`salesCalculationService
  // .calculateLine`'s own shape, see `cart/lib/reprice.ts#computeLineTotals`) — the
  // cart/document-level aggregate's `grandTotalGrossAmount` field does not exist here.
  lineTotals: { grossAmount?: number } | null
  addedByActorType: string
  flagState: string | null
}

type ApprovalRow = {
  id: string
  status: string
  amountGross: string
  currencyCode: string
} | null

type MergeLogRow = {
  id: string
  strategy: string
  createdAt: string
  mergedByActorType: string
  proposalCartId: string | null
}

// `quantity` is a `numeric(16, 4)` column, so the API always sends it as a 4-decimal
// string (e.g. "2.0000") — trimmed to how many decimals the value actually needs.
function formatLineQuantity(value: string): string {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 4 }) : value
}

type WarningRow = { code: string; lineId?: string; message: string }

type CartAdminDetail = {
  id: string
  updatedAt: string
  status: string
  kind: string
  channel: string
  currencyCode: string
  locale: string
  storeId: string | null
  customerId: string | null
  customerName: string | null
  customerUserId: string | null
  email: string | null
  note: string | null
  requiresApproval: boolean
  lines: CartLineRow[]
  totals: { grandTotalGrossAmount?: number; grandTotalNetAmount?: number }
  expiresAt: string
}

type CartAdminDetailResponse = {
  cart: CartAdminDetail
  approval: ApprovalRow
  mergeLogEntries: MergeLogRow[]
  warnings?: WarningRow[]
}

export default function CartAdminDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const cartId = params?.id ?? ''

  const [data, setData] = React.useState<CartAdminDetailResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(
    () => ({
      pageTitle: t('cart.admin.detail.pageTitle', 'Cart'),
      back: t('cart.admin.detail.actions.back', 'Back to carts'),
      reprice: t('cart.admin.detail.actions.reprice', 'Re-price'),
      sections: {
        lines: t('cart.admin.detail.sections.lines', 'Lines'),
        approval: t('cart.admin.detail.sections.approval', 'Approval'),
        mergeLog: t('cart.admin.detail.sections.mergeLog', 'Merge history'),
        warnings: t('cart.admin.detail.sections.warnings', 'Warnings'),
      },
      fields: {
        channel: t('cart.admin.detail.fields.channel', 'Channel'),
        customer: t('cart.admin.detail.fields.customer', 'Customer'),
        email: t('cart.admin.detail.fields.email', 'Email'),
        note: t('cart.admin.detail.fields.note', 'Note'),
        currency: t('cart.admin.detail.fields.currency', 'Currency'),
        expiresAt: t('cart.admin.detail.fields.expiresAt', 'Expires'),
        grandTotal: t('cart.admin.detail.fields.grandTotal', 'Grand total'),
      },
      noApproval: t('cart.admin.detail.noApproval', 'No approval on this cart.'),
      noMergeLog: t('cart.admin.detail.noMergeLog', 'This cart was never merged.'),
      noLines: t('cart.admin.detail.noLines', 'This cart has no lines.'),
      statuses: {
        active: t('cart.admin.statuses.active', 'Active'),
        locked: t('cart.admin.statuses.locked', 'Locked'),
        converted: t('cart.admin.statuses.converted', 'Converted'),
        abandoned: t('cart.admin.statuses.abandoned', 'Abandoned'),
        expired: t('cart.admin.statuses.expired', 'Expired'),
        merged: t('cart.admin.statuses.merged', 'Merged'),
      },
      errors: {
        load: t('cart.admin.detail.errors.load', 'Failed to load the cart.'),
        reprice: t('cart.admin.detail.errors.reprice', 'Failed to re-price the cart.'),
      },
      flash: {
        repriced: t('cart.admin.detail.flash.repriced', 'Cart re-priced.'),
      },
    }),
    [t],
  )

  const loadCart = React.useCallback(async () => {
    if (!cartId) return
    setIsLoading(true)
    setError(null)
    try {
      const call = await apiCall<CartAdminDetailResponse>(`/api/cart/carts/${cartId}`)
      if (!call.ok || !call.result) throw new Error(labels.errors.load)
      setData(call.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.errors.load)
    } finally {
      setIsLoading(false)
    }
  }, [cartId, labels.errors.load])

  React.useEffect(() => {
    void loadCart()
  }, [loadCart, reloadToken])

  const repriceMutationContextId = 'cart-admin-detail:reprice'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: repriceMutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const handleReprice = React.useCallback(async () => {
    if (!data) return
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(data.cart.updatedAt), () =>
            apiCall<CartAdminDetailResponse>(`/api/cart/carts/${cartId}/reprice`, {
              method: 'POST',
              body: JSON.stringify({}),
            }),
          ),
        context: {
          formId: repriceMutationContextId,
          resourceKind: 'cart.cart',
          resourceId: cartId,
          retryLastMutation,
        },
        mutationPayload: {},
      })
      flash(labels.flash.repriced, 'success')
      setReloadToken((token) => token + 1)
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        setReloadToken((token) => token + 1)
        return
      }
      flash(labels.errors.reprice, 'error')
    }
  }, [cartId, data, labels.errors.reprice, labels.flash.repriced, retryLastMutation, runMutation, t])

  if (isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('cart.admin.detail.loading', 'Loading cart...')} />
        </PageBody>
      </Page>
    )
  }

  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? labels.errors.load} />
        </PageBody>
      </Page>
    )
  }

  const { cart, approval, mergeLogEntries, warnings } = data
  const canReprice = cart.status === 'active' || cart.status === 'abandoned'

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              href="/backend/cart/carts"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden /> {labels.back}
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-medium">{labels.pageTitle}</h1>
              <StatusBadge variant={CART_STATUS_VARIANTS[cart.status] ?? 'neutral'} dot>
                {labels.statuses[cart.status as keyof typeof labels.statuses] ?? cart.status}
              </StatusBadge>
            </div>
          </div>
          <Button type="button" disabled={!canReprice} onClick={() => void handleReprice()}>
            {labels.reprice}
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{labels.fields.channel}</p>
            <p className="text-sm text-foreground">{cart.channel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{labels.fields.customer}</p>
            <p className="truncate text-sm text-foreground">{cart.customerName ?? cart.customerId ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{labels.fields.email}</p>
            <p className="truncate text-sm text-foreground">{cart.email ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{labels.fields.grandTotal}</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {formatCurrency(cart.totals.grandTotalGrossAmount ?? null, cart.currencyCode) ?? '—'}
            </p>
          </div>
        </div>

        {warnings && warnings.length > 0 ? (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-medium text-foreground">{labels.sections.warnings}</h2>
            <ul className="space-y-1">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`} className="text-sm text-status-warning-text">
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">{labels.sections.lines}</h2>
          {cart.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.noLines}</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <tbody>
                  {cart.lines.map((line) => (
                    <tr key={line.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-foreground">{line.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatLineQuantity(line.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">
                        {formatCurrency(line.lineTotals?.grossAmount ?? null, cart.currencyCode) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">{labels.sections.approval}</h2>
          {approval ? (
            <p className="text-sm text-foreground">
              {approval.status} — {formatCurrency(Number(approval.amountGross), approval.currencyCode) ?? approval.amountGross}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{labels.noApproval}</p>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">{labels.sections.mergeLog}</h2>
          {mergeLogEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.noMergeLog}</p>
          ) : (
            <ul className="space-y-1">
              {mergeLogEntries.map((entry) => (
                <li key={entry.id} className="text-sm text-muted-foreground">
                  {entry.strategy} — {formatDateTime(entry.createdAt) ?? entry.createdAt} ({entry.mergedByActorType})
                </li>
              ))}
            </ul>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
