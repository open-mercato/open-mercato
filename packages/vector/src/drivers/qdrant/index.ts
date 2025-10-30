import type { VectorDriver, VectorDriverDocument, VectorDriverQuery, VectorDriverQueryResult } from '../../types'

function notImplemented(method: string): never {
  throw new Error(`[vector.qdrant] ${method} not implemented yet`)
}

export function createQdrantDriver(): VectorDriver {
  return {
    id: 'qdrant',
    async ensureReady() {
      notImplemented('ensureReady')
    },
    async upsert(doc: VectorDriverDocument) {
      void doc
      notImplemented('upsert')
    },
    async delete(entityId: string, recordId: string, tenantId: string) {
      void entityId
      void recordId
      void tenantId
      notImplemented('delete')
    },
    async getChecksum(entityId: string, recordId: string, tenantId: string) {
      void entityId
      void recordId
      void tenantId
      notImplemented('getChecksum')
    },
    async query(input: VectorDriverQuery): Promise<VectorDriverQueryResult[]> {
      void input
      notImplemented('query')
    },
    async purge(entityId: string, tenantId: string) {
      void entityId
      void tenantId
      notImplemented('purge')
    },
  }
}
