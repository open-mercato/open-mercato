import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { attachOperationMetadataHeader } from '../operationMetadata'

const FALLBACK = { resourceKind: 'device', resourceId: 'dev-1' }

function makeLogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    undoToken: 'undo-abc',
    commandId: 'devices.register',
    actionLabel: 'Register device',
    resourceKind: 'user_device',
    resourceId: 'dev-99',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    ...overrides,
  }
}

describe('attachOperationMetadataHeader', () => {
  it('attaches a deserializable x-om-operation header for an undoable entry', () => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, makeLogEntry(), FALLBACK)
    const header = response.headers.get('x-om-operation')
    expect(header).toBeTruthy()
    const parsed = deserializeOperationMetadata(header)
    expect(parsed).toMatchObject({
      id: 'log-1',
      undoToken: 'undo-abc',
      commandId: 'devices.register',
      actionLabel: 'Register device',
      resourceKind: 'user_device',
      resourceId: 'dev-99',
      executedAt: '2026-01-02T03:04:05.000Z',
    })
  })

  it('falls back to the provided resource kind/id when the entry omits them', () => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, makeLogEntry({ resourceKind: null, resourceId: null }), FALLBACK)
    const parsed = deserializeOperationMetadata(response.headers.get('x-om-operation'))
    expect(parsed?.resourceKind).toBe('device')
    expect(parsed?.resourceId).toBe('dev-1')
  })

  it('is a no-op when the entry is null', () => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, null, FALLBACK)
    expect(response.headers.get('x-om-operation')).toBeNull()
  })

  it('is a no-op when the entry has no undo token', () => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, makeLogEntry({ undoToken: null }), FALLBACK)
    expect(response.headers.get('x-om-operation')).toBeNull()
  })

  it('is a no-op when the entry lacks a command id', () => {
    const response = new Response(null)
    attachOperationMetadataHeader(response, makeLogEntry({ commandId: null }), FALLBACK)
    expect(response.headers.get('x-om-operation')).toBeNull()
  })
})
