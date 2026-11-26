import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

type TraceIngestAuthority = { tenantId: string; organizationId: string } & (
  | { source: 'webhook' }
  | { source: 'opencode'; runId: string }
)

// The route and command can load from different production server bundles.
const authorityRegistryKey = Symbol.for('@open-mercato/agent_orchestrator/traceIngestAuthority')
const authorityRegistry = globalThis as typeof globalThis & {
  [authorityRegistryKey]?: WeakMap<CommandRuntimeContext, TraceIngestAuthority>
}
const traceIngestAuthorities = authorityRegistry[authorityRegistryKey] ??= new WeakMap()

export function withTraceIngestAuthority(
  ctx: CommandRuntimeContext,
  authority: TraceIngestAuthority,
): CommandRuntimeContext {
  const ingestContext = { ...ctx }
  traceIngestAuthorities.set(ingestContext, authority)
  return ingestContext
}

export function getTraceIngestAuthority(ctx: CommandRuntimeContext): TraceIngestAuthority | undefined {
  return traceIngestAuthorities.get(ctx)
}
