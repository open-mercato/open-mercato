"use client"
import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '../primitives/button'
import { DataLoader } from '../primitives/DataLoader'
import { flash } from './FlashMessages'
import dynamic from 'next/dynamic'
import remarkGfm from 'remark-gfm'
import { Trash2, Save } from 'lucide-react'

// Stable empty options array to avoid creating a new [] every render
const EMPTY_OPTIONS: CrudFieldOption[] = []

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
  onDelete?: () => Promise<void> | void
  // Legacy field-only grid toggle. Use `groups` for advanced layout.
  twoColumn?: boolean
  title?: string
  backHref?: string
  // When provided, CrudForm will fetch custom field definitions and append
  // form-editable custom fields automatically to the provided `fields`.
  entityId?: string
  // Optional grouped layout rendered in two responsive columns (1 on mobile).
  groups?: CrudFormGroup[]
  // Loading state for the entire form (e.g., when loading record data)
  isLoading?: boolean
  loadingMessage?: string
}

// Group-level custom component context
export type CrudFormGroupComponentProps = {
  values: Record<string, any>
  setValue: (id: string, v: any) => void
  errors: Record<string, string>
}

// Special group kind for automatic Custom Fields section
export type CrudFormGroup = {
  id: string
  title?: string
  column?: 1 | 2
  description?: string
  // Either list field ids, inline field configs, or mix of both
  fields?: (CrudField | string)[]
  // Inject a custom component into the group card
  component?: (ctx: CrudFormGroupComponentProps) => React.ReactNode
  // When kind === 'customFields', the group renders form-editable custom fields
  kind?: 'customFields'
}

export function CrudForm<TValues extends Record<string, any>>({
  schema,
  fields,
  initialValues,
  submitLabel = 'Save',
  cancelHref,
  successRedirect,
  onSubmit,
  onDelete,
  twoColumn = false,
  title,
  backHref,
  entityId,
  groups,
  isLoading = false,
  loadingMessage = 'Loading data...',
}: CrudFormProps<TValues>) {
  const router = useRouter()
  const formId = React.useId()
  const [values, setValues] = React.useState<Record<string, any>>({ ...(initialValues || {}) })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [dynamicOptions, setDynamicOptions] = React.useState<Record<string, CrudFieldOption[]>>({})
  const [cfFields, setCfFields] = React.useState<CrudField[]>([])
  const [isLoadingCustomFields, setIsLoadingCustomFields] = React.useState(false)

  // Auto-append custom fields for this entityId
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (!entityId) { 
        setCfFields([])
        setIsLoadingCustomFields(false)
        return 
      }
      
      setIsLoadingCustomFields(true)
      try {
        const mod = await import('./utils/customFieldForms')
        const f = await mod.fetchCustomFieldFormFields(entityId)
        if (!cancelled) {
          setCfFields(f)
          setIsLoadingCustomFields(false)
        }
      } catch {
        if (!cancelled) {
          setCfFields([])
          setIsLoadingCustomFields(false)
        }
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

  // Separate basic fields from custom fields for progressive loading
  const basicFields = React.useMemo(() => fields, [fields])
  const customFields = React.useMemo(() => {
    if (!cfFields.length) return []
    const provided = new Set(fields.map(f => f.id))
    return cfFields.filter(f => !provided.has(f.id))
  }, [fields, cfFields])

  const setValue = React.useCallback((id: string, v: any) => {
    setValues((prev) => {
      // Only update if the value actually changed to prevent unnecessary re-renders
      if (prev[id] === v) return prev
      return { ...prev, [id]: v }
    })
  }, [])

  // Apply initialValues when provided (reapply when initialValues change for edit forms)
  React.useEffect(() => {
    if (initialValues) {
      setValues((prev) => ({ ...prev, ...(initialValues as any) }))
    }
  }, [initialValues])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setErrors({})

    // Basic required-field validation when no zod schema is provided
    const requiredErrors: Record<string, string> = {}
    for (const f of allFields) {
      if (!('required' in f) || !f.required) continue
      const v = values[f.id]
      const isArray = Array.isArray(v)
      const isString = typeof v === 'string'
      const empty =
        v === undefined ||
        v === null ||
        (isString && v.trim() === '') ||
        (isArray && v.length === 0) ||
        ((f as any).type === 'checkbox' && v !== true)
      if (empty) requiredErrors[f.id] = 'This field is required'
    }
    if (Object.keys(requiredErrors).length) {
      setErrors(requiredErrors)
      flash('Please fix the highlighted errors.', 'error')
      return
    }

    let parsed: any = values
    if (schema) {
      const res = (schema as z.ZodTypeAny).safeParse(values)
      if (!res.success) {
        const fieldErrors: Record<string, string> = {}
        res.error.issues.forEach((iss) => {
          if (iss.path && iss.path.length) fieldErrors[String(iss.path[0])] = iss.message
        })
        setErrors(fieldErrors)
        flash('Please fix the highlighted errors.', 'error')
        return
      }
      parsed = res.data
    }

    setPending(true)
    try {
      await onSubmit?.(parsed)
      if (successRedirect) router.push(successRedirect)
    } catch (err: any) {
      // Try to extract meaningful message often returned as JSON
      let msg = err?.message || 'Unexpected error'
      try {
        const parsed = JSON.parse(msg)
        if (parsed?.error) msg = String(parsed.error)
        else if (parsed?.message) msg = String(parsed.message)
      } catch {}
      flash(msg || 'Save failed', 'error')
      // Also keep inline error minimal and human-friendly
      setFormError(msg)
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
  const [local, setLocal] = React.useState<string>(value)
  const typingRef = React.useRef(false)

  // Sync down from parent when not actively typing
  React.useEffect(() => {
    if (!typingRef.current) setLocal(value)
  }, [value])

  const handleChange = React.useCallback((v?: string) => {
    typingRef.current = true
    setLocal(v ?? '')
  }, [])

  const commit = React.useCallback(() => {
    if (!typingRef.current) return
    typingRef.current = false
    const current = local
    onChange(current)
    // Try to preserve focus after parent re-render
    requestAnimationFrame(() => {
      const ta = containerRef.current?.querySelector('textarea') as HTMLTextAreaElement | null
      ta?.focus()
    })
  }, [local, onChange])
  return (
    <div ref={containerRef} data-color-mode="light" className="w-full">
      <MDEditor
        value={local}
        height={220}
        onChange={handleChange}
        previewOptions={{ remarkPlugins: [remarkGfm] }}
        // Commit changes only on blur to avoid parent re-render while typing
        onBlur={commit as any}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

// HTML Rich Text editor (contentEditable) with shortcuts; returns HTML string
type HtmlRTProps = { value?: string; onChange: (html: string) => void }
const HtmlRichTextEditor = React.memo(function HtmlRichTextEditor({ value = '', onChange }: HtmlRTProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const applyingExternal = React.useRef(false)
  const typingRef = React.useRef(false)

  // Sync DOM when external value changes (but don't fight user typing)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const current = el.innerHTML
    if (!typingRef.current && current !== value) {
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
      // do not call onChange eagerly; rely on blur commit
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
        onInput={() => { if (!applyingExternal.current) typingRef.current = true }}
        onBlur={() => {
          const el = ref.current
          if (!el) return
          typingRef.current = false
          onChange(el.innerHTML)
        }}
      />
    </div>
  )
}, (prev, next) => prev.value === next.value)

// Very simple markdown editor with Bold/Italic/Underline + shortcuts.
type SimpleMDProps = { value?: string; onChange: (md: string) => void }
const SimpleMarkdownEditor = React.memo(function SimpleMarkdownEditor({ value = '', onChange }: SimpleMDProps) {
  const taRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [local, setLocal] = React.useState<string>(value)
  const typingRef = React.useRef(false)

  React.useEffect(() => {
    if (!typingRef.current) setLocal(value)
  }, [value])

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
        spellCheck={false}
        value={local}
        onChange={(e) => { typingRef.current = true; setLocal(e.target.value) }}
        onBlur={() => { if (typingRef.current) { typingRef.current = false; onChange(local) } }}
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

  const grid = twoColumn ? 'grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4' : 'grid grid-cols-1 gap-4'

  type FieldControlProps = {
    f: CrudField
    value: any
    error?: string
    options: CrudFieldOption[]
    idx: number
    setValue: (id: string, v: any) => void
  }

  const FieldControl = React.useMemo(() => React.memo(function FieldControlImpl({ f, value, error, options, idx, setValue }: FieldControlProps) {
    // Memoize the setValue callback for this specific field to prevent unnecessary re-renders
    const fieldSetValue = React.useCallback((v: any) => setValue(f.id, v), [setValue, f.id])
    
    return (
      <div className="space-y-1">
        {f.type !== 'checkbox' ? (
          <label className="block text-sm font-medium">
            {f.label}
            {f.required ? <span className="text-red-600"> *</span> : null}
          </label>
        ) : null}
        {f.type === 'text' && (
          <TextInput value={value ?? ''} placeholder={(f as any).placeholder} onChange={fieldSetValue} />
        )}
        {f.type === 'number' && (
          <NumberInput value={value} placeholder={(f as any).placeholder} onChange={fieldSetValue} />
        )}
        {f.type === 'date' && (
          <input type="date" className="w-full h-9 rounded border px-2 text-sm" value={value ?? ''} onChange={(e) => setValue(f.id, e.target.value || undefined)} />
        )}
        {f.type === 'textarea' && (
          <TextAreaInput value={value ?? ''} placeholder={(f as any).placeholder} onChange={fieldSetValue} />
        )}
        {f.type === 'richtext' && ((f as any).editor === 'simple') && (
          <SimpleMarkdownEditor value={String(value ?? '')} onChange={fieldSetValue} />
        )}
        {f.type === 'richtext' && ((f as any).editor === 'html') && (
          <HtmlRichTextEditor value={String(value ?? '')} onChange={fieldSetValue} />
        )}
        {f.type === 'richtext' && (!('editor' in f) || ((f as any).editor !== 'simple' && (f as any).editor !== 'html')) && (
          <MarkdownEditor value={String(value ?? '')} onChange={fieldSetValue} />
        )}
        {f.type === 'tags' && (
          <TagsInput value={Array.isArray(value) ? (value as string[]) : []} onChange={fieldSetValue} placeholder={(f as any).placeholder} suggestions={options.map((o) => o.label)} />
        )}
        {f.type === 'checkbox' && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="size-4" checked={!!value} onChange={(e) => setValue(f.id, e.target.checked)} />
            <span className="text-sm">{f.label}</span>
          </label>
        )}
        {f.type === 'select' && !((f as any).multiple) && (
          <select
            className="w-full h-9 rounded border px-2 text-sm"
            value={Array.isArray(value) ? (value[0] ?? '') : (value ?? '')}
            onChange={(e) => setValue(f.id, e.target.value || undefined)}
          >
            <option value="">—</option>
            {options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
          </select>
        )}
        {f.type === 'select' && ((f as any).multiple) && (f as any).listbox === true && (() => {
          const selected: string[] = Array.isArray(value) ? (value as string[]) : []
          const [query, setQuery] = React.useState('')
          const filtered = React.useMemo(() => {
            const q = query.toLowerCase().trim()
            if (!q) return options
            return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
          }, [options, query])
          const toggle = (val: string) => {
            const set = new Set(selected)
            if (set.has(val)) set.delete(val)
            else set.add(val)
            setValue(f.id, Array.from(set))
          }
          return (
            <div className="w-full">
              <input
                className="mb-2 w-full h-8 rounded border px-2 text-sm"
                placeholder={(f as any).placeholder || 'Search...'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="rounded border max-h-48 overflow-auto divide-y">
                {filtered.map((opt) => {
                  const isSel = selected.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggle(opt.value)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${isSel ? 'bg-muted' : ''}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <input type="checkbox" className="size-4" readOnly checked={isSel} />
                        <span>{opt.label}</span>
                      </span>
                    </button>
                  )
                })}
                {!filtered.length ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
                ) : null}
              </div>
            </div>
          )
        })()}
        {f.type === 'select' && ((f as any).multiple) && !((f as any).listbox === true) && (
          <div className="flex flex-wrap gap-3">
            {options.map((opt) => {
              const arr: string[] = Array.isArray(value) ? (value as string[]) : []
              const checked = arr.includes(opt.value)
              return (
                <label key={opt.value} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4"
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
          <RelationSelect options={options} placeholder={(f as any).placeholder} value={Array.isArray(value) ? (value[0] ?? '') : (value ?? '')} onChange={fieldSetValue} />
        )}
        {f.type === 'custom' && (
          <>{(f as any).component({ id: f.id, value, error, setValue: fieldSetValue })}</>
        )}
        {(f as any).description ? (
          <div className="text-xs text-muted-foreground">{(f as any).description}</div>
        ) : null}
        {error ? (
          <div className="text-xs text-red-600">{error}</div>
        ) : null}
      </div>
    )
  }, (prev, next) => {
    // More efficient comparison - only check what actually matters
    return (
      prev.f.id === next.f.id && 
      prev.f.type === next.f.type &&
      prev.f.label === next.f.label &&
      prev.f.required === next.f.required &&
      prev.value === next.value && 
      prev.error === next.error && 
      prev.options === next.options
    )
  }), [])

  // Helper to render a list of field configs
  const renderFields = (fieldList: CrudField[]) => (
    <div className="grid grid-cols-1 gap-4">
      {fieldList.map((f, idx) => (
        <FieldControl
          key={f.id}
          f={f}
          value={values[f.id]}
          error={errors[f.id]}
              options={(f as CrudBuiltinField).options || dynamicOptions[f.id] || EMPTY_OPTIONS}
              idx={idx}
              setValue={setValue}
            />
          ))}
    </div>
  )

  // If groups are provided, render the two-column grouped layout
  if (groups && groups.length) {
    // Build a field index for lookup by id
    const byId = new Map(allFields.map((f) => [f.id, f]))

    const resolveGroupFields = (g: CrudFormGroup): CrudField[] => {
      if (g.kind === 'customFields') {
        return cfFields
      }
      const src = g.fields || []
      const result: CrudField[] = []
      for (const item of src) {
        if (typeof item === 'string') {
          const found = byId.get(item)
          if (found) result.push(found)
        } else {
          result.push(item)
        }
      }
      return result
    }

    const col1: CrudFormGroup[] = []
    const col2: CrudFormGroup[] = []
    for (const g of groups) {
      if ((g.column ?? 1) === 2) col2.push(g)
      else col1.push(g)
    }

    const GroupCard = React.memo(({ g }: { g: CrudFormGroup }) => {
      const groupFields = React.useMemo(() => resolveGroupFields(g), [g, allFields, cfFields])
      const isCustomFieldsGroup = g.kind === 'customFields'
      
      return (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          {g.title || isCustomFieldsGroup ? (
            <div className="text-sm font-medium">{g.title || 'Custom Fields'}</div>
          ) : null}
          {g.description ? <div className="text-xs text-muted-foreground">{g.description}</div> : null}
          {g.component ? (
            <div>{g.component({ values, setValue, errors })}</div>
          ) : null}
          <DataLoader
            isLoading={isCustomFieldsGroup && isLoadingCustomFields}
            loadingMessage="Loading data..."
            spinnerSize="md"
            className="min-h-[1px]"
          >
            {groupFields.length > 0 ? renderFields(groupFields) : <div className="min-h-[1px]" />}
          </DataLoader>
        </div>
      )
    }, (prev, next) => {
      // Only re-render if the group config or relevant dependencies change
      return (
        prev.g.id === next.g.id &&
        prev.g.title === next.g.title &&
        prev.g.description === next.g.description &&
        prev.g.kind === next.g.kind &&
        prev.g.column === next.g.column &&
        JSON.stringify(prev.g.fields) === JSON.stringify(next.g.fields)
      )
    })

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {backHref ? (
              <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
                ← Back
              </Link>
            ) : null}
            {title ? <div className="text-base font-medium">{title}</div> : null}
          </div>
          <div className="flex items-center gap-2">
            {onDelete ? (
              <Button type="button" variant="outline" onClick={async () => { try { await onDelete() } catch {} }} className="text-red-600 border-red-200 hover:bg-red-50 rounded-none">
                <Trash2 className="size-4 mr-2" />
                Delete
              </Button>
            ) : null}
            {cancelHref ? (
              <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
                Cancel
              </Link>
            ) : null}
            <Button type="submit" form={formId} disabled={pending}>
              <Save className="size-4 mr-2" />
              {pending ? 'Saving…' : submitLabel}
            </Button>
          </div>
        </div>
        <DataLoader
          isLoading={isLoading}
          loadingMessage={loadingMessage}
          spinnerSize="md"
          className="min-h-[400px]"
        >
          <form id={formId} onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4">
              <div className="space-y-4">
                {col1.map((g) => (
                  <GroupCard key={g.id} g={g} />
                ))}
              </div>
              <div className="space-y-4">
                {col2.map((g) => (
                  <GroupCard key={g.id} g={g} />
                ))}
              </div>
            </div>
            {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
            <div className="flex items-center justify-between gap-2">
              <div />
              <div className="flex items-center gap-2">
                {onDelete ? (
                  <Button type="button" variant="outline" onClick={async () => { try { await onDelete() } catch {} }} className="text-red-600 border-red-200 hover:bg-red-50 rounded-none">
                    <Trash2 className="size-4 mr-2" />
                    Delete
                  </Button>
                ) : null}
                {cancelHref ? (
                  <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
                    Cancel
                  </Link>
                ) : null}
                <Button type="submit" disabled={pending}>
                  <Save className="size-4 mr-2" />
                  {pending ? 'Saving…' : submitLabel}
                </Button>
              </div>
            </div>
          </form>
        </DataLoader>
      </div>
    )
  }

  // Default single-card layout (compatible with previous API)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {backHref ? (
            <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
              ← Back
            </Link>
          ) : null}
          {title ? <div className="text-base font-medium">{title}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          {onDelete ? (
            <Button type="button" variant="outline" onClick={async () => { try { await onDelete() } catch {} }} className="text-red-600 border-red-200 hover:bg-red-50">
              <Trash2 className="size-4 mr-2" />
              Delete
            </Button>
          ) : null}
          {cancelHref ? (
            <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
              Cancel
            </Link>
          ) : null}
          <Button type="submit" form={formId} disabled={pending}>
            <Save className="size-4 mr-2" />
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </div>
      <DataLoader
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        spinnerSize="md"
        className="min-h-[400px]"
      >
        <div>
          <form id={formId} onSubmit={handleSubmit} className="rounded-lg border bg-card p-4 space-y-4">
            <div className={grid}>
              {allFields.map((f, idx) => (
                <FieldControl
                  key={f.id}
                  f={f}
                  value={values[f.id]}
                  error={errors[f.id]}
                  options={(f as CrudBuiltinField).options || dynamicOptions[f.id] || EMPTY_OPTIONS}
                  idx={idx}
                  setValue={setValue}
                />
              ))}
            </div>
            {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
            <div className="flex items-center justify-end gap-2">
              {onDelete ? (
                <Button type="button" variant="outline" onClick={async () => { try { await onDelete() } catch {} }} className="text-red-600 border-red-200 hover:bg-red-50">
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </Button>
              ) : null}
              {cancelHref ? (
                <Link href={cancelHref} className="h-9 inline-flex items-center rounded border px-3 text-sm">
                  Cancel
                </Link>
              ) : null}
              <Button type="submit" disabled={pending}>
                <Save className="size-4 mr-2" />
                {pending ? 'Saving…' : submitLabel}
              </Button>
            </div>
          </form>
        </div>
      </DataLoader>
    </div>
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
        className="w-full h-9 rounded border px-2 text-sm"
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
// Local-buffer text input to avoid focus loss when parent re-renders
function TextInput({ value, onChange, placeholder }: { value: any; onChange: (v: string) => void; placeholder?: string }) {
  const ref = React.useRef<HTMLInputElement | null>(null)
  const [local, setLocal] = React.useState<string>(value ?? '')
  const isFocusedRef = React.useRef(false)
  
  React.useEffect(() => {
    // Only sync from props when not focused to avoid caret jumps
    if (!isFocusedRef.current) {
      setLocal(value ?? '')
    }
  }, [value])
  
  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocal(e.target.value)
  }, [])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onChange(local)
      ;(e.target as HTMLInputElement).blur()
    }
  }, [local, onChange])
  
  const handleFocus = React.useCallback(() => {
    isFocusedRef.current = true
  }, [])
  
  const handleBlur = React.useCallback(() => {
    isFocusedRef.current = false
    onChange(local)
  }, [local, onChange])
  
  return (
    <input
      ref={ref}
      type="text"
      className="w-full h-9 rounded border px-2 text-sm"
      placeholder={placeholder}
      value={local}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      spellCheck={false}
    />
  )
}

// Local-buffer number input to avoid focus loss when parent re-renders
function NumberInput({ value, onChange, placeholder }: { value: any; onChange: (v: number | undefined) => void; placeholder?: string }) {
  const [local, setLocal] = React.useState<string>(value !== undefined && value !== null ? String(value) : '')
  const isFocusedRef = React.useRef(false)
  
  React.useEffect(() => {
    // Only sync from props when not focused to avoid caret jumps
    if (!isFocusedRef.current) {
      setLocal(value !== undefined && value !== null ? String(value) : '')
    }
  }, [value])
  
  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocal(e.target.value)
  }, [])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const numValue = local === '' ? undefined : Number(local)
      onChange(numValue)
      ;(e.target as HTMLInputElement).blur()
    }
  }, [local, onChange])
  
  const handleFocus = React.useCallback(() => {
    isFocusedRef.current = true
  }, [])
  
  const handleBlur = React.useCallback(() => {
    isFocusedRef.current = false
    const numValue = local === '' ? undefined : Number(local)
    onChange(numValue)
  }, [local, onChange])
  
  return (
    <input
      type="number"
      className="w-full h-9 rounded border px-2 text-sm"
      placeholder={placeholder}
      value={local}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  )
}

// Local-buffer textarea to avoid form-wide re-renders while typing
function TextAreaInput({ value, onChange, placeholder }: { value: any; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = React.useState<string>(value ?? '')
  const isFocusedRef = React.useRef(false)

  React.useEffect(() => {
    if (!isFocusedRef.current) setLocal(value ?? '')
  }, [value])

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocal(e.target.value)
  }, [])

  const handleFocus = React.useCallback(() => { isFocusedRef.current = true }, [])
  const handleBlur = React.useCallback(() => { isFocusedRef.current = false; onChange(local) }, [local, onChange])

  return (
    <textarea
      className="w-full rounded border px-2 py-2 min-h-[120px] text-sm"
      placeholder={placeholder}
      value={local}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  )
}
