import { makeActivityRoute } from '@open-mercato/core/modules/entities/lib/makeActivityRoute'
import { ResourcesResourceActivity } from '../data/entities'
import {
  resourcesResourceActivityCreateSchema,
  resourcesResourceActivityUpdateSchema,
} from '../data/validators'
import { E } from '#generated/entities.ids.generated'
import { createResourcesCrudOpenApi } from './openapi'

const route = makeActivityRoute({
  entity: ResourcesResourceActivity,
  entityId: E.resources.resources_resource_activity,
  parentFkColumn: 'resource_id',
  parentFkParam: 'resourceId',
  features: { view: 'resources.view', manage: 'resources.manage_resources' },
  createSchema: resourcesResourceActivityCreateSchema,
  updateSchema: resourcesResourceActivityUpdateSchema,
  commandPrefix: 'resources.resource-activities',
  logPrefix: '[resources.activities]',
  openApiFactory: createResourcesCrudOpenApi,
  openApi: {
    resourceName: 'ResourceActivity',
    createDescription: 'Adds an activity to a resource timeline.',
    updateDescription: 'Updates a resource activity.',
    deleteDescription: 'Deletes a resource activity.',
  },
})

export const metadata = route.metadata
export const openApi = route.openApi
export const GET = route.GET
export const POST = route.POST
export const PUT = route.PUT
export const DELETE = route.DELETE
