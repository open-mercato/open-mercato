"use client"

import * as React from 'react'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { formatDurationMs, type SpanView } from '../types'
import { deriveLlmStepRows, fidelityBadgeVariant, formatCostMicros, type LlmStepRow } from './llmStepRows'

const EMPTY_VALUE = '—'

function MutedText({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>
}

function ModelCell({ row }: { row: LlmStepRow }) {
  if (!row.provider && !row.requestModel) return <MutedText>{EMPTY_VALUE}</MutedText>
  return (
    <span className="block min-w-0">
      {row.provider ? <span className="block text-xs text-muted-foreground">{row.provider}</span> : null}
      {row.requestModel ? (
        <span className="block break-all font-mono text-xs text-foreground">
          {row.responseModel ? `${row.requestModel} → ${row.responseModel}` : row.requestModel}
        </span>
      ) : null}
    </span>
  )
}

function ParametersCell({ row }: { row: LlmStepRow }) {
  const t = useT()
  if (!row.recorded) return <MutedText>{t('agent_orchestrator.trace.notRecorded')}</MutedText>
  if (row.parameters.length === 0) return <MutedText>{t('agent_orchestrator.trace.providerDefault')}</MutedText>
  return (
    <ul className="space-y-0.5">
      {row.parameters.map((parameter) => (
        <li key={parameter.name} className="break-all font-mono text-xs text-foreground">
          {parameter.name}={parameter.value}
        </li>
      ))}
    </ul>
  )
}

function TokensCell({ row }: { row: LlmStepRow }) {
  const t = useT()
  const { inputTokens, outputTokens, cachedInputTokens, reasoningTokens } = row.usage
  const parts = [
    inputTokens !== undefined ? t('agent_orchestrator.trace.tokens.input', undefined, { count: inputTokens }) : null,
    outputTokens !== undefined ? t('agent_orchestrator.trace.tokens.output', undefined, { count: outputTokens }) : null,
    cachedInputTokens !== undefined
      ? t('agent_orchestrator.trace.tokens.cached', undefined, { count: cachedInputTokens })
      : null,
    reasoningTokens !== undefined
      ? t('agent_orchestrator.trace.tokens.reasoning', undefined, { count: reasoningTokens })
      : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return <MutedText>{EMPTY_VALUE}</MutedText>
  return (
    <span className="block text-xs tabular-nums text-foreground">
      {parts.map((part) => (
        <span key={part} className="block whitespace-nowrap">
          {part}
        </span>
      ))}
    </span>
  )
}

function FidelityCell({ row }: { row: LlmStepRow }) {
  const t = useT()
  if (!row.fidelity) return <MutedText>{EMPTY_VALUE}</MutedText>
  return (
    <StatusBadge variant={fidelityBadgeVariant(row.fidelity)}>
      {t(`agent_orchestrator.trace.fidelity.${row.fidelity}`)}
    </StatusBadge>
  )
}

export function LlmStepMetadataCard({
  spans,
  currency,
}: {
  spans: readonly SpanView[]
  currency: string | null
}) {
  const t = useT()
  const locale = useLocale()
  const rows = React.useMemo(() => deriveLlmStepRows(spans, currency), [spans, currency])
  if (rows.length === 0) return null
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" data-testid="llm-step-metadata-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('agent_orchestrator.trace.modelCalls')}</h2>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('agent_orchestrator.trace.columns.step')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.columns.model')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.parameters')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.columns.tokens')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.costPerStep')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.columns.latency')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.columns.finishReason')}</TableHead>
              <TableHead>{t('agent_orchestrator.trace.columns.fidelity')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-testid="llm-step-row">
                <TableCell className="align-top text-xs tabular-nums text-foreground">{row.step}</TableCell>
                <TableCell className="align-top">
                  <ModelCell row={row} />
                </TableCell>
                <TableCell className="align-top">
                  <ParametersCell row={row} />
                </TableCell>
                <TableCell className="align-top">
                  <TokensCell row={row} />
                </TableCell>
                <TableCell className="align-top whitespace-nowrap text-xs tabular-nums text-foreground">
                  {row.costMicros !== null ? formatCostMicros(row.costMicros, row.currency, locale) : EMPTY_VALUE}
                </TableCell>
                <TableCell className="align-top whitespace-nowrap text-xs tabular-nums text-foreground">
                  {formatDurationMs(row.latencyMs) ?? EMPTY_VALUE}
                </TableCell>
                <TableCell className="align-top font-mono text-xs text-foreground">
                  {row.finishReasons.length > 0 ? row.finishReasons.join(', ') : EMPTY_VALUE}
                </TableCell>
                <TableCell className="align-top">
                  <FidelityCell row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
