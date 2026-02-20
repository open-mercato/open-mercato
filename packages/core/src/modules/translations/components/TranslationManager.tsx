"use client"

import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Save, Plus, X } from 'lucide-react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { locales as defaultLocales } from '@open-mercato/shared/lib/i18n/config'
import { ISO_639_1, isValidIso639, getIso639Label } from '@open-mercato/shared/lib/i18n/iso639'
import { formatEntityLabel, buildEntityListUrl, getRecordLabel } from '../lib/helpers'
import { resolveFieldList } from '../lib/resolve-field-list'
import type { ResolvedField } from '../lib/resolve-field-list'

type TranslationManagerProps = {
  entityType?: string
  recordId?: string
  baseValues?: Record<string, unknown>
  translatableFields?: string[]
  mode?: 'standalone' | 'embedded'
  compact?: boolean
}

type EntityOption = { entityId: string; label?: string; source?: string }

type TranslationsResponse = {
  entityType: string
  entityId: string
  translations: Record<string, Record<string, unknown>>
  createdAt?: string
  updatedAt?: string
}

function useTranslationLocales() {
  return useQuery<string[]>({
    queryKey: ['translation-locales'],
    queryFn: async () => {
      const res = await apiCall<{ locales: string[] }>('/api/translations/locales')
      if (!res.ok) return [...defaultLocales]
      return Array.isArray(res.result?.locales) && res.result.locales.length > 0
        ? res.result.locales
        : [...defaultLocales]
    },
    staleTime: 60_000,
  })
}

export function TranslationManager({
  entityType: propEntityType,
  recordId: propRecordId,
  baseValues: propBaseValues,
  translatableFields: propTranslatableFields,
  mode = 'standalone',
  compact = false,
}: TranslationManagerProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const isEmbedded = mode === 'embedded'

  const [selectedEntityType, setSelectedEntityType] = React.useState(propEntityType ?? '')
  const [selectedRecordId, setSelectedRecordId] = React.useState(propRecordId ?? '')
  const [activeLocale, setActiveLocale] = React.useState('')
  const [editedTranslations, setEditedTranslations] = React.useState<Record<string, Record<string, string>>>({})
  const [hasUserEdited, setHasUserEdited] = React.useState(false)

  const entityType = isEmbedded ? (propEntityType ?? '') : selectedEntityType
  const recordId = isEmbedded ? (propRecordId ?? '') : selectedRecordId

  const { data: locales = [...defaultLocales] } = useTranslationLocales()

  React.useEffect(() => {
    if (locales.length > 0 && (!activeLocale || !locales.includes(activeLocale))) {
      setActiveLocale(locales[0])
    }
  }, [locales, activeLocale])

  React.useEffect(() => {
    if (isEmbedded && propEntityType) setSelectedEntityType(propEntityType)
  }, [isEmbedded, propEntityType])

  React.useEffect(() => {
    if (isEmbedded && propRecordId) setSelectedRecordId(propRecordId)
  }, [isEmbedded, propRecordId])

  const { data: entities, isLoading: loadingEntities, error: entitiesError } = useQuery<{ items: EntityOption[] }>({
    queryKey: ['entities-list', scopeVersion],
    enabled: !isEmbedded,
    queryFn: async () =>
      readApiResultOrThrow('/api/entities/entities', undefined, {
        errorMessage: t('translations.manager.errors.loadEntities', 'Failed to load entities'),
      }),
  })

  const entitySuggestions = React.useMemo(
    () =>
      (entities?.items || []).map((item) => ({
        value: item.entityId,
        label: formatEntityLabel(item.entityId, item.label),
        description: item.entityId,
      })),
    [entities],
  )

  const resolveEntityLabel = React.useCallback(
    (value: string) => {
      const match = entities?.items?.find((e) => e.entityId === value)
      return match ? formatEntityLabel(match.entityId, match.label) : formatEntityLabel(value)
    },
    [entities],
  )

  const listUrl = React.useMemo(() => entityType ? buildEntityListUrl(entityType) : null, [entityType])

  const loadRecordSuggestions = React.useCallback(
    async (query?: string) => {
      if (!entityType || !listUrl) return []
      const url = `${listUrl}?pageSize=20${query ? `&search=${encodeURIComponent(query)}` : ''}`
      const res = await apiCall<{ items: Array<Record<string, unknown>> }>(url)
      if (!res.ok) return []
      const items = res.result?.items ?? []
      return items.map((item) => ({
        value: String(item.id ?? ''),
        label: getRecordLabel(item),
      }))
    },
    [entityType, listUrl],
  )

  const { data: recordData } = useQuery<Record<string, unknown> | null>({
    queryKey: ['translation-record-data', entityType, recordId, listUrl, scopeVersion],
    enabled: !isEmbedded && !!entityType && !!recordId && !!listUrl,
    queryFn: async () => {
      const res = await apiCall<{ items: Array<Record<string, unknown>> }>(
        `${listUrl}?id=${encodeURIComponent(recordId)}&ids=${encodeURIComponent(recordId)}&pageSize=1`,
      )
      if (!res.ok) return null
      const items = res.result?.items
      return Array.isArray(items) && items.length > 0 ? items[0] : null
    },
  })

  const baseValues = isEmbedded ? (propBaseValues ?? {}) : (recordData ?? {})

  const resolveRecordLabel = React.useCallback(
    (value: string) => {
      if (recordData) return getRecordLabel(recordData)
      return value
    },
    [recordData],
  )

  const { data: fieldDefs = [], isLoading: loadingFieldDefs } = useCustomFieldDefs(entityType ? [entityType] : [], {
    enabled: !!entityType,
  })

  const fieldList = React.useMemo(
    () => resolveFieldList(entityType, propTranslatableFields, fieldDefs as Array<{ key: string; kind: string; label?: string }>),
    [entityType, propTranslatableFields, fieldDefs],
  )

  const {
    data: translationData,
    isLoading: loadingTranslation,
    isError: translationError,
    refetch: refetchTranslation,
  } = useQuery<TranslationsResponse | null>({
    queryKey: ['entity-translation', entityType, recordId, scopeVersion],
    enabled: !!entityType && !!recordId,
    queryFn: async () => {
      const res = await apiCall<TranslationsResponse>(
        `/api/translations/${encodeURIComponent(entityType)}/${encodeURIComponent(recordId)}`,
      )
      if (!res.ok) {
        if (res.response?.status === 404) return null
        return null
      }
      return res.result ?? null
    },
  })

  const translationSignature = React.useMemo(() => JSON.stringify(translationData ?? null), [translationData])
  const lastTranslationSignatureRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const sig = translationSignature
    if (sig === lastTranslationSignatureRef.current && hasUserEdited) return
    lastTranslationSignatureRef.current = sig

    if (!translationData?.translations) {
      if (!hasUserEdited) setEditedTranslations({})
      return
    }

    const parsed: Record<string, Record<string, string>> = {}
    for (const [locale, fields] of Object.entries(translationData.translations)) {
      if (!fields || typeof fields !== 'object') continue
      parsed[locale] = {}
      for (const [key, val] of Object.entries(fields)) {
        parsed[locale][key] = typeof val === 'string' ? val : ''
      }
    }
    if (!hasUserEdited) setEditedTranslations(parsed)
  }, [translationSignature, translationData, hasUserEdited])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entityType || !recordId) {
        throw new Error(t('translations.manager.errors.selectRecord', 'Select an entity and record before saving'))
      }
      const body: Record<string, Record<string, string | null>> = {}
      for (const [locale, fields] of Object.entries(editedTranslations)) {
        const localeFields: Record<string, string | null> = {}
        let hasValues = false
        for (const [key, val] of Object.entries(fields)) {
          if (val && val.trim().length > 0) {
            localeFields[key] = val.trim()
            hasValues = true
          }
        }
        if (hasValues) body[locale] = localeFields
      }
      const res = await apiCall(
        `/api/translations/${encodeURIComponent(entityType)}/${encodeURIComponent(recordId)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        throw new Error(t('translations.manager.errors.save', 'Failed to save translations'))
      }
      return true
    },
    onSuccess: () => {
      flash(t('translations.manager.flash.saved', 'Translations saved'), 'success')
      setHasUserEdited(false)
      void refetchTranslation()
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : t('translations.manager.errors.save', 'Failed to save translations')
      flash(message, 'error')
    },
  })

  const updateFieldValue = (locale: string, fieldKey: string, value: string) => {
    setHasUserEdited(true)
    setEditedTranslations((prev) => ({
      ...prev,
      [locale]: {
        ...prev[locale],
        [fieldKey]: value,
      },
    }))
  }

  const getBaseValue = (fieldKey: string): string => {
    if (!baseValues) return ''
    const candidate = fieldKey in baseValues ? baseValues[fieldKey] : baseValues[`cf_${fieldKey}`]
    if (candidate === undefined || candidate === null) return ''
    return typeof candidate === 'string' ? candidate : String(candidate)
  }

  const renderRecordPicker = () => {
    if (isEmbedded) return null

    return (
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">
          {t('translations.manager.selectRecord', 'Select record')}
        </label>
        <ComboboxInput
          value={selectedRecordId}
          onChange={(next) => {
            setSelectedRecordId(next)
            setHasUserEdited(false)
          }}
          placeholder={t('translations.manager.searchRecords', 'Search records...')}
          loadSuggestions={loadRecordSuggestions}
          resolveLabel={resolveRecordLabel}
          allowCustomValues
          disabled={!entityType}
        />
      </div>
    )
  }

  const renderLocaleTabs = () => (
    <div className="flex gap-1 border-b">
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            activeLocale === locale
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveLocale(locale)}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  )

  const renderFieldTable = () => {
    if (!entityType || !recordId) {
      return (
        <div className="rounded border bg-background/70 p-4 text-sm text-muted-foreground">
          {t('translations.manager.selectFirst', 'Select an entity and record to manage translations.')}
        </div>
      )
    }
    if (loadingTranslation || loadingFieldDefs) {
      return (
        <LoadingMessage
          label={t('translations.manager.loadingTranslations', 'Loading translations...')}
          className="border-0 bg-transparent p-4"
        />
      )
    }
    if (translationError) {
      return (
        <ErrorMessage
          label={t('translations.manager.errors.loadTranslation', 'Failed to load translations')}
          action={(
            <Button variant="outline" size="sm" onClick={() => void refetchTranslation()}>
              {t('translations.manager.actions.retry', 'Retry')}
            </Button>
          )}
        />
      )
    }
    if (!fieldList.length) {
      return (
        <div className="rounded border bg-background/70 p-4 text-sm text-muted-foreground">
          {t('translations.manager.noFields', 'No translatable fields found for this entity type.')}
        </div>
      )
    }

    const localeTranslations = editedTranslations[activeLocale] ?? {}

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left w-[140px]">
                {t('translations.manager.fields.field', 'Field')}
              </th>
              {!compact && (
                <th className="px-3 py-2 text-left">
                  {t('translations.manager.fields.baseValue', 'Base value')}
                </th>
              )}
              <th className="px-3 py-2 text-left">
                {t('translations.manager.fields.translation', 'Translation')} ({activeLocale.toUpperCase()})
              </th>
            </tr>
          </thead>
          <tbody>
            {fieldList.map((field) => {
              const baseVal = getBaseValue(field.key)
              const translatedVal = localeTranslations[field.key] ?? ''

              return (
                <tr key={field.key} className="border-t">
                  <td className="px-3 py-2 align-top text-xs font-medium text-muted-foreground">
                    {field.label}
                  </td>
                  {!compact && (
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground max-w-[200px]">
                      {baseVal ? (
                        <span className="line-clamp-3">{baseVal}</span>
                      ) : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2 align-top">
                    {field.multiline ? (
                      <textarea
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        rows={3}
                        value={translatedVal}
                        onChange={(e) => updateFieldValue(activeLocale, field.key, e.target.value)}
                        placeholder={baseVal || field.label}
                      />
                    ) : (
                      <Input
                        value={translatedVal}
                        onChange={(e) => updateFieldValue(activeLocale, field.key, e.target.value)}
                        placeholder={baseVal || field.label}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (entityType && recordId && !mutation.isPending) mutation.mutate()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [entityType, recordId, mutation])

  if (compact) {
    return (
      <div className="space-y-3">
        {renderLocaleTabs()}
        {renderFieldTable()}
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !entityType || !recordId}
          >
            <Save className="mr-2 h-3 w-3" />
            {mutation.isPending
              ? t('translations.manager.actions.saving', 'Saving...')
              : t('translations.manager.actions.save', 'Save translations')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{t('translations.manager.title', 'Translations')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('translations.manager.description', 'Manage translations for entity records across supported locales.')}
          </p>
        </div>

        {!isEmbedded && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">
                  {t('translations.manager.selectEntity', 'Choose entity')}
                </label>
                <div className="mt-1">
                  <ComboboxInput
                    value={selectedEntityType}
                    onChange={(next) => {
                      setSelectedEntityType(next)
                      setSelectedRecordId('')
                      setHasUserEdited(false)
                    }}
                    placeholder={t('translations.manager.placeholder', 'Select an entity')}
                    suggestions={entitySuggestions}
                    resolveLabel={resolveEntityLabel}
                    disabled={loadingEntities || !!entitiesError}
                  />
                </div>
                {entitiesError && (
                  <p className="mt-1 text-xs text-red-600">
                    {t('translations.manager.errors.loadEntities', 'Failed to load entities')}
                  </p>
                )}
              </div>
              {renderRecordPicker()}
            </div>
          </div>
        )}

        <div className="rounded-lg border bg-background/70 p-4">
          {renderLocaleTabs()}
          <div className="mt-3">
            {renderFieldTable()}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || loadingEntities || !!entitiesError || !entityType || !recordId}
          >
            <Save className="mr-2 h-4 w-4" />
            {mutation.isPending
              ? t('translations.manager.actions.saving', 'Saving...')
              : t('translations.manager.actions.save', 'Save translations')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function LocaleManager() {
  const t = useT()
  const queryClient = useQueryClient()
  const { data: locales = [], isLoading } = useTranslationLocales()
  const [newLocale, setNewLocale] = React.useState('')

  const mutation = useMutation({
    mutationFn: async (updatedLocales: string[]) => {
      const res = await apiCall<{ locales: string[] }>('/api/translations/locales', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locales: updatedLocales }),
      })
      if (!res.ok) throw new Error('Failed to save locales')
      return res.result?.locales ?? updatedLocales
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['translation-locales'], result)
      flash(t('translations.locales.flash.saved', 'Locales updated'), 'success')
    },
    onError: () => {
      flash(t('translations.locales.flash.error', 'Failed to update locales'), 'error')
    },
  })

  const availableLocales = React.useMemo(
    () => ISO_639_1.filter((entry) => !locales.includes(entry.code)).map((entry) => ({
      value: entry.code,
      label: `${entry.code.toUpperCase()} — ${entry.label}`,
    })),
    [locales],
  )

  const addLocale = () => {
    const code = newLocale.toLowerCase().trim()
    if (!code || !isValidIso639(code) || locales.includes(code)) return
    mutation.mutate([...locales, code])
    setNewLocale('')
  }

  const removeLocale = (locale: string) => {
    if (locales.length <= 1) return
    mutation.mutate(locales.filter((l) => l !== locale))
  }

  if (isLoading) {
    return <LoadingMessage label={t('translations.locales.loading', 'Loading locales...')} className="border-0 bg-transparent p-4" />
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{t('translations.locales.title', 'Supported locales')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('translations.locales.description', 'Configure which locales are available for translations. Add ISO language codes (e.g. fr, it, ja, zh).')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {locales.map((locale) => (
          <span
            key={locale}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-sm font-medium"
            title={getIso639Label(locale) ?? locale}
          >
            {locale.toUpperCase()}{getIso639Label(locale) ? ` — ${getIso639Label(locale)}` : ''}
            {locales.length > 1 && (
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => removeLocale(locale)}
                disabled={mutation.isPending}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <div className="max-w-[240px] flex-1">
          <ComboboxInput
            value={newLocale}
            onChange={setNewLocale}
            placeholder={t('translations.locales.addPlaceholder', 'Search language...')}
            suggestions={availableLocales}
            resolveLabel={(value) => {
              const label = getIso639Label(value)
              return label ? `${value.toUpperCase()} — ${label}` : value.toUpperCase()
            }}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={addLocale}
          disabled={mutation.isPending || !newLocale.trim() || !isValidIso639(newLocale) || locales.includes(newLocale.toLowerCase().trim())}
        >
          <Plus className="mr-1 h-3 w-3" />
          {t('translations.locales.add', 'Add')}
        </Button>
      </div>
    </div>
  )
}
