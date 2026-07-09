"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { Bold, Heading1, Heading2, Italic, List, ListOrdered, Plus, Trash2 } from 'lucide-react'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { getDocumentEditorExtensions } from '../../../lib/editorConfig'
import {
  DOCUMENT_ENTITY_REGISTRY,
  getEntityRegistryEntry,
  type DocumentEntityType,
} from '../../../lib/entityRegistry'

export type DocumentTemplateContextSlot = {
  slot: string
  entityType: DocumentEntityType
  required?: boolean
}

export type DocumentTemplateRow = {
  id: string
  name: string
  description: string | null
  bodyHtml: string
  contextSlots: DocumentTemplateContextSlot[] | null
  isActive: boolean
  updatedAt: string
  createdAt: string
}

type TemplateEditorDialogProps = {
  open: boolean
  template: DocumentTemplateRow | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type ToolbarButtonProps = {
  label: string
  icon: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

type TemplateMutationResponse = {
  id?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

const SLOT_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*$/
const DEFAULT_BODY_HTML = '<p></p>'

const ENTITY_TYPE_FALLBACKS: Record<DocumentEntityType, string> = {
  'customer-person': 'Customer person',
  'customer-company': 'Customer company',
  deal: 'Deal',
  product: 'Product',
  quote: 'Quote',
}

function toSlotBase(entityType: DocumentEntityType): string {
  const parts = entityType.split('-')
  const [first = 'slot', ...rest] = parts
  return [
    first,
    ...rest.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)),
  ].join('')
}

function deriveSlotKey(entityType: DocumentEntityType, slots: DocumentTemplateContextSlot[], excludeIndex?: number): string {
  const base = toSlotBase(entityType)
  const existing = new Set(
    slots
      .filter((_, index) => index !== excludeIndex)
      .map((slot) => slot.slot)
      .filter(Boolean),
  )
  if (!existing.has(base)) return base
  let ordinal = 2
  while (existing.has(`${base}${ordinal}`)) ordinal += 1
  return `${base}${ordinal}`
}

function normalizeSlots(slots: DocumentTemplateContextSlot[]): DocumentTemplateContextSlot[] | null {
  const normalized = slots
    .map((slot) => ({
      slot: slot.slot.trim(),
      entityType: slot.entityType,
      required: slot.required ? true : undefined,
    }))
    .filter((slot) => slot.slot.length > 0)
  return normalized.length > 0 ? normalized : null
}

function ToolbarButton({ label, icon, active = false, disabled = false, onClick }: ToolbarButtonProps) {
  return (
    <IconButton
      type="button"
      variant={active ? 'outline' : 'ghost'}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </IconButton>
  )
}

function runEditorCommand(editor: Editor | null, command: (editor: Editor) => void): void {
  if (!editor) return
  command(editor)
}

export function TemplateEditorDialog({ open, template, onOpenChange, onSaved }: TemplateEditorDialogProps) {
  const t = useT()
  const nameInputId = React.useId()
  const descriptionInputId = React.useId()
  const activeInputId = React.useId()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [isActive, setIsActive] = React.useState(true)
  const [contextSlots, setContextSlots] = React.useState<DocumentTemplateContextSlot[]>([])
  const [bodyHtml, setBodyHtml] = React.useState(DEFAULT_BODY_HTML)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [insertTokenValue, setInsertTokenValue] = React.useState<string | undefined>(undefined)
  const isEditMode = template !== null
  const mutationContextId = template ? `documents-template-editor:${template.id}` : 'documents-template-editor:new'

  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const editor = useEditor({
    extensions: getDocumentEditorExtensions(),
    content: bodyHtml,
    editable: true,
    editorProps: {
      attributes: {
        class: 'min-h-80 text-base leading-7 text-foreground focus-visible:outline-none',
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      setBodyHtml(updatedEditor.getHTML())
    },
  }, [])

  React.useEffect(() => {
    if (!open) return
    const nextBodyHtml = template?.bodyHtml || DEFAULT_BODY_HTML
    setName(template?.name ?? '')
    setDescription(template?.description ?? '')
    setIsActive(template?.isActive ?? true)
    setContextSlots(template?.contextSlots ?? [])
    setBodyHtml(nextBodyHtml)
    setFormError(null)
    editor?.commands.setContent(nextBodyHtml)
  }, [editor, open, template])

  const slotError = React.useCallback((slot: DocumentTemplateContextSlot): string | null => {
    if (slot.slot.length === 0) return t(
      'documents.templates.validation.slotRequired',
      'Slot key is required.',
    )
    if (!SLOT_KEY_PATTERN.test(slot.slot)) return t(
      'documents.templates.validation.slotKey',
      'Use a camelCase key that starts with a lowercase letter.',
    )
    return null
  }, [t])

  const hasSlotErrors = React.useMemo(
    () => contextSlots.some((slot) => slotError(slot) !== null),
    [contextSlots, slotError],
  )

  const tokenOptions = React.useMemo(() => {
    const options: string[] = ['{{date}}']
    for (const slot of contextSlots) {
      const entry = getEntityRegistryEntry(slot.entityType)
      if (!entry || !slot.slot || !SLOT_KEY_PATTERN.test(slot.slot)) continue
      for (const tokenField of entry.tokenFields) {
        options.push(`{{${slot.slot}.${tokenField.field}}}`)
      }
      options.push(`{{${slot.slot}.chip}}`)
    }
    return options
  }, [contextSlots])

  const handleAddSlot = React.useCallback(() => {
    const entityType = DOCUMENT_ENTITY_REGISTRY[0]?.type ?? 'customer-person'
    setContextSlots((current) => [
      ...current,
      { slot: deriveSlotKey(entityType, current), entityType, required: true },
    ])
  }, [])

  const handleSave = React.useCallback(async () => {
    const trimmedName = name.trim()
    const nextBodyHtml = editor?.getHTML() ?? bodyHtml
    if (!trimmedName) {
      setFormError(t('documents.templates.validation.nameRequired', 'Template name is required.'))
      return
    }
    if (hasSlotErrors) {
      setFormError(t('documents.templates.validation.fixSlots', 'Fix the slot keys before saving.'))
      return
    }

    setIsSubmitting(true)
    setFormError(null)
    const payload = {
      name: trimmedName,
      description: description.trim().length > 0 ? description.trim() : null,
      bodyHtml: nextBodyHtml,
      contextSlots: normalizeSlots(contextSlots),
      isActive,
    }

    try {
      if (template) {
        await runMutation({
          operation: async () =>
            withScopedApiRequestHeaders(
              buildOptimisticLockHeader(template.updatedAt),
              () => apiCallOrThrow<TemplateMutationResponse>(
                '/api/documents/templates',
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ id: template.id, ...payload }),
                },
                { errorMessage: t('documents.templates.error.update', 'Failed to update template.') },
              ),
            ),
          context: {
            formId: mutationContextId,
            resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
            resourceId: template.id,
            retryLastMutation,
          },
          mutationPayload: { id: template.id, ...payload },
        })
        flash(t('documents.templates.success.update', 'Template updated.'), 'success')
      } else {
        await runMutation({
          operation: async () =>
            apiCallOrThrow<TemplateMutationResponse>(
              '/api/documents/templates',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              },
              { errorMessage: t('documents.templates.error.create', 'Failed to create template.') },
            ),
          context: {
            formId: mutationContextId,
            resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
            resourceId: 'new',
            retryLastMutation,
          },
          mutationPayload: payload,
        })
        flash(t('documents.templates.success.create', 'Template created.'), 'success')
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      const fallback = template
        ? t('documents.templates.error.update', 'Failed to update template.')
        : t('documents.templates.error.create', 'Failed to create template.')
      flash(err instanceof Error ? err.message : fallback, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    bodyHtml,
    contextSlots,
    description,
    editor,
    hasSlotErrors,
    isActive,
    mutationContextId,
    name,
    onOpenChange,
    onSaved,
    retryLastMutation,
    runMutation,
    t,
    template,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="overflow-y-auto"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onOpenChange(false)
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleSave()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditMode
              ? t('documents.templates.dialog.editTitle', 'Edit template')
              : t('documents.templates.dialog.createTitle', 'New template')}
          </DialogTitle>
          <DialogDescription>
            {t('documents.templates.dialog.description', 'Build a reusable document body with entity tokens.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <div className="space-y-2">
              <Label htmlFor={nameInputId}>{t('documents.templates.fields.name', 'Name')}</Label>
              <Input
                id={nameInputId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('documents.templates.fields.namePlaceholder', 'Template name')}
                aria-invalid={formError !== null && name.trim().length === 0}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={descriptionInputId}>{t('documents.templates.fields.description', 'Description')}</Label>
              <Textarea
                id={descriptionInputId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('documents.templates.fields.descriptionPlaceholder', 'What this template is for')}
                maxLength={2000}
                showCount
              />
            </div>

            <div className="space-y-3">
              <Label>{t('documents.templates.fields.body', 'Body')}</Label>
              <div className="rounded-md border border-border bg-card">
                <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
                  <ToolbarButton
                    label={t('documents.editor.toolbar.bold')}
                    icon={<Bold />}
                    active={editor?.isActive('bold') ?? false}
                    disabled={!editor}
                    onClick={() => runEditorCommand(editor, (currentEditor) => currentEditor.chain().focus().toggleBold().run())}
                  />
                  <ToolbarButton
                    label={t('documents.editor.toolbar.italic')}
                    icon={<Italic />}
                    active={editor?.isActive('italic') ?? false}
                    disabled={!editor}
                    onClick={() => runEditorCommand(editor, (currentEditor) => currentEditor.chain().focus().toggleItalic().run())}
                  />
                  <ToolbarButton
                    label={t('documents.editor.toolbar.heading1')}
                    icon={<Heading1 />}
                    active={editor?.isActive('heading', { level: 1 }) ?? false}
                    disabled={!editor}
                    onClick={() => runEditorCommand(editor, (currentEditor) => currentEditor.chain().focus().toggleHeading({ level: 1 }).run())}
                  />
                  <ToolbarButton
                    label={t('documents.editor.toolbar.heading2')}
                    icon={<Heading2 />}
                    active={editor?.isActive('heading', { level: 2 }) ?? false}
                    disabled={!editor}
                    onClick={() => runEditorCommand(editor, (currentEditor) => currentEditor.chain().focus().toggleHeading({ level: 2 }).run())}
                  />
                  <ToolbarButton
                    label={t('documents.editor.toolbar.bulletList')}
                    icon={<List />}
                    active={editor?.isActive('bulletList') ?? false}
                    disabled={!editor}
                    onClick={() => runEditorCommand(editor, (currentEditor) => currentEditor.chain().focus().toggleBulletList().run())}
                  />
                  <ToolbarButton
                    label={t('documents.editor.toolbar.orderedList')}
                    icon={<ListOrdered />}
                    active={editor?.isActive('orderedList') ?? false}
                    disabled={!editor}
                    onClick={() => runEditorCommand(editor, (currentEditor) => currentEditor.chain().focus().toggleOrderedList().run())}
                  />
                  <div className="min-w-52">
                    <Select
                      value={insertTokenValue}
                      onValueChange={(token) => {
                        setInsertTokenValue(token)
                        runEditorCommand(editor, (currentEditor) => currentEditor.chain().focus().insertContent(token).run())
                        window.setTimeout(() => setInsertTokenValue(undefined), 0)
                      }}
                    >
                      <SelectTrigger aria-label={t('documents.templates.editor.insertField', 'Insert field')}>
                        <SelectValue placeholder={t('documents.templates.editor.insertField', 'Insert field')} />
                      </SelectTrigger>
                      <SelectContent>
                        {tokenOptions.map((token) => (
                          <SelectItem key={token} value={token}>
                            {token}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className={cn(
                  'max-w-none p-4 text-foreground',
                  '[&_.ProseMirror]:min-h-80 [&_.ProseMirror]:focus-visible:outline-none',
                  '[&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:text-3xl [&_h1]:font-bold',
                  '[&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-2xl [&_h2]:font-semibold',
                  '[&_p]:my-3 [&_p]:leading-7',
                  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6',
                  '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6',
                )}>
                  <EditorContent editor={editor} />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
              <Label htmlFor={activeInputId} className="text-sm font-medium">
                {t('documents.templates.fields.active', 'Active')}
              </Label>
              <Switch
                id={activeInputId}
                checked={isActive}
                onCheckedChange={setIsActive}
                aria-label={t('documents.templates.fields.active', 'Active')}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>{t('documents.templates.slots.title', 'Context slots')}</Label>
                <Button type="button" size="sm" variant="outline" onClick={handleAddSlot}>
                  <Plus />
                  {t('documents.templates.slots.add', 'Add slot')}
                </Button>
              </div>
              {contextSlots.length === 0 ? (
                <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  {t('documents.templates.slots.empty', 'No entity context slots.')}
                </p>
              ) : (
                <div className="space-y-3">
                  {contextSlots.map((slot, index) => {
                    const keyInputId = `${nameInputId}-slot-${index}`
                    const error = slotError(slot)
                    return (
                      <div key={`${slot.entityType}:${index}`} className="space-y-3 rounded-md border border-border bg-card p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-2">
                            <Label htmlFor={keyInputId}>{t('documents.templates.slots.key', 'Slot key')}</Label>
                            <Input
                              id={keyInputId}
                              value={slot.slot}
                              onChange={(event) => {
                                const nextValue = event.target.value
                                setContextSlots((current) => current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, slot: nextValue } : item,
                                ))
                              }}
                              aria-invalid={error !== null}
                            />
                            {error ? (
                              <p className="text-xs text-status-error-text" role="alert">{error}</p>
                            ) : null}
                          </div>
                          <IconButton
                            type="button"
                            variant="ghost"
                            aria-label={t('documents.templates.slots.remove', 'Remove slot')}
                            title={t('documents.templates.slots.remove', 'Remove slot')}
                            onClick={() => setContextSlots((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          >
                            <Trash2 />
                          </IconButton>
                        </div>
                        <div className="space-y-2">
                          <Label>{t('documents.templates.slots.entityType', 'Entity type')}</Label>
                          <Select
                            value={slot.entityType}
                            onValueChange={(value) => {
                              const nextType = value as DocumentEntityType
                              setContextSlots((current) => current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, entityType: nextType, slot: deriveSlotKey(nextType, current, index) }
                                  : item,
                              ))
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DOCUMENT_ENTITY_REGISTRY.map((entry) => (
                                <SelectItem key={entry.type} value={entry.type}>
                                  {t(entry.labelKey, ENTITY_TYPE_FALLBACKS[entry.type])}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={slot.required === true}
                            onCheckedChange={(checked) => {
                              setContextSlots((current) => current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, required: checked === true } : item,
                              ))
                            }}
                          />
                          <span>{t('documents.templates.slots.required', 'Required')}</span>
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {formError ? (
          <p className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text" role="alert">
            {formError}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('documents.actions.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSubmitting}>
            {t('documents.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
