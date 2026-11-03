import { HocuspocusProvider } from '@hocuspocus/provider'
import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  bindCollabAwarenessStates,
  type CollabContext,
} from '../../../../server/documents-collab-server'

const ROOM = 'awareness-wire-room'
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for awareness state')
    await delay(10)
  }
}

describe('documents collaboration awareness wire boundary', () => {
  it('keeps peers connected when providers echo foreign awareness', async () => {
    const canonicalAuthor = {
      id: 'author',
      name: 'Trusted Author',
      color: '#123456',
    }
    const server = new Server<CollabContext>({
      port: 0,
      address: '127.0.0.1',
      quiet: true,
      stopOnSignals: false,
      onAuthenticate: async ({ token }) => ({
        userId: token,
        tenantId: 'tenant',
        organizationId: 'organization',
        documentId: ROOM,
        tier: 'editor',
        readOnly: false,
        exp: null,
        awarenessUser: token === 'author'
          ? canonicalAuthor
          : { id: 'collaborator', name: 'Collaborator', color: '#654321' },
      }),
      beforeHandleAwareness: async (data) => {
        bindCollabAwarenessStates(data.context, data.states, {
          ownedClientIds: data.connection
            ? new Set(data.document.getClients(data.connection))
            : new Set(),
          occupiedClientIds: new Set(data.awareness.getStates().keys()),
        })
      },
    })

    let author: HocuspocusProvider | undefined
    let collaborator: HocuspocusProvider | undefined
    const authorDocument = new Y.Doc()
    const collaboratorDocument = new Y.Doc()
    let collaboratorStatus = ''
    let collaboratorCloses = 0

    try {
      await server.listen()

      const authorConnected = new Promise<void>((resolve) => {
        author = new HocuspocusProvider({
          url: server.webSocketURL,
          name: ROOM,
          document: authorDocument,
          token: 'author',
          onStatus: ({ status }) => {
            if (status === 'connected') resolve()
          },
        })
      })
      const collaboratorConnected = new Promise<void>((resolve) => {
        collaborator = new HocuspocusProvider({
          url: server.webSocketURL,
          name: ROOM,
          document: collaboratorDocument,
          token: 'collaborator',
          onStatus: ({ status }) => {
            collaboratorStatus = status
            if (status === 'connected') resolve()
          },
          onClose: () => { collaboratorCloses += 1 },
        })
      })

      await Promise.all([authorConnected, collaboratorConnected])

      const cursor = {
        anchor: { tname: 'default', assoc: 0 },
        head: { tname: 'default', assoc: 0 },
      }
      author.awareness?.setLocalState({
        user: {
          id: 'spoofed',
          name: 'Administrator',
          color: '#fff;background:url(https://invalid)',
        },
        cursor,
        arbitrary: { nested: 'must not be rebroadcast' },
      })

      await waitFor(() => collaborator?.awareness?.getStates()
        .get(authorDocument.clientID)?.cursor !== undefined)
      await delay(100)

      const remote = collaborator.awareness?.getStates().get(authorDocument.clientID)
      expect(collaboratorCloses).toBe(0)
      expect(collaboratorStatus).toBe('connected')
      expect(remote).toEqual({ user: canonicalAuthor, cursor })
      expect(JSON.stringify(remote)).not.toContain('Administrator')
      expect(JSON.stringify(remote)).not.toContain('background')
      expect(JSON.stringify(remote)).not.toContain('arbitrary')
    } finally {
      author?.destroy()
      collaborator?.destroy()
      authorDocument.destroy()
      collaboratorDocument.destroy()
      await server.destroy()
    }
  }, 10_000)
})
