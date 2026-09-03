"use client"

import * as React from 'react'
import { Check, Scale } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeProposalEnvelope, rankProposalOptions } from '../data/proposalEnvelope'
import type { ProposalOption } from '../data/validators'
import { humanizeKey } from './proposalFactsData'

/**
 * The option set an agent offered, ranked, with ONE selection control
 * (spec `2026-08-11-agent-taxonomy.md`, Phase 4 step 11).
 *
 * The envelope exists so an operator can see the alternatives the agent
 * considered rather than a single verdict, so this component never collapses to
 * the leader: every option renders with its own rationale and confidence, and
 * the disposition runs the one the human picked.
 *
 * An EMPTY option set is `none_proposed` — the agent looked and had nothing to
 * offer. That is a real answer with no decision behind it, so it renders as an
 * EmptyState and never as a selectable row.
 */

export type ProposalOptionListProps = {
  /** Raw persisted/ad-hoc payload; coerced through `normalizeProposalEnvelope`. */
  payload: unknown
  /** Currently picked option id, or null when the operator has not chosen yet. */
  selectedOptionId?: string | null
  /** Omit for a read-only render (playground preview, disposed proposal). */
  onSelect?: (optionId: string) => void
  disabled?: boolean
  /**
   * `agent_proposals.auto_disposition_block` — `near_tie` means the agent's top
   * two options were too close to auto-approve, so silence here would read as
   * "the threshold was not met".
   */
  autoDispositionBlock?: string | null
  /** Renders the "you must pick one" hint below the list. */
  showChooseHint?: boolean
  className?: string
}

const MAX_ACTION_CHIPS = 4

function confidencePct(option: ProposalOption): number | null {
  if (typeof option.confidence !== 'number') return null
  return Math.round(option.confidence * 100)
}

export function ProposalOptionList({
  payload,
  selectedOptionId = null,
  onSelect,
  disabled = false,
  autoDispositionBlock = null,
  showChooseHint = false,
  className,
}: ProposalOptionListProps) {
  const t = useT()
  const options = React.useMemo(
    () => rankProposalOptions(normalizeProposalEnvelope(payload).options),
    [payload],
  )
  const interactive = !!onSelect && !disabled

  const optionRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const registerRef = React.useCallback((id: string, node: HTMLButtonElement | null) => {
    if (node) optionRefs.current.set(id, node)
    else optionRefs.current.delete(id)
  }, [])

  // Roving arrow-key navigation over the radio group: moving the cursor also
  // picks the option, which is the WAI-ARIA radiogroup behaviour and keeps the
  // keyboard triage flow (the whole point of the inbox) intact.
  const focusOption = React.useCallback(
    (index: number) => {
      const target = options[index]
      if (!target) return
      onSelect?.(target.id)
      optionRefs.current.get(target.id)?.focus()
    },
    [options, onSelect],
  )

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (!interactive) return
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault()
          focusOption(Math.min(index + 1, options.length - 1))
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault()
          focusOption(Math.max(index - 1, 0))
          break
        case 'Home':
          event.preventDefault()
          focusOption(0)
          break
        case 'End':
          event.preventDefault()
          focusOption(options.length - 1)
          break
        default:
          break
      }
    },
    [interactive, focusOption, options.length],
  )

  if (options.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          variant="subtle"
          size="sm"
          icon={<Scale className="size-5" />}
          title={t('agent_orchestrator.proposal.options.noneProposed.title')}
          description={t('agent_orchestrator.proposal.options.noneProposed.description')}
        />
      </div>
    )
  }

  const selectedIndex = options.findIndex((option) => option.id === selectedOptionId)
  const nearTie = autoDispositionBlock === 'near_tie'

  return (
    <div className={cn('space-y-3', className)}>
      {nearTie ? (
        <div className="flex items-start gap-2.5 rounded-lg bg-status-warning-bg px-3.5 py-2.5 text-sm text-status-warning-text">
          <Scale className="mt-0.5 size-4 shrink-0" />
          <span>{t('agent_orchestrator.proposal.options.nearTie')}</span>
        </div>
      ) : null}

      <ul
        role={interactive ? 'radiogroup' : 'list'}
        aria-label={t('agent_orchestrator.proposal.options.heading')}
        className="space-y-2"
      >
        {options.map((option, index) => {
          const selected = option.id === selectedOptionId
          const pct = confidencePct(option)
          const body = (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge variant={selected ? 'info' : 'neutral'}>
                  {t('agent_orchestrator.proposal.options.rank', undefined, { rank: index + 1 })}
                </StatusBadge>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{option.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {pct == null
                    ? t('agent_orchestrator.proposal.options.noConfidence')
                    : t('agent_orchestrator.proposal.options.confidence', undefined, { pct })}
                </span>
                {selected ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-status-success-text">
                    <Check className="size-3.5" aria-hidden="true" />
                    {t('agent_orchestrator.proposal.options.chosen')}
                  </span>
                ) : null}
              </div>
              {option.rationale ? (
                <p className="mt-1 text-sm text-muted-foreground">{option.rationale}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {option.actions.slice(0, MAX_ACTION_CHIPS).map((action, actionIndex) => (
                  <span
                    key={`${action.type}-${actionIndex}`}
                    title={action.type}
                    className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {humanizeKey(action.type)}
                  </span>
                ))}
                {option.actions.length > MAX_ACTION_CHIPS ? (
                  <span className="text-xs text-muted-foreground">
                    {t('agent_orchestrator.proposal.options.moreActions', undefined, {
                      count: option.actions.length - MAX_ACTION_CHIPS,
                    })}
                  </span>
                ) : null}
              </div>
            </>
          )

          if (!interactive) {
            return (
              <li
                key={option.id}
                data-proposal-option={option.id}
                data-selected={selected ? 'true' : 'false'}
                className={cn(
                  'rounded-lg border p-3',
                  selected ? 'border-brand-violet bg-brand-violet/10' : 'border-border bg-card',
                )}
              >
                {body}
              </li>
            )
          }

          return (
            <li key={option.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                ref={(node) => registerRef(option.id, node)}
                data-proposal-option={option.id}
                data-selected={selected ? 'true' : 'false'}
                tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
                onClick={() => onSelect?.(option.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-brand-violet bg-brand-violet/10'
                    : 'border-border bg-card hover:bg-muted/40',
                )}
              >
                {body}
              </button>
            </li>
          )
        })}
      </ul>

      {showChooseHint && selectedIndex < 0 ? (
        <p className="text-sm text-muted-foreground">{t('agent_orchestrator.proposal.options.chooseHint')}</p>
      ) : null}
    </div>
  )
}

export default ProposalOptionList
