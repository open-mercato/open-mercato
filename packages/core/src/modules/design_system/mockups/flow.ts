import { z } from 'zod'
import { CAMEL_CASE_NAME, SCAFFOLD_FIELD_TYPES } from './composeContracts'

/**
 * Flow-outline schema (`*.flow.json`) — spec
 * `.ai/specs/2026-07-05-ds-live-mockup-composer.md`, Phase 3.
 *
 * The outline is the structured intermediate between a user story and a draft
 * mockup: `om-ux-flows` is the ONLY stage that reads prose; everything
 * downstream (the draft generator, the promote bridge) reads this artifact.
 * Shape: which screens exist (steps in task order), what each screen is for,
 * the per-screen intents with the data they require, the state-matrix rows to
 * cover, and links back to user-story ids.
 *
 * Extensions over the spec sketch (strictly additive, recorded in the spec
 * changelog): the `dashboard` intent kind (KPI rows), structured `fields` on
 * intents (required data as name/type/required — the same vocabulary as the
 * scaffold `--fields` DSL, so drafts are promotable without re-inference),
 * `states` per screen (state-matrix rows the screen must cover), and
 * `entity`/`module` promotion hints carried into generated documents.
 */

export const FLOW_INTENT_KINDS = [
  'list',
  'form',
  'detail',
  'dashboard',
  'action',
  'navigation',
  'feedback',
] as const
export type FlowIntentKind = (typeof FLOW_INTENT_KINDS)[number]

/**
 * Rows of the om-ux-product-design state matrix
 * (`.ai/skills/om-ux-product-design/references/state-matrix.md`) a screen
 * commits to covering. The generator records them on the draft so review can
 * hold the screen to them; "not applicable" is a deliberate omission here.
 */
export const FLOW_SCREEN_STATES = [
  'initial',
  'loading',
  'empty',
  'no-results',
  'partial',
  'validation-error',
  'system-error',
  'offline',
  'permission-denied',
  'success',
  'destructive',
] as const
export type FlowScreenState = (typeof FLOW_SCREEN_STATES)[number]

const USER_STORY_PATTERN = /^US-[A-Za-z0-9._-]+$/
const SLUG_PATTERN = /^[a-z0-9-]+$/

/** Required data for an intent — one entry per field, scaffold-DSL vocabulary. */
export const flowField = z
  .object({
    name: z.string().regex(CAMEL_CASE_NAME, 'field names must be camelCase'),
    label: z.string().min(1).optional(), // defaults to a humanized name
    type: z.enum(SCAFFOLD_FIELD_TYPES).optional(), // defaults to text
    required: z.boolean().optional(),
    options: z.array(z.string().min(1)).min(1).optional(), // select only
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.type ?? 'text') === 'select' && (!value.options || value.options.length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'select fields must list their options', path: ['options'] })
    }
    if ((value.type ?? 'text') !== 'select' && value.options !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'options are only valid on select fields', path: ['options'] })
    }
  })
export type FlowField = z.infer<typeof flowField>

export const flowIntent = z
  .object({
    kind: z.enum(FLOW_INTENT_KINDS),
    description: z.string().min(1),
    userStory: z.string().regex(USER_STORY_PATTERN).optional(),
    fields: z.array(flowField).min(1).optional(),
  })
  .strict()
export type FlowIntent = z.infer<typeof flowIntent>

export const flowScreen = z
  .object({
    slug: z.string().regex(SLUG_PATTERN), // becomes the mockup slug
    purpose: z.string().min(1),
    order: z.number().int().nonnegative(),
    intents: z.array(flowIntent).min(1),
    states: z.array(z.enum(FLOW_SCREEN_STATES)).min(1).optional(),
  })
  .strict()
export type FlowScreen = z.infer<typeof flowScreen>

export const flowTransition = z
  .object({
    from: z.string().regex(SLUG_PATTERN),
    to: z.string().regex(SLUG_PATTERN), // may point at an existing screen outside the outline
    trigger: z.string().min(1),
  })
  .strict()
export type FlowTransition = z.infer<typeof flowTransition>

export const flowOutline = z
  .object({
    version: z.literal(1),
    source: z.string().min(1), // user story id or spec path
    entity: z.string().min(1).optional(), // promotion hint, copied to generated documents
    module: z.string().min(1).optional(), // promotion hint, copied to generated documents
    screens: z.array(flowScreen).min(1),
    transitions: z.array(flowTransition),
  })
  .strict()
  .superRefine((outline, ctx) => {
    const slugs = new Set(outline.screens.map((screen) => screen.slug))
    if (slugs.size !== outline.screens.length) {
      ctx.addIssue({ code: 'custom', message: 'screen slugs must be unique', path: ['screens'] })
    }
    outline.transitions.forEach((transition, index) => {
      // `from` must be a screen of this outline (typo guard); `to` may name an
      // existing screen elsewhere in the product.
      if (!slugs.has(transition.from)) {
        ctx.addIssue({
          code: 'custom',
          message: `transition "from" references unknown screen "${transition.from}"`,
          path: ['transitions', index, 'from'],
        })
      }
    })
  })
export type FlowOutline = z.infer<typeof flowOutline>
