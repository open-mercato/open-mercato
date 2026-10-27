/**
 * Task presets (spec §6.1, item 7).
 *
 * PURE: a preset is a data transformation over the inspector's drafts, so the
 * shape it produces is unit-testable — and provable to parse — without opening
 * the editor. Every piece of author-facing copy is passed IN by the caller,
 * which is what keeps the labels translated (`useT` lives in the component)
 * while the rule about what a preset contains lives here.
 */

import type { FormField } from '../components/fields/FormFieldArrayEditor'
import {
  newDecisionDraft,
  newEntityBindingDraft,
  type TaskDecisionDraft,
  type TaskEntityBindingDraft,
} from './task-inspector-config'

export const APPROVAL_PRESET_COMMENT_FIELD = 'comment'

export interface ApprovalPresetCopy {
  approveLabel: string
  rejectLabel: string
  commentLabel: string
}

export interface ApprovalPresetRoutes {
  /** Durable transition ids of the step's outgoing routes, in evaluation order. */
  approveTransitionId?: string
  rejectTransitionId?: string
}

export interface ApprovalPresetInput extends ApprovalPresetCopy, ApprovalPresetRoutes {
  decisions?: TaskDecisionDraft[]
  formFields?: FormField[]
  entityBindings?: TaskEntityBindingDraft[]
}

export interface ApprovalPresetResult {
  decisions: TaskDecisionDraft[]
  formFields: FormField[]
  entityBindings: TaskEntityBindingDraft[]
  /** True when the preset left an empty binding row for the author to complete. */
  promptsForEntityBinding: boolean
}

/**
 * Approve / Reject plus a comment field, bound to the step's first two
 * outgoing routes.
 *
 * Three deliberate choices:
 *
 * - It is ADDITIVE. Existing decisions, form fields and bindings are kept, and
 *   a decision already bound to a route the preset would use is left alone —
 *   applying the preset twice must not double the buttons or overwrite copy an
 *   author wrote.
 * - Routes are bound by their DURABLE ids, taken from the step's real outgoing
 *   transitions. When a route is missing the button is still created with an
 *   empty binding rather than an invented id: an unbound button is visible and
 *   fixable, a fabricated id is a silently broken workflow.
 * - It PROMPTS for the entity binding rather than guessing one. An approval is
 *   always an approval OF something, and the ledger path that yields that
 *   record is the one thing a preset genuinely cannot know, so it seeds an
 *   empty binding row instead of leaving the section untouched.
 */
export function buildApprovalPreset(input: ApprovalPresetInput): ApprovalPresetResult {
  const decisions = [...(input.decisions ?? [])]
  const boundRoutes = new Set(decisions.map((decision) => decision.transitionId).filter(Boolean))

  const addDecision = (label: string, transitionId: string, style: TaskDecisionDraft['style']) => {
    if (transitionId && boundRoutes.has(transitionId)) return
    const draft = newDecisionDraft(transitionId)
    decisions.push({ ...draft, label, style })
    if (transitionId) boundRoutes.add(transitionId)
  }

  addDecision(input.approveLabel, input.approveTransitionId ?? '', 'primary')
  addDecision(input.rejectLabel, input.rejectTransitionId ?? '', 'destructive')

  const formFields = [...(input.formFields ?? [])]
  if (!formFields.some((field) => field.name === APPROVAL_PRESET_COMMENT_FIELD)) {
    formFields.push({
      name: APPROVAL_PRESET_COMMENT_FIELD,
      type: 'textarea',
      label: input.commentLabel,
      required: false,
    })
  }

  const entityBindings = [...(input.entityBindings ?? [])]
  const promptsForEntityBinding = entityBindings.length === 0
  if (promptsForEntityBinding) entityBindings.push(newEntityBindingDraft())

  return { decisions, formFields, entityBindings, promptsForEntityBinding }
}
