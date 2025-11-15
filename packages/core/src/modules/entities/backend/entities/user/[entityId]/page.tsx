"use client"
import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { invalidateCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { upsertCustomEntitySchema, upsertCustomFieldDefSchema } from '@open-mercato/core/modules/entities/data/validators'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { loadGeneratedFieldRegistrations } from '@open-mercato/ui/backend/fields/registry'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { createCrudFormError, raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { FieldDefinitionsEditor, type FieldDefinition, type FieldDefinitionError } from '../../../../components/FieldDefinitionsEditor'

type Def = FieldDefinition
type EntitiesListResponse = { items?: Array<Record<string, unknown>> }
type DefinitionsManageResponse = { items?: any[]; deletedKeys?: string[] }

type DefErrors = FieldDefinitionError


export default function EditDefinitionsPage({ params }: { params?: { entityId?: string } }) {
  React.useEffect(() => { loadGeneratedFieldRegistrations().catch(() => {}) }, [])
  const router = useRouter()
  const queryClient = useQueryClient()
  const entityId = useMemo(() => decodeURIComponent((params?.entityId as any) || ''), [params])
  const [label, setLabel] = useState('')
  const [entitySource, setEntitySource] = useState<'code'|'custom'>('custom')
  const [entityFormLoading, setEntityFormLoading] = useState(true)
  const [entityInitial, setEntityInitial] = useState<{ label?: string; description?: string; labelField?: string; defaultEditor?: string; showInSidebar?: boolean }>({})
  const [defs, setDefs] = useState<Def[]>([])
  const [orderDirty, setOrderDirty] = useState(false)
  const [orderSaving, setOrderSaving] = useState(false)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletedKeys, setDeletedKeys] = useState<string[]>([])
  const [defErrors, setDefErrors] = useState<Record<number, DefErrors>>({})

  const validateDef = React.useCallback((d: Def): DefErrors => {
    const parsed = upsertCustomFieldDefSchema.safeParse({ entityId, key: d.key, kind: d.kind, configJson: d.configJson, isActive: d.isActive })
    if (parsed.success) return {}
    const errs: DefErrors = {}
    for (const issue of parsed.error.issues) {
      if ((issue.path || []).includes('key')) errs.key = issue.message
      if ((issue.path || []).includes('kind')) errs.kind = issue.message
    }
    return errs
  }, [entityId])

  const validateAndSetErrorAt = (index: number, d: Def) => {
    const errs = validateDef(d)
    setDefErrors((prev) => ({ ...prev, [index]: errs }))
    return !errs.key && !errs.kind
  }

  const validateAll = () => {
    const nextErrors: Record<number, DefErrors> = {}
    defs.forEach((d, i) => {
      nextErrors[i] = validateDef(d)
    })
    setDefErrors(nextErrors)
    return Object.values(nextErrors).every(e => !e.key && !e.kind)
  }

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const entJson = await readApiResultOrThrow<EntitiesListResponse>(
          '/api/entities/entities',
          undefined,
          { errorMessage: 'Failed to load entity metadata', fallback: { items: [] } },
        )
        const ent = (entJson.items || []).find((x: any) => x.entityId === entityId)
        if (mounted) {
          const record = ent as Record<string, unknown> | undefined
          const labelValue =
            typeof record?.label === 'string' && record.label.trim().length > 0 ? record.label : entityId
          const descriptionValue = typeof record?.description === 'string' ? record.description : ''
          const labelFieldValue =
            typeof record?.labelField === 'string' && record.labelField.length > 0 ? record.labelField : 'name'
          const defaultEditorValue =
            typeof record?.defaultEditor === 'string' ? record.defaultEditor : ''
          const showInSidebarValue = record?.showInSidebar === true
          setLabel(labelValue)
          if (record?.source === 'code' || record?.source === 'custom') setEntitySource(record.source)
          setEntityInitial({
            label: labelValue,
            description: descriptionValue,
            labelField: labelFieldValue,
            defaultEditor: defaultEditorValue,
            showInSidebar: showInSidebarValue,
          })
          setEntityFormLoading(false)
        }
        const json = await readApiResultOrThrow<DefinitionsManageResponse>(
          `/api/entities/definitions.manage?entityId=${encodeURIComponent(entityId)}`,
          undefined,
          { errorMessage: 'Failed to load entity definitions', fallback: { items: [], deletedKeys: [] } },
        )
        if (mounted) {
          const loaded: Def[] = (json.items || []).map((d: any) => ({ key: d.key, kind: d.kind, configJson: d.configJson || {}, isActive: d.isActive !== false }))
          loaded.sort((a, b) => (a.configJson?.priority ?? 0) - (b.configJson?.priority ?? 0))
          setDefs(loaded)
          setDefErrors({})
          setDeletedKeys(Array.isArray(json.deletedKeys) ? json.deletedKeys : [])
        }
      } catch (e: any) {
        if (mounted) setError(e.message || 'Failed to load')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    if (entityId) load()
    return () => { mounted = false }
  }, [entityId])

  function addField() {
    setDefs((arr) => [...arr, { key: '', kind: 'text', configJson: {}, isActive: true }])
  }

  async function restoreField(key: string) {
    try {
      const call = await apiCall('/api/entities/definitions.restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, key }),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, 'Failed to restore field')
      }
      // Reload definitions & deleted keys
      const j2 = await readApiResultOrThrow<DefinitionsManageResponse>(
        `/api/entities/definitions.manage?entityId=${encodeURIComponent(entityId)}`,
        undefined,
        { errorMessage: 'Failed to reload field definitions', fallback: { items: [], deletedKeys: [] } },
      )
      const loaded: Def[] = (j2.items || []).map((d: any) => ({ key: d.key, kind: d.kind, configJson: d.configJson || {}, isActive: d.isActive !== false }))
      loaded.sort((a, b) => (a.configJson?.priority ?? 0) - (b.configJson?.priority ?? 0))
      setDefs(loaded)
      setDeletedKeys(Array.isArray(j2.deletedKeys) ? j2.deletedKeys : [])
      flash(`Restored ${key}`, 'success')
      await invalidateCustomFieldDefs(queryClient, entityId)
    } catch (e: any) {
      flash(e?.message || 'Failed to restore field', 'error')
    }
  }

  async function saveAll() {
    setSaving(true)
    setError(null)
    try {
      if (!validateAll()) {
        flash('Please fix validation errors in field definitions', 'error')
        throw new Error('Validation failed')
      }
      const payload = {
        entityId,
        definitions: defs.filter(d => !!d.key).map((d) => ({
          key: d.key,
          kind: d.kind,
          configJson: d.configJson,
          isActive: d.isActive !== false,
        })),
      }
      const call = await apiCall('/api/entities/definitions.batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        await raiseCrudError(call.response, 'Failed to save definitions')
      }
      await invalidateCustomFieldDefs(queryClient, entityId)
      router.push(`/backend/entities/user?flash=Definitions%20saved&type=success`)
    } catch (e: any) {
      setError(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function removeField(idx: number) {
    const def = defs[idx]
    if (!def) return
    if (def.key) {
      try {
        const call = await apiCall('/api/entities/definitions', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityId, key: def.key }),
        })
        if (!call.ok) {
          await raiseCrudError(call.response, 'Failed to delete field')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete field'
        flash(message, 'error')
        return
      }
    }
    setDefs((arr) => arr.filter((_, i) => i !== idx))
    setOrderDirty(true)
    if (def.key) {
      await invalidateCustomFieldDefs(queryClient, entityId)
    }
  }

  async function saveOrderIfDirty() {
    if (!orderDirty) return
    setOrderSaving(true)
    try {
      // Do not save order when there are invalid keys/kinds
      if (!validateAll()) throw new Error('Validation failed')
      const payload = {
        entityId,
        definitions: defs.filter(d => !!d.key).map((d) => ({
          key: d.key,
          kind: d.kind,
          configJson: d.configJson,
          isActive: d.isActive !== false,
        })),
      }
      const call = await apiCall('/api/entities/definitions.batch', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      })
      if (!call.ok) {
        await raiseCrudError(call.response, 'Failed to save order')
      }
      setOrderDirty(false)
      flash('Order saved', 'success')
      await invalidateCustomFieldDefs(queryClient, entityId)
    } catch (e: any) {
      flash(e?.message || 'Failed to save order', 'error')
    } finally {
      setOrderSaving(false)
    }
  }

  if (!entityId) {
    return (
      <Page>
        <PageBody>
          <div className="p-6">
            <ErrorNotice title="Invalid entity" message="The requested entity ID is missing or invalid." />
          </div>
        </PageBody>
      </Page>
    )
  }
  // Unify loader via CrudForm isLoading; do not return early here

  // Schema for inline field-level validation in CrudForm
  const entityFormSchema = upsertCustomEntitySchema
    .pick({ label: true, description: true, defaultEditor: true as any })
    .extend({
      // Allow empty string in the UI select, treat as undefined later
      defaultEditor: z.union([z.enum(['markdown','simpleMarkdown','htmlRichText']).optional(), z.literal('')]).optional(),
      // Include showInSidebar so CrudForm doesn't strip it on submit
      showInSidebar: z.boolean().optional(),
    }) as z.ZodType<Record<string, unknown>>

  const fields: CrudField[] = [
    { id: 'label', label: 'Label', type: 'text', required: true },
    { id: 'description', label: 'Description', type: 'textarea' },
    {
      id: 'defaultEditor',
      label: 'Default Editor (multiline)',
      type: 'select',
      options: [
        { value: '', label: 'Default (Markdown)' },
        { value: 'markdown', label: 'Markdown (UIW)' },
        { value: 'simpleMarkdown', label: 'Simple Markdown' },
        { value: 'htmlRichText', label: 'HTML Rich Text' },
      ],
    } as any,
    ...(entitySource === 'custom' ? [{ id: 'showInSidebar', label: 'Show in sidebar', type: 'checkbox' }] : []),
  ]
  const groups: CrudFormGroup[] = [
    { id: 'settings', title: 'Entity Settings', column: 1, fields: entitySource === 'custom' ? ['label','description','defaultEditor','showInSidebar'] : ['label','description','defaultEditor'] },
    { id: 'definitions', title: 'Field Definitions', column: 1, component: () => (
      <FieldDefinitionsEditor
        definitions={defs}
        errors={defErrors}
        deletedKeys={deletedKeys}
        onAddField={addField}
        onRemoveField={(index) => { void removeField(index) }}
        onDefinitionChange={(index, nextDef) => {
          setDefs((arr) => arr.map((entry, idx) => (idx === index ? nextDef : entry)))
          validateAndSetErrorAt(index, nextDef)
        }}
        onRestoreField={(key) => { void restoreField(key) }}
        onReorder={(from, to) => {
          setDefs((arr) => {
            const next = [...arr]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
          })
          setOrderDirty(true)
        }}
        orderNotice={orderDirty ? { dirty: true, saving: orderSaving, message: 'Reordered — will auto-save on blur' } : undefined}
        addButtonLabel="Add Field"
        listRef={listRef}
        listProps={{
          tabIndex: -1,
          onBlur: (event) => {
            const current = listRef.current
            const next = event.relatedTarget as Node | null
            if (!current) return
            if (!next || !current.contains(next)) {
              void saveOrderIfDirty()
            }
          },
        }}
      />
    ) },
  ]

  return (
    <Page>
      <PageBody>
        <CrudForm
          schema={entityFormSchema}
          title={`Edit Entity: ${entityId}`}
          backHref={entitySource === 'code' ? "/backend/entities/system" : "/backend/entities/user"}
          fields={fields}
          groups={groups}
          initialValues={entityInitial as any}
          isLoading={entityFormLoading || loading}
          submitLabel="Save"
          deleteVisible={entitySource === 'custom'}
          extraActions={entitySource === 'custom' ? (
            <Button variant="outline" asChild>
              <Link href={`/backend/entities/user/${encodeURIComponent(entityId)}/records`}>
                Show Records
              </Link>
            </Button>
          ) : null}
          cancelHref={entitySource === 'code' ? "/backend/entities/system" : "/backend/entities/user"}
          successRedirect={entitySource === 'code' ? "/backend/entities/system?flash=Definitions%20saved&type=success" : "/backend/entities/user?flash=Definitions%20saved&type=success"}
          onSubmit={async (vals) => {
            // Validate fields client-side before hitting the API
            if (!validateAll()) {
              flash('Please fix validation errors in field definitions', 'error')
              throw createCrudFormError('Please fix validation errors in field definitions')
            }
            // Save entity settings only for custom entities
            if (entitySource === 'custom') {
              // Treat showInSidebar as optional to avoid defaulting to false when omitted
              const partial = upsertCustomEntitySchema
                .pick({ label: true, description: true, labelField: true as any, defaultEditor: true as any })
                .extend({ showInSidebar: z.boolean().optional() }) as unknown as z.ZodTypeAny
              const normalized = { 
                ...(vals as any), 
                defaultEditor: (vals as any)?.defaultEditor || undefined,
              }
              const parsed = partial.safeParse(normalized)
              if (!parsed.success) throw createCrudFormError('Validation failed')
              const callEntity = await apiCall('/api/entities/entities', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId, ...(parsed.data as any) })
              })
              if (!callEntity.ok) {
                await raiseCrudError(callEntity.response, 'Failed to save entity')
              }
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
            }
            // Save definitions in a single batch (transactional)
            const defsPayload = {
              entityId,
              definitions: defs.filter(d => !!d.key).map((d) => ({
                key: d.key,
                kind: d.kind,
                configJson: d.configJson,
                isActive: d.isActive !== false,
              })),
            }
            const callDefs = await apiCall('/api/entities/definitions.batch', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(defsPayload)
            })
            if (!callDefs.ok) {
              await raiseCrudError(callDefs.response, 'Failed to save definitions')
            }
            try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
            // Invalidate all custom field definition caches so DataTables refresh with new labels
            await invalidateCustomFieldDefs(queryClient, entityId)
            flash('Definitions saved', 'success')
          }}
        onDelete={entitySource === 'custom' ? async () => {
          const callDelete = await apiCall('/api/entities/entities', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entityId }) })
          if (!callDelete.ok) {
            await raiseCrudError(callDelete.response, 'Failed to delete entity')
          }
          flash('Entity deleted', 'success')
          try { window.dispatchEvent(new Event('om:refresh-sidebar')) } catch {}
        } : undefined}
      />
      </PageBody>
    </Page>
  )
}
