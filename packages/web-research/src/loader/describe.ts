import type { AdapterModule } from '../contract/adapter'

export type OptionFieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'stringList'

export type OptionField = {
  readonly name: string
  readonly kind: OptionFieldKind
  readonly required: boolean
  /** True when the value must never be echoed back to a browser. */
  readonly secret: boolean
  readonly choices?: readonly string[]
  readonly format?: string
  readonly min?: number
  readonly max?: number
}

const SECRET_WORD = /(^|_)(api_?key|key|token|secret|password|passwd|credential)s?(_|$)/

/**
 * Whether a field name looks like a credential. The name is split at camelCase
 * boundaries first, so `accessToken` and `access_token` are treated alike — a
 * plain word-boundary match misses the camelCase spelling entirely.
 */
function isSecretName(name: string): boolean {
  return SECRET_WORD.test(name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
}

type ZodInternals = {
  type?: string
  innerType?: { def?: ZodInternals }
  entries?: Record<string, unknown>
  format?: string
  element?: { def?: ZodInternals }
  checks?: Array<{ _zod?: { def?: { check?: string; value?: number } } }>
}

type ZodLike = { def?: ZodInternals; shape?: Record<string, ZodLike> }

function unwrap(schema: ZodLike): { inner: ZodInternals; required: boolean } {
  let def = schema.def
  let required = true
  // `.optional()` / `.nullable()` / `.default()` wrap the real type.
  while (def && (def.type === 'optional' || def.type === 'nullable' || def.type === 'default')) {
    if (def.type !== 'nullable') required = false
    def = def.innerType?.def
  }
  return { inner: def ?? {}, required }
}

function boundsOf(inner: ZodInternals): { min?: number; max?: number } {
  const bounds: { min?: number; max?: number } = {}
  for (const check of inner.checks ?? []) {
    const def = check?._zod?.def
    if (!def || typeof def.value !== 'number') continue
    if (def.check === 'greater_than' || def.check === 'min_length') bounds.min = def.value
    if (def.check === 'less_than' || def.check === 'max_length') bounds.max = def.value
  }
  return bounds
}

function kindOf(inner: ZodInternals): OptionFieldKind | null {
  switch (inner.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'int':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'enum':
      return 'enum'
    case 'array':
      // Only string arrays are renderable as a plain comma-separated input.
      return inner.element?.def?.type === 'string' ? 'stringList' : null
    default:
      // `custom` is how an adapter declares a host-supplied capability
      // (a model resolver, a sidecar handle). Not user-configurable, so it must
      // never reach the admin form.
      return null
  }
}

/**
 * Describes an adapter's options as renderable fields, so the settings UI can
 * build a form for an adapter it has never heard of — including one published by
 * a third party — without the adapter shipping any UI of its own.
 */
export function describeOptionsSchema(module: AdapterModule<unknown>): OptionField[] {
  const schema = module.optionsSchema as unknown as ZodLike
  const shape = schema.shape ?? (schema.def as { shape?: Record<string, ZodLike> } | undefined)?.shape
  if (!shape) return []

  const fields: OptionField[] = []
  for (const [name, entry] of Object.entries(shape)) {
    const { inner, required } = unwrap(entry)
    const kind = kindOf(inner)
    if (kind === null) continue
    const bounds = boundsOf(inner)
    fields.push({
      name,
      kind,
      required,
      secret: isSecretName(name),
      ...(kind === 'enum' && inner.entries ? { choices: Object.keys(inner.entries) } : {}),
      ...(inner.format ? { format: inner.format } : {}),
      ...(bounds.min === undefined ? {} : { min: bounds.min }),
      ...(bounds.max === undefined ? {} : { max: bounds.max }),
    })
  }
  return fields
}

/** Placeholder returned instead of a stored secret, and accepted back unchanged. */
export const SECRET_PLACEHOLDER = '__om_secret_unchanged__'

export function maskSecrets(
  values: Record<string, unknown>,
  fields: readonly OptionField[],
): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...values }
  for (const field of fields) {
    if (!field.secret) continue
    const value = masked[field.name]
    if (typeof value === 'string' && value.length > 0) masked[field.name] = SECRET_PLACEHOLDER
  }
  return masked
}

/** Restores stored secrets the client echoed back as the placeholder. */
export function unmaskSecrets(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown>,
  fields: readonly OptionField[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...incoming }
  for (const field of fields) {
    if (!field.secret) continue
    if (merged[field.name] === SECRET_PLACEHOLDER) {
      const previous = stored[field.name]
      if (previous === undefined) delete merged[field.name]
      else merged[field.name] = previous
    }
  }
  return merged
}
