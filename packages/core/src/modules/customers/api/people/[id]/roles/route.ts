import { buildEntityRolesOpenApi, createEntityRolesHandlers } from '../../../../api/entity-roles-factory'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.roles.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.roles.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.roles.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.roles.manage'] },
}
export const openApi = buildEntityRolesOpenApi('person')

const handlers = createEntityRolesHandlers('person')
export const GET = handlers.GET
export const POST = handlers.POST
export const PUT = handlers.PUT
export const DELETE = handlers.DELETE
