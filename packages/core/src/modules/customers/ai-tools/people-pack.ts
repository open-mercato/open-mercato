/**
 * `customers.list_people` + `customers.get_person` (Phase 1 WS-C, Step 3.9).
 *
 * Read-only tools scoped to `ctx.tenantId` / `ctx.organizationId` that wrap
 * the existing customers query engine + encryption helpers. Mutation tools
 * are deferred to Step 5.13+ under the pending-action contract.
 *
 * Phase 3a of `.ai/specs/implemented/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
 * `customers.list_people` is now an API-backed wrapper over
 * `GET /api/customers/people`. The `companyId` AI input has no inclusion
 * equivalent on the route (the route exposes `excludeLinkedCompanyId` only)
 * so it is pre-resolved against `CustomerPersonProfile.company` and threaded
 * through the route's `ids` filter.
 *
 * Phase 3c of the same spec migrates `customers.get_person` to a single
 * in-process call to `GET /api/customers/people/<id>?include=...` (the
 * documented aggregate detail route). Tool name, schema, requiredFeatures,
 * and output shape are unchanged.
 */
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import {
  createAiApiOperationRunner,
  type AiApiOperationRequest,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerPersonProfile,
} from '../data/entities'
import { assertTenantScope, type CustomersAiToolDefinition, type CustomersToolContext } from './types'
import {
  buildRelatedRecords,
  buildScope,
  resolveEm,
  toCustomerListSummary,
  toIso,
  type CustomerRelatedRecords,
} from './_shared'

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

const listPeopleInput = z
  .object({
    q: z.string().trim().optional().describe('Optional search text matched against display name / email / phone. Omit or leave empty to list all.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum rows to return (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Number of rows to skip (default 0).'),
    tags: z.array(z.string().uuid()).optional().describe('Restrict to persons carrying at least one of these tag ids.'),
    companyId: z.string().uuid().optional().describe('Restrict to persons linked to the given company entity.'),
  })
  .passthrough()

type ListPeopleInput = z.infer<typeof listPeopleInput>

type ListPeopleApiItem = {
  id?: string
  display_name?: string | null
  displayName?: string | null
  primary_email?: string | null
  primaryEmail?: string | null
  primary_phone?: string | null
  primaryPhone?: string | null
  status?: string | null
  lifecycle_stage?: string | null
  lifecycleStage?: string | null
  source?: string | null
  owner_user_id?: string | null
  ownerUserId?: string | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListPeopleApiResponse = {
  items?: ListPeopleApiItem[]
  total?: number
}

type ListPeopleOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listPeopleTool = defineApiBackedAiTool<ListPeopleInput, ListPeopleApiResponse, ListPeopleOutput>({
  name: 'customers.list_people',
  displayName: 'List people',
  description:
    'Search / list people (CRM persons) for the caller tenant + organization. Returns { items, total, limit, offset }.',
  inputSchema: listPeopleInput,
  requiredFeatures: ['customers.people.view'],
  toOperation: async (input, ctx) => {
    const { tenantId } = assertTenantScope(ctx as unknown as CustomersToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1

    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
    }
    if (input.q?.trim()) query.search = input.q.trim()
    if (input.tags && input.tags.length > 0) query.tagIds = input.tags.join(',')

    if (input.companyId) {
      const em = resolveEm(ctx)
      const profiles = await findWithDecryption<CustomerPersonProfile>(
        em,
        CustomerPersonProfile,
        { tenantId, company: input.companyId } as never,
        undefined,
        buildScope(ctx, tenantId),
      )
      const ids = profiles
        .map((profile) => {
          const entity = (profile as { entity?: unknown }).entity
          if (!entity) return null
          if (typeof entity === 'string') return entity
          const candidate = (entity as { id?: unknown }).id
          return typeof candidate === 'string' ? candidate : null
        })
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      // Empty match — feed a non-existent uuid so the route returns
      // { items: [], total: 0 } without us bypassing the API.
      query.ids = ids.length ? ids.join(',') : NIL_UUID
    }

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/customers/people',
      query,
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListPeopleApiResponse
    const rawItems: ListPeopleApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => toCustomerListSummary(row)),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CustomersAiToolDefinition

const getPersonInput = z.object({
  personId: z.string().uuid().describe('Person entity id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe('When true, include notes, activities, deals, addresses, tasks, and tags (each capped at 100).'),
})

type GetPersonInput = z.infer<typeof getPersonInput>

type ApiPersonDetailRow = Record<string, unknown> | null | undefined

const getPersonTool: CustomersAiToolDefinition = {
  name: 'customers.get_person',
  displayName: 'Get person',
  description:
    'Fetch a person customer record by id with profile fields and (optionally) notes, activities, deals, addresses, tasks, tags, and custom fields. Returns { found: false } when the record is outside tenant/org scope or missing.',
  inputSchema: getPersonInput,
  requiredFeatures: ['customers.people.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: GetPersonInput = getPersonInput.parse(rawInput)
    const includeRelated = !!input.includeRelated

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: `/customers/people/${input.personId}`,
    }
    if (includeRelated) {
      operation.query = { include: 'addresses,comments,activities,interactions,deals,todos' }
    }

    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)
    const response = await runner.run<Record<string, unknown>>(operation)
    if (!response.success) {
      if (response.statusCode === 404 || response.statusCode === 403) {
        return { found: false as const, personId: input.personId }
      }
      throw new Error(response.error ?? `Failed to fetch person ${input.personId}`)
    }
    const data = (response.data ?? {}) as Record<string, unknown>
    const personRow = (data.person ?? null) as ApiPersonDetailRow
    if (!personRow) {
      return { found: false as const, personId: input.personId }
    }
    const profileRow = (data.profile ?? null) as ApiPersonDetailRow
    const customFields = (data.customFields ?? {}) as Record<string, unknown>

    let related: CustomerRelatedRecords | null = null
    if (includeRelated) {
      related = buildRelatedRecords(data)
    }

    return {
      found: true as const,
      person: {
        id: personRow.id,
        displayName: personRow.displayName ?? null,
        description: personRow.description ?? null,
        primaryEmail: personRow.primaryEmail ?? null,
        primaryPhone: personRow.primaryPhone ?? null,
        status: personRow.status ?? null,
        lifecycleStage: personRow.lifecycleStage ?? null,
        source: personRow.source ?? null,
        ownerUserId: personRow.ownerUserId ?? null,
        organizationId: personRow.organizationId ?? null,
        tenantId: personRow.tenantId ?? null,
        createdAt: toIso(personRow.createdAt),
        updatedAt: toIso(personRow.updatedAt),
      },
      profile: profileRow
        ? {
            id: profileRow.id,
            firstName: profileRow.firstName ?? null,
            lastName: profileRow.lastName ?? null,
            preferredName: profileRow.preferredName ?? null,
            jobTitle: profileRow.jobTitle ?? null,
            department: profileRow.department ?? null,
            seniority: profileRow.seniority ?? null,
            timezone: profileRow.timezone ?? null,
            linkedInUrl: profileRow.linkedInUrl ?? null,
            twitterUrl: profileRow.twitterUrl ?? null,
            companyEntityId: profileRow.companyEntityId ?? null,
          }
        : null,
      customFields,
      related,
    }
  },
}

export const peopleAiTools: CustomersAiToolDefinition[] = [listPeopleTool, getPersonTool]

export default peopleAiTools
