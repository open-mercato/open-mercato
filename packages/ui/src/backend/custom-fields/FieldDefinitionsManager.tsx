"use client"

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../primitives/button'
import { Spinner } from '../../primitives/spinner'
import { ErrorNotice } from '../../primitives/ErrorNotice'
import { flash } from '../FlashMessages'
import { apiCall, readApiResultOrThrow } from '../utils/apiCall'
import { raiseCrudError } from '../utils/serverErrors'
import { invalidateCustomFieldDefs } from '../utils/customFieldDefs'
import { FieldDefinitionsEditor, type FieldDefinition, type FieldDefinitionError } from './FieldDefinitionsEditor'
import { upsertCustomFieldDefSchema } from '@open-mercato/shared/modules/entities/validators'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type FieldsetGroup = { code: string; title?: string; hint?: string }
type FieldsetDefinition = { code: string; label: string; icon?: string; description?: string; groups?: FieldsetGroup[] }
type DefinitionsManageResponse = {
  items?: any[]
  deletedKeys?: string[]
  fieldsets?: FieldsetDefinition[]
  settings?: { singleFieldsetPerRecord?: boolean }
}

type FieldDefinitionsManagerProps = {
  entityId: string
  initialFieldset?: string | null
  onClose: () => void
  onSaved?: () => void | Promise<void>
  fullEditorHref?: string | null
}

export type FieldDefinitionsManagerHandle = {
  submit: () => Promise<void>
}

function normalizeGroupPayload(value: unknown): FieldsetGroup | null {
  if (!value) return null
  if (typeof value === 'string') {
    const code = value.trim()
    return code ? { code } : null
  }
  if (typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const code = typeof entry.code === 'string' ? entry.code.trim() : ''
  if (!code) return null
  const group: FieldsetGroup = { code }
  if (typeof entry.title === 'string' && entry.title.trim()) group.title = entry.title.trim()
  if (typeof entry.hint === 'string' && entry.hint.trim()) group.hint = entry.hint.trim()
  return group
}

export const FieldDefinitionsManager = React.forwardRef<FieldDefinitionsManagerHandle, FieldDefinitionsManagerProps>(
  function FieldDefinitionsManager({ entityId, initialFieldset = null, onClose, onSaved, fullEditorHref }, ref) {
    const t = useT()
    const queryClient = useQueryClient()
    const [loading, setLoading] = React.useState(true)
    const [saving, setSaving] = React.useState(false)
    const [statusError, setStatusError] = React.useState<string | null>(null)
    const [defs, setDefs] = React.useState<FieldDefinition[]>([])
    const [deletedKeys, setDeletedKeys] = React.useState<string[]>([])
    const [defErrors, setDefErrors] = React.useState<Record<number, FieldDefinitionError>>({})
    const [fieldsets, setFieldsets] = React.useState<FieldsetDefinition[]>([])
    const [activeFieldset, setActiveFieldset] = React.useState<string | null>(initialFieldset)
    const [singleFieldsetPerRecord, setSingleFieldsetPerRecord] = React.useState(true)
    const [isDirty, setIsDirty] = React.useState(false)
    const [orderDirty, setOrderDirty] = React.useState(false)

    const loadDefinitions = React.useCallback(async () => {
      if (!entityId) return
      setLoading(true)
      setStatusError(null)
      try {
        const json = await readApiResultOrThrow<DefinitionsManageResponse>(
          `/api/entities/definitions.manage?entityId=${encodeURIComponent(entityId)}`,
          undefined,
          { errorMessage: t('entities.customFields.errors.loadFailed', 'Failed to load field definitions'), fallback: { items: [], deletedKeys: [] } },
        )
        const loaded: FieldDefinition[] = (json.items || []).map((d: any) => ({
          key: d.key,
          kind: d.kind,
          configJson: d.configJson || {},
          isActive: d.isActive !== false,
        }))
        loaded.sort(
          (a, b) => Number(a.configJson?.priority ?? 0) - Number(b.configJson?.priority ?? 0)
        )
        setDefs(loaded)
        setDeletedKeys(Array.isArray(json.deletedKeys) ? json.deletedKeys : [])
        const loadedFieldsets = Array.isArray(json.fieldsets) ? json.fieldsets : []
        setFieldsets(loadedFieldsets)
        setActiveFieldset((current) => {
          if (initialFieldset && loadedFieldsets.some((fs) => fs.code === initialFieldset)) {
            return initialFieldset
          }
          if (current && loadedFieldsets.some((fs) => fs.code === current)) return current
          return loadedFieldsets[0]?.code ?? null
        })
        setSingleFieldsetPerRecord(json.settings?.singleFieldsetPerRecord !== false)
        setDefErrors({})
        setIsDirty(false)
        setOrderDirty(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : t('entities.customFields.errors.loadFailed', 'Failed to load field definitions')
        setStatusError(message)
      } finally {
        setLoading(false)
      }
    }, [entityId, initialFieldset, t])

    React.useEffect(() => {
      loadDefinitions().catch(() => {})
    }, [loadDefinitions])

    const buildFieldsetPayload = React.useCallback(() => {
      const groupMap = new Map<string, FieldsetGroup[]>()
      defs.forEach((definition) => {
        const code = typeof definition.configJson?.fieldset === 'string' ? definition.configJson.fieldset : null
        if (!code) return
        const normalized = normalizeGroupPayload(definition.configJson?.group)
        if (!normalized) return
        const list = groupMap.get(code) ?? []
        if (!list.some((entry) => entry.code === normalized.code)) {
          list.push(normalized)
          groupMap.set(code, list)
        }
      })
      return fieldsets.map((fs) => ({
        ...fs,
        groups: groupMap.get(fs.code) ?? [],
      }))
    }, [defs, fieldsets])

    const validateDef = React.useCallback(
      (definition: FieldDefinition): FieldDefinitionError => {
        const parsed = upsertCustomFieldDefSchema.safeParse({
          entityId,
          key: definition.key,
          kind: definition.kind,
          configJson: definition.configJson,
          isActive: definition.isActive,
        })
        if (parsed.success) return {}
        const errs: FieldDefinitionError = {}
        for (const issue of parsed.error.issues) {
          if (issue.path.includes('key')) errs.key = issue.message
          if (issue.path.includes('kind')) errs.kind = issue.message
        }
        return errs
      },
      [entityId],
    )

    const validateAll = React.useCallback(() => {
      const nextErrors: Record<number, FieldDefinitionError> = {}
      defs.forEach((definition, index) => {
        nextErrors[index] = validateDef(definition)
      })
      setDefErrors(nextErrors)
      return Object.values(nextErrors).every((entry) => !entry.key && !entry.kind)
    }, [defs, validateDef])

    const handleDefinitionChange = React.useCallback((index: number, nextDef: FieldDefinition) => {
      setDefs((arr) => arr.map((entry, idx) => (idx === index ? nextDef : entry)))
      setDefErrors((prev) => ({ ...prev, [index]: validateDef(nextDef) }))
      setIsDirty(true)
    }, [validateDef])

    const handleAddField = React.useCallback(() => {
      setDefs((arr) => [
        ...arr,
        {
          key: '',
          kind: 'text',
          configJson: activeFieldset ? { fieldset: activeFieldset } : {},
          isActive: true,
        },
      ])
      setIsDirty(true)
    }, [activeFieldset])

    const handleRemoveField = React.useCallback(async (index: number) => {
      const def = defs[index]
      if (!def) return
      if (def.key) {
        try {
          const call = await apiCall('/api/entities/definitions', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entityId, key: def.key }),
          })
          if (!call.ok) {
            await raiseCrudError(call.response, t('entities.customFields.errors.deleteFailed', 'Failed to delete field'))
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : t('entities.customFields.errors.deleteFailed', 'Failed to delete field')
          flash(message, 'error')
          return
        }
      }
      setDefs((arr) => arr.filter((_, idx) => idx !== index))
      setIsDirty(true)
    }, [defs, entityId, t])

    const handleRestoreField = React.useCallback(async (key: string) => {
      try {
        const call = await apiCall('/api/entities/definitions.restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityId, key }),
        })
        if (!call.ok) {
          await raiseCrudError(call.response, t('entities.customFields.errors.restoreFailed', 'Failed to restore field'))
        }
        flash(t('entities.customFields.flash.restored', 'Field restored'), 'success')
        await loadDefinitions()
      } catch (error) {
        const message = error instanceof Error ? error.message : t('entities.customFields.errors.restoreFailed', 'Failed to restore field')
        flash(message, 'error')
      }
    }, [entityId, loadDefinitions, t])

    const handleReorder = React.useCallback((from: number, to: number) => {
      setDefs((arr) => {
        const next = [...arr]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
      setIsDirty(true)
      setOrderDirty(true)
    }, [])

    const handleFieldsetsChange = React.useCallback((next: FieldsetDefinition[]) => {
      setFieldsets(next)
      if (!next.some((fs) => fs.code === activeFieldset)) {
        setActiveFieldset(next[0]?.code ?? null)
      }
      setIsDirty(true)
    }, [activeFieldset])

    const handleFieldsetCodeChange = React.useCallback((previousCode: string, nextCode: string) => {
      if (!previousCode || !nextCode || previousCode === nextCode) return
      setDefs((arr) =>
        arr.map((entry) => {
          const current = typeof entry.configJson?.fieldset === 'string' ? entry.configJson.fieldset : undefined
          if (current !== previousCode) return entry
          const nextConfig = { ...(entry.configJson || {}) }
          nextConfig.fieldset = nextCode
          return { ...entry, configJson: nextConfig }
        }),
      )
      setActiveFieldset((current) => (current === previousCode ? nextCode : current))
      setIsDirty(true)
    }, [])

    const handleFieldsetRemoved = React.useCallback((code: string) => {
      if (!code) return
      setDefs((arr) =>
        arr.map((entry) => {
          const current = typeof entry.configJson?.fieldset === 'string' ? entry.configJson.fieldset : undefined
          if (current !== code) return entry
          const nextConfig = { ...(entry.configJson || {}) }
          delete nextConfig.fieldset
          delete nextConfig.group
          return { ...entry, configJson: nextConfig }
        }),
      )
      setIsDirty(true)
    }, [])

    const submit = React.useCallback(async () => {
      if (!entityId) return
      setSaving(true)
      setStatusError(null)
      try {
        if (!validateAll()) {
          flash(t('entities.customFields.errors.validation', 'Please fix validation errors'), 'error')
          throw new Error(t('entities.customFields.errors.validation', 'Validation failed'))
        }
        const payload = {
          entityId,
          definitions: defs.filter((d) => !!d.key).map((d) => ({
            key: d.key,
            kind: d.kind,
            configJson: d.configJson,
            isActive: d.isActive !== false,
          })),
          fieldsets: buildFieldsetPayload(),
          singleFieldsetPerRecord,
        }
        const call = await apiCall('/api/entities/definitions.batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!call.ok) {
          await raiseCrudError(call.response, t('entities.customFields.errors.saveFailed', 'Failed to save definitions'))
        }
        await invalidateCustomFieldDefs(queryClient, entityId)
        flash(t('entities.customFields.flash.saved', 'Definitions saved'), 'success')
        setIsDirty(false)
        setOrderDirty(false)
        if (onSaved) await onSaved()
        onClose()
      } catch (err) {
        const message = err instanceof Error ? err.message : t('entities.customFields.errors.saveFailed', 'Failed to save definitions')
        setStatusError(message)
      } finally {
        setSaving(false)
      }
    }, [buildFieldsetPayload, defs, entityId, onClose, onSaved, queryClient, singleFieldsetPerRecord, t, validateAll])

    React.useImperativeHandle(ref, () => ({ submit }), [submit])

    const cancelLabel = t('ui.forms.actions.cancel', 'Cancel')
    const saveLabel = saving ? t('ui.forms.status.saving', 'Saving...') : t('ui.forms.actions.save', 'Save')
    const openFullLabel = t('entities.customFields.openInNewTab', 'Open full editor')

    const handleOpenFullEditor = React.useCallback(() => {
      if (!fullEditorHref || typeof window === 'undefined') return
      window.open(fullEditorHref, '_blank', 'noopener,noreferrer')
    }, [fullEditorHref])

    const content = loading ? (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    ) : (
      <FieldDefinitionsEditor
        definitions={defs}
        errors={defErrors}
        deletedKeys={deletedKeys}
        fieldsets={fieldsets}
        activeFieldset={activeFieldset}
        onActiveFieldsetChange={setActiveFieldset}
        onFieldsetsChange={handleFieldsetsChange}
        onFieldsetCodeChange={handleFieldsetCodeChange}
        onFieldsetRemoved={handleFieldsetRemoved}
        singleFieldsetPerRecord={singleFieldsetPerRecord}
        onSingleFieldsetPerRecordChange={(value) => {
          setSingleFieldsetPerRecord(value)
          setIsDirty(true)
        }}
        onAddField={handleAddField}
        onRemoveField={(index) => { void handleRemoveField(index) }}
        onDefinitionChange={handleDefinitionChange}
        onRestoreField={(key) => { void handleRestoreField(key) }}
        onReorder={handleReorder}
        orderNotice={orderDirty ? { dirty: true, message: t('entities.customFields.orderNotice', 'Reordered — remember to save') } : undefined}
        translate={t}
      />
    )

    return (
      <div className="flex flex-col gap-4">
        {statusError ? (
          <ErrorNotice title={t('entities.customFields.errors.title', 'Something went wrong')} message={statusError} />
        ) : null}
        <div className="rounded-lg border bg-card p-4 max-h-[70vh] overflow-y-auto">
          {content}
        </div>
        <div className="flex justify-end gap-2">
          {fullEditorHref ? (
            <Button type="button" variant="ghost" onClick={handleOpenFullEditor}>
              {openFullLabel}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {cancelLabel}
          </Button>
          <Button type="button" onClick={() => { void submit() }} disabled={saving || !isDirty}>
            {saveLabel}
          </Button>
        </div>
      </div>
    )
  },
)

FieldDefinitionsManager.displayName = 'FieldDefinitionsManager'
