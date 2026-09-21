'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import {
  AGENT_REVIEW_ON_BREACH_ACTIONS,
  type AgentReviewOnBreachDraft,
} from '../../lib/agent-review-inspector'

/**
 * "When the deadline passes" for an agent disposition (spec §7.5).
 *
 * Shaped exactly like `TaskOnBreachField` — same Select, same conditional
 * "Reassign to" input — but over a DIFFERENT action set, which is why it is its
 * own component rather than a prop on that one. "Follow a route" is missing on
 * purpose: routing the run past a proposal nobody answered drops the mutation
 * the agent proposed, which is a rejection in everything but name, and only a
 * human may reach a verdict. "Mark for attention" replaces it — the run stays
 * parked, the proposal stays pending, and the instance shows up in the triage
 * queue.
 */
export function AgentReviewOnBreachField({
  id,
  value,
  setValue,
  disabled,
}: CrudCustomFieldRenderProps) {
  const t = useT()
  const draft: AgentReviewOnBreachDraft =
    value && typeof value === 'object'
      ? (value as AgentReviewOnBreachDraft)
      : { action: '', reassignTo: '' }

  const update = (patch: Partial<AgentReviewOnBreachDraft>) => setValue({ ...draft, ...patch })

  return (
    <div className="space-y-2">
      <Select
        value={draft.action || 'none'}
        onValueChange={(next) =>
          update({ action: next === 'none' ? '' : (next as AgentReviewOnBreachDraft['action']) })
        }
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label={t('workflows.tasks.inspector.when.onBreach')}>
          <SelectValue placeholder={t('workflows.tasks.inspector.when.onBreachNone')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('workflows.tasks.inspector.when.onBreachNone')}</SelectItem>
          {AGENT_REVIEW_ON_BREACH_ACTIONS.map((action) => (
            <SelectItem key={action} value={action}>
              {t(`workflows.form.invokeAgent.review.onBreachActions.${action}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {draft.action === 'reassign' && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-reassign`} className="text-xs font-medium">
            {t('workflows.tasks.inspector.when.reassignTo')}
          </Label>
          <Input
            id={`${id}-reassign`}
            type="text"
            value={draft.reassignTo}
            onChange={(event) => update({ reassignTo: event.target.value })}
            placeholder={t('workflows.tasks.inspector.when.reassignToPlaceholder')}
            disabled={disabled}
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t('workflows.form.invokeAgent.review.onBreachHint')}
      </p>
    </div>
  )
}
