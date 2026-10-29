'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { CollapsibleSection } from '@open-mercato/ui/backend/SectionHeader'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  AGENT_RUNS_API_PATH,
  AGENT_RUNS_HREF,
  agentRunChannelLabel,
  agentRunConversationHref,
  agentRunStatusLabel,
  agentRunStatusVariant,
  formatRunCount,
  formatRunDateTime,
  formatRunDuration,
  shortHash,
  type AgentRunDetailResponse,
  type AgentRunStep,
  type AgentRunToolCall,
} from '../../../../../components/agent-runs/agentRunsShared'
import {
  OPTIONAL_REQUEST_HEADERS,
  pendingActionDetailHref,
} from '../../../../../components/pending-actions/pendingActionsShared'

type DetailLoadResult =
  | { kind: 'found'; detail: AgentRunDetailResponse }
  | { kind: 'not_found' }

export class AgentRunRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`[internal] Agent run request failed (${status})`)
    this.name = 'AgentRunRequestError'
    this.status = status
  }
}

async function loadAgentRun(id: string): Promise<DetailLoadResult> {
  const call = await apiCall<AgentRunDetailResponse>(`${AGENT_RUNS_API_PATH}/${encodeURIComponent(id)}`, {
    headers: OPTIONAL_REQUEST_HEADERS,
  })
  if (call.status === 404 || call.status === 400) return { kind: 'not_found' }
  if (!call.ok || !call.result) throw new AgentRunRequestError(call.status)
  return { kind: 'found', detail: call.result }
}

type StepGroup = {
  stepIndex: number
  step: AgentRunStep | null
  toolCalls: AgentRunToolCall[]
}

export function groupRunSteps(steps: AgentRunStep[], toolCalls: AgentRunToolCall[]): StepGroup[] {
  const groups = new Map<number, StepGroup>()
  const ensure = (stepIndex: number): StepGroup => {
    const existing = groups.get(stepIndex)
    if (existing) return existing
    const created: StepGroup = { stepIndex, step: null, toolCalls: [] }
    groups.set(stepIndex, created)
    return created
  }
  for (const step of steps) ensure(step.stepIndex).step = step
  for (const toolCall of toolCalls) ensure(toolCall.stepIndex).toolCalls.push(toolCall)
  return Array.from(groups.values())
    .sort((left, right) => left.stepIndex - right.stepIndex)
    .map((group) => ({
      ...group,
      toolCalls: [...group.toolCalls].sort((left, right) => left.callIndex - right.callIndex),
    }))
}

type DetailRowProps = { label: string; children: React.ReactNode }

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function TruncatedBadge() {
  const t = useT()
  return (
    <StatusBadge variant="warning">
      {t('ai_assistant.runs.detail.truncated', 'Truncated')}
    </StatusBadge>
  )
}

type TextBlockProps = { title: string; text: string; truncated: boolean }

function TextBlock({ title, text, truncated }: TextBlockProps) {
  return (
    <CollapsibleSection title={title} action={truncated ? <TruncatedBadge /> : null}>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-xs">
        {text}
      </pre>
    </CollapsibleSection>
  )
}

function ToolCallCard({ toolCall }: { toolCall: AgentRunToolCall }) {
  const t = useT()
  const hasArgs = toolCall.args !== null && toolCall.args !== undefined
  const hasResult = toolCall.result !== null && toolCall.result !== undefined
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3" data-agent-run-tool-call={toolCall.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{toolCall.toolName}</span>
        <span className="text-xs text-muted-foreground">{formatRunDuration(toolCall.durationMs)}</span>
        {toolCall.isMutation ? (
          <StatusBadge variant="info">{t('ai_assistant.runs.detail.mutation', 'Mutation')}</StatusBadge>
        ) : null}
        {toolCall.pendingActionId ? (
          <Link
            href={pendingActionDetailHref(toolCall.pendingActionId)}
            className="text-xs text-foreground underline-offset-2 hover:underline"
          >
            {t('ai_assistant.runs.detail.pendingAction', 'Pending action')}
          </Link>
        ) : null}
      </div>
      {toolCall.error ? (
        <Alert status="error" data-agent-run-tool-error>
          <AlertTitle>{t('ai_assistant.runs.detail.toolError', 'Tool call failed')}</AlertTitle>
          <AlertDescription>
            {[toolCall.error.code, toolCall.error.message].filter(Boolean).join(': ')}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('ai_assistant.runs.detail.args', 'Arguments')}
          </span>
          {toolCall.argsTruncated ? <TruncatedBadge /> : null}
        </div>
        {hasArgs ? (
          <JsonDisplay data={toolCall.args} maxHeight="20rem" />
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            {toolCall.argKeys.length > 0
              ? t('ai_assistant.runs.detail.argKeys', 'Argument keys: {keys}', { keys: toolCall.argKeys.join(', ') })
              : '—'}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('ai_assistant.runs.detail.result', 'Result')}
          </span>
          {toolCall.resultTruncated ? <TruncatedBadge /> : null}
        </div>
        {hasResult ? (
          <JsonDisplay data={toolCall.result} maxHeight="20rem" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('ai_assistant.runs.detail.resultSize', '{bytes} bytes, content not stored', {
              bytes: formatRunCount(toolCall.resultBytes),
            })}
          </p>
        )}
      </div>
    </div>
  )
}

function StepSection({ group }: { group: StepGroup }) {
  const t = useT()
  const { step, toolCalls } = group
  return (
    <CollapsibleSection
      title={t('ai_assistant.runs.detail.stepTitle', 'Step {index}', { index: String(group.stepIndex + 1) })}
      count={toolCalls.length}
      defaultCollapsed
      contentClassName="flex flex-col gap-3"
    >
      {step ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailRow label={t('ai_assistant.runs.columns.model', 'Model')}>
            <span className="font-mono text-xs">{step.modelId}</span>
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.detail.finishReason', 'Finish reason')}>
            {step.finishReason || '—'}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.tokens', 'Tokens')}>
            {t('ai_assistant.runs.tokensValue', '{input} in / {output} out', {
              input: formatRunCount(step.inputTokens),
              output: formatRunCount(step.outputTokens),
            })}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.duration', 'Duration')}>
            {formatRunDuration(step.durationMs)}
          </DetailRow>
        </dl>
      ) : null}
      {step?.text ? (
        <TextBlock title={t('ai_assistant.runs.detail.stepText', 'Step text')} text={step.text} truncated={step.textTruncated} />
      ) : null}
      {toolCalls.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('ai_assistant.runs.detail.toolCalls', 'Tool calls')}
          </h4>
          {toolCalls.map((toolCall) => (
            <ToolCallCard key={toolCall.id} toolCall={toolCall} />
          ))}
        </div>
      ) : null}
    </CollapsibleSection>
  )
}

export function AiRunDetailPageClient({ id }: { id: string }) {
  const t = useT()
  const query = useQuery<DetailLoadResult>({
    queryKey: ['ai_assistant', 'agent_runs', 'detail', id],
    queryFn: () => loadAgentRun(id),
    retry: false,
  })

  const detail = query.data?.kind === 'found' ? query.data.detail : null
  const stepGroups = React.useMemo(
    () => (detail ? groupRunSteps(detail.steps, detail.toolCalls) : []),
    [detail],
  )

  if (query.isLoading) {
    return <LoadingMessage label={t('ai_assistant.runs.detail.loading', 'Loading agent run…')} />
  }

  if (query.data?.kind === 'not_found') {
    return (
      <RecordNotFoundState
        label={t('ai_assistant.runs.detail.notFound', 'Agent run not found')}
        description={t(
          'ai_assistant.runs.detail.notFoundDescription',
          'It may have been removed, or you cannot access it.',
        )}
        backHref={AGENT_RUNS_HREF}
        backLabel={t('ai_assistant.runs.detail.back', 'Back to agent runs')}
      />
    )
  }

  if (query.error || !detail) {
    return (
      <ErrorMessage
        label={t('ai_assistant.runs.detail.loadError', 'Failed to load the agent run.')}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('ai_assistant.runs.detail.retry', 'Try again')}
          </Button>
        }
      />
    )
  }

  const { run, links } = detail
  const contentCaptured = run.captureLevel !== 'metadata'
  const conversationId = links.conversationId

  return (
    <div className="flex flex-col gap-6" data-agent-run-detail>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href={AGENT_RUNS_HREF} className="text-xs text-muted-foreground hover:underline">
            {t('ai_assistant.runs.detail.back', 'Back to agent runs')}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-base font-semibold">{run.agentId}</h2>
            <StatusBadge variant={agentRunStatusVariant(run.status)} dot>
              {agentRunStatusLabel(t, run.status)}
            </StatusBadge>
          </div>
        </div>
        {conversationId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={agentRunConversationHref(conversationId)} data-agent-run-open-conversation>
              {t('ai_assistant.runs.detail.openConversation', 'Open conversation')}
            </Link>
          </Button>
        ) : null}
      </div>

      {!contentCaptured ? (
        <Alert status="information" data-agent-run-content-not-captured>
          <AlertDescription>
            {t('ai_assistant.runs.detail.contentNotCaptured', 'Content was not captured for this run.')}
          </AlertDescription>
        </Alert>
      ) : null}

      {run.error ? (
        <Alert status="error" data-agent-run-error>
          <AlertTitle>{t('ai_assistant.runs.detail.runError', 'The run ended with an error')}</AlertTitle>
          <AlertDescription>{[run.error.code, run.error.message].filter(Boolean).join(': ')}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('ai_assistant.runs.detail.metadata', 'Metadata')}</h3>
        <dl className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailRow label={t('ai_assistant.runs.detail.agentVersion', 'Agent version')}>
            {run.agentVersion ?? '—'}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.detail.definitionHash', 'Definition hash')}>
            <span className="font-mono text-xs" title={run.agentDefinitionHash}>
              {shortHash(run.agentDefinitionHash)}
            </span>
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.detail.promptOverride', 'Prompt override')}>
            {run.promptOverrideVersion !== null && run.promptOverrideVersion !== undefined
              ? t('ai_assistant.runs.detail.promptOverrideVersion', 'Version {version}', {
                  version: String(run.promptOverrideVersion),
                })
              : '—'}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.model', 'Model')}>
            <span className="font-mono text-xs">{`${run.providerId}/${run.modelId}`}</span>
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.channel', 'Channel')}>
            {agentRunChannelLabel(t, run.channel)}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.tokens', 'Tokens')}>
            {t('ai_assistant.runs.tokensValue', '{input} in / {output} out', {
              input: formatRunCount(run.inputTokens),
              output: formatRunCount(run.outputTokens),
            })}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.duration', 'Duration')}>
            {formatRunDuration(run.durationMs)}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.toolCalls', 'Tool calls')}>
            {formatRunCount(run.toolCallCount)}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.detail.finishReason', 'Finish reason')}>
            {run.finishReason ?? run.stopReason ?? '—'}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.columns.startedAt', 'Started')}>
            {formatRunDateTime(run.startedAt)}
          </DetailRow>
          <DetailRow label={t('ai_assistant.runs.detail.completedAt', 'Completed at')}>
            {formatRunDateTime(run.completedAt)}
          </DetailRow>
        </dl>
      </section>

      {contentCaptured && run.inputText ? (
        <TextBlock
          title={t('ai_assistant.runs.detail.input', 'Input')}
          text={run.inputText}
          truncated={run.contentTruncated}
        />
      ) : null}
      {contentCaptured && run.outputText ? (
        <TextBlock
          title={t('ai_assistant.runs.detail.output', 'Output')}
          text={run.outputText}
          truncated={run.contentTruncated}
        />
      ) : null}

      <CollapsibleSection title={t('ai_assistant.runs.detail.modelParams', 'Model parameters')} defaultCollapsed>
        <JsonDisplay data={run.modelParams ?? {}} maxHeight="20rem" />
      </CollapsibleSection>

      <section className="flex flex-col gap-3" data-agent-run-steps>
        <h3 className="text-sm font-semibold">{t('ai_assistant.runs.detail.steps', 'Steps')}</h3>
        {stepGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('ai_assistant.runs.detail.noSteps', 'No steps were recorded for this run.')}
          </p>
        ) : (
          stepGroups.map((group) => <StepSection key={group.stepIndex} group={group} />)
        )}
      </section>
    </div>
  )
}

export default AiRunDetailPageClient
