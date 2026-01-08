import type {
  VectorDriver,
  VectorDriverDocument,
  VectorDriverQuery,
  VectorDriverQueryResult,
  VectorDriverCountParams,
} from '../../types'

function notImplemented(method: string): never {
  throw new Error(`[vector.chromadb] ${method} not implemented yet`)
}

export function createChromaDbDriver(): VectorDriver {
  return {
    id: 'chromadb',
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
    async count(params: VectorDriverCountParams) {
      void params
      notImplemented('count')
    },
  }
}
