import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type {
  AiToolLoadBeforeSingleRecord,
  McpToolContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import {
  createAiApiOperationRunner,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Incident, IncidentSeverity } from './data/entities'
import {
  findSimilarIncidents,
  loadIncidentAiContext,
  type IncidentAiScope,
  type SimilarIncident,
} from './lib/aiRuntime'

const incidentStatusSchema = z.enum([
  'open',
  'investigating',
  'identified',
  'mitigated',
  'resolved',
  'closed',
])

const listIncidentsInputSchema = z.object({
  status: incidentStatusSchema.optional(),
  severityKey: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(25).optional().default(10),
})

type ListIncidentsInput = z.infer<typeof listIncidentsInputSchema>

const getIncidentInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    number: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.id && !value.number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['id'],
        message: 'id or number is required',
      })
    }
  })

type GetIncidentInput = z.infer<typeof getIncidentInputSchema>

const findSimilarInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(10).optional().default(5),
})

type FindSimilarInput = z.infer<typeof findSimilarInputSchema>

const addTimelineNoteInputSchema = z.object({
  incidentId: z.string().uuid(),
  body: z.string().trim().min(1).max(8000),
  visibility: z.enum(['internal', 'customer_facing']).default('internal'),
})

type AddTimelineNoteInput = z.infer<typeof addTimelineNoteInputSchema>

type ListIncidentsApiItem = {
  id?: string
  number?: string | null
  title?: string | null
  status?: string | null
  severity_id?: string | null
  severityId?: string | null
  priority?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type ListIncidentsApiResponse = {
  items?: ListIncidentsApiItem[]
  total?: number
}

type ListIncidentsOutput = {
  items: Array<{
    id: string
    number: string | null
    title: string | null
    status: string | null
    severityId: string | null
    priority: string | null
    updatedAt: string | null
  }>
  total: number
  limit: number
}

type GetIncidentOutput =
  | {
      found: true
      incident: NonNullable<Awaited<ReturnType<typeof loadIncidentAiContext>>>['incident']
      timeline: NonNullable<Awaited<ReturnType<typeof loadIncidentAiContext>>>['timeline']
      impacts: NonNullable<Awaited<ReturnType<typeof loadIncidentAiContext>>>['impacts']
      participants: NonNullable<Awaited<ReturnType<typeof loadIncidentAiContext>>>['participants']
    }
  | {
      found: false
      id?: string
      number?: string
    }

type FindSimilarOutput = {
  results: SimilarIncident[]
}

type AddTimelineNoteOutput = {
  recordId: string
  commandName: 'incidents.timeline_entries.add'
  entryId: string | null
  incidentId: string
  visibility: 'internal' | 'customer_facing'
}

function assertScope(ctx: McpToolContext): IncidentAiScope {
  if (!ctx.tenantId) throw new Error('[internal] tenant context is required')
  if (!ctx.organizationId) throw new Error('[internal] organization context is required')
  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    organizationIds: [ctx.organizationId],
  }
}

function resolveEntityManager(ctx: McpToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em').fork()
}

async function resolveSeverityId(
  ctx: McpToolContext,
  scope: IncidentAiScope,
  severityKey: string | undefined,
): Promise<string | null | undefined> {
  if (!severityKey) return undefined
  const em = resolveEntityManager(ctx)
  const severity = await findOneWithDecryption(
    em,
    IncidentSeverity,
    {
      key: severityKey,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } satisfies FilterQuery<IncidentSeverity>,
    undefined,
    scope,
  )
  return severity?.id ?? null
}

async function loadIncidentByIdOrNumber(
  ctx: McpToolContext,
  scope: IncidentAiScope,
  input: GetIncidentInput,
): Promise<Incident | null> {
  const em = resolveEntityManager(ctx)
  const where = input.id
    ? {
        id: input.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }
    : {
        number: input.number,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }
  return findOneWithDecryption(
    em,
    Incident,
    where satisfies FilterQuery<Incident>,
    undefined,
    scope,
  )
}

function normalizeListItem(row: ListIncidentsApiItem): ListIncidentsOutput['items'][number] | null {
  if (!row.id) return null
  return {
    id: row.id,
    number: row.number ?? null,
    title: row.title ?? null,
    status: row.status ?? null,
    severityId: row.severity_id ?? row.severityId ?? null,
    priority: row.priority ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  }
}

const listIncidentsTool = defineAiTool<ListIncidentsInput, ListIncidentsOutput>({
  name: 'incidents.list_incidents',
  displayName: 'List incidents',
  description:
    'List incidents in the caller tenant and organization. Filters by status, severity key, and text search. Returns at most 25 records.',
  inputSchema: listIncidentsInputSchema,
  requiredFeatures: ['incidents.incident.view', 'incidents.ai.use'],
  tags: ['read', 'incidents'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const input = listIncidentsInputSchema.parse(rawInput)
    const scope = assertScope(ctx)
    const severityId = await resolveSeverityId(ctx, scope, input.severityKey)
    if (severityId === null) {
      return { items: [], total: 0, limit: input.limit }
    }

    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)
    const response = await runner.run<ListIncidentsApiResponse>({
      method: 'GET',
      path: '/incidents',
      query: {
        page: 1,
        pageSize: input.limit,
        status: input.status,
        search: input.search,
        severityId,
        sortField: 'updatedAt',
        sortDir: 'desc',
      },
    })
    if (!response.success) {
      throw new Error(response.error ?? '[internal] failed to list incidents')
    }
    const data = response.data ?? {}
    const rawItems = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map(normalizeListItem).filter((item): item is ListIncidentsOutput['items'][number] => !!item),
      total: typeof data.total === 'number' ? data.total : rawItems.length,
      limit: input.limit,
    }
  },
})

const getIncidentTool = defineAiTool<GetIncidentInput, GetIncidentOutput>({
  name: 'incidents.get_incident',
  displayName: 'Get incident',
  description:
    'Fetch one incident by id or incident number, including latest timeline entries, impacts, and participants scoped to the caller tenant and organization.',
  inputSchema: getIncidentInputSchema,
  requiredFeatures: ['incidents.incident.view', 'incidents.ai.use'],
  tags: ['read', 'incidents'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const input = getIncidentInputSchema.parse(rawInput)
    const scope = assertScope(ctx)
    const incident = await loadIncidentByIdOrNumber(ctx, scope, input)
    if (!incident) {
      return {
        found: false,
        ...(input.id ? { id: input.id } : {}),
        ...(input.number ? { number: input.number } : {}),
      }
    }
    const context = await loadIncidentAiContext(ctx.container, scope, incident.id, {
      timelineLimit: 50,
      timelineOrder: 'desc',
    })
    if (!context) {
      return {
        found: false,
        id: incident.id,
        number: incident.number,
      }
    }
    return {
      found: true,
      incident: context.incident,
      timeline: context.timeline,
      impacts: context.impacts,
      participants: context.participants,
    }
  },
})

const findSimilarIncidentsTool = defineAiTool<FindSimilarInput, FindSimilarOutput>({
  name: 'incidents.find_similar_incidents',
  displayName: 'Find similar incidents',
  description:
    'Search incident history for related incidents by text. Soft-fails to an empty result list if search is unavailable.',
  inputSchema: findSimilarInputSchema,
  requiredFeatures: ['incidents.incident.view', 'incidents.ai.use'],
  tags: ['read', 'search', 'incidents'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const input = findSimilarInputSchema.parse(rawInput)
    const scope = assertScope(ctx)
    return {
      results: await findSimilarIncidents(ctx.container, scope, input.query, input.limit),
    }
  },
})

const addTimelineNoteTool = defineAiTool<AddTimelineNoteInput, AddTimelineNoteOutput>({
  name: 'incidents.add_timeline_note',
  displayName: 'Add incident timeline note',
  description:
    'Add an internal or customer-facing timeline note. Mutation tool: the runtime routes this through prepareMutation before executing incidents.timeline_entries.add.',
  inputSchema: addTimelineNoteInputSchema,
  requiredFeatures: ['incidents.incident.manage', 'incidents.ai.use'],
  tags: ['write', 'incidents'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<AiToolLoadBeforeSingleRecord | null> => {
    const input = addTimelineNoteInputSchema.parse(rawInput)
    const scope = assertScope(ctx)
    const incident = await loadIncidentByIdOrNumber(ctx, scope, { id: input.incidentId })
    if (!incident) return null
    return {
      recordId: incident.id,
      entityType: 'incidents.incident',
      recordVersion: incident.updatedAt.toISOString(),
      before: {
        timelineNote: null,
        visibility: null,
      },
      after: {
        timelineNote: input.body,
        visibility: input.visibility,
      },
      display: {
        fieldLabels: {
          timelineNote: 'Timeline note',
          visibility: 'Visibility',
        },
        after: {
          timelineNote: input.body,
          visibility: input.visibility,
        },
      },
    }
  },
  handler: async (rawInput, ctx) => {
    const input = addTimelineNoteInputSchema.parse(rawInput)
    const scope = assertScope(ctx)
    const incident = await loadIncidentByIdOrNumber(ctx, scope, { id: input.incidentId })
    if (!incident) throw new Error('[internal] incident not found')

    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)
    const response = await runner.run<{ entryId?: string | null; incidentId?: string | null }>({
      method: 'POST',
      path: `/incidents/${incident.id}/timeline`,
      body: {
        body: input.body,
        visibility: input.visibility,
        kind: 'note',
      },
    })
    if (!response.success) {
      throw new Error(response.error ?? '[internal] failed to add incident timeline note')
    }
    return {
      recordId: incident.id,
      commandName: 'incidents.timeline_entries.add',
      entryId: response.data?.entryId ?? null,
      incidentId: response.data?.incidentId ?? incident.id,
      visibility: input.visibility,
    }
  },
})

export const aiTools = [
  listIncidentsTool,
  getIncidentTool,
  findSimilarIncidentsTool,
  addTimelineNoteTool,
]

export default aiTools
