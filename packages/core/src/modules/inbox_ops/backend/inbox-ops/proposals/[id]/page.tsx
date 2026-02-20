"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Pencil,
  AlertTriangle,
  CheckCheck,
  Loader2,
  ExternalLink,
  RefreshCw,
  Package,
  Users,
  FileText,
  MessageSquare,
  Truck,
  UserPlus,
  Link2,
  Activity,
  ShoppingBag,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import type { ThreadMessage, ExtractedParticipant, InboxActionType, InboxDiscrepancyType } from '../../../../data/entities'

type ProposalDetail = {
  id: string
  summary: string
  confidence: string
  status: string
  participants: ExtractedParticipant[]
  possiblyIncomplete: boolean
  llmModel?: string
  createdAt: string
}

type ActionDetail = {
  id: string
  proposalId: string
  sortOrder: number
  actionType: InboxActionType
  description: string
  payload: Record<string, unknown>
  status: string
  confidence: string
  requiredFeature?: string
  createdEntityId?: string
  createdEntityType?: string
  executionError?: string
  executedAt?: string
}

type DiscrepancyDetail = {
  id: string
  type: InboxDiscrepancyType
  severity: string
  description: string
  expectedValue?: string
  foundValue?: string
  resolved: boolean
  actionId?: string
}

type EmailDetail = {
  id: string
  subject: string
  forwardedByAddress: string
  forwardedByName?: string
  cleanedText?: string
  threadMessages?: ThreadMessage[]
  status: string
  processingError?: string
  receivedAt: string
}

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

function useActionTypeLabels(): Record<string, string> {
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

function ConfidenceBadge({ value }: { value: string }) {
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

function EmailThreadViewer({ email }: { email: EmailDetail | null }) {
  const t = useT()
  if (!email) return null

  const messages = email.threadMessages || []

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm">{t('inbox_ops.email_thread', 'Email Thread')}</h3>
      {messages.length > 0 ? (
        messages.map((msg, index) => (
          <div key={index} className="border rounded-lg p-3 md:p-4 bg-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {msg.from?.name || msg.from?.email || 'Unknown'}
                </div>
                <div className="text-xs text-muted-foreground truncate">{msg.from?.email}</div>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {msg.date ? new Date(msg.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
            <div className="text-sm whitespace-pre-wrap text-foreground/80">{msg.body}</div>
          </div>
        ))
      ) : email.cleanedText ? (
        <div className="border rounded-lg p-3 md:p-4 bg-card">
          <div className="text-sm whitespace-pre-wrap text-foreground/80">{email.cleanedText}</div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('inbox_ops.no_email_content', 'No email content available')}</p>
      )}
    </div>
  )
}

function ActionCard({
  action,
  discrepancies,
  actionTypeLabels,
  onAccept,
  onReject,
  onRetry,
  onEdit,
}: {
  action: ActionDetail
  discrepancies: DiscrepancyDetail[]
  actionTypeLabels: Record<string, string>
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRetry: (id: string) => void
  onEdit: (action: ActionDetail) => void
}) {
  const t = useT()
  const Icon = ACTION_TYPE_ICONS[action.actionType] || Package
  const label = actionTypeLabels[action.actionType] || action.actionType

  const actionDiscrepancies = discrepancies.filter((d) => d.actionId === action.id && !d.resolved)
  const hasBlockingDiscrepancies = actionDiscrepancies.some((d) => d.severity === 'error')

  if (action.status === 'executed') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-green-50 dark:bg-green-950/20">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <p className="text-sm text-muted-foreground">{action.description}</p>
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
        <p className="text-sm text-muted-foreground">{action.description}</p>
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
        <p className="text-sm text-muted-foreground">{action.description}</p>
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

  return (
    <div className="border rounded-lg p-3 md:p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-5 w-5 text-primary flex-shrink-0" />
        <span className="text-sm font-medium">{label}</span>
        <ConfidenceBadge value={action.confidence} />
      </div>
      <p className="text-sm text-foreground/80 mb-2">{action.description}</p>

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

      <div className="flex items-center gap-2">
        <div title={hasBlockingDiscrepancies ? t('inbox_ops.action.accept_blocked', 'Resolve errors before accepting') : undefined}>
          <Button
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onAccept(action.id)}
            disabled={hasBlockingDiscrepancies}
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

function EditActionDialog({
  action,
  actionTypeLabels,
  onClose,
  onSaved,
}: {
  action: ActionDetail
  actionTypeLabels: Record<string, string>
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const [payload, setPayload] = React.useState<Record<string, unknown>>(
    () => structuredClone(action.payload),
  )
  const [isSaving, setIsSaving] = React.useState(false)
  const [jsonMode, setJsonMode] = React.useState(false)
  const [jsonText, setJsonText] = React.useState(() => JSON.stringify(action.payload, null, 2))
  const [jsonError, setJsonError] = React.useState<string | null>(null)

  const handleSave = React.useCallback(async () => {
    let finalPayload = payload
    if (jsonMode) {
      try {
        finalPayload = JSON.parse(jsonText)
        setJsonError(null)
      } catch {
        setJsonError('Invalid JSON')
        return
      }
    }

    setIsSaving(true)
    const result = await apiCall<{ ok: boolean; error?: string }>(
      `/api/inbox_ops/proposals/${action.proposalId}/actions/${action.id}`,
      { method: 'PATCH', body: JSON.stringify({ payload: finalPayload }) },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.edit_dialog.saved', 'Action updated successfully'), 'success')
      onSaved()
      onClose()
    } else {
      flash(result?.result?.error || t('inbox_ops.flash.save_failed', 'Failed to save'), 'error')
    }
    setIsSaving(false)
  }, [action, payload, jsonMode, jsonText, t, onSaved, onClose])

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave])

  const updateField = (key: string, value: unknown) => {
    setPayload((prev) => ({ ...prev, [key]: value }))
  }

  const label = actionTypeLabels[action.actionType] || action.actionType
  const hasTypedEditor = [
    'create_order', 'create_quote', 'update_order', 'update_shipment', 'create_contact', 'link_contact', 'log_activity', 'draft_reply',
  ].includes(action.actionType)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-2xl sm:max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>{t('inbox_ops.edit_dialog.title', 'Edit Action')}: {label}</DialogTitle>
          <DialogDescription>{action.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] py-2">
          {hasTypedEditor && !jsonMode && (
            <>
              {action.actionType === 'update_order' && (
                <UpdateOrderPayloadEditor payload={payload} updateField={updateField} />
              )}
              {action.actionType === 'update_shipment' && (
                <ShipmentPayloadEditor payload={payload} updateField={updateField} />
              )}
              {action.actionType === 'create_contact' && (
                <ContactPayloadEditor payload={payload} updateField={updateField} />
              )}
              {action.actionType === 'link_contact' && (
                <LinkContactPayloadEditor payload={payload} updateField={updateField} />
              )}
              {action.actionType === 'log_activity' && (
                <LogActivityPayloadEditor payload={payload} updateField={updateField} />
              )}
              {action.actionType === 'draft_reply' && (
                <DraftReplyPayloadEditor payload={payload} updateField={updateField} />
              )}
            </>
          )}

          {(!hasTypedEditor || jsonMode) && (
            <div className="space-y-2">
              <Label>{t('inbox_ops.edit_dialog.payload_json', 'Payload (JSON)')}</Label>
              <Textarea
                className="font-mono text-xs min-h-[200px]"
                value={jsonText}
                onChange={(event) => {
                  setJsonText(event.target.value)
                  setJsonError(null)
                }}
              />
              {jsonError && <p className="text-xs text-red-600">{t('inbox_ops.edit_dialog.invalid_json', 'Invalid JSON')}</p>}
            </div>
          )}

          {hasTypedEditor && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!jsonMode) {
                  setJsonText(JSON.stringify(payload, null, 2))
                } else {
                  try {
                    setPayload(JSON.parse(jsonText))
                    setJsonError(null)
                  } catch {
                    setJsonError('Invalid JSON')
                    return
                  }
                }
                setJsonMode(!jsonMode)
              }}
            >
              {jsonMode ? t('inbox_ops.edit_dialog.form_view', 'Form view') : t('inbox_ops.edit_dialog.json_view', 'JSON view')}
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t('inbox_ops.edit_dialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t('inbox_ops.edit_dialog.save', 'Save Changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ShipmentPayloadEditor({
  payload,
  updateField,
}: {
  payload: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}) {
  const t = useT()
  const trackingNumbers = ((payload.trackingNumbers as string[]) || []).join(', ')

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.carrier', 'Carrier')}</Label>
          <Input value={(payload.carrierName as string) || ''} onChange={(event) => updateField('carrierName', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.status', 'Status')}</Label>
          <Input value={(payload.statusLabel as string) || ''} onChange={(event) => updateField('statusLabel', event.target.value)} />
        </div>
      </div>
      <div>
        <Label>{t('inbox_ops.edit_dialog.tracking_numbers', 'Tracking Numbers')}</Label>
        <Input
          value={trackingNumbers}
          onChange={(event) => updateField('trackingNumbers', event.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder={t('inbox_ops.placeholder.comma_separated', 'Comma-separated')}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.shipped_at', 'Shipped At')}</Label>
          <Input value={(payload.shippedAt as string) || ''} onChange={(event) => updateField('shippedAt', event.target.value)} placeholder="YYYY-MM-DD" />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.estimated_delivery', 'Estimated Delivery')}</Label>
          <Input value={(payload.estimatedDelivery as string) || ''} onChange={(event) => updateField('estimatedDelivery', event.target.value)} placeholder="YYYY-MM-DD" />
        </div>
      </div>
      <div>
        <Label>{t('inbox_ops.edit_dialog.notes', 'Notes')}</Label>
        <Textarea value={(payload.notes as string) || ''} onChange={(event) => updateField('notes', event.target.value)} rows={2} />
      </div>
    </div>
  )
}

function ContactPayloadEditor({
  payload,
  updateField,
}: {
  payload: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}) {
  const t = useT()
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.name', 'Name')}</Label>
          <Input value={(payload.name as string) || ''} onChange={(event) => updateField('name', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.type', 'Type')}</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={(payload.type as string) || 'person'}
            onChange={(event) => updateField('type', event.target.value)}
          >
            <option value="person">{t('inbox_ops.contact_type.person', 'Person')}</option>
            <option value="company">{t('inbox_ops.contact_type.company', 'Company')}</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.email', 'Email')}</Label>
          <Input value={(payload.email as string) || ''} onChange={(event) => updateField('email', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.phone', 'Phone')}</Label>
          <Input value={(payload.phone as string) || ''} onChange={(event) => updateField('phone', event.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.company_name', 'Company Name')}</Label>
          <Input value={(payload.companyName as string) || ''} onChange={(event) => updateField('companyName', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.role', 'Role')}</Label>
          <Input value={(payload.role as string) || ''} onChange={(event) => updateField('role', event.target.value)} />
        </div>
      </div>
    </div>
  )
}

function LinkContactPayloadEditor({
  payload,
  updateField,
}: {
  payload: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}) {
  const t = useT()
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.email', 'Email')}</Label>
          <Input value={(payload.emailAddress as string) || ''} onChange={(event) => updateField('emailAddress', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.contact_id', 'Contact ID')}</Label>
          <Input value={(payload.contactId as string) || ''} onChange={(event) => updateField('contactId', event.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.contact_type', 'Contact Type')}</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={(payload.contactType as string) || 'person'}
            onChange={(event) => updateField('contactType', event.target.value)}
          >
            <option value="person">{t('inbox_ops.contact_type.person', 'Person')}</option>
            <option value="company">{t('inbox_ops.contact_type.company', 'Company')}</option>
          </select>
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.contact_name', 'Contact Name')}</Label>
          <Input value={(payload.contactName as string) || ''} onChange={(event) => updateField('contactName', event.target.value)} />
        </div>
      </div>
    </div>
  )
}

function DraftReplyPayloadEditor({
  payload,
  updateField,
}: {
  payload: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}) {
  const t = useT()
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.to', 'To')}</Label>
          <Input value={(payload.to as string) || ''} onChange={(event) => updateField('to', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.to_name', 'To Name')}</Label>
          <Input value={(payload.toName as string) || ''} onChange={(event) => updateField('toName', event.target.value)} />
        </div>
      </div>
      <div>
        <Label>{t('inbox_ops.edit_dialog.subject', 'Subject')}</Label>
        <Input value={(payload.subject as string) || ''} onChange={(event) => updateField('subject', event.target.value)} />
      </div>
      <div>
        <Label>{t('inbox_ops.edit_dialog.body', 'Body')}</Label>
        <Textarea value={(payload.body as string) || ''} onChange={(event) => updateField('body', event.target.value)} rows={6} />
      </div>
    </div>
  )
}

function UpdateOrderPayloadEditor({
  payload,
  updateField,
}: {
  payload: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}) {
  const t = useT()
  const quantityChanges = (payload.quantityChanges as Record<string, unknown>[]) || []
  const deliveryDateChange = (payload.deliveryDateChange as Record<string, unknown>) || {}
  const noteAdditions = Array.isArray(payload.noteAdditions) ? (payload.noteAdditions as string[]).join('\n') : ''

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.order_id', 'Order ID')}</Label>
          <Input value={(payload.orderId as string) || ''} onChange={(event) => updateField('orderId', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.order_number', 'Order Number')}</Label>
          <Input value={(payload.orderNumber as string) || ''} onChange={(event) => updateField('orderNumber', event.target.value)} />
        </div>
      </div>

      {quantityChanges.length > 0 && (
        <div>
          <Label className="mb-1 block">{t('inbox_ops.edit_dialog.quantity_changes', 'Quantity Changes')}</Label>
          <div className="space-y-2">
            {quantityChanges.map((change, index) => (
              <div key={index} className="border rounded p-2 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">{t('inbox_ops.edit_dialog.line_item', 'Line Item')}</Label>
                    <Input
                      className="h-8 text-sm"
                      value={(change.lineItemName as string) || ''}
                      onChange={(event) => {
                        const arr = [...quantityChanges]
                        arr[index] = { ...arr[index], lineItemName: event.target.value }
                        updateField('quantityChanges', arr)
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('inbox_ops.edit_dialog.old_qty', 'Old Qty')}</Label>
                    <Input
                      className="h-8 text-sm"
                      value={(change.oldQuantity as string) || ''}
                      onChange={(event) => {
                        const arr = [...quantityChanges]
                        arr[index] = { ...arr[index], oldQuantity: event.target.value }
                        updateField('quantityChanges', arr)
                      }}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('inbox_ops.edit_dialog.new_qty', 'New Qty')}</Label>
                    <Input
                      className="h-8 text-sm"
                      value={(change.newQuantity as string) || ''}
                      onChange={(event) => {
                        const arr = [...quantityChanges]
                        arr[index] = { ...arr[index], newQuantity: event.target.value }
                        updateField('quantityChanges', arr)
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Boolean(deliveryDateChange.oldDate || deliveryDateChange.newDate) && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('inbox_ops.edit_dialog.old_delivery_date', 'Old Delivery Date')}</Label>
            <Input
              value={(deliveryDateChange.oldDate as string) || ''}
              onChange={(event) => updateField('deliveryDateChange', { ...deliveryDateChange, oldDate: event.target.value })}
              placeholder="YYYY-MM-DD"
            />
          </div>
          <div>
            <Label>{t('inbox_ops.edit_dialog.new_delivery_date', 'New Delivery Date')}</Label>
            <Input
              value={(deliveryDateChange.newDate as string) || ''}
              onChange={(event) => updateField('deliveryDateChange', { ...deliveryDateChange, newDate: event.target.value })}
              placeholder="YYYY-MM-DD"
            />
          </div>
        </div>
      )}

      <div>
        <Label>{t('inbox_ops.edit_dialog.note_additions', 'Notes')}</Label>
        <Textarea
          value={noteAdditions}
          onChange={(event) => {
            const lines = event.target.value.split('\n').filter(Boolean)
            updateField('noteAdditions', lines.length > 0 ? lines : undefined)
          }}
          rows={2}
          placeholder={t('inbox_ops.placeholder.one_note_per_line', 'One note per line')}
        />
      </div>
    </div>
  )
}

function LogActivityPayloadEditor({
  payload,
  updateField,
}: {
  payload: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}) {
  const t = useT()
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t('inbox_ops.edit_dialog.contact_name', 'Contact Name')}</Label>
          <Input value={(payload.contactName as string) || ''} onChange={(event) => updateField('contactName', event.target.value)} />
        </div>
        <div>
          <Label>{t('inbox_ops.edit_dialog.contact_type', 'Contact Type')}</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={(payload.contactType as string) || 'person'}
            onChange={(event) => updateField('contactType', event.target.value)}
          >
            <option value="person">{t('inbox_ops.contact_type.person', 'Person')}</option>
            <option value="company">{t('inbox_ops.contact_type.company', 'Company')}</option>
          </select>
        </div>
      </div>
      <div>
        <Label>{t('inbox_ops.edit_dialog.activity_type', 'Activity Type')}</Label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          value={(payload.activityType as string) || 'email'}
          onChange={(event) => updateField('activityType', event.target.value)}
        >
          <option value="email">{t('inbox_ops.activity_type.email', 'Email')}</option>
          <option value="call">{t('inbox_ops.activity_type.call', 'Call')}</option>
          <option value="meeting">{t('inbox_ops.activity_type.meeting', 'Meeting')}</option>
          <option value="note">{t('inbox_ops.activity_type.note', 'Note')}</option>
        </select>
      </div>
      <div>
        <Label>{t('inbox_ops.edit_dialog.subject', 'Subject')}</Label>
        <Input value={(payload.subject as string) || ''} onChange={(event) => updateField('subject', event.target.value)} />
      </div>
      <div>
        <Label>{t('inbox_ops.edit_dialog.body', 'Body')}</Label>
        <Textarea value={(payload.body as string) || ''} onChange={(event) => updateField('body', event.target.value)} rows={6} />
      </div>
    </div>
  )
}

export default function ProposalDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const proposalId = params?.id

  const [proposal, setProposal] = React.useState<ProposalDetail | null>(null)
  const [actions, setActions] = React.useState<ActionDetail[]>([])
  const [discrepancies, setDiscrepancies] = React.useState<DiscrepancyDetail[]>([])
  const [email, setEmail] = React.useState<EmailDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isProcessing, setIsProcessing] = React.useState(false)

  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const actionTypeLabels = useActionTypeLabels()
  const [editingAction, setEditingAction] = React.useState<ActionDetail | null>(null)
  const [sendingReplyId, setSendingReplyId] = React.useState<string | null>(null)

  const handleEditAction = React.useCallback((action: ActionDetail) => {
    if (action.actionType === 'create_order' || action.actionType === 'create_quote') {
      const kind = action.actionType === 'create_order' ? 'order' : 'quote'
      try {
        sessionStorage.setItem(
          'inbox_ops.orderDraft',
          JSON.stringify({
            actionId: action.id,
            proposalId: action.proposalId,
            payload: action.payload,
          }),
        )
      } catch { /* sessionStorage unavailable */ }
      router.push(`/backend/sales/documents/create?kind=${kind}&fromInboxAction=${encodeURIComponent(action.id)}`)
      return
    }
    if (action.actionType === 'create_product') {
      try {
        sessionStorage.setItem(
          'inbox_ops.productDraft',
          JSON.stringify({
            actionId: action.id,
            proposalId: action.proposalId,
            payload: action.payload,
          }),
        )
      } catch { /* sessionStorage unavailable */ }
      router.push(`/backend/catalog/products/create?fromInboxAction=${encodeURIComponent(action.id)}`)
      return
    }
    setEditingAction(action)
  }, [router])

  const loadData = React.useCallback(async () => {
    if (!proposalId) return
    setIsLoading(true)
    const result = await apiCall<{
      proposal: ProposalDetail
      actions: ActionDetail[]
      discrepancies: DiscrepancyDetail[]
      email: EmailDetail
    }>(`/api/inbox_ops/proposals/${proposalId}`)
    if (result?.ok && result.result) {
      setProposal(result.result.proposal)
      setActions(result.result.actions || [])
      setDiscrepancies(result.result.discrepancies || [])
      setEmail(result.result.email)
    }
    setIsLoading(false)
  }, [proposalId])

  React.useEffect(() => { loadData() }, [loadData])

  const handleAcceptAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean; error?: string }>(
      `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/accept`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.action_executed', 'Action executed'), 'success')
      await loadData()
    } else {
      flash(result?.result?.error || t('inbox_ops.flash.action_execute_failed', 'Failed to execute action'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData, t])

  const handleRejectAction = React.useCallback(async (actionId: string) => {
    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean }>(
      `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}/reject`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.action_rejected', 'Action rejected'), 'success')
      await loadData()
    } else {
      flash(t('inbox_ops.flash.action_reject_failed', 'Failed to reject action'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, loadData])

  const handleAcceptAll = React.useCallback(async () => {
    const pendingCount = actions.filter((a) => a.status === 'pending').length
    const confirmed = await confirm({
      title: t('inbox_ops.action.accept_all', 'Accept All'),
      text: t('inbox_ops.action.accept_all_confirm', `Execute ${pendingCount} pending actions?`).replace('{count}', String(pendingCount)),
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean; succeeded: number; failed: number }>(
      `/api/inbox_ops/proposals/${proposalId}/accept-all`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.accept_all_success', '{succeeded} actions executed')
        .replace('{succeeded}', String(result.result.succeeded))
        + (result.result.failed > 0 ? `, ${result.result.failed} failed` : ''), 'success')
      await loadData()
    } else {
      flash(t('inbox_ops.flash.accept_all_failed', 'Failed to accept all actions'), 'error')
    }
    setIsProcessing(false)
  }, [proposalId, actions, confirm, t, loadData])

  const handleRejectAll = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('inbox_ops.action.reject_all', 'Reject Proposal'),
      text: t('inbox_ops.action.reject_all_confirm', 'Reject all pending actions in this proposal?'),
    })
    if (!confirmed) return

    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean }>(
      `/api/inbox_ops/proposals/${proposalId}/reject`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.action.proposal_rejected', 'Proposal rejected'), 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [proposalId, confirm, t, loadData])

  const handleRetryExtraction = React.useCallback(async () => {
    if (!email) return
    setIsProcessing(true)
    const result = await apiCall<{ ok: boolean }>(
      `/api/inbox_ops/emails/${email.id}/reprocess`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.flash.reprocessing_started', 'Reprocessing started'), 'success')
      await loadData()
    }
    setIsProcessing(false)
  }, [email, loadData])

  const handleSendReply = React.useCallback(async (actionId: string) => {
    setSendingReplyId(actionId)
    const result = await apiCall<{ ok: boolean; error?: string }>(
      `/api/inbox_ops/proposals/${proposalId}/replies/${actionId}/send`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.reply.sent_success', 'Reply sent successfully'), 'success')
      await loadData()
    } else {
      flash(result?.result?.error || t('inbox_ops.flash.send_reply_failed', 'Failed to send reply'), 'error')
    }
    setSendingReplyId(null)
  }, [proposalId, t, loadData])

  if (isLoading) return <LoadingMessage label={t('inbox_ops.loading_proposal', 'Loading proposal...')} />

  const pendingActions = actions.filter((a) => a.status === 'pending')
  const emailIsProcessing = email?.status === 'processing'
  const emailFailed = email?.status === 'failed'

  return (
    <Page>
      {ConfirmDialogElement}
      {editingAction && (
        <EditActionDialog
          action={editingAction}
          actionTypeLabels={actionTypeLabels}
          onClose={() => setEditingAction(null)}
          onSaved={loadData}
        />
      )}

      <div className="flex items-center justify-between px-3 py-3 md:px-6 md:py-4 border-b">
        <div className="flex items-center gap-3">
          <Link href="/backend/inbox-ops">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold truncate">{email?.subject || 'Proposal'}</h1>
            <p className="text-xs text-muted-foreground">
              {email?.forwardedByName || email?.forwardedByAddress} · {email?.receivedAt && new Date(email.receivedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pendingActions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 md:h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={handleRejectAll}
              disabled={isProcessing}
            >
              <XCircle className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">{t('inbox_ops.action.reject_all', 'Reject Proposal')}</span>
            </Button>
          )}
          {pendingActions.length > 1 && (
            <Button size="sm" className="h-11 md:h-9" onClick={handleAcceptAll} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCheck className="h-4 w-4 mr-1" />}
              <span className="hidden md:inline">{t('inbox_ops.action.accept_all', 'Accept All')}</span>
            </Button>
          )}
        </div>
      </div>

      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* Left panel: Email Thread */}
          <div>
            <EmailThreadViewer email={email} />
          </div>

          {/* Right panel: Summary + Actions */}
          <div className="space-y-4">
            {emailIsProcessing ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                <p className="text-sm text-muted-foreground">{t('inbox_ops.extraction_loading', 'AI is analyzing this thread...')}</p>
              </div>
            ) : emailFailed ? (
              <div className="border rounded-lg p-4 bg-red-50 dark:bg-red-950/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <span className="text-sm font-medium text-red-700">{t('inbox_ops.extraction_failed', 'Extraction failed')}</span>
                </div>
                {email?.processingError && (
                  <p className="text-xs text-red-600 mb-3">{email.processingError}</p>
                )}
                <Button size="sm" variant="outline" onClick={handleRetryExtraction} disabled={isProcessing}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  {t('inbox_ops.action.retry', 'Retry')}
                </Button>
              </div>
            ) : proposal ? (
              <>
                {/* Summary */}
                <div className="border rounded-lg p-3 md:p-4">
                  <h3 className="font-semibold text-sm mb-2">{t('inbox_ops.summary', 'Summary')}</h3>
                  <p className="text-sm text-foreground/80 mb-3">{proposal.summary}</p>

                  <div className="flex items-center gap-4 mb-3">
                    <div>
                      <span className="text-xs text-muted-foreground">{t('inbox_ops.confidence', 'Confidence')}</span>
                      <ConfidenceBadge value={proposal.confidence} />
                    </div>
                  </div>

                  {proposal.possiblyIncomplete && (
                    <div className="flex items-center gap-2 text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-950/20 rounded px-2 py-1 mb-3">
                      <AlertTriangle className="h-3 w-3" />
                      {t('inbox_ops.possibly_incomplete', 'This thread appears to be a partial forward')}
                    </div>
                  )}

                  {/* Participants */}
                  {proposal.participants.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">{t('inbox_ops.participants', 'Participants')}</h4>
                      <div className="space-y-1">
                        {proposal.participants.map((p, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm">
                            <Users className="h-3 w-3 text-muted-foreground" />
                            <span>{p.name}</span>
                            <span className="text-xs text-muted-foreground">({p.role})</span>
                            {p.matchedContactId && <CheckCircle className="h-3 w-3 text-green-500" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Discrepancies not tied to a specific action */}
                {(() => {
                  const actionIds = new Set(actions.map((a) => a.id))
                  const general = discrepancies.filter((d) => !d.resolved && (!d.actionId || !actionIds.has(d.actionId)))
                  if (general.length === 0) return null
                  return (
                    <div className="border rounded-lg p-3 md:p-4 bg-yellow-50 dark:bg-yellow-950/20">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <h3 className="font-semibold text-sm text-yellow-800 dark:text-yellow-300">{t('inbox_ops.discrepancies', 'Issues Detected')}</h3>
                      </div>
                      <div className="space-y-1.5">
                        {general.map((d) => (
                          <div key={d.id} className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
                            d.severity === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-950/30' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/30'
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
                    </div>
                  )
                })()}

                {/* Actions */}
                <div>
                  <h3 className="font-semibold text-sm mb-2">{t('inbox_ops.actions', 'Proposed Actions')}</h3>
                  {actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('inbox_ops.no_actions', 'No actionable items detected in this thread')}</p>
                  ) : (
                    <div className="space-y-3">
                      {actions.map((action) => (
                        <div key={action.id}>
                          <ActionCard
                            action={action}
                            discrepancies={discrepancies}
                            actionTypeLabels={actionTypeLabels}
                            onAccept={handleAcceptAction}
                            onReject={handleRejectAction}
                            onRetry={handleAcceptAction}
                            onEdit={handleEditAction}
                          />
                          {action.actionType === 'draft_reply' && (action.status === 'executed' || action.status === 'accepted') && (
                            <div className="mt-2 pl-7">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-11 md:h-9"
                                disabled={sendingReplyId === action.id}
                                onClick={() => handleSendReply(action.id)}
                              >
                                {sendingReplyId === action.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                ) : (
                                  <ExternalLink className="h-4 w-4 mr-1" />
                                )}
                                {sendingReplyId === action.id
                                  ? t('inbox_ops.reply.sending', 'Sending...')
                                  : t('inbox_ops.reply.send', 'Send Reply')}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
