import { aiAgentHttpCallSettingsSchema } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-call-contract'

/**
 * Pure mapping from the Playground's "Model settings" fields to the
 * `callSettings` body of POST /agents/:id/run. Blank fields are omitted so the
 * agent's own `modelSettings` (and then the provider default) apply to them.
 * Values are checked against the same `aiAgentHttpCallSettingsSchema` the route
 * enforces, so the page names the bad field instead of rendering the route's
 * generic validation error.
 */

export type PlaygroundCallSettingsDraft = {
  temperature: string
  topP: string
  maxOutputTokens: string
  seed: string
}

export const EMPTY_PLAYGROUND_CALL_SETTINGS: PlaygroundCallSettingsDraft = {
  temperature: '',
  topP: '',
  maxOutputTokens: '',
  seed: '',
}

export type PlaygroundCallSettings = {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  seed?: number
}

export type PlaygroundCallSettingsResult =
  | { ok: true; callSettings: PlaygroundCallSettings | null }
  | { ok: false; field: keyof PlaygroundCallSettingsDraft }

const INTEGER_FIELDS: ReadonlyArray<keyof PlaygroundCallSettingsDraft> = ['maxOutputTokens', 'seed']
const FIELDS: ReadonlyArray<keyof PlaygroundCallSettingsDraft> = ['temperature', 'topP', 'maxOutputTokens', 'seed']

export function buildPlaygroundCallSettings(draft: PlaygroundCallSettingsDraft): PlaygroundCallSettingsResult {
  const callSettings: PlaygroundCallSettings = {}
  for (const field of FIELDS) {
    const raw = draft[field].trim()
    if (!raw) continue
    const value = Number(raw)
    if (!Number.isFinite(value)) return { ok: false, field }
    if (INTEGER_FIELDS.includes(field) && !Number.isInteger(value)) return { ok: false, field }
    callSettings[field] = value
  }
  const checked = aiAgentHttpCallSettingsSchema.safeParse(callSettings)
  if (!checked.success) {
    const failed = checked.error.issues[0]?.path[0]
    const field = FIELDS.find((candidate) => candidate === failed) ?? FIELDS[0]
    return { ok: false, field }
  }
  return { ok: true, callSettings: Object.keys(callSettings).length > 0 ? callSettings : null }
}

export function hasPlaygroundCallSettings(draft: PlaygroundCallSettingsDraft): boolean {
  return FIELDS.some((field) => draft[field].trim().length > 0)
}
