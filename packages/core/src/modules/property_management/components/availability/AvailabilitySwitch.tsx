"use client"

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { AvailabilityDialog } from './AvailabilityDialog'
import { useUnavailabilities } from './useUnavailabilities'
import {
  AVAILABILITY_MANAGE_FEATURE,
  describeRow,
  inheritedRow,
  ownRows,
  subjectTypeLabel,
  UNAVAILABILITY_RESOURCE_KIND,
  type AvailabilityAncestor,
  type AvailabilitySubject,
  type UnavailabilityRow,
} from './availabilityModel'

const CONTEXT_ID = 'property-management-availability-switch'

export type AvailabilitySwitchProps = {
  subject: AvailabilitySubject
  rows: readonly UnavailabilityRow[]
  ancestors?: readonly AvailabilityAncestor[]
  disabled?: boolean
  loading?: boolean
  refreshing?: boolean
  error?: boolean
  truncated?: boolean
  retryable?: boolean
  onRetry?: () => void
  onChanged: () => void
}

export function AvailabilitySwitch({
  subject,
  rows: sharedRows,
  ancestors = [],
  disabled = false,
  loading: sharedLoading = false,
  refreshing: sharedRefreshing = false,
  error: sharedError = false,
  truncated = false,
  retryable = true,
  onRetry,
  onChanged: onSharedChanged,
}: AvailabilitySwitchProps) {
  const t = useT()
  const locale = useLocale()
  const { payload: chrome } = useBackendChrome()
  const canManage = hasFeature(chrome?.grantedFeatures, AVAILABILITY_MANAGE_FEATURE)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [retryPhase, setRetryPhase] = React.useState<'idle' | 'requested' | 'loading'>('idle')
  const switchRef = React.useRef<HTMLButtonElement>(null)
  const retryRef = React.useRef<HTMLButtonElement>(null)
  const describedById = React.useId()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('property_management.common.blocked', 'The change was blocked.'),
  })
  const dialogSubject = React.useMemo(
    () => (dialogOpen ? { type: subject.type, id: subject.id, name: subject.name } : null),
    [dialogOpen, subject.type, subject.id, subject.name],
  )
  const exact = useUnavailabilities(truncated ? { buildingIds: [], subjectIds: [subject.id, ...ancestors.map((ancestor) => ancestor.id)] } : null)
  const rows = truncated ? exact.rows : sharedRows
  const loading = sharedLoading || (truncated && exact.loading)
  const refreshing = sharedRefreshing || (truncated && exact.refreshing)
  const error = sharedError || (truncated && exact.error)
  const onChanged = () => {
    if (truncated) exact.reload()
    onSharedChanged()
  }
  const own = ownRows(rows, subject)
  const inherited = own.length ? null : inheritedRow(rows, ancestors)
  const available = own.length === 0
  const current = own.find((row) => row.inEffect) ?? own[0] ?? null

  const makeAvailable = async () => {
    setPending(true)
    try {
      for (const row of own) {
        await runMutation({
          operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () =>
            apiCallOrThrow(`/api/property_management/unavailabilities/${encodeURIComponent(row.id)}/end`, { method: 'POST' }, {
              errorMessage: t('property_management.availability.endError', 'Could not make it available.'),
            }),
          ),
          mutationPayload: { id: row.id },
          context: { formId: CONTEXT_ID, resourceKind: UNAVAILABILITY_RESOURCE_KIND, resourceId: row.id, retryLastMutation },
        })
      }
      flash(t('property_management.availability.ended', '{name} is available again.', { name: subject.name }), 'success')
    } catch (err) {
      if (!surfaceRecordConflict(err, t)) {
        flash(err instanceof Error ? err.message : t('property_management.availability.endError', 'Could not make it available.'), 'error')
      }
    } finally {
      setPending(false)
      onChanged()
    }
  }

  React.useEffect(() => {
    if (retryPhase === 'idle') return
    if (loading) {
      if (retryPhase === 'requested') setRetryPhase('loading')
      return
    }
    if (retryPhase === 'requested' && error) return
    const retryHadFocus = document.activeElement === retryRef.current
    setRetryPhase('idle')
    if (retryHadFocus && !error) switchRef.current?.focus()
  }, [retryPhase, loading, error])

  React.useEffect(() => {
    if (!error || !retryable) return
    if (document.activeElement === switchRef.current) retryRef.current?.focus()
  }, [error, retryable])

  const retry = () => {
    if (!error) return
    const reloadAvailability = !sharedError && truncated && exact.error ? exact.reload : onRetry ?? onChanged
    setRetryPhase('requested')
    reloadAvailability()
  }

  const unknown = loading || error
  const busy = pending || refreshing
  const blocked = busy || disabled || !canManage || unknown
  const showRetry = retryable && (error || retryPhase !== 'idle')
  const label = loading
    ? t('property_management.availability.checking', 'Checking…')
    : error
      ? t('property_management.availability.unknown', 'Availability unknown')
      : inherited
        ? t('property_management.availability.inheritedState', 'Unavailable — set on its {subject}', { subject: subjectTypeLabel(t, inherited.subjectType) })
        : available
          ? t('property_management.availability.available', 'Available')
          : t('property_management.availability.unavailable', 'Unavailable')
  const source = unknown ? null : current ?? inherited
  const hint = source ? describeRow(t, source, locale) : null
  const stateId = `${describedById}-state`
  const hintId = `${describedById}-hint`

  return (
    <div className="flex flex-col gap-0.5" onClick={(event) => event.stopPropagation()}>
      <span className="flex items-center gap-2">
        <Switch
          ref={switchRef}
          checked={!unknown && available}
          aria-disabled={blocked}
          aria-busy={busy || undefined}
          className={blocked ? 'cursor-not-allowed opacity-60' : undefined}
          aria-label={inherited
            ? t('property_management.availability.switchLabelOwn', '{name} available on its own', { name: subject.name })
            : t('property_management.availability.switchLabel', '{name} available', { name: subject.name })}
          aria-describedby={hint ? `${stateId} ${hintId}` : stateId}
          data-testid={`pm-availability-switch-${subject.type}-${subject.id}`}
          onCheckedChange={(checked) => {
            if (blocked) return
            if (checked) void makeAvailable()
            else setDialogOpen(true)
          }}
        />
        <span id={stateId} className={unknown ? 'text-sm text-muted-foreground' : inherited ? 'text-sm text-status-warning-text' : 'text-sm'} data-testid={`pm-availability-state-${subject.id}`}>{label}</span>
        {showRetry ? (
          <IconButton
            ref={retryRef}
            type="button"
            variant="ghost"
            size="xs"
            onClick={retry}
            aria-disabled={error ? undefined : true}
            className={error ? undefined : 'cursor-not-allowed text-text-disabled hover:bg-transparent'}
            aria-label={t('property_management.availability.retryFor', 'Retry loading availability of {name}', { name: subject.name })}
            data-testid={`pm-availability-retry-${subject.id}`}
          >
            <RefreshCw aria-hidden className="size-4" />
          </IconButton>
        ) : null}
      </span>
      {hint ? (
        <span id={hintId} className="max-w-xs whitespace-normal break-words text-xs text-muted-foreground" title={hint} data-testid={`pm-availability-hint-${subject.id}`}>
          {hint}
        </span>
      ) : null}
      <AvailabilityDialog
        subject={dialogSubject}
        onClose={() => setDialogOpen(false)}
        onDone={() => {
          setDialogOpen(false)
          onChanged()
        }}
      />
    </div>
  )
}
