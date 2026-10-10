import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { formatActivityKey } from '../../lib/client/xray/format'
import type { XraySuggestion, XraySuggestionStatus } from '../../lib/client/xray/types'

export const XRAY_SUGGESTION_STATUS_MAP: StatusMap<XraySuggestionStatus> = {
  open: 'info',
  dismissed: 'neutral',
  drafted: 'success',
  superseded: 'warning',
}

export const XRAY_NOT_DRAFTABLE_REASONS = [
  'trigger_not_expressible',
  'condition_not_expressible',
  'no_command',
  'workflows_unavailable',
  'command_not_workflow_safe',
  'draft_invalid',
  'command_forbidden',
] as const

export function describeNotDraftableReason(reason: string | null | undefined, t: TranslateFn): string {
  if (reason && (XRAY_NOT_DRAFTABLE_REASONS as readonly string[]).includes(reason)) {
    return t(`insights.xray.ui.suggestions.reasons.${reason}`)
  }
  return t('insights.xray.ui.suggestions.reasons.unknown')
}

/** The rule of a suggestion as one sentence of declared identifiers (never record values). */
export function describeSuggestionRule(suggestion: Pick<XraySuggestion, 'trigger' | 'condition' | 'followups'>, t: TranslateFn): string {
  const trigger = formatActivityKey(suggestion.trigger.activityKey, t)
  const followups = suggestion.followups.map((followup) => formatActivityKey(`${followup.field}:${followup.value}`, t)).join(', ')
  const base = t('insights.xray.ui.suggestions.rule', { trigger, followups })
  if (!suggestion.condition) return base
  return t('insights.xray.ui.suggestions.ruleWithCondition', {
    rule: base,
    condition: formatActivityKey(`${suggestion.condition.field}:${suggestion.condition.value}`, t),
  })
}
