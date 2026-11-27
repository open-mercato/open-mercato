import { AsyncLocalStorage } from 'node:async_hooks'

export const RUN_OBSERVATION_MAX_KNOWLEDGE_KEYS = 50
export const RUN_OBSERVATION_MAX_RETRIEVAL_HITS = 200

const KNOWLEDGE_KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/

export type RunObservationKnowledgeEntry = {
  version: string
  label?: string
}

export type RunObservationRetrievalHit = {
  ref: string
  score?: number
  version?: string
}

export type RunObservationRetrieval = {
  source: string
  queryHash: string
  k: number
  hits: RunObservationRetrievalHit[]
}

export type RunObservationSnapshot = {
  knowledge: Record<string, RunObservationKnowledgeEntry>
  retrievals: RunObservationRetrieval[]
  dropped: {
    knowledgeKeys: number
    retrievalHits: number
  }
}

export type RunObservationCollector = {
  recordKnowledgeVersion(key: string, version: string, meta?: { label?: string }): void
  recordRetrieval(entry: RunObservationRetrieval): void
  snapshot(): RunObservationSnapshot
}

export function isValidKnowledgeKey(key: string): boolean {
  return KNOWLEDGE_KEY_PATTERN.test(key)
}

export function createRunObservationCollector(): RunObservationCollector {
  const knowledge = new Map<string, RunObservationKnowledgeEntry>()
  const retrievals: RunObservationRetrieval[] = []
  let droppedKnowledgeKeys = 0
  let droppedRetrievalHits = 0

  return {
    recordKnowledgeVersion(key, version, meta) {
      if (!isValidKnowledgeKey(key)) {
        droppedKnowledgeKeys += 1
        return
      }
      if (!knowledge.has(key) && knowledge.size >= RUN_OBSERVATION_MAX_KNOWLEDGE_KEYS) {
        droppedKnowledgeKeys += 1
        return
      }
      const entry: RunObservationKnowledgeEntry = { version }
      if (meta?.label !== undefined) entry.label = meta.label
      knowledge.set(key, entry)
    },
    recordRetrieval(entry) {
      const keptHits = entry.hits.slice(0, RUN_OBSERVATION_MAX_RETRIEVAL_HITS).map((hit) => ({ ...hit }))
      droppedRetrievalHits += entry.hits.length - keptHits.length
      retrievals.push({ source: entry.source, queryHash: entry.queryHash, k: entry.k, hits: keptHits })
    },
    snapshot() {
      const knowledgeSnapshot: Record<string, RunObservationKnowledgeEntry> = {}
      for (const [key, entry] of knowledge) {
        knowledgeSnapshot[key] = { ...entry }
      }
      return {
        knowledge: knowledgeSnapshot,
        retrievals: retrievals.map((retrieval) => ({
          ...retrieval,
          hits: retrieval.hits.map((hit) => ({ ...hit })),
        })),
        dropped: {
          knowledgeKeys: droppedKnowledgeKeys,
          retrievalHits: droppedRetrievalHits,
        },
      }
    },
  }
}

const runObservationStorage = new AsyncLocalStorage<RunObservationCollector>()

export function bindRunObservation<T>(collector: RunObservationCollector, fn: () => T): T {
  return runObservationStorage.run(collector, fn)
}

export function getActiveRunObservationCollector(): RunObservationCollector | undefined {
  return runObservationStorage.getStore()
}

export function reportKnowledgeVersion(key: string, version: string, meta?: { label?: string }): void {
  const collector = runObservationStorage.getStore()
  if (!collector) return
  collector.recordKnowledgeVersion(key, version, meta)
}

export function reportRetrieval(entry: RunObservationRetrieval): void {
  const collector = runObservationStorage.getStore()
  if (!collector) return
  collector.recordRetrieval(entry)
}
