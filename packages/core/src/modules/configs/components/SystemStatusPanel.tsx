"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  SystemStatusSnapshot,
  SystemStatusItem,
  SystemStatusState,
  SystemStatusRuntimeMode,
} from '../lib/system-status.types'

const API_PATH = '/api/configs/system-status'
const ENV_GUIDE_URL = 'https://docs.openmercato.com/docs/framework/operations/system-status#managing-variables'

const STATUS_LABEL_KEYS: Record<SystemStatusState, string> = {
  enabled: 'configs.systemStatus.state.enabled',
  disabled: 'configs.systemStatus.state.disabled',
  set: 'configs.systemStatus.state.set',
  unset: 'configs.systemStatus.state.unset',
  unknown: 'configs.systemStatus.state.unknown',
}

const STATUS_BADGE_CLASSES: Record<SystemStatusState, string> = {
  enabled: 'border border-emerald-300 bg-emerald-50 text-emerald-700',
  disabled: 'border border-slate-300 bg-slate-100 text-slate-700',
  set: 'border border-blue-300 bg-blue-50 text-blue-700',
  unset: 'border border-dashed border-slate-200 text-slate-500',
  unknown: 'border border-amber-300 bg-amber-50 text-amber-700',
}

const RUNTIME_MODE_LABEL_KEYS: Record<SystemStatusRuntimeMode, string> = {
  development: 'configs.systemStatus.runtime.development',
  production: 'configs.systemStatus.runtime.production',
  test: 'configs.systemStatus.runtime.test',
  unknown: 'configs.systemStatus.runtime.unknown',
}

const KNOWN_RUNTIME_MODES = new Set<SystemStatusRuntimeMode>(['development', 'production', 'test', 'unknown'])

function isSystemStatusSnapshot(payload: unknown): payload is SystemStatusSnapshot {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as { categories?: unknown; runtimeMode?: unknown }
  if (!Array.isArray(value.categories)) return false
  if (typeof value.runtimeMode !== 'string') return false
  if (!KNOWN_RUNTIME_MODES.has(value.runtimeMode as SystemStatusRuntimeMode)) return false
  return value.categories.every((category) => {
    if (!category || typeof category !== 'object') return false
    const entry = category as { key?: unknown; items?: unknown }
    if (typeof entry.key !== 'string') return false
    if (!Array.isArray(entry.items)) return false
    return entry.items.every((item) => {
      if (!item || typeof item !== 'object') return false
      const asItem = item as { key?: unknown; state?: unknown }
      return typeof asItem.key === 'string' && typeof asItem.state === 'string'
    })
  })
}

function renderEnvAssignment(
  item: SystemStatusItem,
  rawValue: string | null | undefined,
  translate: (key: string, fallback?: string) => string,
): React.ReactNode {
  const value = typeof rawValue === 'string' ? rawValue : ''
  const hasValue = value.trim().length > 0
  const codeClass =
    'block w-full break-all whitespace-pre-wrap rounded bg-muted px-1.5 py-0.5 font-mono text-xs sm:text-sm'
  if (!hasValue) {
    const notSet = translate('configs.systemStatus.value.notSet', 'Not set')
    return (
      <div className="space-y-1">
        <code className={codeClass}>{item.key}</code>
        <span className="text-xs text-muted-foreground sm:text-sm">({notSet})</span>
      </div>
    )
  }
  return (
    <code className={codeClass}>
      {`${item.key}=${value}`}
    </code>
  )
}

function StatusBadge({ state }: { state: SystemStatusState }) {
  const t = useT()
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[state]}`}>
      {t(STATUS_LABEL_KEYS[state])}
    </span>
  )
}

type FetchState = {
  loading: boolean
  error: string | null
  snapshot: SystemStatusSnapshot | null
}

export function SystemStatusPanel() {
  const t = useT()
  const [state, setState] = React.useState<FetchState>({ loading: true, error: null, snapshot: null })

  const loadSnapshot = React.useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const payload = await readApiResultOrThrow<unknown>(API_PATH, undefined, {
        errorMessage: t('configs.systemStatus.error', 'Failed to load system status'),
      })
      if (!isSystemStatusSnapshot(payload)) {
        setState({
          loading: false,
          error: t('configs.systemStatus.invalidResponse', 'Unexpected response when loading system status'),
          snapshot: null,
        })
        return
      }
      setState({ loading: false, error: null, snapshot: payload })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('configs.systemStatus.error', 'Failed to load system status')
      setState({ loading: false, error: message, snapshot: null })
    }
  }, [t])

  React.useEffect(() => {
    loadSnapshot().catch(() => {})
  }, [loadSnapshot])

  if (state.loading) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.systemStatus.title', 'System status')}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'configs.systemStatus.description',
              'Review debugging, cache, and logging flags that shape backend behaviour.'
            )}
          </p>
        </header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('configs.systemStatus.loading', 'Loading status snapshot…')}
        </div>
      </section>
    )
  }

  if (state.error) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.systemStatus.title', 'System status')}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'configs.systemStatus.description',
              'Review debugging, cache, and logging flags that shape backend behaviour.'
            )}
          </p>
        </header>
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
        <Button type="button" variant="outline" onClick={() => loadSnapshot().catch(() => {})}>
          {t('configs.systemStatus.retry', 'Retry')}
        </Button>
      </section>
    )
  }

  const snapshot = state.snapshot
  if (!snapshot) return null

  return (
    <section className="space-y-6 rounded-lg border bg-background p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t('configs.systemStatus.title', 'System status')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('configs.systemStatus.description', 'Review debugging, cache, and logging flags that shape backend behaviour.')}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(
            'configs.systemStatus.runtimeMode',
            'Runtime mode: {{mode}}',
            { mode: t(RUNTIME_MODE_LABEL_KEYS[snapshot.runtimeMode]) }
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(
            'configs.systemStatus.generatedAt',
            'Snapshot generated {{timestamp}}',
            { timestamp: new Date(snapshot.generatedAt).toLocaleString() }
          )}
        </p>
      </header>
      <div className="space-y-6">
        {snapshot.categories.map((category) => (
          <div key={category.key} className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">{t(category.labelKey)}</h3>
              {category.descriptionKey ? (
                <p className="text-sm text-muted-foreground">{t(category.descriptionKey)}</p>
              ) : null}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {category.items.map((item) => (
                <article key={item.key} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">{t(item.labelKey)}</h4>
                      <p className="text-xs text-muted-foreground">{t(item.descriptionKey)}</p>
                    </div>
                    <StatusBadge state={item.state} />
                  </div>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="space-y-1">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t('configs.systemStatus.details.currentValue', 'Current value')}
                      </dt>
                      <dd className="text-sm font-medium">
                        {renderEnvAssignment(item, item.value, t)}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t('configs.systemStatus.details.defaultValue', 'Default')}
                      </dt>
                      <dd className="text-sm font-medium">
                        {renderEnvAssignment(item, item.defaultValue, t)}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'configs.systemStatus.details.updateHint',
                      'Update by running `export {{key}}=value` or editing `.env`, then restart the app.',
                      { key: item.key }
                    )}{' '}
                    <a
                      href={ENV_GUIDE_URL}
                      className="font-medium text-primary hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('configs.systemStatus.details.updateDocs', 'Environment configuration guide')}
                    </a>
                  </p>
                  {item.docUrl ? (
                    <div>
                      <a
                        href={item.docUrl}
                        className="text-sm font-medium text-primary hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('configs.systemStatus.viewDocs', 'View documentation')}
                      </a>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default SystemStatusPanel
