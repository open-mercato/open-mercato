import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'

export { createPagedListResponseSchema }

export const buildReferenceCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Reference module',
  makeListDescription: ({ pluralLower }) => `Returns ${pluralLower} in the authenticated tenant and organization scope.`,
})
