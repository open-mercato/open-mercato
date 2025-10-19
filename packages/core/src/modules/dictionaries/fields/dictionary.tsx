"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useT } from '@/lib/i18n/context'
import { DictionarySelectControl } from '../components/DictionarySelectControl'

type DictionaryFieldDefinition = {
  dictionaryId?: string
  dictionaryInlineCreate?: boolean
}

type Props = CrudCustomFieldRenderProps & { def?: DictionaryFieldDefinition }

type DictionarySummary = {
  id: string
  name: string
  key: string
  isActive: boolean
}

function DictionaryFieldDefEditor({ def, onChange }: { def: { configJson?: DictionaryFieldDefinition } | undefined; onChange: (patch: Partial<DictionaryFieldDefinition>) => void }) {
  const t = useT()
  const [items, setItems] = React.useState<DictionarySummary[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const selectedId = typeof def?.configJson?.dictionaryId === 'string' ? def?.configJson?.dictionaryId : ''
  const inlineCreate = def?.configJson?.dictionaryInlineCreate !== false

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await apiFetch('/api/dictionaries?includeInactive=true')
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to load dictionaries')
        }
        const entries = Array.isArray(json?.items) ? json.items : []
        if (!cancelled) {
          setItems(
            entries.map((entry: any) => ({
              id: String(entry.id),
              name: typeof entry.name === 'string' && entry.name.trim().length ? entry.name : String(entry.key ?? entry.id),
              key: typeof entry.key === 'string' ? entry.key : '',
              isActive: entry.isActive !== false,
            })),
          )
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load dictionaries list', err)
          setError(t('dictionaries.customFields.errorLoad', 'Failed to load dictionaries.'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [t])

  const manageHref = '/backend/config/dictionaries'

  return (
    <div className="mt-3 space-y-3 rounded border border-dashed border-muted-foreground/40 bg-muted/10 p-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t('dictionaries.customFields.dictionaryLabel', 'Dictionary source')}
        </label>
        <select
          className="w-full rounded border px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={selectedId}
          onChange={(event) => onChange({ dictionaryId: event.target.value || undefined })}
        >
          <option value="">{t('dictionaries.customFields.dictionaryPlaceholder', 'Select a dictionary')}</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {item.isActive ? '' : ` (${t('dictionaries.customFields.inactive', 'inactive')})`}
            </option>
          ))}
        </select>
        {loading ? (
          <p className="text-xs text-muted-foreground">
            {t('dictionaries.customFields.loading', 'Loading dictionaries…')}
          </p>
        ) : null}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('dictionaries.customFields.empty', 'No dictionaries available yet. Create one first.')}
          </p>
        ) : null}
      </div>
      {selectedId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/60 px-2 py-1 text-xs text-muted-foreground">
          <span>{t('dictionaries.customFields.selectedHint', 'Entries from this dictionary populate the field.')}</span>
          <a href={manageHref} className="font-medium text-primary hover:underline" target="_blank" rel="noreferrer">
            {t('dictionaries.customFields.manageLink', 'Manage dictionaries')}
          </a>
        </div>
      ) : null}
      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={inlineCreate}
          onChange={(event) => onChange({ dictionaryInlineCreate: event.target.checked })}
          disabled={!selectedId}
        />
        {t('dictionaries.customFields.allowInlineCreate', 'Allow inline creation inside forms')}
      </label>
    </div>
  )
}

function DictionaryFieldInput({ value, onChange, disabled, def }: Props) {
  const t = useT()
  const dictionaryId = def?.dictionaryId
  if (!dictionaryId) {
    return (
      <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
        {t('dictionaries.config.entries.error.load', 'Failed to load dictionary entries.')}
      </div>
    )
  }
  const normalizedValue = typeof value === 'string' ? value : Array.isArray(value) ? String(value[0] ?? '') : undefined
  return (
    <DictionarySelectControl
      dictionaryId={dictionaryId}
      value={normalizedValue ?? ''}
      onChange={(next) => onChange(next ?? undefined)}
      allowInlineCreate={def?.dictionaryInlineCreate !== false}
      disabled={disabled}
    />
  )
}

FieldRegistry.register('dictionary', {
  input: DictionaryFieldInput,
  defEditor: (props) => <DictionaryFieldDefEditor {...props} />,
})
