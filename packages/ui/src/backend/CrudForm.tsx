"use client"
import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '../primitives/button'
import dynamic from 'next/dynamic'
import remarkGfm from 'remark-gfm'

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
  multiple?: boolean
  // for relation/select style fields; if provided, options are loaded on mount
  loadOptions?: () => Promise<CrudFieldOption[]>
  // when type === 'richtext', choose editor implementation
  editor?: 'simple' | 'uiw' | 'html'
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
  // When provided, CrudForm will fetch custom field definitions and append
  // form-editable custom fields automatically to the provided `fields`.
  entityId?: string
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
  entityId,
}: CrudFormProps<TValues>) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, any>>({ ...(initialValues || {}) })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [dynamicOptions, setDynamicOptions] = React.useState<Record<string, CrudFieldOption[]>>({})
  const [cfFields, setCfFields] = React.useState<CrudField[]>([])

  // Auto-append custom fields for this entityId
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!entityId) { setCfFields([]); return }
      try {
        const mod = await import('./utils/customFieldForms')
        const f = await mod.fetchCustomFieldFormFields(entityId)
        if (!cancelled) setCfFields(f)
      } catch {
        if (!cancelled) setCfFields([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [entityId])

  const allFields = React.useMemo(() => {
    if (!cfFields.length) return fields
    const provided = new Set(fields.map(f => f.id))
    const extras = cfFields.filter(f => !provided.has(f.id))
    return [...fields, ...extras]
  }, [fields, cfFields])

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
// Markdown editor using @uiw/react-md-editor (client-only)
type MDProps = { value?: string; onChange: (md: string) => void }
// Use the correct type for the imported component. If @uiw/react-md-editor exports a type for its props, use it.
// Otherwise, define a minimal type here.
type MDEditorProps = {
  value?: string;
  height?: number;
  onChange?: (value?: string) => void;
  previewOptions?: { remarkPlugins?: any[] };
};
const MDEditor = dynamic<MDEditorProps>(() => import('@uiw/react-md-editor'), { ssr: false });
const MarkdownEditor = React.memo(({ value = '', onChange }: MDProps) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const handleChange = React.useCallback((v?: string) => {
    onChange(v ?? '')
    // Try to preserve focus after parent re-render
    requestAnimationFrame(() => {
      const ta = containerRef.current?.querySelector('textarea') as HTMLTextAreaElement | null
      ta?.focus()
    })
  }, [onChange])
  return (
    <div ref={containerRef} data-color-mode="light" className="w-full">
      <MDEditor
        value={value}
        height={220}
        onChange={handleChange}
        previewOptions={{ remarkPlugins: [remarkGfm] }}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

// HTML Rich Text editor (contentEditable) with shortcuts; returns HTML string
type HtmlRTProps = { value?: string; onChange: (html: string) => void }
const HtmlRichTextEditor = React.memo(function HtmlRichTextEditor({ value = '', onChange }: HtmlRTProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const applyingExternal = React.useRef(false)

  // Sync DOM when external value changes (but don't fight user typing)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const current = el.innerHTML
    if (current !== value) {
      applyingExternal.current = true
      el.innerHTML = value || ''
      // release the flag next tick
      requestAnimationFrame(() => { applyingExternal.current = false })
    }
  }, [value])

  const exec = (cmd: string, arg?: string) => {
    const el = ref.current
    if (!el) return
    el.focus()
    try {
      document.execCommand(cmd, false, arg)
      onChange(el.innerHTML)
    } catch (_) {}
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.metaKey || e.ctrlKey
    if (!isMod) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); exec('bold') }
    if (k === 'i') { e.preventDefault(); exec('italic') }
    if (k === 'u') { e.preventDefault(); exec('underline') }
  }

  return (
    <div className="w-full rounded border">
      <div className="flex items-center gap-1 px-2 py-1 border-b">
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>Bold</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>Italic</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>Underline</button>
        <span className="mx-2 text-muted-foreground">|</span>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>• List</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', '<h3>')}>H3</button>
        <button
          type="button"
          className="px-2 py-0.5 text-xs rounded hover:bg-muted"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt('Link URL')?.trim()
            if (url) exec('createLink', url)
          }}
        >Link</button>
      </div>
      <div
        ref={ref}
        className="w-full px-2 py-2 min-h-[160px] focus:outline-none prose prose-sm max-w-none"
        contentEditable
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onInput={(e) => {
          if (applyingExternal.current) return
          onChange((e.target as HTMLDivElement).innerHTML)
        }}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

// Very simple markdown editor with Bold/Italic/Underline + shortcuts.
type SimpleMDProps = { value?: string; onChange: (md: string) => void }
const SimpleMarkdownEditor = React.memo(function SimpleMarkdownEditor({ value = '', onChange }: SimpleMDProps) {
  const taRef = React.useRef<HTMLTextAreaElement | null>(null)

  const wrap = (before: string, after: string = before) => {
    const el = taRef.current
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isMod = e.metaKey || e.ctrlKey
    if (!isMod) return
    const key = e.key.toLowerCase()
    if (key === 'b') { e.preventDefault(); wrap('**') }
    if (key === 'i') { e.preventDefault(); wrap('_') }
    if (key === 'u') { e.preventDefault(); wrap('__') }
  }

  return (
    <div className="w-full rounded border">
      <div className="flex items-center gap-1 px-2 py-1 border-b">
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')}>Bold</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('_')}>Italic</button>
        <button type="button" className="px-2 py-0.5 text-xs rounded hover:bg-muted" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('__')}>Underline</button>
      </div>
      <textarea
        ref={taRef}
        className="w-full min-h-[160px] resize-y px-2 py-2 font-mono text-sm outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write markdown..."
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

  // Load dynamic options for fields that require it
  React.useEffect(() => {
    let cancelled = false
    const loadAll = async () => {
      const loaders = allFields
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
  }, [allFields])

  // no auto-focus; let the browser/user manage focus

  const grid = twoColumn ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'

  type FieldControlProps = {
    f: CrudField
    value: any
    error?: string
    options: CrudFieldOption[]
    idx: number
    setValue: (id: string, v: any) => void
  }

  const FieldControl = React.useMemo(() => React.memo(function FieldControlImpl({ f, value, error, options, idx, setValue }: FieldControlProps) {
    return (
      <div className="space-y-1">
        <label className="block text-sm font-medium">
          {f.label}
          {f.required ? <span className="text-red-600"> *</span> : null}
        </label>
        {f.type === 'text' && (
          <input type="text" className="w-full h-9 rounded border px-2" placeholder={(f as any).placeholder} value={value ?? ''} onChange={(e) => setValue(f.id, e.target.value)} />
        )}
        {f.type === 'number' && (
          <input type="number" className="w-full h-9 rounded border px-2" placeholder={(f as any).placeholder} value={value ?? ''}
                 onChange={(e) => setValue(f.id, e.target.value === '' ? undefined : Number(e.target.value))} />
        )}
        {f.type === 'date' && (
          <input type="date" className="w-full h-9 rounded border px-2" value={value ?? ''} onChange={(e) => setValue(f.id, e.target.value || undefined)} />
        )}
        {f.type === 'textarea' && (
          <textarea className="w-full rounded border px-2 py-2 min-h-[120px]" placeholder={(f as any).placeholder} value={value ?? ''} onChange={(e) => setValue(f.id, e.target.value)} />
        )}
        {f.type === 'richtext' && ((f as any).editor === 'simple') && (
          <SimpleMarkdownEditor value={String(value ?? '')} onChange={(md) => setValue(f.id, md)} />
        )}
        {f.type === 'richtext' && ((f as any).editor === 'html') && (
          <HtmlRichTextEditor value={String(value ?? '')} onChange={(html) => setValue(f.id, html)} />
        )}
        {f.type === 'richtext' && (!('editor' in f) || ((f as any).editor !== 'simple' && (f as any).editor !== 'html')) && (
          <MarkdownEditor value={String(value ?? '')} onChange={(md) => setValue(f.id, md)} />
        )}
        {f.type === 'tags' && (
          <TagsInput value={Array.isArray(value) ? (value as string[]) : []} onChange={(v) => setValue(f.id, v)} placeholder={(f as any).placeholder} />
        )}
        {f.type === 'checkbox' && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={!!value} onChange={(e) => setValue(f.id, e.target.checked)} />
            <span className="text-sm text-muted-foreground">Enable</span>
          </label>
        )}
        {f.type === 'select' && !((f as any).multiple) && (
          <select className="w-full h-9 rounded border px-2" value={value ?? ''} onChange={(e) => setValue(f.id, e.target.value || undefined)}>
            <option value="">—</option>
            {options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
        )}
        {f.type === 'select' && ((f as any).multiple) && (
          <div className="space-y-1">
            {options.map((opt) => {
              const arr: string[] = Array.isArray(value) ? (value as string[]) : []
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
        )}
        {f.type === 'relation' && (
          <RelationSelect options={options} placeholder={(f as any).placeholder} value={value ?? ''} onChange={(v) => setValue(f.id, v)} />
        )}
        {f.type === 'custom' && (
          <>{(f as any).component({ id: f.id, value, error, autoFocus: idx === 0, setValue: (v: any) => setValue(f.id, v) })}</>
        )}
        {(f as any).description ? (
          <div className="text-xs text-muted-foreground">{(f as any).description}</div>
        ) : null}
        {error ? (
          <div className="text-xs text-red-600">{error}</div>
        ) : null}
      </div>
    )
  }, (prev, next) => prev.f.id === next.f.id && prev.value === next.value && prev.error === next.error && prev.options === next.options), [])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {backHref ? (
          <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
            ← Back
          </Link>
        ) : null}
        {title ? <div className="text-base font-medium">{title}</div> : null}
      </div>
      <div>
        <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-4 space-y-4">
          <div className={grid}>
          {allFields.map((f, idx) => (
            <FieldControl
              key={f.id}
              f={f}
              value={values[f.id]}
              error={errors[f.id]}
              options={f.options || dynamicOptions[f.id] || []}
              idx={idx}
              setValue={setValue}
            />
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
