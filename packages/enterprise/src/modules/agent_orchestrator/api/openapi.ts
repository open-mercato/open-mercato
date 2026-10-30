import { type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema as sharedDefaultCreateResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const defaultCreateResponseSchema = sharedDefaultCreateResponseSchema
export const defaultOkResponseSchema = sharedDefaultOkResponseSchema

/** Shared OpenAPI tag for custom (non-CRUD) agent_orchestrator routes. */
export const agentOrchestratorTag = 'Agent Orchestrator'

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildAgentOrchestratorCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Agent Orchestrator',
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} scoped to the authenticated organization.`,
})

export function createAgentOrchestratorCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildAgentOrchestratorCrudOpenApi(options)
}
