import type {
  PromptSection,
  PromptSectionName,
  PromptTemplate,
} from './prompt-composition-types'

/**
 * Canonical prompt section names the built-in agent prompt templates ship.
 * These align with the 7 section headers the spec (§8) mandates, plus the
 * free-form `overrides` bucket the template already reserves.
 */
export const CANONICAL_PROMPT_SECTIONS: readonly PromptSectionName[] = [
  'role',
  'scope',
  'data',
  'tools',
  'attachments',
  'mutationPolicy',
  'responseStyle',
  'overrides',
] as const

/**
 * Reserved keys that MUST NOT appear in a prompt override. These name policy
 * fields that live on the agent definition itself — allowing them to be
 * modified via the prompt-override layer would let a tenant silently escalate
 * an agent beyond the mutation / tool / attachment contract enforced by
 * `checkAgentPolicy` at dispatch time.
 */
export const RESERVED_OVERRIDE_KEYS: readonly string[] = [
  'mutationPolicy',
  'readOnly',
  'allowedTools',
  'acceptedMediaTypes',
] as const

const HEADER_MAP: Readonly<Record<string, PromptSectionName>> = {
  role: 'role',
  scope: 'scope',
  data: 'data',
  tools: 'tools',
  attachments: 'attachments',
  'mutation policy': 'mutationPolicy',
  mutation_policy: 'mutationPolicy',
  mutationpolicy: 'mutationPolicy',
  'response style': 'responseStyle',
  response_style: 'responseStyle',
  responsestyle: 'responseStyle',
  overrides: 'overrides',
}

function canonicalize(key: string): PromptSectionName | null {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return null
  return HEADER_MAP[normalized] ?? null
}

function prettyHeader(name: PromptSectionName): string {
  switch (name) {
    case 'mutationPolicy':
      return 'MUTATION POLICY'
    case 'responseStyle':
      return 'RESPONSE STYLE'
    default:
      return name.toUpperCase()
  }
}

export interface AppliedPromptOverride {
  sections: PromptSection[]
  systemPrompt: string
}

export interface PromptOverrideInput {
  /** Additive text keyed by canonical section id or free-form new header. */
  sections: Record<string, string> | null | undefined
}

/**
 * Applies an additive prompt override to a built-in template. Rules:
 *
 * - A canonical section key (`role`, `scope`, `data`, `tools`, `attachments`,
 *   `MUTATION POLICY`, `RESPONSE STYLE`, `overrides`) APPENDS the override
 *   text below the built-in section content with a blank line separator.
 *   The built-in content is never removed or rewritten.
 * - A non-canonical key is treated as a brand-new section and inserted
 *   after the canonical `RESPONSE STYLE` position (before `overrides`,
 *   if any). Canonical section order is always preserved.
 * - Empty or whitespace-only override values are ignored.
 * - If any reserved policy key is present (`mutationPolicy`, `readOnly`,
 *   `allowedTools`, `acceptedMediaTypes`), this function throws. Call sites
 *   SHOULD validate via {@link validatePromptOverrideInput} first so the
 *   error surfaces as a 400 to the API caller.
 */
export function applyPromptOverride(
  template: PromptTemplate,
  override: PromptOverrideInput | null | undefined,
): AppliedPromptOverride {
  const baseSections = [...template.sections]
  const sections = override?.sections ?? null

  if (!sections || typeof sections !== 'object') {
    return {
      sections: baseSections,
      systemPrompt: renderPrompt(baseSections),
    }
  }

  assertNoReservedKeys(sections)

  // First pass: append to canonical sections.
  const byCanonical = new Map<PromptSectionName, string>()
  const unknownKeys: Array<{ rawKey: string; value: string }> = []
  for (const [rawKey, value] of Object.entries(sections)) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const canonical = canonicalize(rawKey)
    if (canonical) {
      const existing = byCanonical.get(canonical)
      byCanonical.set(canonical, existing ? `${existing}\n\n${trimmed}` : trimmed)
    } else {
      unknownKeys.push({ rawKey, value: trimmed })
    }
  }

  const appended: PromptSection[] = baseSections.map((section) => {
    const addendum = byCanonical.get(section.name)
    if (!addendum) return section
    const nextContent = section.content.trim().length === 0
      ? addendum
      : `${section.content}\n\n${addendum}`
    return { ...section, content: nextContent }
  })

  // If a canonical section wasn't already present but an override targets it,
  // append it using its canonical header. Catalog / customer templates ship
  // all 7 canonical headers today, but we defend against future templates
  // that may omit some.
  const declaredNames = new Set(appended.map((s) => s.name))
  for (const [canonical, addendum] of byCanonical.entries()) {
    if (!declaredNames.has(canonical)) {
      appended.push({ name: canonical, content: addendum })
      declaredNames.add(canonical)
    }
  }

  // Brand-new sections inject after RESPONSE STYLE. We insert by splitting the
  // array at the index directly after `responseStyle`. If `overrides` is
  // already present, new sections land before it so `overrides` stays last.
  if (unknownKeys.length > 0) {
    const newSections: PromptSection[] = unknownKeys.map(({ rawKey, value }) => ({
      name: 'overrides',
      content: `[${rawKey.trim().toUpperCase()}]\n${value}`,
    }))
    const responseStyleIndex = appended.findIndex((s) => s.name === 'responseStyle')
    const overridesIndex = appended.findIndex((s) => s.name === 'overrides')
    let insertAt: number
    if (overridesIndex >= 0) {
      insertAt = overridesIndex
    } else if (responseStyleIndex >= 0) {
      insertAt = responseStyleIndex + 1
    } else {
      insertAt = appended.length
    }
    appended.splice(insertAt, 0, ...newSections)
  }

  return {
    sections: appended,
    systemPrompt: renderPrompt(appended),
  }
}

/**
 * Produces a flat string representation of a prompt template. The runtime uses
 * this when the agent definition declares sections but the underlying call
 * site expects a single-string `systemPrompt` (today: both `runAiAgentText`
 * and `runAiAgentObject`).
 */
export function renderPrompt(sections: readonly PromptSection[]): string {
  const lines: string[] = []
  for (const section of sections) {
    const content = section.content.trim()
    if (!content) continue
    lines.push(`[${prettyHeader(section.name)}]\n${content}`)
  }
  return lines.join('\n\n')
}

/**
 * Returns the list of reserved keys present in the supplied override payload.
 * Empty array means the body is safe for persistence. Call this before the
 * repository `save` so the API layer can reject with a 400 / `reserved_key`.
 */
export function findReservedKeys(sections: Record<string, unknown> | null | undefined): string[] {
  if (!sections || typeof sections !== 'object') return []
  const reservedSet = new Set(RESERVED_OVERRIDE_KEYS.map((key) => key.toLowerCase()))
  const hits: string[] = []
  for (const key of Object.keys(sections)) {
    if (reservedSet.has(key.trim().toLowerCase())) {
      hits.push(key)
    }
  }
  return hits
}

function assertNoReservedKeys(sections: Record<string, unknown>): void {
  const hits = findReservedKeys(sections)
  if (hits.length > 0) {
    throw new PromptOverrideReservedKeyError(hits)
  }
}

export class PromptOverrideReservedKeyError extends Error {
  readonly code = 'reserved_key'
  constructor(public readonly keys: readonly string[]) {
    super(
      `Prompt override includes reserved policy keys: ${keys.join(', ')}. ` +
        `Policy fields (${RESERVED_OVERRIDE_KEYS.join(', ')}) are never editable via prompt overrides.`,
    )
    this.name = 'PromptOverrideReservedKeyError'
  }
}

/**
 * Convenience wrapper: composes the full system prompt for a legacy agent that
 * ships a single-string `systemPrompt`. Returns the base unchanged when no
 * override is present. When an override is present, the base is treated as the
 * `role` section and overrides are layered via {@link applyPromptOverride}.
 */
export function composeSystemPromptWithOverride(
  baseSystemPrompt: string,
  override: PromptOverrideInput | null | undefined,
): string {
  if (!override?.sections || Object.keys(override.sections).length === 0) {
    return baseSystemPrompt
  }
  const template: PromptTemplate = {
    id: 'legacy-system-prompt',
    sections: [
      { name: 'role', content: baseSystemPrompt },
      { name: 'scope', content: '' },
      { name: 'data', content: '' },
      { name: 'tools', content: '' },
      { name: 'attachments', content: '' },
      { name: 'mutationPolicy', content: '' },
      { name: 'responseStyle', content: '' },
    ],
  }
  const applied = applyPromptOverride(template, override)
  return applied.systemPrompt
}
