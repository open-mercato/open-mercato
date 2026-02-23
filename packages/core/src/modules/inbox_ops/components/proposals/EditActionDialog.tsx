"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Loader2 } from 'lucide-react'
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
import type { ActionDetail } from './types'

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

export function EditActionDialog({
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
        setJsonError(t('inbox_ops.edit_dialog.invalid_json', 'Invalid JSON'))
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
                    setJsonError(t('inbox_ops.edit_dialog.invalid_json', 'Invalid JSON'))
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
