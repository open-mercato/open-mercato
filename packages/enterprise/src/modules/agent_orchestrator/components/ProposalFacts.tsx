"use client"
import * as React from 'react'
import { Check, ShieldAlert } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AgentFactView, GuardCheckView } from './types'
import {
  deriveFactsFromInput,
  deriveProposedFields,
  deriveReasoning,
  resolveDeclaredFacts,
  type FactSources,
  type ResolvedFact,
} from './proposalFactsData'

/**
 * Real-data panels for a proposal awaiting disposition. `FactsGrid` shows the
 * case facts behind the proposal — the agent's declared facts (FACTS.json /
 * defineAgent `facts`) when present, else a generic derivation from the run
 * input — plus the flat fields of the proposed action itself. `ReasoningList`
 * shows the persisted rationale(s) and the actual guardrail verdicts.
 * Sections render nothing when there is no data — no placeholders.
 */

export function FactsGrid({
  facts,
  sources,
  className,
}: {
  facts?: AgentFactView[]
  sources: FactSources
  className?: string
}) {
  const declared = facts && facts.length > 0 ? resolveDeclaredFacts(facts, sources) : []
  const rows = declared.length > 0 ? declared : deriveFactsFromInput(sources.input)
  if (rows.length === 0) return null
  return (
    <div className={cn('grid grid-cols-2 gap-4 sm:grid-cols-4', className)}>
      {rows.map((fact) => (
        <div key={fact.label}>
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground" title={fact.label}>
            {fact.label}
          </p>
          <p className="mt-1 truncate text-sm font-medium text-foreground" title={fact.value}>
            {fact.value}
          </p>
        </div>
      ))}
    </div>
  )
}

export function ProposedFields({ payload, className }: { payload: unknown; className?: string }) {
  const t = useT()
  const fields: ResolvedFact[] = deriveProposedFields(payload)
  if (fields.length === 0) return null
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('agent_orchestrator.caseload.inbox.proposed')}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {fields.map((field) => (
          <div key={field.label} className="rounded-lg border border-border px-3 py-2">
            <p className="truncate text-xs text-muted-foreground" title={field.label}>{field.label}</p>
            <p className="mt-0.5 truncate text-sm font-medium text-foreground" title={field.value}>{field.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReasoningList({
  rationale,
  input,
  guardResults,
  className,
}: {
  rationale: string | null
  input: unknown
  guardResults: GuardCheckView[]
  className?: string
}) {
  const t = useT()
  const items = deriveReasoning(rationale, input)
  const failedGuards = guardResults.filter((check) => check.result !== 'pass')
  const hasGuards = guardResults.length > 0
  if (items.length === 0 && !hasGuards) return null
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('agent_orchestrator.caseload.inbox.reasoning')}
      </p>
      <div className="mt-2 space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-status-success-text" />
            <span className="min-w-0 text-foreground">
              {item.label ? <span className="font-medium">{item.label}: </span> : null}
              {item.text}
            </span>
          </div>
        ))}
        {hasGuards ? (
          failedGuards.length === 0 ? (
            <div className="flex items-center gap-2 text-sm">
              <Check className="size-4 shrink-0 text-status-success-text" />
              <span className="text-muted-foreground">{t('agent_orchestrator.caseload.inbox.guardrails')}</span>
            </div>
          ) : (
            failedGuards.map((check, index) => (
              <div key={index} className="flex items-center gap-2 text-sm">
                <ShieldAlert className="size-4 shrink-0 text-status-error-text" />
                <span className="text-foreground">
                  {t('agent_orchestrator.caseload.inbox.guardrailFlagged', undefined, {
                    kind: check.kind,
                    result: check.result,
                  })}
                </span>
              </div>
            ))
          )
        ) : null}
      </div>
    </div>
  )
}
