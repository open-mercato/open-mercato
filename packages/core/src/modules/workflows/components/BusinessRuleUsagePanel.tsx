'use client'

import * as React from 'react'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { readJsonSafe } from '@open-mercato/ui/backend/utils/serverErrors'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { BusinessRuleUsageReference } from '../lib/business-rule-usage'

const logger = createLogger('workflows')

export type BusinessRuleUsagePanelProps = {
  ruleId: string | null
  className?: string
}

type UsageResponse = {
  workflowCount?: number
  references?: BusinessRuleUsageReference[]
}

/**
 * BusinessRuleUsagePanel — the workflows half of the inline-BR dependency
 * visibility (#4236). `business_rules` exposes a slot on its `InlineRuleEditor`;
 * this panel fills it by asking `GET /api/workflows/rule-usage`, so the upstream
 * module never imports or queries workflows.
 */
export function BusinessRuleUsagePanel({ ruleId, className }: BusinessRuleUsagePanelProps) {
  const t = useT()
  const [usage, setUsage] = React.useState<UsageResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!ruleId) {
      setUsage(null)
      return
    }
    let cancelled = false
    setIsLoading(true)
    setFailed(false)
    const load = async () => {
      try {
        const response = await apiFetch(`/api/workflows/rule-usage?ruleId=${encodeURIComponent(ruleId)}`)
        if (!response.ok) {
          if (!cancelled) setFailed(true)
          return
        }
        const body = (await readJsonSafe<UsageResponse>(response)) ?? {}
        if (!cancelled) setUsage(body)
      } catch (error) {
        logger.error('Failed to load business rule usage', { ruleId, err: error })
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [ruleId])

  if (!ruleId) return null

  const references = usage?.references ?? []
  const workflowCount = usage?.workflowCount ?? 0

  return (
    <section className={`rounded-lg border border-border bg-card p-3 ${className ?? ''}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('workflows.businessRules.usage.title')}
      </h4>
      {isLoading ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner size="sm" />
          <span>{t('workflows.common.loadingDetails')}</span>
        </div>
      ) : failed ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('workflows.businessRules.usage.unavailable')}</p>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium text-foreground">
            {t('workflows.businessRules.usage.workflowCount', { count: workflowCount })}
          </p>
          {references.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{t('workflows.businessRules.usage.empty')}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {references.map((reference) => (
                <li
                  key={`${reference.workflowId}:${reference.version}:${reference.kind}:${reference.locationId}`}
                  className="text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">{reference.workflowName || reference.workflowId}</span>
                  <span className="ml-1">{t(`workflows.businessRules.usage.kinds.${reference.kind}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
