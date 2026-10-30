import { createHash } from 'node:crypto'
import { canonicalJsonStringify } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-definition-hash'
import type { AgentRegistryEntry, AgentResultKind } from '../sdk/defineAgent'
import { resolveAgentOutcomeJsonSchema } from '../sdk/agentOutcomeContract'
import type { FileAgentFile } from '../tokens/types'

export const DEFINITION_HASH_PREFIX = 'sha256:'

const SHORT_AGENT_VERSION_HEX_LENGTH = 16

export type CodeAgentDefinitionHashInput = {
  aiDefinitionHash: string | null
  resultKind: AgentResultKind
  outcomeSchema: unknown
  agentType: string | null
}

export type DefinitionHashSourceFile = Pick<FileAgentFile, 'path' | 'content' | 'inContext'>

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function computeCodeAgentDefinitionHash(input: CodeAgentDefinitionHashInput): string {
  const canonical = canonicalJsonStringify({
    aiDefinitionHash: input.aiDefinitionHash,
    resultKind: input.resultKind,
    outcomeSchema: input.outcomeSchema ?? null,
    agentType: input.agentType,
  })
  return `${DEFINITION_HASH_PREFIX}${sha256Hex(canonical)}`
}

export function computeFileAgentDefinitionHash(sourceFiles: readonly DefinitionHashSourceFile[]): string {
  const inContextFiles = sourceFiles
    .filter((file) => file.inContext)
    .map((file) => ({ path: file.path, content: file.content }))
    .sort((left, right) => compareCodePoints(left.path, right.path))
  return `${DEFINITION_HASH_PREFIX}${sha256Hex(canonicalJsonStringify(inContextFiles))}`
}

const resolvedHashes = new WeakMap<AgentRegistryEntry, string>()

export function resolveAgentDefinitionHash(entry: AgentRegistryEntry): string {
  const cached = resolvedHashes.get(entry)
  if (cached) return cached
  const hash =
    entry.sourceFiles
      ? computeFileAgentDefinitionHash(entry.sourceFiles)
      : computeCodeAgentDefinitionHash({
          aiDefinitionHash: entry.aiDefinitionHash ?? null,
          resultKind: entry.resultKind,
          outcomeSchema: resolveAgentOutcomeJsonSchema(entry) ?? null,
          agentType: entry.agentType ?? null,
        })
  resolvedHashes.set(entry, hash)
  return hash
}

export function toShortAgentVersion(definitionHash: string): string {
  const hex = definitionHash.startsWith(DEFINITION_HASH_PREFIX)
    ? definitionHash.slice(DEFINITION_HASH_PREFIX.length)
    : definitionHash
  return `${DEFINITION_HASH_PREFIX}${hex.slice(0, SHORT_AGENT_VERSION_HEX_LENGTH)}`
}

export function resolveRunAgentVersion(input: {
  agentVersion?: string | null
  definitionHash?: string | null
}): string | null {
  if (input.agentVersion) return input.agentVersion
  if (input.definitionHash) return toShortAgentVersion(input.definitionHash)
  return null
}
