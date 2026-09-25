import { type ZodTypeAny } from 'zod'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const createPagedListResponseSchema = (itemSchema: ZodTypeAny) =>
  createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })

const buildCrudOpenApi = createCrudOpenApiFactory({ defaultTag: 'Transport Operations' })

export function createTransportCrudOpenApi(options: CrudOpenApiOptions) {
  return buildCrudOpenApi(options)
}

export { defaultCreateResponseSchema, defaultOkResponseSchema }
