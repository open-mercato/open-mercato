"use client"
import * as React from 'react'
import { Button } from '../primitives/button'

export type FilterOption = { value: string; label: string }

export type FilterDef = {
  id: string
  label: string
  type: 'text' | 'select' | 'checkbox' | 'dateRange'
  options?: FilterOption[]
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
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {filters.map((f) => (
                <div key={f.id} className="space-y-2">
                  <div className="text-sm font-medium">{f.label}</div>
                  {f.type === 'text' && (
                    <input
                      type="text"
                      className="w-full h-9 rounded border px-2"
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
                          className="w-full h-9 rounded border px-2"
                          value={values[f.id]?.from ?? ''}
                          onChange={(e) => setValue(f.id, { ...(values[f.id] ?? {}), from: e.target.value || undefined })}
                        />
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">To</div>
                        <input
                          type="date"
                          className="w-full h-9 rounded border px-2"
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
                          {f.options?.map((opt) => {
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
                          className="w-full h-9 rounded border px-2"
                          value={values[f.id] ?? ''}
                          onChange={(e) => setValue(f.id, e.target.value || undefined)}
                        >
                          <option value="">—</option>
                          {f.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
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
              <Button onClick={handleApply}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
