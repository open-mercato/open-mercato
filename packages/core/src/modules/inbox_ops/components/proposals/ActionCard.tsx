"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CheckCircle,
  XCircle,
  Pencil,
  AlertTriangle,
  RefreshCw,
  Package,
  FileText,
  MessageSquare,
  Truck,
  UserPlus,
  Link2,
  Activity,
  ShoppingBag,
} from 'lucide-react'
import type { ActionDetail, DiscrepancyDetail } from './types'
import { hasContactNameIssue } from '../../lib/contactValidation'

export { hasContactNameIssue }

const ACTION_TYPE_ICONS: Record<string, React.ElementType> = {
  create_order: Package,
  create_quote: FileText,
  update_order: Package,
  update_shipment: Truck,
  create_contact: UserPlus,
  create_product: ShoppingBag,
  link_contact: Link2,
  log_activity: Activity,
  draft_reply: MessageSquare,
}

export function useActionTypeLabels(): Record<string, string> {
  const t = useT()
  return {
    create_order: t('inbox_ops.action_type.create_order', 'Create Sales Order'),
    create_quote: t('inbox_ops.action_type.create_quote', 'Create Quote'),
    update_order: t('inbox_ops.action_type.update_order', 'Update Order'),
    update_shipment: t('inbox_ops.action_type.update_shipment', 'Update Shipment'),
    create_contact: t('inbox_ops.action_type.create_contact', 'Create Contact'),
    create_product: t('inbox_ops.action_type.create_product', 'Create Product'),
    link_contact: t('inbox_ops.action_type.link_contact', 'Link Contact'),
    log_activity: t('inbox_ops.action_type.log_activity', 'Log Activity'),
    draft_reply: t('inbox_ops.action_type.draft_reply', 'Draft Reply'),
  }
}

export function ConfidenceBadge({ value }: { value: string }) {
  const num = parseFloat(value)
  const pct = Math.round(num * 100)
  const color = num >= 0.8 ? 'text-green-600' : num >= 0.6 ? 'text-yellow-600' : 'text-red-600'
  const bgColor = num >= 0.8 ? 'bg-green-200' : num >= 0.6 ? 'bg-yellow-200' : 'bg-red-200'
  const width = Math.round(num * 100)
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-medium ${color}`}>{pct}%</span>
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${bgColor} rounded-full`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function OrderPreview({ payload }: { payload: Record<string, unknown> }) {
  const t = useT()
  const lineItems = (payload.lineItems as Record<string, unknown>[]) || []
  const customerName = (payload.customerName as string) || ''
  const currencyCode = (payload.currencyCode as string) || ''
  const notes = (payload.notes as string) || ''
  const deliveryDate = (payload.requestedDeliveryDate as string) || ''

  return (
    <div className="mt-2 space-y-2 text-xs">
      {customerName && (
        <div className="flex gap-1">
          <span className="text-muted-foreground">{t('inbox_ops.preview.customer', 'Customer')}:</span>
          <span>{customerName}</span>
          {typeof payload.customerEmail === 'string' && <span className="text-muted-foreground">({payload.customerEmail})</span>}
        </div>
      )}
      {lineItems.length > 0 && (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-2 py-1 font-medium">{t('inbox_ops.preview.product', 'Product')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('inbox_ops.preview.qty', 'Qty')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('inbox_ops.preview.price', 'Price')}</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => (
                <tr key={index} className="border-t">
                  <td className="px-2 py-1">{(item.productName as string) || '—'}</td>
                  <td className="px-2 py-1 text-right">{String(item.quantity ?? '')}</td>
                  <td className="px-2 py-1 text-right">{item.unitPrice ? `${item.unitPrice} ${currencyCode}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(deliveryDate || notes) && (
        <div className="flex flex-wrap gap-3">
          {deliveryDate && (
            <div className="flex gap-1">
              <span className="text-muted-foreground">{t('inbox_ops.preview.delivery', 'Delivery')}:</span>
              <span>{deliveryDate}</span>
            </div>
          )}
          {notes && (
            <div className="flex gap-1">
              <span className="text-muted-foreground">{t('inbox_ops.preview.notes', 'Notes')}:</span>
              <span className="truncate max-w-[200px]">{notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProductPreview({ payload }: { payload: Record<string, unknown> }) {
  const t = useT()
  const title = (payload.title as string) || ''
  const sku = (payload.sku as string) || ''
  const unitPrice = (payload.unitPrice as string) || ''
  const currencyCode = (payload.currencyCode as string) || ''
  const kind = (payload.kind as string) || 'product'

  return (
    <div className="mt-2 space-y-1 text-xs">
      {title && (
        <div className="flex gap-1">
          <span className="text-muted-foreground">{t('inbox_ops.preview.product_title', 'Title')}:</span>
          <span className="font-medium">{title}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {sku && (
          <div className="flex gap-1">
            <span className="text-muted-foreground">{t('inbox_ops.preview.sku', 'SKU')}:</span>
            <span>{sku}</span>
          </div>
        )}
        {unitPrice && (
          <div className="flex gap-1">
            <span className="text-muted-foreground">{t('inbox_ops.preview.price', 'Price')}:</span>
            <span>{unitPrice}{currencyCode ? ` ${currencyCode}` : ''}</span>
          </div>
        )}
        <div className="flex gap-1">
          <span className="text-muted-foreground">{t('inbox_ops.edit_dialog.kind', 'Kind')}:</span>
          <span>{kind}</span>
        </div>
      </div>
    </div>
  )
}

export function ActionCard({
  action,
  discrepancies,
  actionTypeLabels,
  onAccept,
  onReject,
  onRetry,
  onEdit,
  translatedDescription,
}: {
  action: ActionDetail
  discrepancies: DiscrepancyDetail[]
  actionTypeLabels: Record<string, string>
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRetry: (id: string) => void
  onEdit: (action: ActionDetail) => void
  translatedDescription?: string
}) {
  const t = useT()
  const Icon = ACTION_TYPE_ICONS[action.actionType] || Package
  const label = actionTypeLabels[action.actionType] || action.actionType

  const actionDiscrepancies = discrepancies.filter((d) => d.actionId === action.id && !d.resolved)
  const hasBlockingDiscrepancies = actionDiscrepancies.some((d) => d.severity === 'error')
  const displayDescription = translatedDescription || action.description

  if (action.status === 'executed') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-green-50 dark:bg-green-950/20">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <p className="text-sm text-muted-foreground">{displayDescription}</p>
        {action.createdEntityId && (
          <div className="mt-2">
            <span className="text-xs text-green-600">
              Created {action.createdEntityType} · {action.executedAt && new Date(action.executedAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (action.status === 'rejected') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-muted/50 opacity-60">
        <div className="flex items-center gap-2 mb-2">
          <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium line-through">{label}</span>
          <span className="text-xs text-muted-foreground">{t('inbox_ops.status.rejected', 'Rejected')}</span>
        </div>
        <p className="text-sm text-muted-foreground">{displayDescription}</p>
      </div>
    )
  }

  if (action.status === 'failed') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-red-50 dark:bg-red-950/20">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-red-600">{t('inbox_ops.extraction_failed', 'Failed')}</span>
        </div>
        <p className="text-sm text-muted-foreground">{displayDescription}</p>
        {action.executionError && (
          <p className="text-xs text-red-600 mt-1">{action.executionError}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onRetry(action.id)}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.retry', 'Retry')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onEdit(action)}
          >
            <Pencil className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.edit', 'Edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onReject(action.id)}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.reject', 'Reject')}
          </Button>
        </div>
      </div>
    )
  }

  const hasNameIssue = hasContactNameIssue(action)

  return (
    <div className="border rounded-lg p-3 md:p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-5 w-5 text-primary flex-shrink-0" />
        <span className="text-sm font-medium">{label}</span>
        <ConfidenceBadge value={action.confidence} />
      </div>
      <p className="text-sm text-foreground/80 mb-2">{displayDescription}</p>

      {(action.actionType === 'create_order' || action.actionType === 'create_quote') && (
        <OrderPreview payload={action.payload} />
      )}

      {action.actionType === 'create_product' && (
        <ProductPreview payload={action.payload} />
      )}

      {actionDiscrepancies.length > 0 && (
        <div className="mb-3 space-y-1">
          {actionDiscrepancies.map((d) => (
            <div key={d.id} className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
              d.severity === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-950/20' : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20'
            }`}>
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <div>
                <span>{d.description}</span>
                {(d.expectedValue || d.foundValue) && (
                  <div className="mt-0.5 text-[11px] opacity-80">
                    {d.expectedValue && <span>Expected: {d.expectedValue}</span>}
                    {d.expectedValue && d.foundValue && <span> · </span>}
                    {d.foundValue && <span>Found: {d.foundValue}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasNameIssue && (
        <div className="mb-3 flex items-start gap-2 text-xs rounded px-2 py-1.5 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{t('inbox_ops.contact.name_missing_warning', 'First and last name could not be extracted. Please edit before accepting.')}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div title={
          hasNameIssue
            ? t('inbox_ops.contact.name_missing_warning', 'First and last name could not be extracted. Please edit before accepting.')
            : hasBlockingDiscrepancies
              ? t('inbox_ops.action.accept_blocked', 'Resolve errors before accepting')
              : undefined
        }>
          <Button
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onAccept(action.id)}
            disabled={hasBlockingDiscrepancies || hasNameIssue}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.accept', 'Accept')}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => onEdit(action)}
        >
          <Pencil className="h-4 w-4 mr-1" />
          {t('inbox_ops.action.edit', 'Edit')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => onReject(action.id)}
        >
          <XCircle className="h-4 w-4 mr-1" />
          {t('inbox_ops.action.reject', 'Reject')}
        </Button>
      </div>
    </div>
  )
}
