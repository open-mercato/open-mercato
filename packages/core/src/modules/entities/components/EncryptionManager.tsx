"use client"

import * as React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

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

function normalizeFieldRows(raw: EncryptionMapResponse | undefined): EncryptionFieldRow[] {
  const rows = Array.isArray(raw?.fields) ? raw!.fields : []
  return rows.map((entry, idx) => ({
    id: `${entry.field}-${idx}`,
    field: entry.field,
    hashField: entry.hashField ?? null,
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

  React.useEffect(() => {
    setFields(normalizeFieldRows(map))
    setIsActive(map?.isActive !== false)
  }, [map])

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmed = fields
        .map((row) => ({
          field: row.field.trim(),
          hashField: row.hashField ? row.hashField.trim() : '',
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
    setFields((prev) => [...prev, { id: buildRowId(), field: '', hashField: null }])
  }

  const updateField = (id: string, patch: Partial<EncryptionFieldRow>) => {
    setFields((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((row) => row.id !== id))
  }

  const renderFields = () => {
    if (loadingMap) {
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
        <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
          {t('entities.encryption.empty', 'No fields are encrypted yet. Add the first one below.')}
        </div>
      )
    }
    return (
      <div className="space-y-3">
        {fields.map((row, index) => (
          <div key={row.id} className="grid grid-cols-1 gap-3 rounded border bg-card/60 p-3 md:grid-cols-12 md:items-center">
            <div className="md:col-span-5">
              <label className="text-xs text-muted-foreground">
                {t('entities.encryption.fields.field', 'Field name')}
              </label>
              <Input
                value={row.field}
                placeholder="email"
                onChange={(event) => updateField(row.id, { field: event.target.value })}
                className="mt-1"
              />
            </div>
            <div className="md:col-span-5">
              <label className="text-xs text-muted-foreground">
                {t('entities.encryption.fields.hash', 'Hash field (optional)')}
              </label>
              <Input
                value={row.hashField || ''}
                placeholder="emailHash"
                onChange={(event) => updateField(row.id, { hashField: event.target.value })}
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('entities.encryption.fields.hashHint', 'Use when lookups must stay deterministic (e.g., login by email).')}
              </p>
            </div>
            <div className="md:col-span-2 flex items-end justify-end gap-2">
              <span className="text-xs text-muted-foreground">{t('entities.encryption.fields.row', 'Field {{index}}', { index: index + 1 })}</span>
              <Button variant="ghost" size="sm" onClick={() => removeField(row.id)}>
                {t('entities.encryption.actions.remove', 'Remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t('entities.encryption.title', 'Encryption')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('entities.encryption.description', 'Manage which entity fields are encrypted with tenant keys and optional hash columns.')}
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="flex-1">
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
        <div className="rounded-lg border bg-background/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">{t('entities.encryption.fields.title', 'Encrypted fields')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('entities.encryption.fields.subtitle', 'List the attributes that should be encrypted with the tenant key.')}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={addField}>
              {t('entities.encryption.actions.add', 'Add field')}
            </Button>
          </div>
          {renderFields()}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => void refetchMap()} disabled={loadingMap || mutation.isLoading}>
            {t('entities.encryption.actions.refresh', 'Refresh')}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isLoading || loadingEntities || !!entitiesError || !selectedEntityId}>
            {mutation.isLoading
              ? t('entities.encryption.actions.saving', 'Saving…')
              : t('entities.encryption.actions.save', 'Save encryption map')}
          </Button>
        </div>
      </div>
    </div>
  )
}
