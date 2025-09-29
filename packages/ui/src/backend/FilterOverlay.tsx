"use client"
import * as React from 'react'
import { Button } from '../primitives/button'

export type FilterOption = { value: string; label: string }

export type FilterDef = {
  id: string
  label: string
  type: 'text' | 'select' | 'checkbox' | 'dateRange' | 'tags'
  options?: FilterOption[]
  // Optional async loader for options (used by select/tags)
  loadOptions?: () => Promise<FilterOption[]>
  multiple?: boolean
  placeholder?: string
  group?: string
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
}

export function FilterOverlay({ title = 'Filters', filters, initialValues, open, onOpenChange, onApply, onClear }: FilterOverlayProps) {
  const [values, setValues] = React.useState<FilterValues>(initialValues)
  React.useEffect(() => setValues(initialValues), [initialValues])

  // Load dynamic options for filters that request it
  const [dynamicOptions, setDynamicOptions] = React.useState<Record<string, FilterOption[]>>({})
  React.useEffect(() => {
    let cancelled = false
    const loadAll = async () => {
      const loaders = filters
        .filter((f): f is FilterDef & { loadOptions: () => Promise<FilterOption[]> } => (f as any).loadOptions != null)
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
  }, [filters])

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
              <h2 className="text-base font-semibold">{title}</h2>
              <button className="text-sm text-muted-foreground" onClick={() => onOpenChange(false)}>Close</button>
            </div>
            {/* Top actions: duplicate Clear/Apply */}
            <div className="px-4 py-2 border-b flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={handleClear}>Clear</Button>
              <Button size="sm" onClick={handleApply} className="inline-flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="opacity-80"><path d="M3 4h18"/><path d="M6 8h12l-3 8H9L6 8z"/></svg>
                Apply
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
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
                        <div className="text-xs text-muted-foreground mb-1">From</div>
                        <input
                          type="date"
                          className="w-full h-9 rounded border px-2 text-sm"
                          value={values[f.id]?.from ?? ''}
                          onChange={(e) => setValue(f.id, { ...(values[f.id] ?? {}), from: e.target.value || undefined })}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">To</div>
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
                          <option value="">—</option>
                          {(f.options || dynamicOptions[f.id] || []).map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {f.type === 'tags' && (() => {
                    const arr: string[] = Array.isArray(values[f.id]) ? values[f.id] : []
                    const options = f.options || dynamicOptions[f.id] || []
                    return (
                      <TagsInput
                        value={arr}
                        suggestions={options.map((o) => o.label)}
                        placeholder={f.placeholder}
                        onChange={(next) => setValue(f.id, next.length ? next : undefined)}
                      />
                    )
                  })()}
                  {f.type === 'checkbox' && (
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!values[f.id]}
                        onChange={(e) => setValue(f.id, e.target.checked ? true : undefined)}
                      />
                      <span className="text-sm">Enable</span>
                    </label>
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

function TagsInput({
  value,
  onChange,
  placeholder,
  suggestions,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  suggestions?: string[]
}) {
  const [input, setInput] = React.useState('')

  const add = (v: string) => {
    const t = v.trim()
    if (!t) return
    if (!value.includes(t)) onChange([...value, t])
  }
  const remove = (t: string) => onChange(value.filter((x) => x !== t))

  const sugg = React.useMemo(() => {
    const s = (suggestions || []).filter((t) => !value.includes(t))
    const q = input.toLowerCase().trim()
    return q ? s.filter((t) => t.toLowerCase().includes(q)) : s.slice(0, 8)
  }, [suggestions, value, input])

  return (
    <div className="w-full rounded border px-2 py-1">
      <div className="flex flex-wrap gap-1">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
          >
            {t}
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => remove(t)}>
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] border-0 outline-none py-1 text-sm"
          value={input}
          placeholder={placeholder || 'Add tag and press Enter'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(input)
              setInput('')
            } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
              remove(value[value.length - 1])
            }
          }}
          onBlur={() => {
            add(input)
            setInput('')
          }}
        />
        {sugg.length ? (
          <div className="basis-full mt-1 flex flex-wrap gap-1">
            {sugg.map((t) => (
              <button key={t} type="button" className="text-xs rounded border px-1.5 py-0.5 hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => add(t)}>
                {t}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
