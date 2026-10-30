'use client'

import * as React from 'react'
import Link from 'next/link'
import { Activity, ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildAiRunTraceHref, readRunIdFromLoopTrace, useCanViewAiRunTrace } from './run-trace-link'

export interface LoopTracePanelStepRecord {
  stepIndex: number
  modelId: string
  toolCalls: Array<{
    toolName: string
    args: unknown
    result?: unknown
    error?: { code: string; message: string }
    repairAttempted: boolean
    durationMs: number
  }>
  textDelta: string
  usage: { inputTokens: number; outputTokens: number }
  finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'error'
}

export interface LoopTracePanelTrace {
  agentId: string
  turnId: string
  steps: LoopTracePanelStepRecord[]
  stopReason:
    | 'step-count'
    | 'has-tool-call'
    | 'custom-stop'
    | 'budget-tokens'
    | 'budget-tool-calls'
    | 'budget-wall-clock'
    | 'tenant-disabled'
    | 'finish-reason'
    | 'abort'
  totalDurationMs: number
  totalUsage: { inputTokens: number; outputTokens: number }
  runId?: string
}

type LoopStepRecord = LoopTracePanelStepRecord
type LoopTrace = LoopTracePanelTrace

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function LoopStepRow({ step }: { step: LoopStepRecord }) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const hasTools = step.toolCalls.length > 0

  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/40"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={t('ui.ai.loopTrace.step', 'Step {index}', { index: step.stepIndex })}
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="font-medium text-muted-foreground">
          {t('ui.ai.loopTrace.step', 'Step {index}', { index: step.stepIndex })}
        </span>
        <span className="font-mono text-muted-foreground/60">{step.modelId}</span>
        {hasTools ? (
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            <Wrench className="size-3" aria-hidden />
            {step.toolCalls.length}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-muted-foreground/60">{step.finishReason}</span>
        <span className="font-mono text-muted-foreground/60">
          {step.usage.inputTokens}↑ {step.usage.outputTokens}↓
        </span>
      </button>

      {expanded ? (
        <div className="bg-muted/20 px-4 pb-2 pt-1 text-xs">
          {step.textDelta ? (
            <div className="mb-2">
              <div className="mb-0.5 font-semibold text-muted-foreground">
                {t('ui.ai.loopTrace.text', 'Text')}
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background p-1.5 font-mono">
                {step.textDelta}
              </pre>
            </div>
          ) : null}
          {hasTools ? (
            <div>
              <div className="mb-0.5 font-semibold text-muted-foreground">
                {t('ui.ai.loopTrace.toolCalls', 'Tool calls')}
              </div>
              <ul className="flex flex-col gap-1">
                {step.toolCalls.map((tc, index) => (
                  <li
                    key={index}
                    className="rounded border border-border bg-background p-1.5"
                    data-loop-trace-tool-call={tc.toolName}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">{tc.toolName}</span>
                      {tc.durationMs ? (
                        <span className="text-muted-foreground/60">{formatMs(tc.durationMs)}</span>
                      ) : null}
                      {tc.error ? (
                        <span className="text-status-error-fg">
                          {t('ui.ai.loopTrace.toolError', 'error: {code}', { code: tc.error.code })}
                        </span>
                      ) : null}
                    </div>
                    {tc.args !== undefined ? (
                      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                        {JSON.stringify(tc.args, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export interface LoopTracePanelProps {
  trace: LoopTracePanelTrace
  className?: string
}

/**
 * Collapsible playground / debug panel that renders a `LoopTrace` per turn.
 * Collapsed by default; each step row is independently expandable.
 *
 * Phase 4 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */
export function LoopTracePanel({ trace, className }: LoopTracePanelProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const canViewRunTrace = useCanViewAiRunTrace()
  const runId = readRunIdFromLoopTrace(trace)
  const totalTokens = trace.totalUsage.inputTokens + trace.totalUsage.outputTokens

  return (
    <section
      className={`rounded-md border border-border bg-background text-xs${className ? ` ${className}` : ''}`}
      data-ai-loop-trace-panel={trace.agentId}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/40"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="loop-trace-steps"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="font-semibold text-muted-foreground">
          {t('ui.ai.loopTrace.title', 'Loop trace')}
        </span>
        <span className="ml-1 font-mono text-muted-foreground/60">
          {t('ui.ai.loopTrace.steps', '{count} steps', { count: trace.steps.length })}
        </span>
        <span
          className="ml-auto font-mono text-muted-foreground/60"
          data-loop-trace-stop-reason={trace.stopReason}
        >
          {trace.stopReason}
        </span>
        <span className="font-mono text-muted-foreground/60">{formatMs(trace.totalDurationMs)}</span>
        <span className="font-mono text-muted-foreground/60">
          {t('ui.ai.loopTrace.tokens', '{count} tok', { count: totalTokens })}
        </span>
      </button>

      {runId && canViewRunTrace ? (
        <div className="flex justify-end border-t border-border px-3 py-1.5">
          <Link
            href={buildAiRunTraceHref(runId)}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            data-ai-loop-trace-full-trace-link={runId}
          >
            <Activity className="size-3" aria-hidden />
            {t('ai_assistant.chat.openFullTrace', 'Open full trace')}
          </Link>
        </div>
      ) : null}

      {open ? (
        <ul id="loop-trace-steps" className="border-t border-border" role="list">
          {trace.steps.map((step) => (
            <LoopStepRow key={step.stepIndex} step={step} />
          ))}
          {trace.steps.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">
              {t('ui.ai.loopTrace.noSteps', 'No steps recorded.')}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}
