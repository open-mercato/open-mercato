/**
 * Agent OUTCOME contract resolution.
 *
 * Every registered agent's result schema is the SAME envelope regardless of how
 * it was authored: `defineAgent` declares `z.object({ kind, proposal | data })`
 * and `compileOutcome` builds exactly that shape from a file agent's OUTCOME.md.
 * The OUTCOME itself — what an author actually wants to map into a workflow
 * context or read in the Playground — is therefore the inner `data` (researcher)
 * or `proposal` (proposal) property of that envelope.
 *
 * Two projections of the same thing:
 * - `resolveAgentOutcomeZod` returns the inner Zod schema (consumed in-process,
 *   e.g. by the workflows INVOKE_AGENT output-contract bridge).
 * - `resolveAgentOutcomeJsonSchema` returns the inner JSON-Schema for the wire.
 *   File agents carry the authored JSON-Schema verbatim (`entry.outcomeSchema`);
 *   in-process agents have no such artifact, so their Zod is converted with the
 *   platform's OpenAPI converter.
 *
 * Both degrade to `undefined` rather than guessing: an agent whose result schema
 * is not the declared envelope simply exposes no outcome contract.
 */

import type { ZodTypeAny } from 'zod'
import { zodToJsonSchema, type JsonSchema } from '@open-mercato/shared/lib/openapi'
import type { AgentRegistryEntry } from './defineAgent'

const OUTCOME_PROPERTY: Record<AgentRegistryEntry['resultKind'], string> = {
  researcher: 'data',
  proposal: 'proposal',
}

function shapeOf(schema: unknown): Record<string, ZodTypeAny> | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined
  const shape = (schema as { shape?: unknown }).shape
  if (typeof shape !== 'object' || shape === null) return undefined
  return shape as Record<string, ZodTypeAny>
}

export function resolveAgentOutcomeZod(entry: AgentRegistryEntry): ZodTypeAny | undefined {
  const shape = shapeOf(entry.schema)
  return shape?.[OUTCOME_PROPERTY[entry.resultKind]]
}

export function resolveAgentOutcomeJsonSchema(entry: AgentRegistryEntry): JsonSchema | undefined {
  if (entry.outcomeSchema) return entry.outcomeSchema as JsonSchema
  const outcome = resolveAgentOutcomeZod(entry)
  if (!outcome) return undefined
  try {
    return zodToJsonSchema(outcome)
  } catch {
    return undefined
  }
}
