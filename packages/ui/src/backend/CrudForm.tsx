"use client"
import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '../primitives/button'

export type CrudFieldOption = { value: string; label: string }

export type CrudField = {
  id: string
  label: string
  type: 'text' | 'textarea' | 'checkbox' | 'select' | 'number' | 'date'
  placeholder?: string
  description?: string
  options?: CrudFieldOption[]
  required?: boolean
}

export type CrudFormProps<TValues extends Record<string, any>> = {
  schema?: z.ZodTypeAny
  fields: CrudField[]
  initialValues?: Partial<TValues>
  submitLabel?: string
  cancelHref?: string
  successRedirect?: string
  onSubmit?: (values: TValues) => Promise<void> | void
  twoColumn?: boolean
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
}: CrudFormProps<TValues>) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, any>>({ ...(initialValues || {}) })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)

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

  const grid = twoColumn ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-4 space-y-4">
      <div className={grid}>
        {fields.map((f) => (
          <div key={f.id} className="space-y-1">
            <label className="block text-sm font-medium">
              {f.label}{f.required ? <span className="text-red-600"> *</span> : null}
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
                onChange={(e) => setValue(f.id, e.target.value === '' ? undefined : Number(e.target.value))}
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
                {f.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
  )
}
