"use client"

import * as React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getEntityFields } from '#generated/entity-fields-registry'

type EntityOption = { entityId: string; label?: string; source?: string }

type EncryptionFieldRow = {
  id: string
  field: string
  hashField?: string | null
}

type EncryptionMapResponse = {
  entityId: string
  fields?: Array<{ field: string; hashField?: string | null }>
  isActive?: boolean
}

type CanonicalOption = { value: string; label?: string }

function normalizeToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function canonicalizeFieldName(raw: string, options: CanonicalOption[]): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return ''
  const normalized = normalizeToken(trimmed)
  for (const option of options) {
    const optionValue = typeof option.value === 'string' ? option.value.trim() : ''
    if (optionValue && normalizeToken(optionValue) === normalized) return optionValue
    if (option.label && normalizeToken(option.label) === normalized) return optionValue
  }
  return trimmed
}

function normalizeFieldRows(raw: EncryptionMapResponse | undefined, options: CanonicalOption[]): EncryptionFieldRow[] {
  const rows = Array.isArray(raw?.fields) ? raw!.fields : []
  return rows.map((entry, idx) => ({
    id: `${entry.field}-${idx}`,
    field: canonicalizeFieldName(entry.field, options),
    hashField: entry.hashField ? canonicalizeFieldName(entry.hashField, options) : null,
  }))
}

function buildRowId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `row-${Math.random().toString(36).slice(2)}`
}

export function EncryptionManager() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [selectedEntityId, setSelectedEntityId] = React.useState('')
  const [fields, setFields] = React.useState<EncryptionFieldRow[]>([])
  const [isActive, setIsActive] = React.useState(true)
  const [baseFieldOptions, setBaseFieldOptions] = React.useState<Array<{ value: string; label: string }>>([])
  const [hasUserEdited, setHasUserEdited] = React.useState(false)
  const { data: fieldDefs = [], isLoading: loadingFieldDefs } = useCustomFieldDefs(selectedEntityId ? [selectedEntityId] : [], {
    enabled: !!selectedEntityId,
  })
  const canonicalOptions = React.useMemo<CanonicalOption[]>(() => {
    const options: CanonicalOption[] = []
    for (const option of baseFieldOptions) {
      if (!option.value) continue
      if (options.some((opt) => opt.value === option.value)) continue
      options.push(option)
    }
    for (const def of fieldDefs) {
      const key = typeof def.key === 'string' ? def.key.trim() : ''
      if (!key || options.some((opt) => opt.value === key)) continue
      const label = typeof def.label === 'string' ? def.label : undefined
      options.push({ value: key, label })
    }
    return options
  }, [baseFieldOptions, fieldDefs])
  const fieldOptions = React.useMemo(() => {
    const entries = new Map<string, string>()
    for (const option of baseFieldOptions) {
      if (!option.value || entries.has(option.value)) continue
      entries.set(option.value, option.label || option.value)
    }
    for (const def of fieldDefs) {
      const key = typeof def.key === 'string' ? def.key.trim() : ''
      if (!key || entries.has(key)) continue
      const label = typeof def.label === 'string' && def.label.trim().length ? def.label : key
      entries.set(key, label)
    }
    for (const row of fields) {
      const main = row.field?.trim()
      if (main && !entries.has(main)) entries.set(main, main)
      const hash = row.hashField?.trim()
      if (hash && !entries.has(hash)) entries.set(hash, hash)
    }
    return Array.from(entries.entries()).map(([value, label]) => ({ value, label }))
  }, [baseFieldOptions, fieldDefs, fields])

  const { data: entities, isLoading: loadingEntities, error: entitiesError } = useQuery<{ items: EntityOption[] }>({
    queryKey: ['entities-list', scopeVersion],
    queryFn: async () =>
      readApiResultOrThrow('/api/entities/entities', undefined, {
        errorMessage: t('entities.encryption.errors.loadEntities', 'Failed to load entities'),
      }),
  })

  React.useEffect(() => {
    if (!selectedEntityId && entities?.items?.length) {
      const first = entities.items[0]
      setSelectedEntityId(first.entityId)
    }
  }, [entities, selectedEntityId])

  React.useEffect(() => {
    if (!selectedEntityId) {
      setBaseFieldOptions([])
      return
    }
    const parts = selectedEntityId.split(':')
    const entitySlug = parts[1]
    if (!entitySlug) {
      setBaseFieldOptions([])
      return
    }

    // Use static registry instead of dynamic import for Turbopack compatibility
    const mod = getEntityFields(entitySlug)
    if (!mod) {
      console.warn('[encryption] No fields found for entity', entitySlug)
      setBaseFieldOptions([])
      return
    }

    const options: Array<{ value: string; label: string }> = []
    for (const raw of Object.values(mod)) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      const value = raw.trim()
      if (options.some((opt) => opt.value === value)) continue
      const label = value
        .split('_')
        .map((segment) => (segment ? `${segment[0].toUpperCase()}${segment.slice(1)}` : ''))
        .join(' ')
        .trim() || value
      options.push({ value, label })
    }
    setBaseFieldOptions(options)
  }, [selectedEntityId])

  const {
    data: map,
    isLoading: loadingMap,
    isError: mapError,
    refetch: refetchMap,
  } = useQuery<EncryptionMapResponse>({
    queryKey: ['encryption-map', selectedEntityId, scopeVersion],
    enabled: !!selectedEntityId,
    queryFn: async () =>
      readApiResultOrThrow(`/api/entities/encryption?entityId=${encodeURIComponent(selectedEntityId)}`, undefined, {
        errorMessage: t('entities.encryption.errors.loadMap', 'Failed to load encryption map'),
      }),
  })

  const mapSignature = React.useMemo(() => JSON.stringify(map ?? null), [map])
  const lastMapSignatureRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const signature = mapSignature
    const isSameMap = signature === lastMapSignatureRef.current
    if (isSameMap && hasUserEdited) return
    if (!map) {
      setFields([])
      setIsActive(true)
      setHasUserEdited(false)
      lastMapSignatureRef.current = signature
      return
    }
    setFields(normalizeFieldRows(map, canonicalOptions))
    setIsActive(map?.isActive !== false)
    setHasUserEdited(false)
    lastMapSignatureRef.current = signature
  }, [mapSignature, map, canonicalOptions, hasUserEdited])

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = fields
        .map((row) => ({
          field: canonicalizeFieldName(row.field, canonicalOptions).trim(),
          hashField: row.hashField ? canonicalizeFieldName(row.hashField, canonicalOptions).trim() : '',
        }))
        .filter((row) => row.field.length > 0)
        .map((row) => ({
          field: row.field,
          hashField: row.hashField ? row.hashField : null,
        }))
      if (!selectedEntityId) {
        throw new Error(t('entities.encryption.errors.selectEntity', 'Select an entity before saving'))
      }
      if (!trimmed.length) {
        throw new Error(t('entities.encryption.errors.noFields', 'Add at least one field to encrypt'))
      }
      const res = await apiCall('/api/entities/encryption', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId: selectedEntityId, fields: trimmed, isActive }),
      })
      if (!res.ok) {
        await raiseCrudError(res.response, t('entities.encryption.errors.save', 'Failed to save encryption map'))
      }
      return true
    },
    onSuccess: () => {
      flash(t('entities.encryption.flash.saved', 'Encryption map saved'), 'success')
      void refetchMap()
    },
    onError: (err: any) => {
      const message = err?.message || t('entities.encryption.errors.save', 'Failed to save encryption map')
      flash(message, 'error')
    },
  })

  const addField = () => {
    setHasUserEdited(true)
    setFields((prev) => [...prev, { id: buildRowId(), field: '', hashField: null }])
  }

  const updateField = (id: string, patch: Partial<EncryptionFieldRow>) => {
    setHasUserEdited(true)
    setFields((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const removeField = (id: string) => {
    setHasUserEdited(true)
    setFields((prev) => prev.filter((row) => row.id !== id))
  }

  const renderFields = () => {
    if (loadingMap || loadingFieldDefs) {
      return (
        <LoadingMessage
          label={t('entities.encryption.loading', 'Loading encryption map…')}
          className="border-0 bg-transparent p-4"
        />
      )
    }
    if (mapError) {
      return (
        <ErrorMessage
          label={t('entities.encryption.errors.loadMap', 'Failed to load encryption map')}
          action={(
            <Button variant="outline" size="sm" onClick={() => void refetchMap()}>
              {t('entities.encryption.actions.retry', 'Retry')}
            </Button>
          )}
        />
      )
    }
    if (!fields.length) {
      return (
        <div className="rounded border bg-background/70 p-4 text-sm text-muted-foreground">
          {t('entities.encryption.empty', 'No fields are encrypted yet. Add the first one below.')}
        </div>
      )
    }
    const withFallbackOption = (value?: string | null) => {
      if (value && !fieldOptions.some((opt) => opt.value === value)) {
        return [...fieldOptions, { value, label: value }]
      }
      return fieldOptions
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left">
                {t('entities.encryption.fields.field', 'Field name')}
              </th>
              <th className="px-3 py-2 text-left">
                {t('entities.encryption.fields.hash', 'Hash field (optional)')}
              </th>
              <th className="px-3 py-2 text-right">
                {t('entities.encryption.fields.actions', 'Actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((row) => {
              const fieldOpts = withFallbackOption(row.field)
              const hashOpts = withFallbackOption(row.hashField)
              return (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 align-top">
                    <select
                      className="w-full rounded border bg-background px-3 py-2 text-sm"
                      value={row.field}
                      onChange={(event) => updateField(row.id, { field: event.target.value })}
                    >
                      <option value="">{t('entities.encryption.fields.selectField', 'Select field')}</option>
                      {fieldOpts.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      className="w-full rounded border bg-background px-3 py-2 text-sm"
                      value={row.hashField || ''}
                      onChange={(event) => updateField(row.id, { hashField: event.target.value ? event.target.value : null })}
                    >
                      <option value="">{t('entities.encryption.fields.selectHash', 'Select hash field (optional)')}</option>
                      {hashOpts.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t('entities.encryption.fields.hashHint', 'Use when lookups must stay deterministic (e.g., login by email).')}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 px-0"
                      aria-label={t('entities.encryption.actions.remove', 'Remove')}
                      onClick={() => removeField(row.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{t('entities.encryption.title', 'Encryption')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('entities.encryption.description', 'Manage which entity fields are encrypted with tenant keys and optional hash columns.')}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                {t('entities.encryption.selectEntity', 'Choose entity')}
              </label>
              <select
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={selectedEntityId}
                onChange={(event) => setSelectedEntityId(event.target.value)}
                disabled={loadingEntities || !!entitiesError}
              >
                {!selectedEntityId ? <option value="">{t('entities.encryption.placeholder', 'Select an entity')}</option> : null}
                {(entities?.items || []).map((item) => (
                  <option key={item.entityId} value={item.entityId}>
                    {item.label || item.entityId} {item.source === 'custom' ? `(${t('entities.encryption.source.custom', 'custom')})` : ''}
                  </option>
                ))}
              </select>
              {entitiesError ? (
                <p className="mt-1 text-xs text-red-600">
                  {t('entities.encryption.errors.loadEntities', 'Failed to load entities')}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('entities.encryption.entityHint', 'Maps apply per tenant/organization. Use field names from your entities.')}
                </p>
              )}
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              {t('entities.encryption.active', 'Encryption enabled for this entity')}
            </label>
          </div>
        </div>
        <div className="rounded-lg border bg-background/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">{t('entities.encryption.fields.title', 'Encrypted fields')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('entities.encryption.fields.subtitle', 'List the attributes that should be encrypted with the tenant key.')}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={addField}>
              <Plus className="mr-2 h-4 w-4" />
              {t('entities.encryption.actions.add', 'Add field')}
            </Button>
          </div>
          {renderFields()}
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || loadingEntities || !!entitiesError || !selectedEntityId}
          >
            <Save className="mr-2 h-4 w-4" />
            {mutation.isPending
              ? t('entities.encryption.actions.saving', 'Saving…')
              : t('entities.encryption.actions.save', 'Save encryption map')}
          </Button>
        </div>
      </div>
    </div>
  )
}
