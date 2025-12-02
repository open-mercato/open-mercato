"use client"
import * as React from 'react'
import { Button } from '../primitives/button'
import { TagsInput, type TagsInputOption } from './inputs/TagsInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type FilterOption = { value: string; label: string; description?: string | null }

export type FilterDef = {
  id: string
  label: string
  type: 'text' | 'select' | 'checkbox' | 'dateRange' | 'tags'
  options?: FilterOption[]
  // Optional async loader for options (used by select/tags)
  loadOptions?: (query?: string) => Promise<FilterOption[]>
  multiple?: boolean
  placeholder?: string
  group?: string
  formatValue?: (value: string) => string
  formatDescription?: (value: string) => string | null | undefined
}

export type FilterValues = Record<string, any>

export type FilterOverlayProps = {
  title?: string
  filters: FilterDef[]
  initialValues: FilterValues
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (values: FilterValues) => void
  onClear?: () => void
  extraContent?: React.ReactNode
}

const EMPTY_FILTER_VALUES: FilterValues = {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeKeys(source: FilterValues | null | undefined): string[] {
  if (!source) return []
  return Object.keys(source).filter((key) => source[key] !== undefined)
}

function areFieldValuesEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!areFieldValuesEqual(a[i], b[i])) return false
    }
    return true
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = normalizeKeys(a as FilterValues)
    const keysB = normalizeKeys(b as FilterValues)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!keysB.includes(key)) return false
      if (!areFieldValuesEqual((a as FilterValues)[key], (b as FilterValues)[key])) return false
    }
    return true
  }
  return false
}

function areFilterValuesEqual(a?: FilterValues | null, b?: FilterValues | null): boolean {
  if (a === b) return true
  const keysA = normalizeKeys(a || EMPTY_FILTER_VALUES)
  const keysB = normalizeKeys(b || EMPTY_FILTER_VALUES)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!keysB.includes(key)) return false
    if (!areFieldValuesEqual(a?.[key], b?.[key])) return false
  }
  return true
}

export function FilterOverlay({
  title,
  filters,
  initialValues,
  open,
  onOpenChange,
  onApply,
  onClear,
  extraContent,
}: FilterOverlayProps) {
  const t = useT()
  const defaultTitle = title ?? t('ui.filters.title', 'Filters')
  const [values, setValues] = React.useState<FilterValues>(initialValues)
  React.useEffect(() => {
    setValues((prev) => (areFilterValuesEqual(prev, initialValues) ? prev : initialValues))
  }, [initialValues])
  const filtersSignature = React.useMemo(
    () => filters.map((f) => `${f.id}:${f.type}:${Boolean((f as any).loadOptions)}:${(f.options || []).length}`).join('|'),
    [filters]
  )
  const lastLoadedSignatureRef = React.useRef<string | null>(null)

  // Load dynamic options for filters that request it
  const [dynamicOptions, setDynamicOptions] = React.useState<Record<string, FilterOption[]>>({})
  React.useEffect(() => {
    if (!open) return
    if (lastLoadedSignatureRef.current === filtersSignature) return
    lastLoadedSignatureRef.current = filtersSignature
    setDynamicOptions({})
    let cancelled = false
    const loadAll = async () => {
      const loaders = filters
        .filter((f): f is FilterDef & { loadOptions: (query?: string) => Promise<FilterOption[]> } => (f as any).loadOptions != null)
        .map(async (f) => {
          try {
            const opts = await (f as any).loadOptions()
            if (!cancelled) setDynamicOptions((prev) => ({ ...prev, [f.id]: opts }))
          } catch {
            // ignore
          }
        })
      await Promise.all(loaders)
    }
    loadAll()
    return () => {
      cancelled = true
    }
  }, [filters, filtersSignature, open])
  React.useEffect(() => {
    if (!open) {
      lastLoadedSignatureRef.current = null
    }
  }, [open])

  const setValue = (id: string, v: any) => setValues((prev) => ({ ...prev, [id]: v }))

  const handleApply = () => {
    onApply(values)
    onOpenChange(false)
  }

  const handleClear = () => {
    setValues({})
    onClear?.()
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => onOpenChange(false)} />
          <div className="absolute left-0 top-0 h-full w-full sm:w-[380px] bg-background shadow-xl border-r flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-base font-semibold">{defaultTitle}</h2>
              <button className="text-sm text-muted-foreground" onClick={() => onOpenChange(false)}>{t('common.close')}</button>
            </div>
            {/* Top actions: duplicate Clear/Apply */}
            <div className="px-4 py-2 border-b flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={handleClear}>{t('ui.filters.actions.clear', 'Clear')}</Button>
              <Button size="sm" onClick={handleApply} className="inline-flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="opacity-80"><path d="M3 4h18"/><path d="M6 8h12l-3 8H9L6 8z"/></svg>
                {t('ui.filters.actions.apply', 'Apply')}
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {extraContent ? <div className="space-y-2 rounded-md border bg-muted/30 p-3">{extraContent}</div> : null}
              {filters.map((f) => (
                <div key={f.id} className="space-y-2">
                  <div className="text-sm font-medium">{f.label}</div>
                  {f.type === 'text' && (
                    <input
                      type="text"
                      className="w-full h-9 rounded border px-2 text-sm"
                      placeholder={f.placeholder}
                      value={values[f.id] ?? ''}
                      onChange={(e) => setValue(f.id, e.target.value || undefined)}
                    />
                  )}
                  {f.type === 'dateRange' && (
                    <div className="grid grid-cols-1 gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">{t('ui.filters.dateRange.from', 'From')}</div>
                        <input
                          type="date"
                          className="w-full h-9 rounded border px-2 text-sm"
                          value={values[f.id]?.from ?? ''}
                          onChange={(e) => setValue(f.id, { ...(values[f.id] ?? {}), from: e.target.value || undefined })}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">{t('ui.filters.dateRange.to', 'To')}</div>
                        <input
                          type="date"
                          className="w-full h-9 rounded border px-2 text-sm"
                          value={values[f.id]?.to ?? ''}
                          onChange={(e) => setValue(f.id, { ...(values[f.id] ?? {}), to: e.target.value || undefined })}
                        />
                      </div>
                    </div>
                  )}
                  {f.type === 'select' && (
                    <div className="space-y-1">
                      {f.multiple ? (
                        <div className="flex flex-col gap-1">
                          {(f.options || dynamicOptions[f.id] || []).map((opt) => {
                            const arr: string[] = Array.isArray(values[f.id]) ? values[f.id] : []
                            const checked = arr.includes(opt.value)
                            return (
                              <label key={opt.value} className="inline-flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = new Set(arr)
                                    if (e.target.checked) next.add(opt.value)
                                    else next.delete(opt.value)
                                    setValue(f.id, Array.from(next))
                                  }}
                                />
                                <span className="text-sm">{opt.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <select
                          className="w-full h-9 rounded border px-2 text-sm"
                          value={values[f.id] ?? ''}
                          onChange={(e) => setValue(f.id, e.target.value || undefined)}
                        >
                          <option value="">{t('ui.forms.select.emptyOption', '—')}</option>
                          {(f.options || dynamicOptions[f.id] || []).map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {f.type === 'tags' && (() => {
                    const arr: string[] = Array.isArray(values[f.id]) ? values[f.id] : []
                    const staticOptions = f.options || []
                    const dynamic = dynamicOptions[f.id] || []
                    const optionMap = new Map<string, FilterOption>()
                    staticOptions.forEach((opt) => optionMap.set(opt.value, opt))
                    dynamic.forEach((opt) => optionMap.set(opt.value, opt))
                    const loadSuggestions = (f as any).loadOptions
                      ? async (q?: string) => {
                          try {
                            const opts = await (f as any).loadOptions(q ?? '')
                            setDynamicOptions((prev) => ({ ...prev, [f.id]: opts }))
                            return opts.map((o: FilterOption) => ({
                              value: o.value,
                              label: o.label,
                              description: o.description,
                            }))
                          } catch {
                            return []
                          }
                        }
                      : undefined
                    const resolveTagLabel = f.formatValue
                      ? (val: string) => f.formatValue!(val)
                      : (val: string) => optionMap.get(val)?.label ?? val
                    const resolveTagDescription = f.formatDescription
                      ? (val: string) => f.formatDescription!(val) ?? null
                      : (val: string) => optionMap.get(val)?.description ?? null
                    const suggestionList: TagsInputOption[] = Array.from(optionMap.values()).map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                      description: opt.description ?? null,
                    }))
                    return (
                      <TagsInput
                        value={arr}
                        suggestions={suggestionList}
                        loadSuggestions={loadSuggestions}
                        allowCustomValues={false}
                        resolveLabel={resolveTagLabel}
                        resolveDescription={resolveTagDescription}
                        placeholder={f.placeholder}
                        onChange={(next) => setValue(f.id, next.length ? next : undefined)}
                      />
                    )
                  })()}
                  {f.type === 'checkbox' && (
                    <div>
                      <select
                        className="w-full h-9 rounded border px-2 text-sm"
                        value={values[f.id] === true ? 'true' : values[f.id] === false ? 'false' : ''}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '') setValue(f.id, undefined)
                          else if (v === 'true') setValue(f.id, true)
                          else if (v === 'false') setValue(f.id, false)
                        }}
                      >
                        <option value="">{t('ui.forms.select.emptyOption', '—')}</option>
                        <option value="true">{t('common.yes', 'Yes')}</option>
                        <option value="false">{t('common.no', 'No')}</option>
                      </select>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="p-4 border-t flex items-center justify-between gap-2">
              <Button variant="outline" onClick={handleClear}>Clear</Button>
              <Button onClick={handleApply} className="inline-flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="opacity-80"><path d="M3 4h18"/><path d="M6 8h12l-3 8H9L6 8z"/></svg>
                Apply
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
