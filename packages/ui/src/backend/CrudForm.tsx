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
  const firstFieldRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement | null>(null)

  const setValue = (id: string, v: any) => setValues((prev) => ({ ...prev, [id]: v }))

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

const RichTextEditor = React.forwardRef<HTMLDivElement, { value?: string; onChange: (html: string) => void }>(
  function RichTextEditor({ value, onChange }, ref) {
    const editorRef = React.useRef<HTMLDivElement | null>(null)
    const composedRef = (node: HTMLDivElement | null) => {
      editorRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref && typeof ref === 'object') (ref as any).current = node
    }
    const hasUserInputRef = React.useRef(false)

    React.useEffect(() => {
      const el = editorRef.current
      if (!el) return
      const current = el.innerHTML
      if (!hasUserInputRef.current) {
        if ((value ?? '') !== current) el.innerHTML = value ?? ''
      }
    }, [value])

    const exec = (cmd: 'bold' | 'italic' | 'underline') => {
      const el = editorRef.current
      if (!el) return
      el.focus()
      try {
        document.execCommand(cmd)
        // update value after command
        onChange(el.innerHTML)
      } catch (_) {}
    }

    return (
      <div className="w-full rounded border">
        <div className="flex items-center gap-1 px-2 py-1 border-b">
          <button type="button" className="px-2 py-0.5 text-sm hover:bg-muted rounded" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
            B
          </button>
          <button type="button" className="px-2 py-0.5 text-sm italic hover:bg-muted rounded" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
            I
          </button>
          <button type="button" className="px-2 py-0.5 text-sm underline hover:bg-muted rounded" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
            U
          </button>
        </div>
        <div
          ref={composedRef}
          className="w-full px-2 py-2 min-h-[140px] prose prose-sm max-w-none focus:outline-none"
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => {
            hasUserInputRef.current = true
            onChange((e.target as HTMLDivElement).innerHTML)
          }}
        />
      </div>
    )
  }
)

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

  React.useEffect(() => {
    // autofocus first field on mount
    firstFieldRef.current?.focus()
  }, [])

  const grid = twoColumn ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Mobile: fullscreen; Desktop: card
    return (
      <div className="md:static md:p-0 md:bg-transparent md:h-auto">
        <div className="fixed inset-0 z-40 bg-background p-0 md:static md:z-auto md:bg-transparent md:p-0 md:block">
          <div className="flex h-full w-full flex-col md:block">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 md:rounded-t-lg md:border-b md:px-4 md:py-3">
              {backHref ? (
                <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
                  ← Back
                </Link>
              ) : null}
              {title ? <div className="text-base font-medium">{title}</div> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 md:p-0">{children}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <Wrapper>
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
                  ref={idx === 0 ? (firstFieldRef as any) : undefined}
                  type="text"
                  className="w-full h-9 rounded border px-2"
                  placeholder={f.placeholder}
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValue(f.id, e.target.value)}
                />
              )}
              {f.type === 'number' && (
                <input
                  ref={idx === 0 ? (firstFieldRef as any) : undefined}
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
                  ref={idx === 0 ? (firstFieldRef as any) : undefined}
                  type="date"
                  className="w-full h-9 rounded border px-2"
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValue(f.id, e.target.value || undefined)}
                />
              )}
              {f.type === 'textarea' && (
                <textarea
                  ref={idx === 0 ? (firstFieldRef as any) : undefined}
                  className="w-full rounded border px-2 py-2 min-h-[120px]"
                  placeholder={f.placeholder}
                  value={values[f.id] ?? ''}
                  onChange={(e) => setValue(f.id, e.target.value)}
                />
              )}
              {f.type === 'richtext' && (
                <RichTextEditor
                  ref={idx === 0 ? (firstFieldRef as any) : undefined}
                  value={values[f.id] as string}
                  onChange={(html) => setValue(f.id, html)}
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
                    ref={idx === 0 ? (firstFieldRef as any) : undefined}
                    type="checkbox"
                    checked={!!values[f.id]}
                    onChange={(e) => setValue(f.id, e.target.checked)}
                  />
                  <span className="text-sm text-muted-foreground">Enable</span>
                </label>
              )}
              {f.type === 'select' && (
                <select
                  ref={idx === 0 ? (firstFieldRef as any) : undefined}
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
    </Wrapper>
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
