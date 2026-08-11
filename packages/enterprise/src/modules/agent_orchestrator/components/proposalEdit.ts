import { z } from 'zod'
import { proposedActionSchema, type ProposedAction } from '../data/validators'
import { leadProposalOption, replaceOptionActions } from '../data/proposalEnvelope'

/**
 * Pure helpers behind the structured proposal editor (spec 4 Phase 4).
 * Operators edit `actions[n].payload` primitive fields (or the actions array
 * as raw JSON behind an explicit escape hatch) — never the whole payload:
 * `confidence` and `rationale` are the agent's testimony and are preserved
 * verbatim by reassembly, along with any non-primitive payload entries.
 *
 * The plan being edited belongs to ONE option of the envelope. Until the ranked
 * selection UI lands, that is the leading option — the same one the disposition
 * would run — and every other option survives the edit untouched.
 */

export type EditableActionField = {
  key: string
  kind: 'string' | 'number' | 'boolean'
  value: string | number | boolean
}

export type ActionEdit = {
  /** Read-only in the editor — changing the action type is a raw-hatch act. */
  type: string
  /** Flat primitive payload entries — the fields the operator decides on. */
  fields: EditableActionField[]
  /** Non-primitive payload entries, preserved verbatim on reassembly. */
  preserved: Record<string, unknown>
}

const rawActionsSchema = z.array(proposedActionSchema)

function isEditablePrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

/**
 * Derive per-action typed editors from a canonical proposal payload.
 * Returns null when the payload carries no option with a plan (legacy /
 * ad-hoc payloads keep the old whole-payload editing path).
 */
export function deriveActionEdits(payload: unknown): ActionEdit[] | null {
  const option = leadProposalOption(payload)
  if (!option) return null
  return option.actions.map((action) => {
    const fields: EditableActionField[] = []
    const preserved: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(action.payload)) {
      if (isEditablePrimitive(value)) {
        fields.push({
          key,
          kind: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
          value: value === null ? '' : value,
        })
      } else {
        preserved[key] = value
      }
    }
    return { type: action.type, fields, preserved }
  })
}

/** Reassemble the edited actions, preserving non-primitive entries verbatim. */
export function actionEditsToActions(edits: ActionEdit[]): ProposedAction[] {
  return edits.map((edit) => ({
    type: edit.type,
    payload: {
      ...edit.preserved,
      ...Object.fromEntries(
        edit.fields.map((field) => {
          if (field.kind === 'number') return [field.key, Number(field.value)]
          if (field.kind === 'boolean') return [field.key, field.value === true || field.value === 'true']
          return [field.key, field.value]
        }),
      ),
    },
  }))
}

export type RawActionsParse =
  | { ok: true; actions: ProposedAction[] }
  | { ok: false; error: 'json' | 'shape' }

/** Parse + zod-guard the raw-JSON escape hatch (the actions array only). */
export function parseRawActions(text: string): RawActionsParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'json' }
  }
  const validated = rawActionsSchema.safeParse(parsed)
  if (!validated.success) return { ok: false, error: 'shape' }
  return { ok: true, actions: validated.data }
}

/**
 * Rebuild the canonical payload with only the edited option's `actions` replaced —
 * the envelope rationale, every other option, and the edited option's own
 * rationale and confidence pass through untouched.
 */
export function reassembleProposalPayload(
  original: unknown,
  actions: ProposedAction[],
  selectedOptionId?: string | null,
): Record<string, unknown> {
  return replaceOptionActions(original, actions, selectedOptionId)
}

export function stringifyActions(actions: ProposedAction[]): string {
  try {
    return JSON.stringify(actions, null, 2)
  } catch {
    return '[]'
  }
}
