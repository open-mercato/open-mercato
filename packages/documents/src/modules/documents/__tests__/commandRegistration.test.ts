import { commandRegistry, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { LinkCreateCommandInput } from '../commands/links'
import '../commands'

describe('documents command registration', () => {
  it.each([
    'documents.link.create',
    'documents.link.delete',
    'documents.document.create',
    'documents.document.update',
    'documents.document.delete',
    'documents.document.instantiate',
    'documents.folder.create',
    'documents.folder.update',
    'documents.folder.delete',
    'documents.share.create',
    'documents.share.update',
    'documents.share.delete',
    'documents.comment.create',
    'documents.comment.resolve',
    'documents.content.replace',
    'documents.template.create',
    'documents.template.update',
    'documents.template.delete',
    'documents.version.create',
    'documents.version.restore',
  ])('registers %s', (commandId) => {
    expect(commandRegistry.has(commandId)).toBe(true)
  })

  it('does not create an audit or undo entry for an idempotent link-create replay', async () => {
    const handler = commandRegistry.get<
      LinkCreateCommandInput,
      { id: string; created: boolean; updatedAt: string }
    >('documents.link.create')

    const metadata = await handler?.buildLog?.({
      input: {} as LinkCreateCommandInput,
      result: {
        id: '90f6850b-065f-4f1f-bbb7-c41cdfbf4f5c',
        created: false,
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
      ctx: {} as CommandRuntimeContext,
      snapshots: {},
    })

    expect(metadata).toEqual({ skipLog: true })
  })
})
