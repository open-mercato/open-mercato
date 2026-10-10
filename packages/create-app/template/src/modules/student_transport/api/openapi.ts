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

const buildCrudOpenApi = createCrudOpenApiFactory({ defaultTag: 'Student Transport' })

export function createStudentCrudOpenApi(options: CrudOpenApiOptions) {
  return buildCrudOpenApi(options)
}

export { defaultCreateResponseSchema, defaultOkResponseSchema }
