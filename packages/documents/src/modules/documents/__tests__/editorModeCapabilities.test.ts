import { canCreateSelectionComment, resolveEditorMode } from '../backend/documents/[id]/editorTypes'

describe('document editor mode capabilities', () => {
  it('forces preview when detail capability or refreshed collaboration token is read-only', () => {
    expect(resolveEditorMode(true, false, 'edit')).toBe('preview')
    expect(resolveEditorMode(false, true, 'edit')).toBe('preview')
  })

  it('preserves the requested mode while both projections remain writable', () => {
    expect(resolveEditorMode(false, false, 'edit')).toBe('edit')
    expect(resolveEditorMode(false, false, 'preview')).toBe('preview')
  })

  it('keeps selection comments for capability-read-only collaborators only', () => {
    expect(canCreateSelectionComment({
      permissionReadOnly: false,
      mode: 'edit',
      transport: 'collab',
      hasCommentHandler: true,
    })).toBe(true)
    expect(canCreateSelectionComment({
      permissionReadOnly: true,
      mode: 'preview',
      transport: 'collab',
      hasCommentHandler: true,
    })).toBe(true)
    expect(canCreateSelectionComment({
      permissionReadOnly: false,
      mode: 'preview',
      transport: 'collab',
      hasCommentHandler: true,
    })).toBe(false)
    expect(canCreateSelectionComment({
      permissionReadOnly: true,
      mode: 'preview',
      transport: 'fallback',
      hasCommentHandler: true,
    })).toBe(false)
    expect(canCreateSelectionComment({
      permissionReadOnly: true,
      mode: 'preview',
      transport: 'collab',
      hasCommentHandler: false,
    })).toBe(false)
  })
})
