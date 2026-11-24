import type { MessageObjectTypeDefinition } from '@open-mercato/shared/modules/messages/types'
import clientMessageObjectTypes from './message-objects.client'

type PreviewLoader = NonNullable<MessageObjectTypeDefinition['loadPreview']>

const previewLoaders: Record<string, PreviewLoader | undefined> = {
  leave_request: async (entityId, ctx) => {
    const { loadLeaveRequestPreview } = await import('./lib/messageObjectPreviews')
    return loadLeaveRequestPreview(entityId, ctx)
  },
  team: async (entityId, ctx) => {
    const { loadTeamPreview } = await import('./lib/messageObjectPreviews')
    return loadTeamPreview(entityId, ctx)
  },
  team_member: async (entityId, ctx) => {
    const { loadTeamMemberPreview } = await import('./lib/messageObjectPreviews')
    return loadTeamMemberPreview(entityId, ctx)
  },
  team_role: async (entityId, ctx) => {
    const { loadStaffTeamRolePreview } = await import('./lib/messageObjectPreviews')
    return loadStaffTeamRolePreview(entityId, ctx)
  },
  my_availability: async (entityId, ctx) => {
    const { loadStaffAvailabilityPreview } = await import('./lib/messageObjectPreviews')
    return loadStaffAvailabilityPreview(entityId, ctx)
  },
}

export const messageObjectTypes: MessageObjectTypeDefinition[] = clientMessageObjectTypes.map((type) => {
  const loadServerPreview = previewLoaders[type.entityType]
  if (!loadServerPreview) return type
  return {
    ...type,
    loadPreview: (entityId, ctx) => {
      if (typeof window !== 'undefined' && type.loadPreview) return type.loadPreview(entityId, ctx)
      return loadServerPreview(entityId, ctx)
    },
  }
})

export default messageObjectTypes
