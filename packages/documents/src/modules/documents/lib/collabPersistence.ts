import * as Y from 'yjs'

export const COLLAB_CONTENT_SAVE_TIMEOUT_MS = 15000

export function containsDocumentSnapshot(durable: Y.Snapshot, requested: Y.Snapshot): boolean {
  for (const [clientId, clock] of requested.sv) {
    if ((durable.sv.get(clientId) ?? 0) < clock) return false
  }
  return Y.equalDeleteSets(Y.mergeDeleteSets([durable.ds, requested.ds]), durable.ds)
}
