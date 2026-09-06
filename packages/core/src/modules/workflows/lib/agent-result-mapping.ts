/**
 * Maps an INVOKE_AGENT result into a workflow-context patch.
 *
 * An INVOKE_AGENT activity may declare an optional `outputMapping` (mirroring
 * SUB_WORKFLOW). When present, the agent's result is routed into the chosen
 * context keys instead of the legacy fixed keys. The mapping reads from a
 * normalized envelope so authors address a stable contract regardless of the
 * runtime (in-process vs OpenCode) or the resolution path (inline branch vs
 * parked-and-resumed worker).
 *
 * Returns the mapped patch when a non-empty mapping is provided, otherwise
 * `null` to signal the caller should fall back to its legacy fixed-key payload —
 * keeping existing definitions byte-for-byte backward compatible.
 */

import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows').child({ component: 'agent-result-mapping' })

export type AgentResultEnvelope = {
  kind: 'auto_approved' | 'researcher' | 'user_task' | 'none_proposed' | 'artifact'
  agentId?: string
  proposalId?: string
  proposalPayload?: unknown
  data?: unknown
  /** Set for an `artifact` result: the files the run produced, by reference. */
  artifacts?: unknown[]
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

function setNestedValue(obj: Record<string, any>, path: string, value: any): void {
  const keys = path.split('.')
  const lastKey = keys.pop()!
  const target = keys.reduce<Record<string, any>>((current, key) => {
    if (!(key in current)) current[key] = {}
    return current[key]
  }, obj)
  target[lastKey] = value
}

function warnOnTemplateMapping(sourcePath: string): void {
  if (/\{\{.*\}\}/.test(sourcePath)) {
    logger.warn(
      'INVOKE_AGENT outputMapping value looks like a {{ }} template, but mapping values are plain ' +
        'dot-paths into the agent result envelope (e.g. "proposalPayload.riskScore"). This entry ' +
        'will not resolve and is being ignored.',
      { sourcePath }
    )
  }
}

export function mapAgentResultToContext(
  envelope: AgentResultEnvelope,
  outputMapping: Record<string, string> | undefined | null
): Record<string, any> | null {
  if (!outputMapping || Object.keys(outputMapping).length === 0) return null

  const source = {
    kind: envelope.kind,
    // `artifact` reports as `researcher` here for the same reason it routes onto
    // that handle: the disposition vocabulary describes DECISIONS, and producing
    // a file is not one. The `kind` above still says what actually came back.
    disposition:
      envelope.kind === 'researcher' || envelope.kind === 'artifact' ? 'researcher' : envelope.kind,
    agentId: envelope.agentId,
    proposalId: envelope.proposalId,
    proposalPayload: envelope.proposalPayload,
    data: envelope.data,
    artifacts: envelope.artifacts,
  }

  const result: Record<string, any> = {}
  for (const [targetKey, sourcePath] of Object.entries(outputMapping)) {
    warnOnTemplateMapping(sourcePath)
    const value = getNestedValue(source, sourcePath)
    if (value !== undefined) {
      setNestedValue(result, targetKey, value)
    }
  }
  return result
}
