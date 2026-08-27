"use client"
import * as React from 'react'
import { ChevronDown, ChevronUp, Database, RefreshCw, RotateCcw, ScrollText, Wrench, X } from 'lucide-react'
import { useOptionalT } from '@open-mercato/shared/lib/i18n/context'
import {
  isDevRuntimeBannerEnabled,
  readDevRuntimeLogsUrl,
  readDevRuntimeToken,
} from '@open-mercato/shared/lib/dev-runtime/report'
import {
  DEV_RUNTIME_ACTIONS_PATH,
  DEV_RUNTIME_LOGS_PATH,
  DEV_RUNTIME_STATUS_PATH,
  DEV_RUNTIME_TOKEN_HEADER,
  type RuntimeHealth,
  type RuntimeIssue,
  type DevRuntimeLogSnapshot,
  type RuntimeRecoveryAction,
  type RuntimeStatus,
} from '@open-mercato/shared/lib/dev-runtime/types'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { useConfirmDialog } from '../confirm-dialog'

const ACTION_ICONS: Record<RuntimeRecoveryAction, typeof RefreshCw> = {
  generate: Wrench,
  migrate: Database,
  restart: RotateCcw,
}

// `restart` is always safe to offer; `generate` and `migrate` appear only when
// the classifier justified them for this incident. `migrate` additionally
// requires a confirmation surface — the shared dialog needs the i18n provider,
// so a provider-less tree gets no irreversible action rather than an
// unconfirmed one.
function resolveOfferedActions(
  issue: RuntimeIssue | null,
  { canConfirm }: { canConfirm: boolean },
): RuntimeRecoveryAction[] {
  const actions: RuntimeRecoveryAction[] = []
  if (issue?.recovery === 'generate') actions.push('generate')
  if (issue?.recovery === 'migrate' && canConfirm) actions.push('migrate')
  actions.push('restart')
  return actions
}

const POLL_INTERVAL_MS = 2000

const VISIBLE_HEALTH: RuntimeHealth[] = ['starting', 'degraded', 'recovering', 'unavailable']

type BannerTone = 'info' | 'warning' | 'error'

const HEALTH_TONE: Record<RuntimeHealth, BannerTone> = {
  starting: 'info',
  ready: 'info',
  degraded: 'warning',
  recovering: 'info',
  unavailable: 'error',
}

const TONE_CLASSES: Record<BannerTone, string> = {
  info: 'border-status-info-border bg-status-info-bg text-status-info-text',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text',
  error: 'border-status-error-border bg-status-error-bg text-status-error-text',
}

const TONE_ACTION_CLASSES: Record<BannerTone, string> = {
  info: 'border-status-info-border bg-status-info-bg text-status-info-text hover:bg-status-info-border hover:text-status-info-text',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning-text hover:bg-status-warning-border hover:text-status-warning-text',
  error: 'border-status-error-border bg-status-error-bg text-status-error-text hover:bg-status-error-border hover:text-status-error-text',
}

function dismissalKey(status: RuntimeStatus, issue: RuntimeIssue | null): string {
  return `${status.generation}:${issue?.fingerprint ?? status.health}`
}

async function fetchRuntimeStatus(token: string, signal: AbortSignal): Promise<RuntimeStatus | null> {
  const response = await fetch(DEV_RUNTIME_STATUS_PATH, {
    headers: { [DEV_RUNTIME_TOKEN_HEADER]: token },
    cache: 'no-store',
    signal,
  })
  if (!response.ok) return null
  return (await response.json()) as RuntimeStatus
}

function useRuntimeStatus(token: string | null): RuntimeStatus | null {
  const [status, setStatus] = React.useState<RuntimeStatus | null>(null)

  React.useEffect(() => {
    if (!token) return undefined
    let cancelled = false
    const controller = new AbortController()

    const poll = async () => {
      try {
        const next = await fetchRuntimeStatus(token, controller.signal)
        if (!cancelled) setStatus(next)
      } catch {
        // A momentarily unreachable bridge must never break the page: keep the
        // last known status and try again on the next tick.
      }
    }

    void poll()
    const timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [token])

  return status
}

function reloadPage(): void {
  if (typeof window === 'undefined') return
  try {
    window.location.reload()
  } catch {
    // Reload is a convenience affordance; ignore hosts that block it.
  }
}

/**
 * Dev-only, in-app counterpart to the standalone startup splash. It reports the
 * supervisor's runtime state on an already-open page so a post-ready failure is
 * visible without switching to the terminal. It never renders in production and
 * never renders while the runtime is healthy.
 */
export function DevRuntimeDiagnosticsBanner() {
  // The banner must render even when a broken tree left the app without its
  // i18n provider, so the translator is optional with inline English fallbacks.
  const translate = useOptionalT()
  const t = React.useCallback(
    (key: string, fallback: string) => (translate ? translate(key, fallback) : fallback),
    [translate],
  )
  const [token, setToken] = React.useState<string | null>(null)
  const [logsUrl, setLogsUrl] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [dismissed, setDismissed] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState<RuntimeRecoveryAction | null>(null)
  const [logs, setLogs] = React.useState<DevRuntimeLogSnapshot | null>(null)
  const [logsOpen, setLogsOpen] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  // ConfirmDialog itself calls `useT`, so it can only be mounted where the
  // provider exists.
  const canConfirm = translate !== undefined

  React.useEffect(() => {
    if (!isDevRuntimeBannerEnabled()) return
    setToken(readDevRuntimeToken())
    setLogsUrl(readDevRuntimeLogsUrl())
  }, [])

  const status = useRuntimeStatus(token)
  const issue = status?.issueSummary ?? null
  const currentKey = status ? dismissalKey(status, issue) : null

  // Dismissal is view-local and scoped to one generation:fingerprint, so a new
  // incident — or the same one in a new generation — reappears.
  React.useEffect(() => {
    if (currentKey && dismissed && dismissed !== currentKey) setDismissed(null)
  }, [currentKey, dismissed])

  React.useEffect(() => {
    if (status?.health === 'ready') setExpanded(false)
  }, [status?.health])

  // Logs are fetched on demand from the app itself, so opening them never
  // navigates away from the page being debugged.
  const toggleLogs = React.useCallback(async () => {
    if (logsOpen) {
      setLogsOpen(false)
      return
    }
    setLogsOpen(true)
    if (!token) return
    try {
      const response = await fetch(`${DEV_RUNTIME_LOGS_PATH}?cursor=0`, {
        headers: { [DEV_RUNTIME_TOKEN_HEADER]: token },
        cache: 'no-store',
      })
      setLogs(response.ok ? ((await response.json()) as DevRuntimeLogSnapshot) : null)
    } catch {
      setLogs(null)
    }
  }, [logsOpen, token])

  const runRecoveryAction = React.useCallback(async (action: RuntimeRecoveryAction) => {
    if (!token || pendingAction) return
    // `migrate` writes to the database and cannot be undone automatically, so it
    // always goes through the shared confirmation dialog.
    if (action === 'migrate') {
      const confirmed = await confirm({
        title: t('ui.devRuntime.confirm.migrate.title', 'Apply database migrations?'),
        text: t(
          'ui.devRuntime.confirm.migrate.text',
          'This applies pending migrations to your development database. It is not automatically reversible — rolling back is a separate manual task.',
        ),
        confirmText: t('ui.devRuntime.actions.migrate', 'Run migrations'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }

    setPendingAction(action)
    setActionError(null)
    try {
      const response = await fetch(`${DEV_RUNTIME_ACTIONS_PATH}/${action}`, {
        method: 'POST',
        headers: { [DEV_RUNTIME_TOKEN_HEADER]: token },
        cache: 'no-store',
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        setActionError(payload?.error?.message ?? t('ui.devRuntime.actions.failed', 'The recovery action could not be started.'))
      }
    } catch {
      setActionError(t('ui.devRuntime.actions.failed', 'The recovery action could not be started.'))
    } finally {
      setPendingAction(null)
    }
  }, [token, pendingAction, confirm, t])

  if (!status || !VISIBLE_HEALTH.includes(status.health)) return null
  if (currentKey && dismissed === currentKey) return null

  const tone = HEALTH_TONE[status.health]
  const isBusy = status.recovery?.busy === true
  const headline = t(`ui.devRuntime.health.${status.health}`, DEFAULT_HEALTH_COPY[status.health])
  const title = issue?.title ?? t('ui.devRuntime.noIncident', 'No incident details available')

  return (
    <div
      data-testid="dev-runtime-diagnostics-banner"
      data-health={status.health}
      role={status.health === 'unavailable' ? 'alert' : 'status'}
      aria-live={status.health === 'unavailable' ? 'assertive' : 'polite'}
      // Floating bottom-right dev overlay, lifted clear of the support-chat
      // launcher that sits in that corner. Third-party launchers ship their own
      // very high z-index, so the banner stacks ABOVE the bubble rather than
      // trying to outrank it. `max-w-4xl` keeps the action row on one line on
      // desktop; it still wraps (never scrolls) once the viewport is narrow.
      className={`fixed inset-x-3 bottom-20 z-banner flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-4xl ${TONE_CLASSES[tone]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {headline}
            <span aria-hidden="true"> · </span>
            {title}
          </p>
          {issue?.detail ? <p className="mt-0.5 break-words">{issue.detail}</p> : null}
        </div>
        {/* Dismiss stays pinned to the corner instead of joining the wrapping
            action row, where it used to orphan onto a line of its own. */}
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('ui.devRuntime.actions.dismiss', 'Dismiss')}
          onClick={() => setDismissed(currentKey)}
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-1">
          {issue ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className={`whitespace-nowrap ${TONE_ACTION_CLASSES[tone]}`}
            >
              {expanded
                ? <ChevronUp className="mr-1 size-4" aria-hidden="true" />
                : <ChevronDown className="mr-1 size-4" aria-hidden="true" />}
              {expanded
                ? t('ui.devRuntime.actions.hideDetails', 'Hide details')
                : t('ui.devRuntime.actions.showDetails', 'Show details')}
            </Button>
          ) : null}
          {!isBusy ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={reloadPage}
              className={`whitespace-nowrap ${TONE_ACTION_CLASSES[tone]}`}
            >
              <RefreshCw className="mr-1 size-4" aria-hidden="true" />
              {t('ui.devRuntime.actions.retry', 'Retry')}
            </Button>
          ) : null}
          {!isBusy && token
            ? resolveOfferedActions(issue, { canConfirm }).map((action) => {
                const ActionIcon = ACTION_ICONS[action]
                return (
                  <Button
                    key={action}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendingAction !== null}
                    onClick={() => { void runRecoveryAction(action) }}
                    className={`whitespace-nowrap ${TONE_ACTION_CLASSES[tone]}`}
                  >
                    <ActionIcon className="mr-1 size-4" aria-hidden="true" />
                    {t(`ui.devRuntime.actions.${action}`, DEFAULT_ACTION_COPY[action])}
                  </Button>
                )
              })
            : null}
          {token ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={logsOpen}
              onClick={() => { void toggleLogs() }}
              className={`whitespace-nowrap ${TONE_ACTION_CLASSES[tone]}`}
            >
              <ScrollText className="mr-1 size-4" aria-hidden="true" />
              {logsOpen
                ? t('ui.devRuntime.actions.hideLogs', 'Hide logs')
                : t('ui.devRuntime.actions.viewLogs', 'View logs')}
            </Button>
          ) : null}
      </div>

      {actionError ? <p className="text-xs font-medium">{actionError}</p> : null}

      {expanded && issue ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <DetailRow label={t('ui.devRuntime.details.code', 'Error code')} value={issue.code} />
          <DetailRow label={t('ui.devRuntime.details.source', 'Source')} value={issue.source} />
          <DetailRow label={t('ui.devRuntime.details.occurrences', 'Occurrences')} value={String(issue.occurrences)} />
          <DetailRow label={t('ui.devRuntime.details.generation', 'Runtime generation')} value={String(issue.generation)} />
          <DetailRow label={t('ui.devRuntime.details.firstSeen', 'First seen')} value={issue.firstSeenAt} />
          <DetailRow label={t('ui.devRuntime.details.lastSeen', 'Last seen')} value={issue.lastSeenAt} />
          {issue.path ? <DetailRow label={t('ui.devRuntime.details.path', 'Path')} value={issue.path} /> : null}
        </dl>
      ) : null}
      {logsOpen ? (
        <div className="rounded-md border border-current/20 bg-black/20">
          {logs && logs.lines.length > 0 ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs leading-relaxed">
              {logs.lines.map((line) => `${line.at.slice(11, 19)}  ${line.text}`).join('\n')}
            </pre>
          ) : (
            <p className="p-2 text-xs">{t('ui.devRuntime.logs.empty', 'No diagnostic lines yet.')}</p>
          )}
          {logsUrl ? (
            <p className="border-t border-current/20 px-2 py-1 text-xs opacity-80">
              {t('ui.devRuntime.logs.splashHint', 'Full startup stream:')}{' '}
              <a className="underline" href={logsUrl} target="_blank" rel="noreferrer">{logsUrl}</a>
            </p>
          ) : null}
        </div>
      ) : null}

      {canConfirm ? ConfirmDialogElement : null}
    </div>
  )
}

const DEFAULT_ACTION_COPY: Record<RuntimeRecoveryAction, string> = {
  generate: 'Run generators',
  migrate: 'Run migrations',
  restart: 'Restart runtime',
}

const DEFAULT_HEALTH_COPY: Record<RuntimeHealth, string> = {
  starting: 'Runtime starting',
  ready: 'Runtime ready',
  degraded: 'Runtime degraded',
  recovering: 'Runtime recovering',
  unavailable: 'Runtime unavailable',
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 opacity-80">{label}</dt>
      <dd className="min-w-0 break-words font-mono">{value}</dd>
    </div>
  )
}

export default DevRuntimeDiagnosticsBanner
