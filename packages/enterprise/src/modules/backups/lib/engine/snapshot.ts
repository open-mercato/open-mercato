import type { DatabaseIdentity, SnapshotEvidence } from './types'
export type Consistency = 'single-snapshot' | 'quiesced' | 'multi-snapshot'
export function classifyBoundary(previous: { identity: DatabaseIdentity; evidence: SnapshotEvidence }, next: { identity: DatabaseIdentity; evidence: SnapshotEvidence }, cumulative: Consistency): Consistency {
  if (cumulative === 'multi-snapshot') return cumulative
  return previous.identity.clusterIncarnation === next.identity.clusterIncarnation
    && previous.identity.databaseOid === next.identity.databaseOid
    && previous.evidence.xmax === next.evidence.xmax
    && previous.evidence.xipList.length === 0 && next.evidence.xipList.length === 0
    ? 'quiesced' : 'multi-snapshot'
}
