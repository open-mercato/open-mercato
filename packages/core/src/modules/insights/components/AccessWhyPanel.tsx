import * as React from 'react'
import { CircleCheck, CircleX, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { normalizeAccessExplanation } from '../lib/client/accessExplanation'
import { fetchAccessExplanation, isAbortError, resolveExplainableAccessFeatures } from '../lib/client/explainApi'
import { formatExplainDateTime, toTranslateParams } from '../lib/client/format'
import type { AccessDetailView, AccessExplanationView, AccessRoleView } from '../lib/client/types'
import { ConfidenceBadge } from './ConfidenceBadge'

type AccessExplanationState =
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; explanation: AccessExplanationView }

export function useAccessExplanation(params: { features: readonly string[]; path?: string | null }): {
  state: AccessExplanationState
  retry: () => void
} {
  const features = resolveExplainableAccessFeatures(params.features)
  const featuresKey = features ? features.join(',') : ''
  const path = params.path ?? null
  const [state, setState] = React.useState<AccessExplanationState>({ status: 'loading' })
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    const requested = featuresKey ? featuresKey.split(',') : []
    if (requested.length === 0) {
      setState({ status: 'unsupported' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchAccessExplanation({ features: requested, path }, controller.signal)
      .then((outcome) => {
        if (controller.signal.aborted) return
        if (outcome.status === 'ok') {
          const explanation = normalizeAccessExplanation(outcome.body)
          setState(explanation ? { status: 'ready', explanation } : { status: 'error' })
        } else if (outcome.status === 'forbidden') {
          setState({ status: 'forbidden' })
        } else {
          setState({ status: 'error' })
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setState({ status: 'error' })
      })
    return () => {
      controller.abort()
    }
  }, [featuresKey, path, attempt])
  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}

function RoleList({ roles }: { roles: AccessRoleView[] }) {
  const t = useT()
  if (roles.length === 0) return <span className="text-muted-foreground">{t('insights.why.access.detail.none')}</span>
  return (
    <ul className="flex flex-wrap gap-2">
      {roles.map((role) => (
        <li key={role.id} className="inline-flex flex-wrap items-center gap-1" data-role-id={role.id}>
          <StatusBadge variant="neutral">{role.name ?? t('insights.why.access.detail.unnamedRole')}</StatusBadge>
          {role.appliesToOrganization ? null : (
            <span className="text-xs text-muted-foreground">{t('insights.why.access.detail.roleOtherOrganizations')}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function DetailItem({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('space-y-1', wide && 'sm:col-span-2')}>
      <dt className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

function AccessDetail({ detail }: { detail: AccessDetailView }) {
  const t = useT()
  const locale = useLocale()
  return (
    <dl className="grid gap-3 sm:grid-cols-2" data-testid="insights-access-detail">
      {detail.source ? (
        <DetailItem label={t('insights.why.access.detail.source')}>
          {t(`insights.why.access.sources.${detail.source}`)}
        </DetailItem>
      ) : null}
      {detail.organizationAllowed === false ? (
        <DetailItem label={t('insights.why.access.detail.organization')}>
          {t('insights.why.access.detail.organizationNotAllowed')}
        </DetailItem>
      ) : null}
      <DetailItem label={t('insights.why.access.detail.roles')}>
        <RoleList roles={detail.roles} />
      </DetailItem>
      <DetailItem label={t('insights.why.access.detail.grantingRoles')}>
        <RoleList roles={detail.grantingRoles} />
      </DetailItem>
      <DetailItem label={t('insights.why.access.detail.recentChanges')} wide>
        {detail.recentChanges === null ? (
          <span className="text-muted-foreground">{t('insights.why.access.detail.recentChangesHidden')}</span>
        ) : detail.recentChanges.length === 0 ? (
          <span className="text-muted-foreground">{t('insights.why.access.detail.none')}</span>
        ) : (
          <ul className="space-y-1">
            {detail.recentChanges.map((change) => (
              <li key={change.logId} className="flex flex-wrap gap-2">
                <time dateTime={change.at} className="text-muted-foreground">
                  {formatExplainDateTime(change.at, locale) ?? change.at}
                </time>
                <span className="break-words">{change.actionLabel ?? t(`insights.why.access.changeKinds.${change.kind}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </DetailItem>
    </dl>
  )
}

export type AccessWhyPanelProps = {
  requiredFeatures: readonly string[]
  path?: string | null
  className?: string
}

export function AccessWhyPanel({ requiredFeatures, path = null, className }: AccessWhyPanelProps) {
  const t = useT()
  const locale = useLocale()
  const { state, retry } = useAccessExplanation({ features: requiredFeatures, path })

  if (state.status === 'loading') return <LoadingMessage className={className} label={t('insights.why.loading')} />
  if (state.status === 'unsupported') {
    return (
      <TabEmptyState
        className={className}
        title={t('insights.why.access.unsupported.title')}
        description={t('insights.why.access.unsupported.description')}
      />
    )
  }
  if (state.status === 'forbidden') {
    return (
      <TabEmptyState
        className={className}
        title={t('insights.why.access.forbidden.title')}
        description={t('insights.why.access.forbidden.description')}
      />
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorMessage
        className={className}
        label={t('insights.why.error')}
        action={(
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {t('insights.why.retry')}
          </Button>
        )}
      />
    )
  }

  const { explanation } = state
  const granted = explanation.decision === 'granted'
  const DecisionIcon = granted ? ShieldCheck : ShieldAlert
  return (
    <section
      className={cn('space-y-4 rounded-lg border border-border bg-card p-4', className)}
      aria-label={t('insights.why.access.title')}
      data-testid="insights-access-why"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant={granted ? 'success' : 'error'}>
          <DecisionIcon className="size-3" aria-hidden="true" />
          <span>{t(`insights.why.access.decision.${explanation.decision}`)}</span>
        </StatusBadge>
        <ConfidenceBadge confidence={explanation.confidence} />
      </div>
      {explanation.summary ? (
        <p className="text-sm text-foreground" data-summary-key={explanation.summary.key}>
          {t(explanation.summary.key, toTranslateParams(explanation.summary.params, locale))}
        </p>
      ) : null}
      {explanation.reasons.length > 0 ? (
        <ul className="space-y-1 text-sm text-foreground">
          {explanation.reasons.map((reason) => (
            <li key={reason} data-access-reason={reason}>{t(`insights.why.access.reasons.${reason}`)}</li>
          ))}
        </ul>
      ) : null}
      {explanation.required.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t('insights.why.access.required')}</h4>
          <ul className="space-y-1">
            {explanation.required.map((requirement) => (
              <li
                key={requirement.feature}
                className="flex flex-wrap items-center gap-2 text-sm"
                data-feature={requirement.feature}
                data-granted={requirement.granted ? 'true' : 'false'}
              >
                {requirement.granted ? (
                  <CircleCheck className="size-4 shrink-0 text-status-success-icon" aria-hidden="true" />
                ) : (
                  <CircleX className="size-4 shrink-0 text-status-error-icon" aria-hidden="true" />
                )}
                <code className="break-all font-mono text-xs">{requirement.feature}</code>
                <span className="text-muted-foreground">
                  {requirement.granted ? t('insights.why.access.granted') : t('insights.why.access.missing')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {explanation.detail ? <AccessDetail detail={explanation.detail} /> : null}
      {!granted ? <p className="text-sm text-muted-foreground">{t('insights.why.access.contactAdmin')}</p> : null}
    </section>
  )
}

export default AccessWhyPanel
