import { z } from 'zod'

export const RUN_MANIFEST_VIEW_SPAN_NAME = 'run.manifest'
export const RUN_MANIFEST_VIEW_SPAN_KIND = 'system'

const optionalString = z.string().min(1).optional().catch(undefined)
const nullableId = z.string().nullable().optional().catch(undefined)

export const runManifestViewSchema = z.object({
  'om.manifest.version': z.number().optional().catch(undefined),
  'om.runtime': optionalString,
  'om.agent.id': optionalString,
  'om.agent.definition_hash': optionalString,
  'om.agent.source': optionalString,
  'om.prompt.override': z.object({ id: z.string(), version: z.number() }).optional().catch(undefined),
  'om.prompt.system.sha256': optionalString,
  'om.tools.sha256': optionalString,
  'om.tools.names': z.array(z.string()).optional().catch(undefined),
  'om.model.declared': optionalString,
  'om.model.resolved': optionalString,
  'om.provider': optionalString,
  'om.knowledge': z.record(z.string(), z.string()).optional().catch(undefined),
  'om.invoker': z
    .object({ kind: z.string(), userId: nullableId, apiKeyId: nullableId, ownerUserId: nullableId })
    .optional()
    .catch(undefined),
  'om.entry_point': optionalString,
  'om.channel': optionalString,
  'om.correlation_id': nullableId,
  'om.principal': z
    .object({ agentPrincipalId: nullableId, agentUserId: nullableId, onBehalfOfUserId: nullableId })
    .optional()
    .catch(undefined),
  'om.capture': z.object({ level: z.string() }).passthrough().optional().catch(undefined),
  'om.platform_trace': z.object({ traceparent: z.string().min(1) }).optional().catch(undefined),
  'om.manifest.truncated': z.boolean().optional().catch(undefined),
})

export type RunManifestView = z.infer<typeof runManifestViewSchema>

export type RunManifestSpanLike = {
  name: string
  kind: string
  attributes?: unknown
}

export function isRunManifestSpan(span: Pick<RunManifestSpanLike, 'name' | 'kind'>): boolean {
  return span.name === RUN_MANIFEST_VIEW_SPAN_NAME && span.kind === RUN_MANIFEST_VIEW_SPAN_KIND
}

export function parseRunManifestAttributes(attributes: unknown): RunManifestView | null {
  if (attributes == null || typeof attributes !== 'object' || Array.isArray(attributes)) return null
  const parsed = runManifestViewSchema.safeParse(attributes)
  return parsed.success ? parsed.data : null
}

export function findRunManifestView(spans: readonly RunManifestSpanLike[]): RunManifestView | null {
  const span = spans.find(isRunManifestSpan)
  if (!span) return null
  return parseRunManifestAttributes(span.attributes)
}
