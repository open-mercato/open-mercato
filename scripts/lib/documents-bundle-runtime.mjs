export const DOCUMENTS_EDITOR_RUNTIME_MARKERS = [
  'node_modules/@tiptap/',
  'node_modules/@hocuspocus/',
  'node_modules/prosemirror-',
  'node_modules/y-prosemirror/',
  'node_modules/yjs/',
]

const DOCUMENTS_BACKEND_ROUTE_PREFIX = 'modules/documents/backend/documents/'
const DOCUMENTS_EDITOR_ROUTE_PREFIX = 'modules/documents/backend/documents/[id]/'
const RSC_MANIFEST_ASSIGNMENT_PREFIX = 'globalThis.__RSC_MANIFEST["'
const RSC_MANIFEST_ASSIGNMENT_SEPARATOR = '"] = '

export function carriesDocumentsEditorRuntime(source) {
  return DOCUMENTS_EDITOR_RUNTIME_MARKERS.some((marker) => source.includes(marker))
}

export function isDocumentsListRouteClientModule(modulePath) {
  return (
    modulePath.includes(DOCUMENTS_BACKEND_ROUTE_PREFIX) &&
    !modulePath.includes(DOCUMENTS_EDITOR_ROUTE_PREFIX)
  )
}

export function normalizeChunkPath(chunkPath) {
  return chunkPath.replace(/^\/?_next\//, '').replace(/^\/+/, '')
}

export function parseClientReferenceManifest(source) {
  for (const line of source.split('\n')) {
    if (!line.startsWith(RSC_MANIFEST_ASSIGNMENT_PREFIX)) continue
    const separatorAt = line.indexOf(RSC_MANIFEST_ASSIGNMENT_SEPARATOR)
    if (separatorAt === -1) continue
    const route = line.slice(RSC_MANIFEST_ASSIGNMENT_PREFIX.length, separatorAt)
    const payload = line.slice(separatorAt + RSC_MANIFEST_ASSIGNMENT_SEPARATOR.length).replace(/;\s*$/, '')
    try {
      return { route, manifest: JSON.parse(payload) }
    } catch {
      return null
    }
  }
  return null
}

export function collectEagerRouteChunks(manifest, isTrackedClientModule) {
  const chunks = new Set()
  for (const entryFiles of Object.values(manifest?.entryJSFiles ?? {})) {
    for (const file of entryFiles) chunks.add(normalizeChunkPath(file))
  }
  for (const [modulePath, entry] of Object.entries(manifest?.clientModules ?? {})) {
    if (entry?.async === true) continue
    if (!isTrackedClientModule(modulePath)) continue
    for (const file of entry?.chunks ?? []) chunks.add(normalizeChunkPath(file))
  }
  return chunks
}
