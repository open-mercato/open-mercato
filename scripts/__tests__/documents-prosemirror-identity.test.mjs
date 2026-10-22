import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { Schema } from '@tiptap/pm/model'
import { EditorState, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view'
import { DecorationSet as CollaborationDecorationSet } from 'prosemirror-view'
import { prosemirrorToYXmlFragment, yCursorPlugin, ySyncPlugin } from '@tiptap/y-tiptap'
import { Awareness } from 'y-protocols/awareness'
import * as Yjs from 'yjs'

test('Documents pagination and collaboration share the same decoration constructor', () => {
  assert.equal(DecorationSet, CollaborationDecorationSet)
})

test('Documents collaboration and pagination decorations render together', () => {
  const dom = new JSDOM('<!doctype html><div id="editor"></div>')
  const originals = new Map()
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'getComputedStyle']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  }
  const ydoc = new Yjs.Doc()
  const awareness = new Awareness(ydoc)
  let view
  try {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', toDOM: () => ['p', 0] },
        text: {},
      },
    })
    const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Shared document'))])
    prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment('default'))
    const pagination = new Plugin({
      props: {
        decorations: (state) => DecorationSet.create(state.doc, [
          Decoration.widget(1, () => document.createElement('span')),
        ]),
      },
    })
    view = new EditorView(document.querySelector('#editor'), {
      state: EditorState.create({
        schema,
        doc,
        plugins: [ySyncPlugin(ydoc.getXmlFragment('default')), yCursorPlugin(awareness), pagination],
      }),
    })
    assert.equal(view.dom.textContent, 'Shared document')
    assert.ok(view.dom.querySelector('.ProseMirror-widget'))
  } finally {
    view?.destroy()
    awareness.destroy()
    ydoc.destroy()
    dom.window.close()
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})
