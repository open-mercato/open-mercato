"use client"

import * as React from 'react'
import { Check, Loader2, Pencil } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { deriveProjectCode, slugifyProjectName, PROJECT_CODE_MAX_LENGTH } from '../time-tracking/projectCode'

const PAGE_SIZE = 100
const MAX_PAGES = 5

type ProjectCodeRow = { id?: unknown; code?: unknown }

/**
 * D-10: screen 4 has no code field, but the column is required and unique, so
 * the code is derived from the name and shown read-only underneath it behind an
 * explicit edit affordance. Uniqueness is checked live against the codes already
 * in scope; the server-side partial unique index (surfaced as a `409` with a
 * `code` field error) stays the authority.
 */
export function useTakenProjectCodes(excludeId?: string | null): {
  taken: Set<string>
  loading: boolean
} {
  const [taken, setTaken] = React.useState<Set<string>>(() => new Set())
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const collected = new Set<string>()
      try {
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const res = await apiCall<{ items?: ProjectCodeRow[]; totalPages?: number }>(
            `/api/staff/timesheets/time-projects?page=${page}&pageSize=${PAGE_SIZE}&sortField=code&sortDir=asc`,
          )
          const items = Array.isArray(res.result?.items) ? res.result.items : []
          items.forEach((row) => {
            const id = typeof row.id === 'string' ? row.id : null
            const code = typeof row.code === 'string' ? row.code.trim().toUpperCase() : ''
            if (!code) return
            if (excludeId && id === excludeId) return
            collected.add(code)
          })
          const totalPages = typeof res.result?.totalPages === 'number' ? res.result.totalPages : 1
          if (items.length < PAGE_SIZE || page >= totalPages) break
        }
      } catch {
        // A failed probe only weakens the client-side hint — the unique index
        // still rejects a duplicate on save.
      }
      if (cancelled) return
      setTaken(collected)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [excludeId])

  return { taken, loading }
}

export type ProjectCodeFieldProps = {
  value: string
  name: string
  taken: Set<string>
  manual: boolean
  disabled?: boolean
  error?: string
  onChange: (code: string) => void
  onManualChange: (manual: boolean) => void
}

export function ProjectCodeField({
  value,
  name,
  taken,
  manual,
  disabled,
  error,
  onChange,
  onManualChange,
}: ProjectCodeFieldProps) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)

  const duplicate = React.useMemo(() => {
    const normalized = value.trim().toUpperCase()
    return normalized.length > 0 && taken.has(normalized)
  }, [taken, value])

  const startEditing = React.useCallback(() => {
    onManualChange(true)
    setEditing(true)
  }, [onManualChange])

  const resetToDerived = React.useCallback(() => {
    onManualChange(false)
    onChange(deriveProjectCode(name, taken))
    setEditing(false)
  }, [name, onChange, onManualChange, taken])

  if (!editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <code className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {value || t('staff.time_tracking.projects.code.empty', '—')}
          </code>
          <Button type="button" variant="ghost" size="sm" onClick={startEditing} disabled={disabled}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('staff.time_tracking.projects.code.edit', 'Edit code')}
          </Button>
        </div>
        {duplicate ? (
          <p className="text-xs text-status-error-base">
            {t('staff.time_tracking.projects.code.duplicate', 'This code is already used by another project.')}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {manual
              ? t('staff.time_tracking.projects.code.manualHint', 'Set manually — it no longer follows the name.')
              : t('staff.time_tracking.projects.code.autoHint', 'Derived from the project name; it prefixes every task reference.')}
          </p>
        )}
        {error ? <p className="text-xs text-status-error-base">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          disabled={disabled}
          maxLength={PROJECT_CODE_MAX_LENGTH}
          autoFocus
          aria-invalid={duplicate || Boolean(error)}
          onChange={(event) => onChange(slugifyProjectName(event.target.value).slice(0, PROJECT_CODE_MAX_LENGTH))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              setEditing(false)
            }
          }}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          {t('staff.time_tracking.projects.code.done', 'Done')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={resetToDerived}>
          {t('staff.time_tracking.projects.code.reset', 'Use the derived code')}
        </Button>
      </div>
      {duplicate ? (
        <p className="text-xs text-status-error-base">
          {t('staff.time_tracking.projects.code.duplicate', 'This code is already used by another project.')}
        </p>
      ) : null}
      {error ? <p className="text-xs text-status-error-base">{error}</p> : null}
    </div>
  )
}

export type ProjectCodeFieldBindingProps = {
  value: unknown
  values?: Record<string, unknown>
  error?: string
  disabled?: boolean
  setValue: (value: unknown) => void
  setFormValue?: (id: string, value: unknown) => void
}

/**
 * Binds the code field to the name: on create the code follows the name until
 * the user edits it; on edit the stored code is authoritative and is never
 * silently re-derived.
 */
export function ProjectCodeFieldBinding({
  value,
  values,
  error,
  disabled,
  setValue,
  setFormValue,
}: ProjectCodeFieldBindingProps) {
  const recordId = typeof values?.id === 'string' ? values.id : null
  const name = typeof values?.name === 'string' ? values.name : ''
  const manual = values?.codeManual === true
  const code = typeof value === 'string' ? value : ''
  const { taken, loading } = useTakenProjectCodes(recordId)

  const setManual = React.useCallback(
    (next: boolean) => setFormValue?.('codeManual', next),
    [setFormValue],
  )

  React.useEffect(() => {
    if (manual || loading) return
    const derived = deriveProjectCode(name, taken)
    if (!name.trim()) {
      if (code) setValue('')
      return
    }
    if (derived !== code) setValue(derived)
  }, [code, loading, manual, name, setValue, taken])

  if (loading && !code) return <ProjectCodeLoading />

  return (
    <ProjectCodeField
      value={code}
      name={name}
      taken={taken}
      manual={manual}
      disabled={disabled}
      error={error}
      onChange={setValue}
      onManualChange={setManual}
    />
  )
}

export function ProjectCodeLoading() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
}
