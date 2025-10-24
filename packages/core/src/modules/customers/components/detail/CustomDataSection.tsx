"use client"

import * as React from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { fetchCustomFieldFormFieldsWithDefinitions } from '@open-mercato/ui/backend/utils/customFieldForms'
import {
  DictionaryValue,
  type DictionaryMap,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { ensureDictionaryEntries } from '@open-mercato/core/modules/dictionaries/components/hooks/useDictionaryEntries'
import { cn } from '@open-mercato/shared/lib/utils'

type CustomDataSectionProps = {
  entityId?: string
  entityIds?: string[]
  values: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => Promise<void>
  title: string
}

function extractDictionaryValue(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const trimmed = entry.trim()
    return trimmed.length ? trimmed : null
  }
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const candidate = record.value ?? record.name ?? record.id ?? record.key ?? record.label
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

function formatFieldValue(field: CrudField, value: unknown, emptyLabel: string, dictionaryMap?: DictionaryMap): React.ReactNode {
  if (dictionaryMap) {
    if (value === undefined || value === null || value === '') {
      return <span className="text-muted-foreground">{emptyLabel}</span>
    }

    if (Array.isArray(value)) {
      const normalizedValues = value
        .map((entry) => extractDictionaryValue(entry))
        .filter((entry): entry is string => typeof entry === 'string' && entry.length)

      if (!normalizedValues.length) {
        return <span className="text-muted-foreground">{emptyLabel}</span>
      }

      return (
        <div className="flex flex-wrap gap-1.5">
          {normalizedValues.map((entry, index) => (
            <DictionaryValue
              key={`${field.id}-${entry}-${index}`}
              value={entry}
              map={dictionaryMap}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs"
              iconWrapperClassName="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background"
              iconClassName="h-3 w-3"
              colorClassName="h-2.5 w-2.5 rounded-full"
            />
          ))}
        </div>
      )
    }

    const resolved = extractDictionaryValue(value)
    if (!resolved) {
      return <span className="text-muted-foreground">{emptyLabel}</span>
    }

    return (
      <DictionaryValue
        value={resolved}
        map={dictionaryMap}
        className="inline-flex items-center gap-2 text-sm"
        fallback={<span className="text-muted-foreground">{emptyLabel}</span>}
        iconWrapperClassName="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card"
        iconClassName="h-4 w-4"
        colorClassName="h-3 w-3 rounded-full"
      />
    )
  }

  const optionMap = Array.isArray(field.options)
    ? field.options.reduce<Map<string, string>>((acc, option) => {
        acc.set(option.value, option.label)
        return acc
      }, new Map())
    : null

  const resolveOptionLabel = (entry: unknown): string => {
    if (entry && typeof entry === 'object') {
      const record = entry as { label?: unknown; value?: unknown; name?: unknown }
      const candidateLabel = record.label
      if (typeof candidateLabel === 'string' && candidateLabel.trim().length) {
        return candidateLabel.trim()
      }
      const candidateValue = record.value ?? record.name
      if (typeof candidateValue === 'string' && candidateValue.trim().length) {
        const normalized = candidateValue.trim()
        return optionMap?.get(normalized) ?? normalized
      }
    }
    if (entry === undefined || entry === null) return ''
    const normalized = String(entry)
    if (!normalized.length) return ''
    return optionMap?.get(normalized) ?? normalized
  }

  if (value === undefined || value === null || value === '') {
    return <span className="text-muted-foreground">{emptyLabel}</span>
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">{emptyLabel}</span>
    return value.map((entry, index) => (
      <span key={`${field.id}-${index}`} className="mr-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs">
        {resolveOptionLabel(entry) || emptyLabel}
      </span>
    ))
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const resolved = resolveOptionLabel(value)
  if (!resolved.length) return <span className="text-muted-foreground">{emptyLabel}</span>
  return resolved
}

export function CustomDataSection({ entityId, entityIds, values, onSubmit, title }: CustomDataSectionProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const emptyLabel = t('customers.people.detail.noValue')
  const [dictionaryMapsByField, setDictionaryMapsByField] = React.useState<Record<string, DictionaryMap>>({})
  const [editing, setEditing] = React.useState(false)
  const sectionRef = React.useRef<HTMLDivElement | null>(null)
  const resolvedEntityIds = React.useMemo(() => {
    if (Array.isArray(entityIds) && entityIds.length) {
      const dedup = new Set<string>()
      const list: string[] = []
      entityIds.forEach((id) => {
        const trimmed = typeof id === 'string' ? id.trim() : ''
        if (!trimmed || dedup.has(trimmed)) return
        dedup.add(trimmed)
        list.push(trimmed)
      })
      return list
    }
    if (typeof entityId === 'string' && entityId.trim().length > 0) {
      return [entityId.trim()]
    }
    return []
  }, [entityId, entityIds])
  const primaryEntityId = resolvedEntityIds.length ? resolvedEntityIds[0] : undefined
  const customFieldFormsQuery = useQuery({
    queryKey: ['customFieldForms', scopeVersion, ...resolvedEntityIds],
    enabled: resolvedEntityIds.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => fetchCustomFieldFormFieldsWithDefinitions(resolvedEntityIds),
  })
  const fields = customFieldFormsQuery.data?.fields ?? []
  const definitions = customFieldFormsQuery.data?.definitions ?? []
  const [dictionaryLoading, setDictionaryLoading] = React.useState(false)
  const loading = customFieldFormsQuery.isLoading || dictionaryLoading

  const submitActiveForm = React.useCallback(() => {
    const node = sectionRef.current?.querySelector('form')
    if (!node) return
    const form = node as HTMLFormElement
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit()
      return
    }
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }, [])

  const handleEditingKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!editing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditing(false)
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        submitActiveForm()
      }
    },
    [editing, submitActiveForm],
  )

  const handleActivate = React.useCallback(() => {
    if (loading || editing) return
    setEditing(true)
  }, [editing, loading])

  const handleReadOnlyKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (loading || editing) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setEditing(true)
      }
    },
    [editing, loading],
  )

  React.useEffect(() => {
    if (!resolvedEntityIds.length) {
      setDictionaryLoading(false)
      setDictionaryMapsByField({})
      return
    }
    if (!definitions.length) {
      setDictionaryLoading(false)
      setDictionaryMapsByField({})
      return
    }

    let cancelled = false
    const load = async () => {
      setDictionaryLoading(true)
      try {
        const dictionaryDefs = definitions
          .map((def) => {
            const rawId = typeof def.dictionaryId === 'string' ? def.dictionaryId.trim() : ''
            if (!rawId) return null
            return { keyLower: def.key.toLowerCase(), dictionaryId: rawId }
          })
          .filter((entry): entry is { keyLower: string; dictionaryId: string } => !!entry)

        if (!dictionaryDefs.length) {
          if (!cancelled) setDictionaryMapsByField({})
          return
        }

        const uniqueDictionaryIds = Array.from(new Set(dictionaryDefs.map((entry) => entry.dictionaryId)))
        const mapsByDictionaryId: Record<string, DictionaryMap> = {}

        await Promise.all(
          uniqueDictionaryIds.map(async (dictionaryId) => {
            try {
              const data = await ensureDictionaryEntries(queryClient, dictionaryId, scopeVersion)
              mapsByDictionaryId[dictionaryId] = data.map
            } catch {
              mapsByDictionaryId[dictionaryId] = {}
            }
          }),
        )

        const dictionaryByKey = dictionaryDefs.reduce<Map<string, string>>((acc, entry) => {
          acc.set(entry.keyLower, entry.dictionaryId)
          return acc
        }, new Map())

        const nextMaps: Record<string, DictionaryMap> = {}
        fields.forEach((field) => {
          const id = typeof field.id === 'string' ? field.id : ''
          if (!id) return
          const normalizedKey = id.startsWith('cf_') ? id.slice(3) : id
          const keyLower = normalizedKey.toLowerCase()
          if (!keyLower) return
          const dictionaryId = dictionaryByKey.get(keyLower)
          if (!dictionaryId) return
          nextMaps[id] = mapsByDictionaryId[dictionaryId] ?? {}
        })

        if (!cancelled) {
          setDictionaryMapsByField(nextMaps)
        }
      } catch {
        if (!cancelled) {
          setDictionaryMapsByField({})
        }
      } finally {
        if (!cancelled) {
          setDictionaryLoading(false)
        }
      }
    }

    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [definitions, fields, queryClient, resolvedEntityIds, scopeVersion])

  const handleSubmit = React.useCallback(async (input: Record<string, unknown>) => {
    await onSubmit(input)
    setEditing(false)
  }, [onSubmit])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between group">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setEditing((prev) => !prev)}
          disabled={loading}
          className={editing
            ? 'opacity-100 transition-opacity duration-150'
            : 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100'}
        >
          {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          <span className="sr-only">{editing ? t('ui.forms.actions.cancel') : t('ui.forms.actions.edit')}</span>
        </Button>
      </div>
      <DataLoader
        isLoading={loading}
        loadingMessage={t('customers.people.detail.loading')}
        spinnerSize="md"
        className="min-h-[120px]"
      >
        {editing ? (
          <div
            ref={sectionRef}
            className="rounded-lg border bg-card p-4"
            onKeyDown={handleEditingKeyDown}
          >
            <CrudForm<Record<string, unknown>>
              embedded
              entityId={primaryEntityId}
              entityIds={resolvedEntityIds}
              fields={fields}
              initialValues={values}
              onSubmit={handleSubmit}
              submitLabel={t('customers.people.detail.inline.saveShortcut')}
              isLoading={loading}
            />
          </div>
        ) : (
          <div
            className={cn(
              'rounded-lg border bg-muted/20 p-4 space-y-3 transition hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              loading ? 'cursor-default' : 'cursor-pointer',
            )}
            role="button"
            tabIndex={loading ? -1 : 0}
            onClick={handleActivate}
            onKeyDown={handleReadOnlyKeyDown}
          >
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('entities.customFields.empty')}</p>
            ) : (
              fields.map((field) => (
                <div key={field.id} className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {field.label}
                  </p>
                  <div className="text-sm break-words">
                    {formatFieldValue(field, values?.[field.id], emptyLabel, dictionaryMapsByField[field.id])}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DataLoader>
    </div>
  )
}

export default CustomDataSection
