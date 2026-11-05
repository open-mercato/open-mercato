/** @jest-environment jsdom */

import type { Editor } from '@tiptap/core'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { prosemirrorToYDoc, ySyncPlugin } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { documentCommentAnchorWriteSchema } from '../data/validators'
import {
  isChangedDocumentCommentAnchor,
  normalizeDocumentCommentAnchor,
} from '../lib/commentAnchors'
import {
  captureCommentAnchor,
  resolveCommentAnchor,
} from '../backend/documents/[id]/CommentAnchorNavigation'

describe('document comment anchors', () => {
  it('accepts strict v2 relative anchors without storing quoted text', () => {
    const anchor = {
      version: 2 as const,
      relativeFrom: 'AQIDBA==',
      relativeTo: 'BQYHCA==',
    }
    expect(documentCommentAnchorWriteSchema.parse(anchor)).toEqual(anchor)
    expect(normalizeDocumentCommentAnchor(anchor)).toEqual(anchor)
  })

  it('keeps valid legacy numeric anchors readable during rollout', () => {
    expect(normalizeDocumentCommentAnchor({ from: 2, to: 7 })).toEqual({ from: 2, to: 7 })
  })

  it('maps malformed or text-bearing legacy payloads to a changed-state sentinel', () => {
    const normalized = normalizeDocumentCommentAnchor({ from: 2, to: 7, text: 'private quote' })
    expect(normalized).toEqual({ kind: 'legacy-unknown' })
    expect(isChangedDocumentCommentAnchor(normalized)).toBe(true)
    expect(documentCommentAnchorWriteSchema.safeParse({ version: 2, relativeFrom: 'not*base64', relativeTo: 'bad' }).success).toBe(false)
    expect(documentCommentAnchorWriteSchema.safeParse({ version: 2, relativeFrom: 'bad', relativeTo: 'AQIDBA==' }).success).toBe(false)
  })

  it('captures v2 anchors from the Tiptap collaboration plugin state', () => {
    const ydoc = new Y.Doc()

    try {
      const schema = new Schema({
        nodes: {
          doc: { content: 'block+' },
          paragraph: { content: 'text*', group: 'block' },
          text: { group: 'inline' },
        },
      })
      const document = schema.node('doc', undefined, [
        schema.node('paragraph', undefined, [schema.text('Before TARGET After')]),
      ])
      let state = EditorState.create({
        schema,
        doc: document,
        plugins: [ySyncPlugin(ydoc.getXmlFragment('default'))],
      })
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 8, 14)))

      const anchor = captureCommentAnchor({ state } as Editor)

      expect(anchor).toMatchObject({ version: 2 })
      expect(anchor && 'version' in anchor ? anchor.relativeFrom : null).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
      expect(anchor && 'version' in anchor ? anchor.relativeTo : null).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    } finally {
      ydoc.destroy()
    }
  })

  it('tracks the full range across edits from a second synchronized editor, then degrades after deletion', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: {
          content: 'text*',
          group: 'block',
          parseDOM: [{ tag: 'p' }],
          toDOM: () => ['p', 0],
        },
        text: { group: 'inline' },
      },
    })
    const initialText = 'Before TARGET After'
    const initialDocument = schema.node('doc', undefined, [
      schema.node('paragraph', undefined, [schema.text(initialText)]),
    ])
    const authorDoc = prosemirrorToYDoc(initialDocument, 'default')
    const collaboratorDoc = new Y.Doc()
    Y.applyUpdate(collaboratorDoc, Y.encodeStateAsUpdate(authorDoc))

    const authorMount = document.body.appendChild(document.createElement('div'))
    const collaboratorMount = document.body.appendChild(document.createElement('div'))
    const authorView = new EditorView(authorMount, {
      state: EditorState.create({
        schema,
        doc: initialDocument,
        plugins: [ySyncPlugin(authorDoc.getXmlFragment('default'))],
      }),
    })
    const collaboratorView = new EditorView(collaboratorMount, {
      state: EditorState.create({
        schema,
        doc: initialDocument,
        plugins: [ySyncPlugin(collaboratorDoc.getXmlFragment('default'))],
      }),
    })
    const syncToAuthor = () => {
      Y.applyUpdate(
        authorDoc,
        Y.encodeStateAsUpdate(collaboratorDoc, Y.encodeStateVector(authorDoc)),
      )
    }

    try {
      authorView.dispatch(authorView.state.tr.setSelection(
        TextSelection.create(authorView.state.doc, 8, 14),
      ))
      const anchor = captureCommentAnchor({ state: authorView.state } as Editor)
      expect(anchor).toMatchObject({ version: 2 })
      if (!anchor) throw new Error('[internal] expected a captured comment anchor')
      const initialRange = resolveCommentAnchor({ state: authorView.state } as Editor, anchor)
      expect(initialRange).not.toBeNull()
      expect(authorView.state.doc.textBetween(initialRange!.from, initialRange!.to)).toBe('TARGET')

      collaboratorView.dispatch(collaboratorView.state.tr.insertText('PREFIX ', 1))
      syncToAuthor()
      collaboratorView.dispatch(collaboratorView.state.tr.insertText('X', 18))
      syncToAuthor()
      collaboratorView.dispatch(collaboratorView.state.tr.insertText(
        ' SUFFIX',
        collaboratorView.state.doc.content.size - 1,
      ))
      syncToAuthor()

      const movedRange = resolveCommentAnchor({ state: authorView.state } as Editor, anchor)
      expect(movedRange).not.toBeNull()
      expect(authorView.state.doc.textBetween(movedRange!.from, movedRange!.to)).toBe('TARXGET')

      const targetFrom = 1 + 'PREFIX '.length + 'Before '.length
      collaboratorView.dispatch(collaboratorView.state.tr.delete(
        targetFrom,
        targetFrom + 'TARXGET'.length,
      ))
      syncToAuthor()
      expect(resolveCommentAnchor({ state: authorView.state } as Editor, anchor)).toBeNull()
    } finally {
      authorView.destroy()
      collaboratorView.destroy()
      authorDoc.destroy()
      collaboratorDoc.destroy()
      document.body.replaceChildren()
    }
  })
})
