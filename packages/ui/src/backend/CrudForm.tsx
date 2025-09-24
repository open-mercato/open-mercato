"use client"
import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '../primitives/button'

export type CrudFieldBase = {
  id: string
  label: string
  placeholder?: string
  description?: string // inline field-level help
  required?: boolean
}

export type CrudFieldOption = { value: string; label: string }

export type CrudBuiltinField = CrudFieldBase & {
  type:
    | 'text'
    | 'textarea'
    | 'checkbox'
    | 'select'
    | 'number'
    | 'date'
    | 'tags'
    | 'richtext'
    | 'relation'
  placeholder?: string
  options?: CrudFieldOption[]
  // for relation/select style fields; if provided, options are loaded on mount
  loadOptions?: () => Promise<CrudFieldOption[]>
}

export type CrudCustomFieldRenderProps = {
  id: string
  value: any
  error?: string
  autoFocus?: boolean
  disabled?: boolean
  setValue: (value: any) => void
}

export type CrudCustomField = CrudFieldBase & {
  type: 'custom'
  component: (props: CrudCustomFieldRenderProps) => React.ReactNode
}

export type CrudField = CrudBuiltinField | CrudCustomField

export type CrudFormProps<TValues extends Record<string, any>> = {
  schema?: z.ZodTypeAny
  fields: CrudField[]
  initialValues?: Partial<TValues>
  submitLabel?: string
  cancelHref?: string
  successRedirect?: string
  onSubmit?: (values: TValues) => Promise<void> | void
  twoColumn?: boolean
  title?: string
  backHref?: string
}

export function CrudForm<TValues extends Record<string, any>>({
  schema,
  fields,
  initialValues,
  submitLabel = 'Save',
  cancelHref,
  successRedirect,
  onSubmit,
  twoColumn = false,
  title,
  backHref,
}: CrudFormProps<TValues>) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, any>>({ ...(initialValues || {}) })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [dynamicOptions, setDynamicOptions] = React.useState<Record<string, CrudFieldOption[]>>({})

  const setValue = (id: string, v: any) => setValues((prev) => ({ ...prev, [id]: v }))

  // Sync when initialValues change (e.g., edit form loads data async)
  React.useEffect(() => {
    if (initialValues) {
      setValues((prev) => ({ ...prev, ...(initialValues as any) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setErrors({})

    let parsed: any = values
    if (schema) {
      const res = (schema as z.ZodTypeAny).safeParse(values)
      if (!res.success) {
        const fieldErrors: Record<string, string> = {}
        res.error.issues.forEach((iss) => {
          if (iss.path && iss.path.length) fieldErrors[String(iss.path[0])] = iss.message
        })
        setErrors(fieldErrors)
        return
      }
      parsed = res.data
    }

    setPending(true)
    try {
      await onSubmit?.(parsed)
      if (successRedirect) router.push(successRedirect)
    } catch (err: any) {
      setFormError(err?.message || 'Unexpected error')
    } finally {
      setPending(false)
  }
}

type RTEProps = { value?: string; onChange: (html: string) => void }
// Simple Markdown editor: returns markdown string, no preview, no deps
type MDProps = { value?: string; onChange: (md: string) => void }
const MarkdownEditor = ({ value = '', onChange }: MDProps) => {
  const ref = React.useRef<HTMLTextAreaElement | null>(null)

  const applyWrap = (before: string, after: string = before) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const sel = value.slice(start, end) || 'text'
    const next = value.slice(0, start) + before + sel + after + value.slice(end)
    onChange(next)
    queueMicrotask(() => {
      const caret = start + before.length + sel.length + after.length
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  const applyLinePrefix = (prefix: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    const before = value.slice(0, start)
    const sel = value.slice(start, end) || ''
    const after = value.slice(end)
    const lines = (sel || value).slice(start, end || undefined).split('\n')
    const transformed = (sel ? sel : value)
      .slice(start, end || undefined)
      .split('\n')
      .map((l) => (l ? `${prefix}${l}` : prefix))
      .join('\n')
    const next = sel ? before + transformed + after : value.slice(0, start) + prefix + value.slice(start)
    onChange(next)
    queueMicrotask(() => {
      const caret = start + prefix.length
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="w-full rounded border">
      <div className="flex items-center gap-1 px-2 py-1 border-b">
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => applyWrap('**')}>Bold</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => applyWrap('_')}>Italic</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => applyLinePrefix('# ')}>H1</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => applyLinePrefix('- ')}>List</button>
      </div>
      <textarea
        ref={ref}
        className="w-full min-h-[160px] resize-y px-2 py-2 font-mono text-sm outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write markdown..."
      />
    </div>
  )
}

  // Load dynamic options for fields that require it
  React.useEffect(() => {
    let cancelled = false
    const loadAll = async () => {
      const loaders = fields
        .filter((f): f is CrudBuiltinField & { loadOptions: () => Promise<CrudFieldOption[]> } =>
          (f as any).loadOptions != null
        )
        .map(async (f) => {
          try {
            const opts = await (f as any).loadOptions()
            if (!cancelled) setDynamicOptions((prev) => ({ ...prev, [f.id]: opts }))
          } catch (_) {
            // ignore
          }
        })
      await Promise.all(loaders)
    }
    loadAll()
    return () => {
      cancelled = true
    }
  }, [fields])

  // no auto-focus; let the browser/user manage focus

  const grid = twoColumn ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'

  return (
    <div className="md:static md:p-0 md:bg-transparent md:h-auto">
      <div className="fixed inset-0 z-40 bg-background p-0 md:static md:z-auto md:bg-transparent md:p-0 md:block">
        <div className="flex h-full w-full flex-col md:block">
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 md:border-0 md:px-4 md:py-3">
            {backHref ? (
              <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
                ← Back
              </Link>
            ) : null}
            {title ? <div className="text-base font-medium">{title}</div> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 md:p-0">
            <form onSubmit={handleSubmit} className="md:rounded-lg md:border md:bg-card md:p-4 space-y-4">
        <div className={grid}>
          {fields.map((f, idx) => (
            <div key={f.id} className="space-y-1">
              <label className="block text-sm font-medium">
                {f.label}
                {f.required ? <span className="text-red-600"> *</span> : null}
              </label>
              {f.type === 'text' && (
                <input
                  type="text"
                  className="w-full h-9 rounded border px-2"
                  placeholder={f.placeholder}
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValue(f.id, e.target.value)}
                />
              )}
              {f.type === 'number' && (
                <input
                  type="number"
                  className="w-full h-9 rounded border px-2"
                  placeholder={f.placeholder}
                  value={values[f.id] ?? ''}
                  onChange={(e) =>
                    setValue(f.id, e.target.value === '' ? undefined : Number(e.target.value))
                  }
                />
              )}
              {f.type === 'date' && (
                <input
                  type="date"
                  className="w-full h-9 rounded border px-2"
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValue(f.id, e.target.value || undefined)}
                />
              )}
              {f.type === 'textarea' && (
                <textarea
                  className="w-full rounded border px-2 py-2 min-h-[120px]"
                  placeholder={f.placeholder}
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValue(f.id, e.target.value)}
                />
              )}
              {f.type === 'richtext' && (
                <MarkdownEditor
                  value={String(values[f.id] ?? '')}
                  onChange={(md) => setValue(f.id, md)}
                />
              )}
              {f.type === 'tags' && (
                <TagsInput
                  value={Array.isArray(values[f.id]) ? (values[f.id] as string[]) : []}
                  onChange={(v) => setValue(f.id, v)}
                  placeholder={f.placeholder}
                />
              )}
              {f.type === 'checkbox' && (
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!values[f.id]}
                    onChange={(e) => setValue(f.id, e.target.checked)}
                  />
                  <span className="text-sm text-muted-foreground">Enable</span>
                </label>
              )}
              {f.type === 'select' && (
                <select
                  className="w-full h-9 rounded border px-2"
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValue(f.id, e.target.value || undefined)}
                >
                  <option value="">—</option>
                  {(f.options || dynamicOptions[f.id] || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
              {f.type === 'relation' && (
                <RelationSelect
                  options={f.options || dynamicOptions[f.id] || []}
                  placeholder={f.placeholder}
                  value={values[f.id] ?? ''}
                  onChange={(v) => setValue(f.id, v)}
                />
              )}
              {f.type === 'custom' && (
                <>{f.component({ id: f.id, value: values[f.id], error: errors[f.id], autoFocus: idx === 0, setValue: (v) => setValue(f.id, v) })}</>
              )}
              {f.description ? (
                <div className="text-xs text-muted-foreground">{f.description}</div>
              ) : null}
              {errors[f.id] ? (
                <div className="text-xs text-red-600">{errors[f.id]}</div>
              ) : null}
            </div>
          ))}
        </div>
        {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
        <div className="flex items-center justify-end gap-2">
          {cancelHref ? (
            <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
              Cancel
            </Link>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

function TagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = React.useState('')

  const add = (v: string) => {
    const t = v.trim()
    if (!t) return
    if (!value.includes(t)) onChange([...value, t])
  }
  const remove = (t: string) => onChange(value.filter((x) => x !== t))

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
      </div>
    </div>
  )
}

function RelationSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: CrudFieldOption[]
  placeholder?: string
}) {
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [query, options])

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        className="w-full h-9 rounded border px-2"
        placeholder={placeholder || 'Search...'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-40 overflow-auto rounded border">
        <button
          type="button"
          className="block w-full text-left px-2 py-1 text-sm hover:bg-muted"
          onClick={() => onChange('')}
        >
          —
        </button>
        {filtered.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`block w-full text-left px-2 py-1 text-sm hover:bg-muted ${
              value === opt.value ? 'bg-muted' : ''
            }`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
