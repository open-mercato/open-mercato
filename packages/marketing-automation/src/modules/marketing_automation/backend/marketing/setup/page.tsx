"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type Check = {
  id: string
  severity: 'blocking' | 'recommended'
  done: boolean
  href?: string
}

type Unavailable = { module: string; reasonKey: string }
type Readiness = { checks?: Check[]; ready?: boolean; remaining?: number; unavailable?: Unavailable[] }

/**
 * The first-run checklist.
 *
 * Answered from live state, never from a "setup completed" flag: an installation whose email channel was
 * deleted last week is not set up, whatever somebody once clicked. That also makes this screen useful long
 * after the first run, as the answer to "why did nothing send".
 */
export default function MarketingSetupPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [readiness, setReadiness] = React.useState<Readiness | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const result = await apiCall<Readiness>('/api/marketing_automation/readiness')
      if (result.ok && result.result) setReadiness(result.result)
      else setLoadFailed(true)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { void load() }, [load, scopeVersion])

  if (loading) {
    return <Page><PageBody><LoadingMessage label={t('marketing_automation.setup.loading', 'Checking your setup…')} /></PageBody></Page>
  }

  const checks = readiness?.checks ?? []

  return (
    <Page>
      <PageBody>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage label={t('marketing_automation.setup.loadFailed', 'Could not check your setup.')} />
          </div>
        ) : null}

        <div className="mb-4">
          <StatusBadge variant={readiness?.ready ? 'success' : 'warning'}>
            {readiness?.ready
              ? t('marketing_automation.setup.ready', 'Ready to send')
              : t('marketing_automation.setup.notReady', 'Nothing will be delivered yet')}
          </StatusBadge>
        </div>

        {/*
          What this installation cannot do, ABOVE the checklist and visibly not part of it.

          Open Mercato is an ERP or a CRM depending on what is installed, so a missing module is a fact about
          the shape of the installation rather than an unfinished setup step — which is exactly why it must not
          be a checklist row with a `done` nobody can ever tick. An operator who reads this first knows why half
          the trigger palette is greyed out before they go looking.
        */}
        {(readiness?.unavailable ?? []).length > 0 ? (
          <div className="space-y-2">
            <SectionHeader title={t('marketing_automation.setup.unavailableTitle', 'Not available here')} />
            <ul className="space-y-2">
              {(readiness?.unavailable ?? []).map((entry) => (
                <li key={entry.module} className="flex items-start gap-2 border-b border-border py-2 text-sm">
                  <StatusBadge variant="neutral">
                    {t('marketing_automation.setup.notInstalled', 'Not installed')}
                  </StatusBadge>
                  <span className="text-muted-foreground">{t(entry.reasonKey, entry.module)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-2">
          <SectionHeader
            title={t('marketing_automation.setup.title', 'Getting started')}
            count={readiness?.remaining ?? 0}
          />
          <ul className="space-y-2">
            {checks.map((check) => (
              <li key={check.id} className="flex items-start justify-between gap-3 border-b border-border py-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <StatusBadge variant={check.done ? 'success' : check.severity === 'blocking' ? 'error' : 'neutral'}>
                      {check.done
                        ? t('marketing_automation.setup.done', 'Done')
                        : check.severity === 'blocking'
                          ? t('marketing_automation.setup.required', 'Required')
                          : t('marketing_automation.setup.optional', 'Recommended')}
                    </StatusBadge>
                    <span className="font-medium text-foreground">
                      {t(`marketing_automation.setup.check.${check.id}.title`, check.id)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t(`marketing_automation.setup.check.${check.id}.body`, '')}
                  </div>
                </div>
                {!check.done && check.href ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={check.href}>{t('marketing_automation.setup.open', 'Open')}</a>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => void load()}>
            {t('marketing_automation.setup.recheck', 'Check again')}
          </Button>
        </div>
      </PageBody>
    </Page>
  )
}
