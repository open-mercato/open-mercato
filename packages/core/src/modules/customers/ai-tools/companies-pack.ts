/**
 * `customers.list_companies` + `customers.get_company` (Phase 1 WS-C, Step 3.9).
 *
 * Phase 3a of `.ai/specs/implemented/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
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
import {
  buildRelatedRecords,
  toCustomerListSummary,
  toIso,
  type CustomerRelatedRecords,
} from './_shared'

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
      items: rawItems.map((row) => ({
        ...toCustomerListSummary(row),
        domain: row.domain ?? null,
        websiteUrl: row.website_url ?? row.websiteUrl ?? null,
        industry: row.industry ?? null,
        sizeBucket: row.size_bucket ?? row.sizeBucket ?? null,
      })),
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

    let related: CustomerRelatedRecords | null = null
    if (includeRelated) {
      related = buildRelatedRecords(data, { includePeople: true })
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
        createdAt: toIso(companyRow.createdAt),
        updatedAt: toIso(companyRow.updatedAt),
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
