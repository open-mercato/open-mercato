import { randomUUID } from 'node:crypto'
import { createChannelFolderCursorStore } from '../channel-folder-cursor-store'

describe('channel folder cursor store input', () => {
  const key = {
    channelId: randomUUID(),
    tenantId: randomUUID(),
    organizationId: null,
    folderId: 'Projects',
  }

  it.each(['', 'x'.repeat(513), 'folder\0name'])('rejects an invalid folder ID before executing SQL', async (folderId) => {
    const execute = jest.fn()
    const store = createChannelFolderCursorStore({ execute })

    await expect(store.read({ ...key, folderId })).rejects.toMatchObject({ name: 'ZodError' })
    await expect(store.advance({ ...key, folderId }, null, 'next')).rejects.toMatchObject({ name: 'ZodError' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects invalid scope, versions, and cursor strings before executing SQL', async () => {
    const execute = jest.fn()
    const store = createChannelFolderCursorStore({ execute })

    await expect(store.read({ ...key, organizationId: '' })).rejects.toMatchObject({ name: 'ZodError' })
    await expect(store.advance(key, 'invalid-version', 'next')).rejects.toMatchObject({ name: 'ZodError' })
    await expect(store.advance(key, null, 'x'.repeat(16385))).rejects.toMatchObject({ name: 'ZodError' })
    await expect(store.advance(key, null, 'cursor\0value')).rejects.toMatchObject({ name: 'ZodError' })
    expect(execute).not.toHaveBeenCalled()
  })
})
