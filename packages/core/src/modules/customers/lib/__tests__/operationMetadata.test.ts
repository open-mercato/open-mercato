/** @jest-environment node */
import { NextResponse } from 'next/server'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { withOperationMetadata } from '../operationMetadata'

function makeResponse(): NextResponse {
  return NextResponse.json({ ok: true })
}

describe('withOperationMetadata', () => {
  it('sets x-om-operation header when the log entry is complete', () => {
    const res = withOperationMetadata(
      makeResponse(),
      {
        id: 'log-1',
        undoToken: 'tok-1',
        commandId: 'customers.interactions.complete',
        actionLabel: 'Complete interaction',
        resourceKind: 'customers.interaction',
        resourceId: 'int-1',
        createdAt: new Date('2026-04-23T20:00:00Z'),
      },
      { resourceKind: 'customers.interaction', resourceId: 'int-1' },
    )

    const raw = res.headers.get('x-om-operation')
    expect(raw).toBeTruthy()
    const parsed = deserializeOperationMetadata(raw)
    expect(parsed).toMatchObject({
      id: 'log-1',
      undoToken: 'tok-1',
      commandId: 'customers.interactions.complete',
      resourceKind: 'customers.interaction',
      resourceId: 'int-1',
      executedAt: '2026-04-23T20:00:00.000Z',
    })
  })

  it('falls back to the provided fallback resource when the log entry omits it', () => {
    const res = withOperationMetadata(
      makeResponse(),
      {
        id: 'log-2',
        undoToken: 'tok-2',
        commandId: 'customers.interactions.cancel',
        actionLabel: null,
        resourceKind: null,
        resourceId: null,
        createdAt: null,
      },
      { resourceKind: 'customers.interaction', resourceId: 'int-42' },
    )
    const parsed = deserializeOperationMetadata(res.headers.get('x-om-operation'))
    expect(parsed?.resourceKind).toBe('customers.interaction')
    expect(parsed?.resourceId).toBe('int-42')
    expect(parsed?.executedAt).toBeTruthy()
  })

  it('is a no-op when logEntry lacks undoToken', () => {
    const res = withOperationMetadata(
      makeResponse(),
      { id: 'log-3', undoToken: null, commandId: 'customers.interactions.cancel' },
      { resourceKind: 'customers.interaction', resourceId: 'int-3' },
    )
    expect(res.headers.get('x-om-operation')).toBeNull()
  })

  it('is a no-op when logEntry is null (skipLog path)', () => {
    const res = withOperationMetadata(
      makeResponse(),
      null,
      { resourceKind: 'customers.interaction', resourceId: 'int-4' },
    )
    expect(res.headers.get('x-om-operation')).toBeNull()
  })
})
