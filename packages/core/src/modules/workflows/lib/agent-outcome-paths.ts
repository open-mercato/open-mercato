/**
 * Workflows Module - INVOKE_AGENT source-path vocabulary (spec
 * 2026-07-26-workflows-ux-redesign.md sections 3.4 / 7.1).
 *
 * Pure translation of an agent's declared OUTCOME JSON-Schema (served by the
 * optional agent_orchestrator peer on `/api/agent_orchestrator/agents`) into
 * the dot paths an `outputMapping` row may read from. The vocabulary is the
 * normalized result envelope `mapAgentResultToContext` builds: the platform's
 * own `kind`/`disposition`/`agentId`/`proposalId` keys, plus the agent's OUTCOME
 * under `data` (researcher agents) or `proposalPayload` (proposal ones).
 *
 * No React, no network, no registry — the editor feeds it the fetched schema and
 * gets back plain data, so the same helper backs the source picker, the
 * author-time path check, and the "Insert sample" rows.
 */

export type AgentResultKind = 'researcher' | 'proposal'

export interface AgentOutcomeSchemaNode {
  type?: string
  properties?: Record<string, AgentOutcomeSchemaNode>
  items?: AgentOutcomeSchemaNode
}

export interface AgentSourcePath {
  path: string
  type: string
  /**
   * True only for an object whose properties this vocabulary does NOT describe
   * (declared without `properties`, or nested past the depth cap). Deeper paths
   * below such a node stay valid; a fully described object is closed, so an
   * undeclared property under it is an author error.
   */
  container: boolean
}

export interface AgentInputRow {
  key: string
  value: string
}

const MAX_OUTCOME_DEPTH = 3

const ENVELOPE_PATHS: ReadonlyArray<AgentSourcePath> = [
  { path: 'kind', type: 'text', container: false },
  { path: 'disposition', type: 'text', container: false },
  { path: 'agentId', type: 'text', container: false },
  { path: 'proposalId', type: 'text', container: false },
]

const JSON_TYPE_LABELS: Record<string, string> = {
  string: 'text',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
  array: 'array',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function labelFor(node: AgentOutcomeSchemaNode | undefined): string {
  const type = node?.type
  return typeof type === 'string' ? JSON_TYPE_LABELS[type] ?? 'unknown' : 'unknown'
}

export function agentOutcomeRootKey(resultKind: AgentResultKind): 'data' | 'proposalPayload' {
  return resultKind === 'researcher' ? 'data' : 'proposalPayload'
}

function describesProperties(node: AgentOutcomeSchemaNode): boolean {
  const properties = node.properties
  return isPlainObject(properties) && Object.keys(properties).length > 0
}

function collectOutcomePaths(
  node: AgentOutcomeSchemaNode,
  prefix: string,
  depth: number,
  collected: AgentSourcePath[],
): void {
  const properties = node.properties
  if (!isPlainObject(properties)) return
  for (const [name, child] of Object.entries(properties)) {
    if (!name || !isPlainObject(child)) continue
    const childNode = child as AgentOutcomeSchemaNode
    const path = `${prefix}.${name}`
    const expandable =
      childNode.type === 'object' && describesProperties(childNode) && depth < MAX_OUTCOME_DEPTH
    collected.push({ path, type: labelFor(childNode), container: !expandable && childNode.type === 'object' })
    if (expandable) collectOutcomePaths(childNode, path, depth + 1, collected)
  }
}

/**
 * Every source path an outputMapping row may reference for the selected agent.
 * Returns an empty list when the agent declares no usable OUTCOME shape — the
 * caller then keeps free text and skips the author-time check rather than
 * flagging paths it cannot verify.
 */
export function buildAgentSourcePaths(
  resultKind: AgentResultKind | undefined,
  outcomeSchema: unknown,
): AgentSourcePath[] {
  if (!resultKind || !isPlainObject(outcomeSchema)) return []
  const rootKey = agentOutcomeRootKey(resultKind)
  const root = outcomeSchema as AgentOutcomeSchemaNode
  const paths: AgentSourcePath[] = [
    ...ENVELOPE_PATHS,
    { path: rootKey, type: 'object', container: !describesProperties(root) },
  ]
  collectOutcomePaths(root, rootKey, 1, paths)
  return paths
}

export function isTemplateExpression(value: string): boolean {
  return /\{\{.*\}\}/.test(value)
}

/**
 * A source path resolves when it names a declared path or descends into an
 * object this vocabulary does not describe. A blank path (a row still being
 * written) and an agent with no declared OUTCOME both resolve — the check only
 * fires where the schema can actually prove the path wrong.
 */
export function isKnownAgentSourcePath(paths: ReadonlyArray<AgentSourcePath>, value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return true
  if (paths.length === 0) return true
  return paths.some(
    (candidate) =>
      candidate.path === trimmed || (candidate.container && trimmed.startsWith(`${candidate.path}.`)),
  )
}

export function agentSampleInputKeys(sampleInput: unknown): string[] {
  return isPlainObject(sampleInput) ? Object.keys(sampleInput) : []
}

/**
 * The `input` rows an agent's SAMPLE input fills in. String values are inserted
 * verbatim (they may already be `{{context.*}}` pills); anything else is
 * serialized so the author sees the exact literal the step will send.
 */
export function agentSampleInputRows(sampleInput: unknown): AgentInputRow[] {
  if (!isPlainObject(sampleInput)) return []
  return Object.entries(sampleInput).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value) ?? '',
  }))
}
