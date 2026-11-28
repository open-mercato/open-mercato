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

/** Physical-origin collision checks intentionally survive server lifetime/timeline changes. */
export function samePhysicalDatabase(left:DatabaseIdentity,right:DatabaseIdentity):boolean{
  const origin=(identity:DatabaseIdentity)=>/^[0-9]+:[0-9]+:(primary|recovery)(:[0-9]+)?$/.test(identity.clusterIncarnation)?identity.clusterIncarnation.split(':')[0]:identity.clusterIncarnation
  return left.databaseOid===right.databaseOid&&origin(left)===origin(right)
}
