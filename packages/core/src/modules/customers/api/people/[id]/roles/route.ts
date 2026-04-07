import { entityRolesMetadata, buildEntityRolesOpenApi, createEntityRolesHandlers } from '../../../../api/entity-roles-factory'

export const metadata = entityRolesMetadata
export const openApi = buildEntityRolesOpenApi('person')

const handlers = createEntityRolesHandlers('person')
export const GET = handlers.GET
export const POST = handlers.POST
export const PUT = handlers.PUT
export const DELETE = handlers.DELETE
