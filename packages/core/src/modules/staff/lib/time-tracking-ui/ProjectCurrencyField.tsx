"use client"

import * as React from 'react'
import { Lock } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type CurrencyOption = { value: string; label: string }

const CURRENCY_OPTIONS_URL = '/api/currencies/currencies/options'

export function useCurrencyOptions(): { options: CurrencyOption[]; loading: boolean } {
  const [options, setOptions] = React.useState<CurrencyOption[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await apiCall<{ items?: CurrencyOption[] }>(`${CURRENCY_OPTIONS_URL}?limit=100`)
        const items = Array.isArray(res.result?.items) ? res.result.items : []
        if (!cancelled) setOptions(items.filter((item) => typeof item?.value === 'string'))
      } catch {
        // The currencies module is optional for this form; without it the field
        // simply offers whatever the project already carries.
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  return { options, loading }
}

type BlockingReport = { id: string; reference: string | null; title: string | null }

type LockedConflictBody = {
  code?: unknown
  error?: unknown
  lockedEntryCount?: unknown
  lockedReports?: unknown
}

function parseLockedConflict(body: unknown): { count: number; reports: BlockingReport[] } | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as LockedConflictBody
  if (payload.code !== 'project_has_locked_entries') return null
  const reports = Array.isArray(payload.lockedReports)
    ? (payload.lockedReports as BlockingReport[]).filter((report) => report && typeof report.id === 'string')
    : []
  return {
    count: typeof payload.lockedEntryCount === 'number' ? payload.lockedEntryCount : reports.length,
    reports,
  }
}

function describeReports(reports: BlockingReport[]): string {
  return reports
    .map((report) => report.reference ?? report.title ?? report.id)
    .filter((label): label is string => typeof label === 'string' && label.length > 0)
    .join(', ')
}

type ChangeCurrencyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectUpdatedAt?: string | null
  currentCurrency: string | null
  entryCount: number
  options: CurrencyOption[]
  onChanged: (currencyCode: string) => void
}

/**
 * D-3 / R11: the change action relabels without converting a single historical
 * amount, so it demands an explicit acknowledgement and it is refused with
 * `409 project_has_locked_entries` while any of the project's entries is frozen
 * inside a closed report — that conflict is surfaced with the blocking reports
 * named rather than as a generic failure.
 *
 * With no entry logged yet there is nothing to relabel, so the warning becomes a
 * plain statement of that fact and the acknowledgement checkbox — friction whose
 * whole subject is the historical amounts — is dropped. The request still sends
 * `acknowledged: true`, because the dialog has still told the user exactly what
 * the change does.
 */
function ChangeCurrencyDialog({
  open,
  onOpenChange,
  projectId,
  projectUpdatedAt,
  currentCurrency,
  entryCount,
  options,
  onChanged,
}: ChangeCurrencyDialogProps) {
  const t = useT()
  const hasEntries = entryCount > 0
  const [nextCurrency, setNextCurrency] = React.useState(currentCurrency ?? '')
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [conflict, setConflict] = React.useState<{ count: number; reports: BlockingReport[] } | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) return
    setNextCurrency(currentCurrency ?? '')
    setAcknowledged(false)
    setSaving(false)
    setConflict(null)
    setError(null)
  }, [open, currentCurrency])

  const canSubmit = Boolean(nextCurrency)
    && nextCurrency !== currentCurrency
    && (!hasEntries || acknowledged)

  const submit = React.useCallback(async () => {
    if (saving || !canSubmit) return
    setSaving(true)
    setConflict(null)
    setError(null)
    try {
      // The parent CrudForm's optimistic-lock header belongs to its own PUT;
      // this call mutates a different concern, so it carries its own.
      const response = await withScopedApiRequestHeaders(
        buildOptimisticLockHeader(projectUpdatedAt ?? null),
        () => apiCall(`/api/staff/timesheets/time-projects/${projectId}/change-currency`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ currencyCode: nextCurrency, acknowledged: true }),
        }),
      )
      if (response.ok) {
        flash(t('staff.time_tracking.projects.currency.changed', 'Project currency changed.'), 'success')
        onChanged(nextCurrency)
        onOpenChange(false)
        return
      }
      const body = await readJsonSafe<unknown>(response.response, null)
      const locked = parseLockedConflict(body)
      if (locked) {
        setConflict(locked)
        return
      }
      const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : t('staff.time_tracking.projects.currency.changeError', 'Failed to change the project currency.')
      setError(message)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : t('staff.time_tracking.projects.currency.changeError', 'Failed to change the project currency.'),
      )
    } finally {
      setSaving(false)
    }
  }, [canSubmit, nextCurrency, onChanged, onOpenChange, projectId, projectUpdatedAt, saving, t])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  const selectableOptions = React.useMemo(() => {
    if (options.length > 0) return options
    return currentCurrency ? [{ value: currentCurrency, label: currentCurrency }] : []
  }, [currentCurrency, options])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('staff.time_tracking.projects.currency.changeTitle', 'Change currency')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {hasEntries ? (
            <Alert status="warning" style="lighter" size="default">
              <AlertTitle>
                {t('staff.time_tracking.projects.currency.warnTitle', 'Amounts are relabelled, not converted')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'staff.time_tracking.projects.currency.warnBody',
                  'The {{count}} entries already logged keep their numeric value and are simply read in the new currency.',
                  { count: String(entryCount) },
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert status="information" style="lighter" size="default">
              <AlertTitle>
                {t('staff.time_tracking.projects.currency.emptyTitle', 'Nothing to relabel yet')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'staff.time_tracking.projects.currency.emptyBody',
                  'No time is logged on this project yet, so the change only sets the currency — no amount is relabelled.',
                )}
              </AlertDescription>
            </Alert>
          )}

          <Select value={nextCurrency} onValueChange={setNextCurrency}>
            <SelectTrigger aria-label={t('staff.time_tracking.projects.currency.label', 'Currency')}>
              <SelectValue placeholder={t('staff.time_tracking.projects.currency.placeholder', 'Select a currency')} />
            </SelectTrigger>
            <SelectContent>
              {selectableOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasEntries ? (
            <CheckboxField
              checked={acknowledged}
              onCheckedChange={(next) => setAcknowledged(next === true)}
              label={t(
                'staff.time_tracking.projects.currency.acknowledge',
                'I understand historical amounts are not converted.',
              )}
            />
          ) : null}

          {conflict ? (
            <Alert status="error" style="lighter" size="default">
              <AlertTitle>
                {t('staff.time_tracking.projects.currency.lockedTitle', 'Locked hours block this change')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'staff.time_tracking.projects.currency.lockedBody',
                  '{{count}} entries are frozen in closed reports: {{reports}}. Unlock them first.',
                  { count: String(conflict.count), reports: describeReports(conflict.reports) },
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('staff.time_tracking.projects.form.actions.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={saving || !canSubmit}
          >
            {t('staff.time_tracking.projects.currency.confirm', 'Change currency')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type ProjectCurrencyFieldProps = {
  value: string | null
  locked: boolean
  entryCount: number
  projectId?: string | null
  projectUpdatedAt?: string | null
  options: CurrencyOption[]
  disabled?: boolean
  onChange: (currencyCode: string | null) => void
  /** Fired after the change-currency action succeeded, so the host can reload the record. */
  onCurrencyChanged?: (currencyCode: string) => void
}

export function ProjectCurrencyField({
  value,
  locked,
  entryCount,
  projectId,
  projectUpdatedAt,
  options,
  disabled,
  onChange,
  onCurrencyChanged,
}: ProjectCurrencyFieldProps) {
  const t = useT()
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const label = React.useMemo(() => {
    if (!value) return null
    return options.find((option) => option.value === value)?.label ?? value
  }, [options, value])

  const selectableOptions = React.useMemo(() => {
    if (options.length > 0) return options
    return value ? [{ value, label: value }] : []
  }, [options, value])

  // D-3: after creation the currency belongs to the change-currency action, and
  // the plain update payload cannot carry it at all (see `buildProjectPayload`
  // and `staffTimeProjectUpdateSchema`). So EVERY persisted project renders the
  // field read-only with the explicit action beside it — a select the save would
  // silently discard is worse than one honest extra click. Only the copy differs:
  // with entries logged the change relabels them, without entries it relabels
  // nothing.
  const hasEntries = locked || entryCount > 0
  if (projectId) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-sm text-muted-foreground">
            {hasEntries ? <Lock className="h-3.5 w-3.5" aria-hidden /> : null}
            {label ?? t('staff.time_tracking.projects.currency.unset', 'Not set')}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)} disabled={disabled}>
            {t('staff.time_tracking.projects.currency.change', 'Change currency')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {hasEntries
            ? t(
              'staff.time_tracking.projects.currency.lockedHint',
              'The currency is fixed for the project and drives all cost reporting. It is read-only because {{count}} entries have already been logged.',
              { count: String(entryCount) },
            )
            : t(
              'staff.time_tracking.projects.currency.postCreateHint',
              'The currency is fixed for the project and drives all cost reporting. After creation it changes only through this action, so the change is always recorded.',
            )}
        </p>
        <ChangeCurrencyDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projectId={projectId}
          projectUpdatedAt={projectUpdatedAt}
          currentCurrency={value}
          entryCount={entryCount}
          options={options}
          onChanged={(currencyCode) => {
            onChange(currencyCode)
            onCurrencyChanged?.(currencyCode)
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select value={value ?? ''} onValueChange={(next) => onChange(next || null)} disabled={disabled}>
        <SelectTrigger aria-label={t('staff.time_tracking.projects.currency.label', 'Currency')}>
          <SelectValue placeholder={t('staff.time_tracking.projects.currency.placeholder', 'Select a currency')} />
        </SelectTrigger>
        <SelectContent>
          {selectableOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t(
          'staff.time_tracking.projects.currency.hint',
          'The currency is fixed for the project and drives all cost reporting.',
        )}
      </p>
    </div>
  )
}

export type ProjectCurrencyFieldBindingProps = {
  value: unknown
  values?: Record<string, unknown>
  disabled?: boolean
  setValue: (value: unknown) => void
  onCurrencyChanged?: (currencyCode: string) => void
}

export function ProjectCurrencyFieldBinding({
  value,
  values,
  disabled,
  setValue,
  onCurrencyChanged,
}: ProjectCurrencyFieldBindingProps) {
  const { options } = useCurrencyOptions()
  const projectId = typeof values?.id === 'string' ? values.id : null
  const updatedAt = typeof values?.updatedAt === 'string' ? values.updatedAt : null
  const entryCount = typeof values?.entryCount === 'number' ? values.entryCount : 0
  const locked = values?.currencyLocked === true

  return (
    <ProjectCurrencyField
      value={typeof value === 'string' && value.length > 0 ? value : null}
      locked={locked}
      entryCount={entryCount}
      projectId={projectId}
      projectUpdatedAt={updatedAt}
      options={options}
      disabled={disabled}
      onChange={setValue}
      onCurrencyChanged={onCurrencyChanged}
    />
  )
}
