"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
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
type QueueDepth = { queueName: string; known: boolean; ready?: number; active?: number; delayed?: number }
type Readiness = { checks?: Check[]; ready?: boolean; remaining?: number; unavailable?: Unavailable[]; queues?: QueueDepth[] }

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
  // The one `recommended` check whose absence stops a whole category of campaign rather than merely leaving a
  // gap, which is why the badge above singles it out.
  const schedulesMissing = checks.some((check) => check.id === 'schedules' && !check.done)

  return (
    <Page>
      <PageBody>
        {loadFailed ? (
          <div className="mb-3">
            <ErrorMessage
              label={t('marketing_automation.setup.loadFailed', 'Could not check your setup.')}
              action={(
                <Button variant="outline" size="sm" onClick={() => { void load() }}>
                  {t('marketing_automation.runs.retry', 'Try again')}
                </Button>
              )}
            />
          </div>
        ) : null}

        {/*
          "Ready to send" was true and incomplete.

          `isReadyToSend` reads the BLOCKING checks, and a missing scheduler registration is not one — event
          campaigns deliver perfectly well without it, which is why the severity stays `recommended`. But the
          badge then reported unqualified readiness to an installation where every win-back, birthday and
          reorder reminder was dead, and the checklist row saying so is further down the page wearing the same
          "Recommended" label as "create a segment".

          So the badge says WHICH half is ready. The fact is unchanged; the sentence is no longer misleading.
        */}
        <div className="mb-4">
          <StatusBadge variant={readiness?.ready ? (schedulesMissing ? 'warning' : 'success') : 'warning'}>
            {readiness?.ready
              ? schedulesMissing
                ? t('marketing_automation.setup.readyEventsOnly', 'Ready to send event-triggered campaigns — scheduled ones cannot run')
                : t('marketing_automation.setup.ready', 'Ready to send')
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
        {/*
          Work that is waiting, shown only when there IS some.
          
          "No worker is running" and "nothing to do" used to look identical: the job log has no rows until a
          worker has already picked something up, so a fresh deploy with no consumer reads as a quiet Sunday.
          This reports the measurable fact — how many jobs are queued — and stops there. It does NOT conclude
          that workers are down: `active` is one sample and can be zero simply between polls, and a false "your
          workers are down" sends somebody hunting a problem that is not there.
          
          A healthy installation has nothing queued and sees none of this.
        */}
        {(() => {
          const waiting = (readiness?.queues ?? []).filter((queue) => (queue.ready ?? 0) > 0)
          if (waiting.length === 0) return null
          const total = waiting.reduce((sum, queue) => sum + (queue.ready ?? 0), 0)
          const working = waiting.reduce((sum, queue) => sum + (queue.active ?? 0), 0)
          return (
            // An inline message is an Alert: the hand-built bordered box carried the same meaning with
            // none of the status colour, icon or role that tells somebody how to weigh it.
            <Alert status="information" style="light" className="mb-4">
              <div className="font-medium">
                {t('marketing_automation.setup.queued.title', '{count} background jobs are waiting')
                  .replace('{count}', String(total))}
              </div>
              <div className="mt-1 text-xs">
                {working > 0
                  ? t('marketing_automation.setup.queued.working', '{count} are being processed right now.')
                      .replace('{count}', String(working))
                  : t(
                      'marketing_automation.setup.queued.idle',
                      'None are being processed at this instant. If this number does not fall, check that a queue worker is running.',
                    )}
              </div>
            </Alert>
          )
        })()}

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
            // Only while something is outstanding. A bare `0` beside the title read as a count of checks
            // rather than a count of what is left, so a fully set up installation looked like it had none.
            count={readiness?.remaining ? readiness.remaining : undefined}
            help={{
              title: t('marketing_automation.setup.title', 'Getting started'),
              body: t('marketing_automation.help.setup.gettingStarted'),
            }}
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
                  {/*
                    Shown only while the check is outstanding, like the "Open" link beside it.
                    
                    Each body is written in the voice of the thing being WRONG — "there is no email channel",
                    "the two periodic jobs are not registered" — because that is when somebody needs it. Rendered
                    unconditionally, a finished installation read as a list of warnings about things that are
                    fine, and the schedules line stated something that was plainly untrue beside its own
                    green "Done".
                  */}
                  {!check.done ? (
                    <div className="text-xs text-muted-foreground">
                      {t(`marketing_automation.setup.check.${check.id}.body`, '')}
                    </div>
                  ) : null}
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
