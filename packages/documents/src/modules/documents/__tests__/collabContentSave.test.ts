import { EventEmitter } from 'node:events'
import * as Y from 'yjs'
import type { CollabResources } from '../backend/documents/[id]/editorTypes'
import { saveCollaborativeContent } from '../backend/documents/[id]/saveCollaborativeContent'
import { containsDocumentSnapshot, COLLAB_CONTENT_SAVE_TIMEOUT_MS } from '../lib/collabPersistence'

function providerFixture() {
  const provider = Object.assign(new EventEmitter(), {
    synced: true,
    configuration: { websocketProvider: { status: 'connected' } },
    sendStateless: jest.fn(),
  })
  const resources = { provider } as unknown as CollabResources
  return { provider, resources }
}

describe('collaboration durable content acknowledgement', () => {
  afterEach(() => jest.useRealTimers())

  it('waits for the correlated durable response rather than socket synchronization', async () => {
    const { provider, resources } = providerFixture()
    const saving = saveCollaborativeContent(resources, new AbortController().signal)
    const request = JSON.parse(provider.sendStateless.mock.calls[0][0]) as { requestId: string }
    provider.emit('stateless', { payload: 'invalid json' })
    provider.emit('stateless', { payload: JSON.stringify({ type: 'documents.content.saved', requestId: crypto.randomUUID(), saved: true }) })
    expect(provider.listenerCount('stateless')).toBe(1)
    provider.emit('stateless', { payload: JSON.stringify({ ...request, type: 'documents.content.saved', saved: true }) })
    await expect(saving).resolves.toBe(true)
    expect(provider.listenerCount('stateless')).toBe(0)
    expect(provider.listenerCount('disconnect')).toBe(0)
  })

  it.each(['close', 'disconnect', 'destroy', 'abort', 'timeout', 'rejected'])('fails closed on %s and removes its listeners', async (event) => {
    jest.useFakeTimers()
    const { provider, resources } = providerFixture()
    const controller = new AbortController()
    const saving = saveCollaborativeContent(resources, controller.signal)
    if (event === 'timeout') jest.advanceTimersByTime(COLLAB_CONTENT_SAVE_TIMEOUT_MS)
    else if (event === 'abort') controller.abort()
    else if (event === 'rejected') {
      const request = JSON.parse(provider.sendStateless.mock.calls[0][0]) as { requestId: string }
      provider.emit('stateless', { payload: JSON.stringify({ ...request, type: 'documents.content.saved', saved: false }) })
    } else provider.emit(event)
    await expect(saving).resolves.toBe(false)
    expect(provider.listenerCount('stateless')).toBe(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('rejects a disconnected or unsynchronized editor before sending a request', async () => {
    const { provider, resources } = providerFixture()
    provider.synced = false
    await expect(saveCollaborativeContent(resources, new AbortController().signal)).resolves.toBe(false)
    provider.synced = true
    provider.configuration.websocketProvider.status = 'disconnected'
    await expect(saveCollaborativeContent(resources, new AbortController().signal)).resolves.toBe(false)
    expect(provider.sendStateless).not.toHaveBeenCalled()
  })
})

describe('durable Yjs snapshot containment', () => {
  it('requires inserts and deletions, while accepting a superset with concurrent collaborator edits', () => {
    const editor = new Y.Doc()
    const durable = new Y.Doc()
    try {
      editor.getText('body').insert(0, 'Earlier content')
      Y.applyUpdate(durable, Y.encodeStateAsUpdate(editor))
      editor.getText('body').delete(0, 8)
      const requested = Y.snapshot(editor)
      expect(containsDocumentSnapshot(Y.snapshot(durable), requested)).toBe(false)
      Y.applyUpdate(durable, Y.encodeStateAsUpdate(editor))
      durable.getText('body').insert(0, 'Collaborator ')
      expect(containsDocumentSnapshot(Y.snapshot(durable), requested)).toBe(true)
      editor.getText('body').insert(0, 'Pending ')
      expect(containsDocumentSnapshot(Y.snapshot(durable), Y.snapshot(editor))).toBe(false)
    } finally {
      editor.destroy()
      durable.destroy()
    }
  })
})
