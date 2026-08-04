/** @jest-environment node */
/**
 * The live call site of the `example.todo-preview-fields` generator plugin.
 *
 * `message-objects.ts` server-side-imports `lib/messageObjectPreviews.ts`, which is the
 * only consumer of the registry the generated `runBootstrapRegistrations()` populates.
 * If this stops reading the registry the plugin becomes a declared host with no live
 * call site, so these tests exercise the loader itself rather than the registry helper.
 */
import { loadTodoPreview } from '../lib/messageObjectPreviews'
import {
  clearTodoPreviewFieldEntries,
  registerTodoPreviewFieldEntries,
} from '../lib/todoPreviewFields'
import { todoPreviewFields } from '../example-todo-preview-fields'

const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: () => ({}) })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ t: (key: string) => key })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

const TENANT = '00000000-0000-4000-8000-00000000000a'
const DONE_LABEL = 'example.todos.form.fields.isDone.label'
const ORGANIZATION_LABEL = 'example.todos.table.column.organization'

beforeEach(() => {
  findOneWithDecryptionMock.mockReset()
  findOneWithDecryptionMock.mockResolvedValue({
    id: 'todo-1',
    title: 'Ship the plugin',
    isDone: false,
    organizationId: 'org-a1',
  })
  clearTodoPreviewFieldEntries()
})

afterEach(() => {
  clearTodoPreviewFieldEntries()
})

describe('todo message-object preview', () => {
  it('shows only the built-in row when no module contributed', async () => {
    const preview = await loadTodoPreview('todo-1', { tenantId: TENANT })

    expect(preview.title).toBe('Ship the plugin')
    expect(preview.metadata).toEqual({ [DONE_LABEL]: 'common.no' })
  })

  it('adds the rows registered through the generator plugin', async () => {
    registerTodoPreviewFieldEntries([{ moduleId: 'example', fields: todoPreviewFields }])

    const preview = await loadTodoPreview('todo-1', { tenantId: TENANT })

    expect(preview.metadata).toEqual({
      [DONE_LABEL]: 'common.no',
      [ORGANIZATION_LABEL]: 'org-a1',
    })
  })

  it('lets the built-in row win when a contribution claims the same label', async () => {
    registerTodoPreviewFieldEntries([
      {
        moduleId: 'hostile',
        fields: [{ id: 'hostile.done', labelKey: DONE_LABEL, render: () => 'HIJACKED' }],
      },
    ])

    const preview = await loadTodoPreview('todo-1', { tenantId: TENANT })

    expect(preview.metadata).toEqual({ [DONE_LABEL]: 'common.no' })
  })

  it('does not consult the registry for a todo that does not resolve', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const render = jest.fn(() => 'never')
    registerTodoPreviewFieldEntries([
      { moduleId: 'other', fields: [{ id: 'other.row', labelKey: 'other.row', render }] },
    ])

    const preview = await loadTodoPreview('missing', { tenantId: TENANT })

    expect(preview.status).toBe('example.messageObjects.notFound')
    expect(preview.metadata).toBeUndefined()
    expect(render).not.toHaveBeenCalled()
  })
})
