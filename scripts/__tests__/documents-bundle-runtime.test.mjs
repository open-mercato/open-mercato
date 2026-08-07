import assert from 'node:assert/strict'
import test from 'node:test'
import {
  carriesDocumentsEditorRuntime,
  DOCUMENTS_EDITOR_RUNTIME_MARKERS,
} from '../lib/documents-bundle-runtime.mjs'

test('Documents bundle markers match package paths instead of incidental identifier substrings', () => {
  assert.equal(carriesDocumentsEditorRuntime('const yjsDocMap = new Map()'), false)
  assert.equal(
    carriesDocumentsEditorRuntime('node_modules/@lexical/react/LexicalCollaborationContext.prod.mjs'),
    false,
  )

  for (const marker of DOCUMENTS_EDITOR_RUNTIME_MARKERS) {
    assert.equal(carriesDocumentsEditorRuntime(`${marker}dist/index.js [app-client]`), true)
  }
})
