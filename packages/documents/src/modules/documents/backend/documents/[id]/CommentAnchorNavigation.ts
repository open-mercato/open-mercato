import type { Editor } from '@tiptap/core'
// Keep this aligned with @tiptap/extension-collaboration. The similarly named
// y-prosemirror plugin key is a different instance and cannot read its binding.
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
  type ProsemirrorBinding,
} from '@tiptap/y-tiptap'
import * as Y from 'yjs'

export type LegacyCommentAnchor = { from: number; to: number }
export type RelativeCommentAnchor = { version: 2; relativeFrom: string; relativeTo: string }
export type CommentAnchor = LegacyCommentAnchor | RelativeCommentAnchor

type YSyncState = { binding?: ProsemirrorBinding | null }

function encodeBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = window.atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function readBinding(editor: Editor): ProsemirrorBinding | null {
  const pluginState = ySyncPluginKey.getState(editor.state) as YSyncState | undefined
  return pluginState?.binding ?? null
}

function validRange(editor: Editor, from: number, to: number): boolean {
  const docSize = editor.state.doc.content.size
  return from >= 0 && to >= 0 && from < to && from <= docSize && to <= docSize
}

export function captureCommentAnchor(editor: Editor): CommentAnchor | null {
  const { from, to } = editor.state.selection
  if (!validRange(editor, from, to)) return null
  const binding = readBinding(editor)
  if (!binding) return { from, to }
  const relativeFrom = absolutePositionToRelativePosition(from, binding.type, binding.mapping)
  const relativeTo = absolutePositionToRelativePosition(to, binding.type, binding.mapping)
  return {
    version: 2,
    relativeFrom: encodeBase64(Y.encodeRelativePosition(relativeFrom)),
    relativeTo: encodeBase64(Y.encodeRelativePosition(relativeTo)),
  }
}

export function resolveCommentAnchor(editor: Editor, anchor: CommentAnchor): LegacyCommentAnchor | null {
  if (!('version' in anchor)) return validRange(editor, anchor.from, anchor.to) ? anchor : null
  const binding = readBinding(editor)
  const encodedFrom = decodeBase64(anchor.relativeFrom)
  const encodedTo = decodeBase64(anchor.relativeTo)
  if (!binding || !encodedFrom || !encodedTo) return null
  try {
    const from = relativePositionToAbsolutePosition(
      binding.doc,
      binding.type,
      Y.decodeRelativePosition(encodedFrom),
      binding.mapping,
    )
    const to = relativePositionToAbsolutePosition(
      binding.doc,
      binding.type,
      Y.decodeRelativePosition(encodedTo),
      binding.mapping,
    )
    return from !== null && to !== null && validRange(editor, from, to) ? { from, to } : null
  } catch {
    return null
  }
}

export function jumpToCommentAnchor(editor: Editor, anchor: CommentAnchor): boolean {
  const range = resolveCommentAnchor(editor, anchor)
  if (!range) return false
  editor.commands.setTextSelection(range)
  editor.commands.focus()
  return true
}
