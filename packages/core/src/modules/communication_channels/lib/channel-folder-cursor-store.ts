import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import { channelFolderCursorAdvanceSchema, channelFolderCursorKeySchema } from '../data/validators'

type ChannelFolderCursorKey = z.infer<typeof channelFolderCursorKeySchema>

type ChannelFolderCursorCheckpoint = {
  cursor: string
  version: string
}

export interface ChannelFolderCursorStore {
  read(key: ChannelFolderCursorKey): Promise<ChannelFolderCursorCheckpoint | null>
  advance(key: ChannelFolderCursorKey, expectedVersion: string | null, cursor: string): Promise<boolean>
}

const channelScopeCondition = `
  channel.id = ?
  and channel.tenant_id = ?
  and channel.organization_id is not distinct from ?
  and channel.deleted_at is null
  and channel.status <> 'disconnected'
`

export function createChannelFolderCursorStore(em: Pick<EntityManager, 'execute'>): ChannelFolderCursorStore {
  return {
    async read(rawKey) {
      const { channelId, tenantId, organizationId, folderId } = channelFolderCursorKeySchema.parse(rawKey)
      const [checkpoint] = await em.execute<ChannelFolderCursorCheckpoint[]>(`
        select checkpoint.cursor, checkpoint.version
        from communication_channel_folder_cursors as checkpoint
        join communication_channels as channel on channel.id = checkpoint.channel_id
        where ${channelScopeCondition}
          and checkpoint.folder_id = ?
      `, [channelId, tenantId, organizationId, folderId])
      return checkpoint ?? null
    },

    async advance(rawKey, rawExpectedVersion, rawCursor) {
      const { channelId, tenantId, organizationId, folderId } = channelFolderCursorKeySchema.parse(rawKey)
      const { expectedVersion, cursor } = channelFolderCursorAdvanceSchema.parse({
        expectedVersion: rawExpectedVersion,
        cursor: rawCursor,
      })
      const scope = [channelId, tenantId, organizationId]

      const written = expectedVersion === null
        ? await em.execute<[{ version: string }] | []>(`
            insert into communication_channel_folder_cursors (channel_id, folder_id, cursor)
            select channel.id, ?, ?
            from communication_channels as channel
            where ${channelScopeCondition}
            on conflict (channel_id, folder_id) do nothing
            returning version
          `, [folderId, cursor, ...scope])
        : await em.execute<[{ version: string }] | []>(`
            update communication_channel_folder_cursors as checkpoint
            set cursor = ?, version = gen_random_uuid(), updated_at = now()
            from communication_channels as channel
            where ${channelScopeCondition}
              and checkpoint.channel_id = channel.id
              and checkpoint.folder_id = ?
              and checkpoint.version = ?
            returning checkpoint.version
          `, [cursor, ...scope, folderId, expectedVersion])

      return written.length > 0
    },
  }
}
