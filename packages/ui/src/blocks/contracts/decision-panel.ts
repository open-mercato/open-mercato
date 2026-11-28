import { z } from 'zod'
import {
  DISABLED_REASON_ISSUE,
  blockBasePropsSchema,
  blockToneSchema,
  callbackSchema,
  disabledReasonRequiresDisabled,
  hasUniqueIds,
  iconNameSchema,
  isoDateTimeSchema,
  slotSchema,
} from './shared'

export const DECISION_PANEL_MAX_DECISIONS = 4

export const decisionPanelStateSchema = z.enum(['pending', 'submitting', 'decided'])
export type DecisionPanelState = z.infer<typeof decisionPanelStateSchema>

export const decisionToneSchema = z.enum(['primary', 'neutral', 'destructive'])
export type DecisionTone = z.infer<typeof decisionToneSchema>

export const decisionPanelCommentModeSchema = z.enum(['none', 'optional', 'required'])
export type DecisionPanelCommentMode = z.infer<typeof decisionPanelCommentModeSchema>

export const decisionPanelVariantSchema = z.enum(['card', 'plain'])
export type DecisionPanelVariant = z.infer<typeof decisionPanelVariantSchema>

export const decisionPanelLayoutSchema = z.enum(['inline', 'stacked'])
export type DecisionPanelLayout = z.infer<typeof decisionPanelLayoutSchema>

export const decisionConfirmSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  confirmLabel: z.string().min(1).optional(),
})
export type DecisionConfirm = z.infer<typeof decisionConfirmSchema>

export const decisionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    tone: decisionToneSchema.optional(),
    icon: iconNameSchema.optional(),
    disabled: z.boolean().optional(),
    disabledReason: z.string().min(1).optional(),
    commentRequired: z.boolean().optional(),
    confirm: decisionConfirmSchema.optional(),
  })
  .refine(disabledReasonRequiresDisabled, DISABLED_REASON_ISSUE)
export type Decision = z.infer<typeof decisionSchema>

export const decisionOutcomeSchema = z.object({
  decisionId: z.string().min(1).optional(),
  label: z.string().min(1),
  tone: blockToneSchema.optional(),
  by: z.string().min(1).optional(),
  at: isoDateTimeSchema.optional(),
  comment: z.string().min(1).optional(),
})
export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>

export const decisionRequesterSchema = z.object({
  name: z.string().min(1),
  avatarUrl: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
})
export type DecisionRequester = z.infer<typeof decisionRequesterSchema>

export const decisionHighlightSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  caption: z.string().min(1).optional(),
  captionTone: z.enum(['neutral', 'info', 'success', 'error']).optional(),
})
export type DecisionHighlight = z.infer<typeof decisionHighlightSchema>

export const decisionFactSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
})
export type DecisionFact = z.infer<typeof decisionFactSchema>

export const decisionPanelPropsSchema = blockBasePropsSchema
  .extend({
    state: decisionPanelStateSchema,
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    headingLevel: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    statusLabel: z.string().min(1).optional(),
    requester: decisionRequesterSchema.optional(),
    requestedAt: isoDateTimeSchema.optional(),
    highlight: decisionHighlightSchema.optional(),
    facts: z.array(decisionFactSchema).max(8).optional(),
    decisions: z.array(decisionSchema).max(DECISION_PANEL_MAX_DECISIONS).optional(),
    onDecide: callbackSchema<(decisionId: string, comment?: string) => void | Promise<void>>().optional(),
    submittingDecisionId: z.string().min(1).optional(),
    commentMode: decisionPanelCommentModeSchema.optional(),
    commentLabel: z.string().min(1).optional(),
    commentPlaceholder: z.string().min(1).optional(),
    commentRequiredMessage: z.string().min(1).optional(),
    comment: z.string().optional(),
    onCommentChange: callbackSchema<(comment: string) => void>().optional(),
    decided: decisionOutcomeSchema.optional(),
    onUndo: callbackSchema<() => void | Promise<void>>().optional(),
    undoLabel: z.string().min(1).optional(),
    disabledReason: z.string().min(1).optional(),
    children: slotSchema.optional(),
    footer: slotSchema.optional(),
    variant: decisionPanelVariantSchema.optional(),
    layout: decisionPanelLayoutSchema.optional(),
  })
  .refine((props) => hasUniqueIds(props.decisions), { message: 'Decision ids must be unique', path: ['decisions'] })
  .refine((props) => !props.facts || new Set(props.facts.map((fact) => fact.key)).size === props.facts.length, {
    message: 'Fact keys must be unique',
    path: ['facts'],
  })
  .refine(
    (props) =>
      props.state === 'decided' ||
      props.status === 'loading' ||
      props.status === 'error' ||
      props.status === 'empty' ||
      (props.decisions?.length ?? 0) > 0,
    { message: 'A pending or submitting panel needs at least one decision', path: ['decisions'] },
  )
  .refine((props) => !props.decisions?.length || props.state === 'decided' || props.onDecide !== undefined, {
    message: 'decisions require onDecide',
    path: ['onDecide'],
  })
  .refine((props) => props.state !== 'decided' || props.decided !== undefined, {
    message: 'state decided requires decided',
    path: ['decided'],
  })
  .refine(
    (props) =>
      props.submittingDecisionId === undefined ||
      (props.decisions ?? []).some((decision) => decision.id === props.submittingDecisionId),
    { message: 'submittingDecisionId must match a decision id', path: ['submittingDecisionId'] },
  )
  .refine(
    (props) => props.commentMode !== 'none' || !(props.decisions ?? []).some((decision) => decision.commentRequired),
    { message: 'A decision with commentRequired needs a comment field', path: ['commentMode'] },
  )
  .refine((props) => props.comment === undefined || props.onCommentChange !== undefined, {
    message: 'A controlled comment requires onCommentChange',
    path: ['onCommentChange'],
  })
  .refine((props) => props.undoLabel === undefined || props.onUndo !== undefined, {
    message: 'undoLabel requires onUndo',
    path: ['onUndo'],
  })
export type DecisionPanelProps = z.infer<typeof decisionPanelPropsSchema>
