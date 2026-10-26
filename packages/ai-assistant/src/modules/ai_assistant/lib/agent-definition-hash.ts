import { createHash } from 'node:crypto'
import type { AiAgentDefinition } from './ai-agent-definition'

export const AGENT_DEFINITION_HASH_PREFIX = 'sha256:'

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function toCanonicalValue(value: unknown, ancestors: Set<object>): CanonicalValue | undefined {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return undefined
    ancestors.add(value)
    const items: CanonicalValue[] = []
    for (const item of value) {
      const canonicalItem = toCanonicalValue(item, ancestors)
      if (canonicalItem !== undefined) items.push(canonicalItem)
    }
    ancestors.delete(value)
    return items
  }
  if (isPlainObject(value)) {
    if (ancestors.has(value)) return undefined
    ancestors.add(value)
    const result: { [key: string]: CanonicalValue } = {}
    for (const key of Object.keys(value).sort()) {
      const canonicalEntry = toCanonicalValue(value[key], ancestors)
      if (canonicalEntry !== undefined) result[key] = canonicalEntry
    }
    ancestors.delete(value)
    return result
  }
  return undefined
}

export function canonicalJsonStringify(value: unknown): string {
  const canonical = toCanonicalValue(value, new Set<object>())
  return JSON.stringify(canonical === undefined ? null : canonical)
}

export function buildAgentDefinitionHashInput(
  agent: AiAgentDefinition,
): Record<string, unknown> {
  return {
    systemPrompt: agent.systemPrompt,
    allowedTools: [...agent.allowedTools].sort(),
    executionMode: agent.executionMode ?? null,
    outputSchemaName: agent.output?.schemaName ?? null,
    mutationPolicy: agent.mutationPolicy ?? null,
    defaultProvider: agent.defaultProvider ?? null,
    defaultModel: agent.defaultModel ?? null,
    modelSettings: agent.modelSettings ?? null,
    loop: agent.loop ?? null,
  }
}

export function computeAgentDefinitionHash(agent: AiAgentDefinition): string {
  const canonical = canonicalJsonStringify(buildAgentDefinitionHashInput(agent))
  return `${AGENT_DEFINITION_HASH_PREFIX}${createHash('sha256').update(canonical).digest('hex')}`
}
