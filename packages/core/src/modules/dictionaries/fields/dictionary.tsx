"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { DictionarySelectControl } from '../components/DictionarySelectControl'
import { useDictionaryEntries } from '../components/hooks/useDictionaryEntries'

type DictionaryFieldDefinition = {
  dictionaryId?: string
  dictionaryInlineCreate?: boolean
  defaultValue?: string
}

type Props = CrudCustomFieldRenderProps & { def?: DictionaryFieldDefinition }

type DictionarySummary = {
  id: string
  name: string
  key: string
  isActive: boolean
}

function DictionaryDefaultSelector({
  dictionaryId,
  defaultValue,
  onChange,
}: {
  dictionaryId: string
  defaultValue: string
  onChange: (value: string) => void
}) {
  const t = useT()
  const { data, isLoading } = useDictionaryEntries(dictionaryId)
  const entries = data?.entries ?? []
  const isStale = defaultValue && entries.length > 0 && !entries.some((e) => e.value === defaultValue)

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {t('dictionaries.customFields.defaultValue', 'Default value')}
      </label>
      <Select
        value={defaultValue || undefined}
        onValueChange={(next) => onChange(next ?? '')}
      >
        <SelectTrigger size="sm">
          <SelectValue placeholder={t('dictionaries.customFields.defaultValueNone', 'No default')} />
        </SelectTrigger>
        <SelectContent>
          {entries.map((entry) => (
            <SelectItem key={entry.value} value={entry.value}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">
          {t('dictionaries.customFields.loading', 'Loading dictionaries…')}
        </p>
      ) : null}
      {isStale ? (
        <p className="text-xs text-amber-600">
          {t('dictionaries.customFields.defaultValueStale', 'Default entry not found — it may have been deleted or renamed.')}
        </p>
      ) : null}
    </div>
  )
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
        const call = await apiCall<{ items?: unknown[]; error?: string }>(
          '/api/dictionaries?includeInactive=true',
        )
        if (!call.ok) {
          const message =
            typeof call.result?.error === 'string' ? call.result.error : 'Failed to load dictionaries'
          throw new Error(message)
        }
        const entries = Array.isArray(call.result?.items) ? call.result!.items : []
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
    <div className="mt-3 space-y-3 rounded border border-dashed border-muted-foreground/40 bg-muted/30 p-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t('dictionaries.customFields.dictionaryLabel', 'Dictionary source')}
        </label>
        <Select
          value={selectedId || undefined}
          onValueChange={(next) => onChange({ dictionaryId: next || undefined })}
        >
          <SelectTrigger size="sm">
            <SelectValue placeholder={t('dictionaries.customFields.dictionaryPlaceholder', 'Select a dictionary')} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
                {item.isActive ? '' : ` (${t('dictionaries.customFields.inactive', 'inactive')})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
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
      {selectedId ? (
        <DictionaryDefaultSelector
          dictionaryId={selectedId}
          defaultValue={typeof def?.configJson?.defaultValue === 'string' ? def.configJson.defaultValue : ''}
          onChange={(value) => onChange({ defaultValue: value || undefined })}
        />
      ) : null}
    </div>
  )
}

function DictionaryFieldInput({ value, setValue, disabled, def }: Props) {
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
      onChange={(next) => setValue(next ?? undefined)}
      allowInlineCreate={def?.dictionaryInlineCreate !== false}
      disabled={disabled}
    />
  )
}

FieldRegistry.register('dictionary', {
  input: DictionaryFieldInput,
  defEditor: (props) => <DictionaryFieldDefEditor {...props} />,
})
