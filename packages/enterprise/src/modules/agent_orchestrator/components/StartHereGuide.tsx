"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { usePersistedBooleanFlag } from '@open-mercato/ui/backend/crud/usePersistedBooleanFlag'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AUTOMATION_VIEW_FEATURE, WORKFLOW_DEFINITIONS_HREF } from '../lib/automationLinks'
import { OPTIONAL_REQUEST_INIT } from './optionalRequest'
import { ProposeOnlyNotice } from './ProposeOnlyNotice'

const DISMISS_KEY = 'agent_orchestrator:start-here:dismissed'

/**
 * The path a first-time user has to reverse-engineer today (F4): agents →
 * playground → an automation that invokes one → the caseload decision → the
 * trace. Each step links forward and reports whether this tenant has already
 * done it, so the block reads as progress rather than as documentation.
 *
 * Progress is derived from data the cockpit already exposes — no new endpoint.
 * Step 3 ("an automation actually invoked an agent") is read off proposals
 * carrying a `workflowInstanceId`, which is precisely the milestone the step
 * describes: an INVOKE_AGENT activity ran. Every probe is optional and a failed
 * one degrades to "not done yet" rather than hiding the guide.
 */
type StepId = 'agents' | 'playground' | 'automation' | 'caseload' | 'traces'

type Signals = {
  hasAgents: boolean
  hasRun: boolean
  hasAutomationRun: boolean
  hasDisposed: boolean
}

const EMPTY_SIGNALS: Signals = {
  hasAgents: false,
  hasRun: false,
  hasAutomationRun: false,
  hasDisposed: false,
}

type StepDef = {
  id: StepId
  feature: string
  href: string
  titleKey: string
  titleFallback: string
  bodyKey: string
  bodyFallback: string
  done: (signals: Signals) => boolean
}

const STEPS: readonly StepDef[] = [
  {
    id: 'agents',
    feature: 'agent_orchestrator.agents.view',
    href: '/backend/agents',
    titleKey: 'agent_orchestrator.startHere.step.agents.title',
    titleFallback: 'Agents',
    bodyKey: 'agent_orchestrator.startHere.step.agents.body',
    bodyFallback: 'See which agents are available to you and what each one is allowed to propose.',
    done: (signals) => signals.hasAgents,
  },
  {
    id: 'playground',
    feature: 'agent_orchestrator.agents.run',
    href: '/backend/playground',
    titleKey: 'agent_orchestrator.startHere.step.playground.title',
    titleFallback: 'Playground',
    bodyKey: 'agent_orchestrator.startHere.step.playground.body',
    bodyFallback: 'Run one against an example input. This is a rehearsal — it changes nothing.',
    done: (signals) => signals.hasRun,
  },
  {
    id: 'automation',
    feature: AUTOMATION_VIEW_FEATURE,
    href: WORKFLOW_DEFINITIONS_HREF,
    titleKey: 'agent_orchestrator.startHere.step.automation.title',
    titleFallback: 'Automation',
    bodyKey: 'agent_orchestrator.startHere.step.automation.body',
    bodyFallback: 'Add an "invoke agent" step to an automation so the agent runs on real events.',
    done: (signals) => signals.hasAutomationRun,
  },
  {
    id: 'caseload',
    feature: 'agent_orchestrator.proposals.view',
    href: '/backend/caseload',
    titleKey: 'agent_orchestrator.startHere.step.caseload.title',
    titleFallback: 'Caseload',
    bodyKey: 'agent_orchestrator.startHere.step.caseload.body',
    bodyFallback: 'Approve, edit or reject what the agent proposed. Only then does anything happen.',
    done: (signals) => signals.hasDisposed,
  },
  {
    id: 'traces',
    feature: 'agent_orchestrator.trace.view',
    href: '/backend/traces',
    titleKey: 'agent_orchestrator.startHere.step.traces.title',
    titleFallback: 'Traces',
    bodyKey: 'agent_orchestrator.startHere.step.traces.body',
    bodyFallback: 'Inspect what the agent actually did, step by step.',
    done: () => false,
  },
]

// Steps 1-4 are the learning path; Traces is a permanent destination and never
// counts as "finished", so completion is measured over the first four only.
const PATH_STEP_IDS: readonly StepId[] = ['agents', 'playground', 'automation', 'caseload']

type ListResponse = { items?: Array<Record<string, unknown>>; total?: number }

async function probeTotal(path: string): Promise<number> {
  const call = await apiCall<ListResponse>(path, OPTIONAL_REQUEST_INIT, { fallback: { items: [], total: 0 } })
  if (!call.ok) return 0
  const result = call.result
  if (typeof result?.total === 'number') return result.total
  return Array.isArray(result?.items) ? result.items.length : 0
}

export function StartHereGuide() {
  const t = useT()
  const router = useRouter()
  const { payload } = useBackendChrome()
  const grantedFeatures = payload?.grantedFeatures
  const { value: dismissed, setValue: setDismissed, isHydrated } = usePersistedBooleanFlag(DISMISS_KEY, false)
  const [signals, setSignals] = React.useState<Signals>(EMPTY_SIGNALS)
  const [probed, setProbed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function probe() {
      const [agentsTotal, runsTotal, recent] = await Promise.all([
        probeTotal('/api/agent_orchestrator/agents?pageSize=1'),
        probeTotal('/api/agent_orchestrator/runs?pageSize=1'),
        apiCall<ListResponse>(
          '/api/agent_orchestrator/proposals?pageSize=25&sortField=createdAt&sortDir=desc',
          OPTIONAL_REQUEST_INIT,
          { fallback: { items: [] } },
        ),
      ])
      if (cancelled) return
      const proposals = recent.ok && Array.isArray(recent.result?.items) ? recent.result!.items! : []
      setSignals({
        hasAgents: agentsTotal > 0,
        hasRun: runsTotal > 0,
        hasAutomationRun: proposals.some((item) => !!(item.workflow_instance_id ?? item.workflowInstanceId)),
        hasDisposed: proposals.some((item) => (item.disposition ?? 'pending') !== 'pending'),
      })
      setProbed(true)
    }
    void probe()
    return () => { cancelled = true }
  }, [])

  const visibleSteps = React.useMemo(
    () => STEPS.filter((step) => hasFeature(grantedFeatures, step.feature)),
    [grantedFeatures],
  )

  const pathComplete = React.useMemo(
    () =>
      visibleSteps
        .filter((step) => PATH_STEP_IDS.includes(step.id))
        .every((step) => step.done(signals)),
    [visibleSteps, signals],
  )

  // Hidden until the probes answer, so the guide never flashes "nothing done"
  // at a tenant that has been running agents for months.
  if (!isHydrated || !probed || dismissed || !visibleSteps.length) return null
  if (pathComplete) return null

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      aria-label={t('agent_orchestrator.startHere.title', 'Start here')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t('agent_orchestrator.startHere.title', 'Start here')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('agent_orchestrator.startHere.subtitle', 'Five steps, in the order you need them.')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('agent_orchestrator.startHere.dismiss', 'Hide getting started')}
          onClick={() => setDismissed(true)}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-3">
        <ProposeOnlyNotice variant="block" />
      </div>

      <ol className="mt-3 space-y-2">
        {visibleSteps.map((step, index) => {
          const done = step.done(signals)
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => router.push(step.href)}
                className="flex w-full items-start gap-3 rounded-md border border-transparent px-2 py-2 text-left hover:border-border hover:bg-muted/50"
              >
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    done
                      ? 'bg-status-success-bg text-status-success-text'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  aria-hidden
                >
                  {done ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {t(step.titleKey, step.titleFallback)}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t(step.bodyKey, step.bodyFallback)}
                  </span>
                </span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
