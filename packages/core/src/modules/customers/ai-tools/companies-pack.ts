/**
 * `customers.list_companies` + `customers.get_company` (Phase 1 WS-C, Step 3.9).
 *
 * Phase 3a of `.ai/specs/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
 * `customers.list_companies` is now an API-backed wrapper over
 * `GET /api/customers/companies`. Tool name, schema, requiredFeatures, and
 * output shape are unchanged.
 *
 * Phase 3c of the same spec migrates `customers.get_company` to a single
 * in-process call to `GET /api/customers/companies/<id>?include=...` over the
 * documented aggregate detail route. Tool name, schema, requiredFeatures, and
 * output shape are unchanged.
 */
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import {
  createAiApiOperationRunner,
  type AiApiOperationRequest,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { assertTenantScope, type CustomersAiToolDefinition, type CustomersToolContext } from './types'

const listCompaniesInput = z
  .object({
    q: z.string().trim().optional().describe('Search text matched against display name / email / domain. Omit or leave empty to list all.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum rows to return (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Number of rows to skip (default 0).'),
    tags: z.array(z.string().uuid()).optional().describe('Restrict to companies carrying at least one of these tag ids.'),
  })
  .passthrough()

type ListCompaniesInput = z.infer<typeof listCompaniesInput>

type ListCompaniesApiItem = {
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
  domain?: string | null
  website_url?: string | null
  websiteUrl?: string | null
  industry?: string | null
  size_bucket?: string | null
  sizeBucket?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListCompaniesApiResponse = {
  items?: ListCompaniesApiItem[]
  total?: number
}

type ListCompaniesOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listCompaniesTool = defineApiBackedAiTool<
  ListCompaniesInput,
  ListCompaniesApiResponse,
  ListCompaniesOutput
>({
  name: 'customers.list_companies',
  displayName: 'List companies',
  description:
    'Search / list companies for the caller tenant + organization. Returns { items, total, limit, offset }.',
  inputSchema: listCompaniesInput,
  requiredFeatures: ['customers.companies.view'],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx as unknown as CustomersToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1

    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
    }
    if (input.q?.trim()) query.search = input.q.trim()
    if (input.tags && input.tags.length > 0) query.tagIds = input.tags.join(',')

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/customers/companies',
      query,
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListCompaniesApiResponse
    const rawItems: ListCompaniesApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => {
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        return {
          id: row.id,
          displayName: row.display_name ?? row.displayName ?? null,
          primaryEmail: row.primary_email ?? row.primaryEmail ?? null,
          primaryPhone: row.primary_phone ?? row.primaryPhone ?? null,
          status: row.status ?? null,
          lifecycleStage: row.lifecycle_stage ?? row.lifecycleStage ?? null,
          source: row.source ?? null,
          ownerUserId: row.owner_user_id ?? row.ownerUserId ?? null,
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          domain: row.domain ?? null,
          websiteUrl: row.website_url ?? row.websiteUrl ?? null,
          industry: row.industry ?? null,
          sizeBucket: row.size_bucket ?? row.sizeBucket ?? null,
          createdAt,
        }
      }),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CustomersAiToolDefinition

const getCompanyInput = z.object({
  companyId: z.string().uuid().describe('Company entity id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe('When true, include notes, activities, deals, people, addresses, tasks, and tags (each capped at 100).'),
})

type GetCompanyInput = z.infer<typeof getCompanyInput>

function toIsoCompany(value: unknown): string | null {
  if (!value) return null
  const dt = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

const getCompanyTool: CustomersAiToolDefinition = {
  name: 'customers.get_company',
  displayName: 'Get company',
  description:
    'Fetch a company customer record by id with profile fields and (optionally) notes, activities, deals, people, addresses, tasks, tags, and custom fields. Returns { found: false } when outside tenant/org scope.',
  inputSchema: getCompanyInput,
  requiredFeatures: ['customers.companies.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId: _tenantId } = assertTenantScope(ctx)
    void _tenantId
    const input: GetCompanyInput = getCompanyInput.parse(rawInput)
    const includeRelated = !!input.includeRelated

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: `/customers/companies/${input.companyId}`,
    }
    if (includeRelated) {
      operation.query = {
        include: 'addresses,comments,activities,interactions,deals,todos,people',
      }
    }

    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)
    const response = await runner.run<Record<string, unknown>>(operation)
    if (!response.success) {
      if (response.statusCode === 404 || response.statusCode === 403) {
        return { found: false as const, companyId: input.companyId }
      }
      throw new Error(response.error ?? `Failed to fetch company ${input.companyId}`)
    }
    const data = (response.data ?? {}) as Record<string, unknown>
    const companyRow = (data.company ?? null) as Record<string, unknown> | null
    if (!companyRow) {
      return { found: false as const, companyId: input.companyId }
    }
    const profileRow = (data.profile ?? null) as Record<string, unknown> | null
    const customFields = (data.customFields ?? {}) as Record<string, unknown>

    let related: Record<string, unknown> | null = null
    if (includeRelated) {
      const addresses = Array.isArray(data.addresses) ? (data.addresses as Array<Record<string, unknown>>) : []
      const activities = Array.isArray(data.activities) ? (data.activities as Array<Record<string, unknown>>) : []
      const notes = Array.isArray(data.comments) ? (data.comments as Array<Record<string, unknown>>) : []
      const todos = Array.isArray(data.todos) ? (data.todos as Array<Record<string, unknown>>) : []
      const interactions = Array.isArray(data.interactions) ? (data.interactions as Array<Record<string, unknown>>) : []
      const tagsRows = Array.isArray(data.tags) ? (data.tags as Array<Record<string, unknown>>) : []
      const dealsRows = Array.isArray(data.deals) ? (data.deals as Array<Record<string, unknown>>) : []
      const peopleRows = Array.isArray(data.people) ? (data.people as Array<Record<string, unknown>>) : []
      related = {
        addresses: addresses.map((address) => ({
          id: address.id,
          name: address.name ?? null,
          purpose: address.purpose ?? null,
          addressLine1: address.addressLine1 ?? null,
          addressLine2: address.addressLine2 ?? null,
          city: address.city ?? null,
          region: address.region ?? null,
          postalCode: address.postalCode ?? null,
          country: address.country ?? null,
          isPrimary: !!address.isPrimary,
        })),
        activities: activities.map((activity) => ({
          id: activity.id,
          activityType: activity.activityType,
          subject: activity.subject ?? null,
          body: activity.body ?? null,
          occurredAt: toIsoCompany(activity.occurredAt),
          createdAt: toIsoCompany(activity.createdAt),
        })),
        notes: notes.map((comment) => ({
          id: comment.id,
          body: comment.body,
          authorUserId: comment.authorUserId ?? null,
          createdAt: toIsoCompany(comment.createdAt),
        })),
        tasks: todos.map((task) => ({
          id: task.id,
          todoId: task.todoId ?? task.id,
          todoSource: task.todoSource ?? null,
          createdAt: toIsoCompany(task.createdAt),
        })),
        interactions: interactions.map((interaction) => ({
          id: interaction.id,
          interactionType: interaction.interactionType,
          title: interaction.title ?? null,
          status: interaction.status,
          scheduledAt: toIsoCompany(interaction.scheduledAt),
          occurredAt: toIsoCompany(interaction.occurredAt),
        })),
        tags: tagsRows
          .map((tag) => {
            if (!tag || typeof tag !== 'object') return null
            const id = typeof tag.id === 'string' ? tag.id : null
            const label = typeof tag.label === 'string' ? tag.label : null
            if (!id || !label) return null
            const slug = typeof tag.slug === 'string' ? tag.slug : label
            const color = typeof tag.color === 'string' ? tag.color : null
            return { id, slug, label, color }
          })
          .filter(
            (entry): entry is { id: string; slug: string; label: string; color: string | null } =>
              entry !== null,
          ),
        deals: dealsRows
          .map((deal) => {
            if (!deal || typeof deal !== 'object') return null
            const id = typeof deal.id === 'string' ? deal.id : null
            if (!id) return null
            return {
              id,
              title: typeof deal.title === 'string' ? deal.title : '',
              status: typeof deal.status === 'string' ? deal.status : null,
              pipelineStageId:
                typeof deal.pipelineStageId === 'string' ? deal.pipelineStageId : null,
              valueAmount:
                typeof deal.valueAmount === 'string'
                  ? deal.valueAmount
                  : deal.valueAmount === null || deal.valueAmount === undefined
                    ? null
                    : String(deal.valueAmount),
              valueCurrency:
                typeof deal.valueCurrency === 'string' ? deal.valueCurrency : null,
            }
          })
          .filter(
            (
              value,
            ): value is {
              id: string
              title: string
              status: string | null
              pipelineStageId: string | null
              valueAmount: string | null
              valueCurrency: string | null
            } => value !== null,
          ),
        people: peopleRows
          .map((person) => {
            if (!person || typeof person !== 'object') return null
            const id = typeof person.id === 'string' ? person.id : null
            const displayName = typeof person.displayName === 'string' ? person.displayName : null
            if (!id || !displayName) return null
            return {
              id,
              displayName,
              primaryEmail:
                typeof person.primaryEmail === 'string' ? person.primaryEmail : null,
              primaryPhone:
                typeof person.primaryPhone === 'string' ? person.primaryPhone : null,
              jobTitle: typeof person.jobTitle === 'string' ? person.jobTitle : null,
              department: typeof person.department === 'string' ? person.department : null,
            }
          })
          .filter(
            (
              value,
            ): value is {
              id: string
              displayName: string
              primaryEmail: string | null
              primaryPhone: string | null
              jobTitle: string | null
              department: string | null
            } => value !== null,
          ),
      }
    }
    return {
      found: true as const,
      company: {
        id: companyRow.id,
        displayName: companyRow.displayName ?? null,
        description: companyRow.description ?? null,
        primaryEmail: companyRow.primaryEmail ?? null,
        primaryPhone: companyRow.primaryPhone ?? null,
        status: companyRow.status ?? null,
        lifecycleStage: companyRow.lifecycleStage ?? null,
        source: companyRow.source ?? null,
        ownerUserId: companyRow.ownerUserId ?? null,
        organizationId: companyRow.organizationId ?? null,
        tenantId: companyRow.tenantId ?? null,
        createdAt: toIsoCompany(companyRow.createdAt),
        updatedAt: toIsoCompany(companyRow.updatedAt),
      },
      profile: profileRow
        ? {
            id: profileRow.id,
            legalName: profileRow.legalName ?? null,
            brandName: profileRow.brandName ?? null,
            domain: profileRow.domain ?? null,
            websiteUrl: profileRow.websiteUrl ?? null,
            industry: profileRow.industry ?? null,
            sizeBucket: profileRow.sizeBucket ?? null,
            annualRevenue: profileRow.annualRevenue ?? null,
          }
        : null,
      customFields,
      related,
    }
  },
}

export const companiesAiTools: CustomersAiToolDefinition[] = [listCompaniesTool, getCompanyTool]

export default companiesAiTools
