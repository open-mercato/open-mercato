import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import { DELEGATE_TOOL_ID } from '../sdk/defineAgent'
import { LOAD_SKILL_TOOL_ID, RUN_SKILL_SCRIPT_TOOL_ID, SUBMIT_OUTCOME_TOOL_ID } from '../../ai-tools'
import type { BusinessHarnessExecutionBundle, BusinessHarnessModelBinding } from './businessHarnessContracts'

export const BUSINESS_HARNESS_CONNECTOR_ID = 'open-mercato'
export const BUSINESS_HARNESS_CAPABILITY_AUDIENCE = 'open-mercato:mcp'
export const BUSINESS_HARNESS_CAPABILITY_BINDING_ID = 'open-mercato-default'

export type BusinessHarnessLoopSettings = {
  maxSteps: number
  timeoutMs: number
  maxToolCalls: number
}

export type PreparedBusinessHarnessAgent = {
  digest: string
  version: string
  tools: string[]
  outputSchema: Record<string, unknown>
  instructions: string
}

export function prepareBusinessHarnessAgent(entry: AgentRegistryEntry): PreparedBusinessHarnessAgent {
  const tools = effectiveBusinessHarnessTools(entry)
  const outputSchema = z.toJSONSchema(entry.schema, {
    unrepresentable: 'any',
  }) as Record<string, unknown>
  const digest = businessHarnessAgentDigest(entry, outputSchema, tools)
  return {
    digest,
    version: digest.slice(0, 16),
    tools,
    outputSchema,
    instructions: compileInstructions(entry),
  }
}

export function compileBusinessHarnessBundle(input: {
  runId: string
  entry: AgentRegistryEntry
  businessInput: unknown
  model: BusinessHarnessModelBinding
  runGrant: string
  loop: BusinessHarnessLoopSettings
  runtimeProfile?: string
  prepared?: PreparedBusinessHarnessAgent
}): { bundle: BusinessHarnessExecutionBundle; digest: string; tools: string[] } {
  const prepared = input.prepared ?? prepareBusinessHarnessAgent(input.entry)
  const { tools, outputSchema, digest, version, instructions } = prepared
  const prompt =
    typeof input.businessInput === 'string'
      ? input.businessInput
      : JSON.stringify(input.businessInput)

  return {
    digest,
    tools,
    bundle: {
      protocolVersion: '1',
      runId: input.runId,
      agent: {
        id: input.entry.id,
        version,
        digest,
        runtimeProfile: input.runtimeProfile ?? 'business-v1',
        instructions,
        model: input.model,
        capabilities:
          tools.length > 0
            ? [
                {
                  connectorId: BUSINESS_HARNESS_CONNECTOR_ID,
                  allowedTools: tools,
                  access: 'read',
                },
              ]
            : [],
        loop: input.loop,
        output: {
          mode: 'object',
          schema: outputSchema,
          name: input.entry.id.replace(/\W+/g, '_').slice(0, 64),
          description: input.entry.description.slice(0, 512),
        },
      },
      input: { prompt },
      authorization: { runGrant: input.runGrant },
    },
  }
}

export function effectiveBusinessHarnessTools(entry: AgentRegistryEntry): string[] {
  const tools = new Set(entry.tools)
  tools.delete(SUBMIT_OUTCOME_TOOL_ID)
  if (entry.skills.length > 0) {
    tools.add(LOAD_SKILL_TOOL_ID)
    tools.add(RUN_SKILL_SCRIPT_TOOL_ID)
  }
  if (entry.subAgents.length > 0) tools.add(DELEGATE_TOOL_ID)
  return [...tools].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export function businessHarnessAgentDigest(
  entry: AgentRegistryEntry,
  outputSchema: Record<string, unknown>,
  tools: string[],
): string {
  return createHash('sha256')
    .update(
      stableJson({
        id: entry.id,
        moduleId: entry.moduleId,
        resultKind: entry.resultKind,
        instructions: entry.instructions,
        outputSchema,
        tools,
        skills: [...entry.skills].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
        subAgents: [...entry.subAgents].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
        loop: entry.loop ?? null,
        runtimeProfile: 'business-v1',
      }),
    )
    .digest('hex')
}

function compileInstructions(entry: AgentRegistryEntry): string {
  const sections = [entry.instructions]
  if (entry.skills.length > 0) {
    sections.push(
      `## Skills\nLoad a skill with \`${LOAD_SKILL_TOOL_ID}\` before using it. Allowed skill ids: ${entry.skills.join(', ')}. Use \`${RUN_SKILL_SCRIPT_TOOL_ID}\` only for scripts declared by those skills.`,
    )
  }
  if (entry.subAgents.length > 0) {
    sections.push(
      `## Sub-agents\nDelegate independent research with \`${DELEGATE_TOOL_ID}\`. Allowed sub-agent ids: ${entry.subAgents.join(', ')}.`,
    )
  }
  sections.push('Return only a value matching the structured output contract.')
  return sections.join('\n\n')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
