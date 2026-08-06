export const DOCUMENTS_EDITOR_RUNTIME_MARKERS = [
  'node_modules/@tiptap/',
  'node_modules/@hocuspocus/',
  'node_modules/prosemirror-',
  'node_modules/y-prosemirror/',
  'node_modules/yjs/',
]

export function carriesDocumentsEditorRuntime(source) {
  return DOCUMENTS_EDITOR_RUNTIME_MARKERS.some((marker) => source.includes(marker))
}
