"use client"

/**
 * "Research company" header trigger for the Company detail page
 * (`detail:customers.company:header`).
 *
 * Opens a right-side sheet that runs the file-defined `deals.company_researcher`
 * agent via `POST /api/agent_orchestrator/agents/deals.company_researcher/run`
 * (synchronous, informative result) and renders the qualified prospect
 * assessment with cited sources. The write is wrapped in `useGuardedMutation`
 * per the customers-module non-CrudForm contract and is optimistic-lock-exempt
 * (a custom action, not a concurrent record edit).
 */

import * as React from 'react'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

const COMPANY_RESEARCH_AGENT_ID = 'deals.company_researcher'

type PayingLikelihood = 'low' | 'medium' | 'high'
type CompanySizeBucket = 'micro' | 'small' | 'mid_market' | 'enterprise' | 'unknown'

interface ResearchAssessment {
  revenueBand: string
  annualRevenueEstimateUsd?: number | null
  employeeEstimate?: string | null
  companySizeBucket: CompanySizeBucket
  fundingStage?: string | null
  dealFitScore: number
  payingLikelihood: PayingLikelihood
  recommendation: string
}

interface ResearchFinding {
  signal: string
  detail: string
  sourceUrl: string
}

interface ResearchResult {
  companyName: string
  assessment: ResearchAssessment
  findings: ResearchFinding[]
  summary: string
}

interface RunResponse {
  kind?: 'informative' | 'actionable'
  data?: ResearchResult
  runId?: string | null
}

interface CompanyOverviewLike {
  company?: { id?: string | null; displayName?: string | null } | null
  profile?: {
    domain?: string | null
    websiteUrl?: string | null
    industry?: string | null
    annualRevenue?: string | null
  } | null
}

interface HostInjectionContext {
  companyId?: string | null
  resourceId?: string | null
  data?: CompanyOverviewLike | null
}

interface CompanyResearchTriggerProps {
  context?: HostInjectionContext
  data?: CompanyOverviewLike | null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

interface ResearchInput {
  companyId: string | null
  companyName: string
  companyDomain: string | null
  websiteUrl: string | null
  industry: string | null
  currentAnnualRevenue: string | null
}

function buildInput(
  context: HostInjectionContext | undefined,
  data: CompanyOverviewLike | null | undefined,
): ResearchInput | null {
  const overview = data ?? context?.data ?? null
  const company = overview?.company ?? null
  const profile = overview?.profile ?? null
  const companyName = readString(company?.displayName)
  if (!companyName) return null
  return {
    companyId: readString(company?.id) ?? readString(context?.companyId) ?? readString(context?.resourceId),
    companyName,
    companyDomain: readString(profile?.domain),
    websiteUrl: readString(profile?.websiteUrl),
    industry: readString(profile?.industry),
    currentAnnualRevenue: readString(profile?.annualRevenue),
  }
}

const payingLikelihoodVariant: Record<PayingLikelihood, StatusBadgeVariant> = {
  high: 'success',
  medium: 'warning',
  low: 'error',
}

export default function CompanyResearchTriggerWidget({ context, data }: CompanyResearchTriggerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [isRunning, setIsRunning] = React.useState(false)
  const [result, setResult] = React.useState<{ data: ResearchResult; runId: string | null } | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const input = React.useMemo(() => buildInput(context, data), [context, data])

  const { runMutation } = useGuardedMutation<{ entityType: string }>({
    contextId: 'agent_examples:company-research',
  })

  const messageForFailure = React.useCallback(
    (status: number, response: Response | undefined, serverError: string | null): string => {
      switch (status) {
        case 400:
          return t(
            'agent_examples.companyResearch.error.selectOrg',
            'Select a single organization before running company research.',
          )
        case 403:
          return t(
            'agent_examples.companyResearch.error.forbidden',
            'You need agent-run and web-search permissions to research a company.',
          )
        case 404:
          return t(
            'agent_examples.companyResearch.error.notFound',
            'The company researcher agent is not available. Run "yarn generate" and restart OpenCode.',
          )
        case 429: {
          const retryAfter = response?.headers?.get('retry-after')
          return retryAfter
            ? t(
                'agent_examples.companyResearch.error.busyRetry',
                'The agent runner is busy. Try again in {seconds}s.',
              ).replace('{seconds}', retryAfter)
            : t(
                'agent_examples.companyResearch.error.busy',
                'The agent runner is busy. Try again shortly.',
              )
        }
        case 422:
          return t(
            'agent_examples.companyResearch.error.failed',
            'The research run could not complete — it may have timed out or been blocked.',
          )
        default:
          return (
            serverError ??
            t('agent_examples.companyResearch.error.generic', 'Failed to run company research.')
          )
      }
    },
    [t],
  )

  const handleRun = React.useCallback(async () => {
    if (!input || isRunning) return
    setIsRunning(true)
    setError(null)
    setResult(null)
    try {
      await runMutation({
        context: { entityType: 'customers:company' },
        mutationPayload: { agentId: COMPANY_RESEARCH_AGENT_ID, companyId: input.companyId },
        operation: async () => {
          // optimistic-lock-exempt: runs an agent, not a concurrent record edit
          const call = await apiCall<RunResponse>(
            `/api/agent_orchestrator/agents/${encodeURIComponent(COMPANY_RESEARCH_AGENT_ID)}/run`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                input: {
                  companyName: input.companyName,
                  companyDomain: input.companyDomain ?? undefined,
                  websiteUrl: input.websiteUrl ?? undefined,
                  industry: input.industry ?? undefined,
                  currentAnnualRevenue: input.currentAnnualRevenue ?? undefined,
                },
              }),
            },
          )
          if (!call.ok) {
            const serverError = readString((call.result as Record<string, unknown> | null)?.error)
            setError(messageForFailure(call.status, call.response, serverError))
            return
          }
          const body = call.result
          if (body && body.kind === 'informative' && body.data) {
            setResult({ data: body.data, runId: readString(body.runId) })
          } else {
            setError(
              t(
                'agent_examples.companyResearch.error.unexpected',
                'The agent returned an unexpected result shape.',
              ),
            )
          }
        },
      })
    } catch {
      setError((prev) =>
        prev ?? t('agent_examples.companyResearch.error.generic', 'Failed to run company research.'),
      )
    } finally {
      setIsRunning(false)
    }
  }, [input, isRunning, messageForFailure, runMutation, t])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next && !isRunning && !result && !error) {
        void handleRun()
      }
    },
    [error, handleRun, isRunning, result],
  )

  if (!input) return null

  const sizeLabels: Record<CompanySizeBucket, string> = {
    micro: t('agent_examples.companyResearch.size.micro', 'Micro'),
    small: t('agent_examples.companyResearch.size.small', 'Small'),
    mid_market: t('agent_examples.companyResearch.size.midMarket', 'Mid-market'),
    enterprise: t('agent_examples.companyResearch.size.enterprise', 'Enterprise'),
    unknown: t('agent_examples.companyResearch.size.unknown', 'Unknown'),
  }
  const likelihoodLabels: Record<PayingLikelihood, string> = {
    high: t('agent_examples.companyResearch.likelihood.high', 'High'),
    medium: t('agent_examples.companyResearch.likelihood.medium', 'Medium'),
    low: t('agent_examples.companyResearch.likelihood.low', 'Low'),
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handleOpenChange(true)}
        data-ai-company-research-trigger=""
        aria-label={t('agent_examples.companyResearch.trigger.ariaLabel', 'Research this company on the web')}
      >
        <AiIcon className="size-4" />
        <span>{t('agent_examples.companyResearch.trigger.label', 'Research company')}</span>
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={cn(
            'sm:max-w-xl sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:h-screen sm:max-h-screen sm:rounded-none sm:rounded-l-2xl',
            'flex flex-col gap-3 p-4 z-[70]',
          )}
          data-ai-company-research-sheet=""
        >
          <DialogHeader>
            <DialogTitle>
              {t('agent_examples.companyResearch.sheet.title', 'Company research')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'agent_examples.companyResearch.sheet.description',
                'An AI agent searches the public web to qualify {company} as a sales prospect — size, revenue, funding, and deal fit. Every finding links to its source.',
              ).replace('{company}', input.companyName)}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {isRunning ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                <span>
                  {t(
                    'agent_examples.companyResearch.running',
                    'Researching {company} on the public web…',
                  ).replace('{company}', input.companyName)}
                </span>
              </div>
            ) : error ? (
              <div className="rounded-md border p-3 text-sm" data-ai-company-research-error="">
                {error}
              </div>
            ) : result ? (
              <ResearchReport
                result={result.data}
                runId={result.runId}
                sizeLabels={sizeLabels}
                likelihoodLabels={likelihoodLabels}
              />
            ) : (
              <div className="py-6 text-sm text-muted-foreground">
                {t('agent_examples.companyResearch.idle', 'Click “Run research” to start.')}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              size="sm"
              onClick={() => void handleRun()}
              disabled={isRunning}
            >
              {isRunning
                ? t('agent_examples.companyResearch.runningShort', 'Researching…')
                : result || error
                  ? t('agent_examples.companyResearch.runAgain', 'Run again')
                  : t('agent_examples.companyResearch.run', 'Run research')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ResearchReport({
  result,
  runId,
  sizeLabels,
  likelihoodLabels,
}: {
  result: ResearchResult
  runId: string | null
  sizeLabels: Record<CompanySizeBucket, string>
  likelihoodLabels: Record<PayingLikelihood, string>
}) {
  const t = useT()
  const { assessment, findings, summary } = result

  return (
    <div className="space-y-4" data-ai-company-research-report="">
      <div className="rounded-md border p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">
              {t('agent_examples.companyResearch.report.dealFit', 'Deal-fit score')}
            </div>
            <div className="text-2xl font-semibold tabular-nums">{assessment.dealFitScore}/100</div>
          </div>
          <StatusBadge variant={payingLikelihoodVariant[assessment.payingLikelihood]} dot>
            {t('agent_examples.companyResearch.report.paying', 'Pays well: {level}').replace(
              '{level}',
              likelihoodLabels[assessment.payingLikelihood],
            )}
          </StatusBadge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <ReportRow
            label={t('agent_examples.companyResearch.report.revenue', 'Revenue')}
            value={assessment.revenueBand}
          />
          <ReportRow
            label={t('agent_examples.companyResearch.report.size', 'Size')}
            value={sizeLabels[assessment.companySizeBucket] ?? assessment.companySizeBucket}
          />
          <ReportRow
            label={t('agent_examples.companyResearch.report.employees', 'Employees')}
            value={assessment.employeeEstimate ?? '—'}
          />
          <ReportRow
            label={t('agent_examples.companyResearch.report.funding', 'Funding')}
            value={assessment.fundingStage ?? '—'}
          />
        </div>
      </div>

      <div className="text-sm">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t('agent_examples.companyResearch.report.recommendation', 'Recommendation')}
        </div>
        <p>{assessment.recommendation}</p>
      </div>

      <div className="text-sm">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t('agent_examples.companyResearch.report.summary', 'Summary')}
        </div>
        <p className="text-muted-foreground">{summary}</p>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
          {t('agent_examples.companyResearch.report.findings', 'Findings')} ({findings.length})
        </div>
        {findings.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t('agent_examples.companyResearch.report.noFindings', 'No citable findings were returned.')}
          </div>
        ) : (
          <ul className="space-y-2">
            {findings.map((finding, index) => (
              <li key={`${finding.sourceUrl}-${index}`} className="rounded-md border p-2 text-sm">
                <div className="font-medium">{finding.signal}</div>
                <div className="text-muted-foreground">{finding.detail}</div>
                <a
                  href={finding.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block break-all text-xs text-primary hover:underline"
                >
                  {finding.sourceUrl}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {runId ? (
        <div className="border-t pt-2">
          <a
            href={`/backend/traces/${encodeURIComponent(runId)}`}
            className="text-xs text-primary hover:underline"
          >
            {t('agent_examples.companyResearch.report.viewTrace', 'View run trace →')}
          </a>
        </div>
      ) : null}
    </div>
  )
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  )
}
