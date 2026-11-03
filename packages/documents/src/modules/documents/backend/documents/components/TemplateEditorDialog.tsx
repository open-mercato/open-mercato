"use client"

import * as React from 'react'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { getEntityRegistryEntry } from '../../../lib/entityRegistry'
import { TemplateBodyEditor } from './TemplateBodyEditor'
import { TemplateSlotsEditor, TEMPLATE_SLOT_KEY_PATTERN } from './TemplateSlotsEditor'
import type { TemplateContextSlot, TemplateRow } from './templateUi'
import { useTemplateDetail } from './useTemplateDetail'

export type DocumentTemplateContextSlot = TemplateContextSlot
export type DocumentTemplateRow = TemplateRow

type TemplateEditorDialogProps = {
  open: boolean
  template: TemplateRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function TemplateEditorDialog({ open, template, onOpenChange, onSaved }: TemplateEditorDialogProps) {
  const t = useT()
  const templateDetail = useTemplateDetail(open, template?.id ?? null)
  const nameInputId = React.useId()
  const descriptionInputId = React.useId()
  const activeInputId = React.useId()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [isActive, setIsActive] = React.useState(true)
  const [slots, setSlots] = React.useState<TemplateContextSlot[]>([])
  const [bodyHtml, setBodyHtml] = React.useState('<p></p>')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const submittingRef = React.useRef(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const mutationContextId = template ? `documents-template-editor:${template.id}` : 'documents-template-editor:new'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  React.useEffect(() => {
    if (!open) return
    if (template && !templateDetail.template) {
      setName('')
      setDescription('')
      setIsActive(true)
      setSlots([])
      setBodyHtml('<p></p>')
      setFormError(null)
      return
    }
    const source = templateDetail.template
    setName(source?.name ?? '')
    setDescription(source?.description ?? '')
    setIsActive(source?.isActive ?? true)
    setSlots(source?.contextSlots ?? [])
    setBodyHtml(source?.bodyHtml || '<p></p>')
    setFormError(null)
  }, [open, template, templateDetail.template])

  const tokenOptions = React.useMemo(() => {
    const options = ['{{date}}']
    for (const slot of slots) {
      const entry = getEntityRegistryEntry(slot.entityType)
      if (!entry || !TEMPLATE_SLOT_KEY_PATTERN.test(slot.slot)) continue
      options.push(...entry.tokenFields.map((field) => `{{${slot.slot}.${field.field}}}`), `{{${slot.slot}.chip}}`)
    }
    return options
  }, [slots])

  const save = React.useCallback(async () => {
    if (submittingRef.current) return
    const editingTemplate = templateDetail.template
    if (template && !editingTemplate) return
    if (!name.trim()) { setFormError(t('documents.templates.validation.nameRequired')); return }
    if (slots.some((slot) => !TEMPLATE_SLOT_KEY_PATTERN.test(slot.slot))) { setFormError(t('documents.templates.validation.fixSlots')); return }
    submittingRef.current = true
    setIsSubmitting(true)
    setFormError(null)
    const payload = {
      name: name.trim(), description: description.trim() || null, bodyHtml,
      contextSlots: slots.length > 0 ? slots.map((slot) => ({ ...slot, slot: slot.slot.trim(), required: slot.required || undefined })) : null,
      isActive,
    }
    try {
      await runMutation({
        operation: () => editingTemplate ? withScopedApiRequestHeaders(
          buildOptimisticLockHeader(editingTemplate.updatedAt),
          () => apiCallOrThrow(
            '/api/documents/templates',
            { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: editingTemplate.id, ...payload }) },
            { errorMessage: t('documents.templates.error.update') },
          ),
        ) : apiCallOrThrow(
          '/api/documents/templates',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
          { errorMessage: t('documents.templates.error.create') },
        ),
        context: { formId: mutationContextId, resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate, resourceId: editingTemplate?.id ?? 'new', retryLastMutation },
        mutationPayload: editingTemplate ? { id: editingTemplate.id, ...payload } : payload,
      })
      flash(t(editingTemplate ? 'documents.templates.success.update' : 'documents.templates.success.create'), 'success')
      onSaved()
      onOpenChange(false)
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: onSaved })) {
        flash(error instanceof Error ? error.message : t(editingTemplate ? 'documents.templates.error.update' : 'documents.templates.error.create'), 'error')
      }
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }, [bodyHtml, description, isActive, mutationContextId, name, onOpenChange, onSaved, retryLastMutation, runMutation, slots, t, template, templateDetail.template])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="overflow-y-auto" onKeyDown={(event) => {
        if (event.key === 'Escape') onOpenChange(false)
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void save() }
      }}>
        <DialogHeader>
          <DialogTitle>{t(template ? 'documents.templates.dialog.editTitle' : 'documents.templates.dialog.createTitle')}</DialogTitle>
          <DialogDescription>{t('documents.templates.dialog.description')}</DialogDescription>
        </DialogHeader>
        {template && templateDetail.isLoading ? <LoadingMessage label={t('documents.templates.instantiate.loading')} /> : null}
        {template && templateDetail.error ? (
          <ErrorMessage
            label={t('documents.templates.error.load')}
            action={<Button type="button" size="sm" variant="outline" onClick={templateDetail.retry}>{t('documents.actions.retry')}</Button>}
          />
        ) : null}
        {!template || templateDetail.template ? (
          <>
            <div className="grid gap-6 xl:grid-cols-3">
              <div className="space-y-4 xl:col-span-2">
                <div className="space-y-2"><Label htmlFor={nameInputId}>{t('documents.templates.fields.name')}</Label><Input id={nameInputId} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('documents.templates.fields.namePlaceholder')} aria-invalid={Boolean(formError && !name.trim())} /></div>
                <div className="space-y-2"><Label htmlFor={descriptionInputId}>{t('documents.templates.fields.description')}</Label><Textarea id={descriptionInputId} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('documents.templates.fields.descriptionPlaceholder')} maxLength={2000} showCount /></div>
                <TemplateBodyEditor bodyHtml={bodyHtml} tokenOptions={tokenOptions} onChange={setBodyHtml} />
              </div>
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"><Label htmlFor={activeInputId}>{t('documents.templates.fields.active')}</Label><Switch id={activeInputId} checked={isActive} onCheckedChange={setIsActive} aria-label={t('documents.templates.fields.active')} /></div>
                <TemplateSlotsEditor slots={slots} onChange={setSlots} />
              </div>
            </div>
            {formError ? <Alert status="error"><AlertDescription>{formError}</AlertDescription></Alert> : null}
          </>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>{t('documents.actions.cancel')}</Button>
          <Button type="button" onClick={() => void save()} disabled={isSubmitting || Boolean(template && !templateDetail.template)}>{t('documents.actions.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
