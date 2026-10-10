import type { SimulationArtifactVersion } from '@open-mercato/shared/modules/insights/simulate'

export type SimulationRunVersion = {
  artifactId: string | null
  artifactVersion: { updatedAt: string | null; fingerprint: string | null } | null
  proposalFingerprint: string
}

export type SimulationVerification = {
  verified: boolean
  artifactId: string | null
  artifactUpdatedAtAfter: Date | null
}

function parseTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isWrittenAfter(liveUpdatedAt: string | null, runUpdatedAt: string | null): boolean {
  const live = parseTime(liveUpdatedAt)
  const base = parseTime(runUpdatedAt)
  if (base === null) return live !== null || liveUpdatedAt === null
  return live !== null && live > base
}

/**
 * S15 (detective control): an `applied` decision is verified when the live artifact was written
 * after the version captured at request time AND its fingerprint equals the fingerprint of the
 * simulated proposal. The client never supplies either value. An artifact without `updatedAt`
 * is compared by fingerprint only; a proposal for an artifact that did not exist yet (apply =
 * create) is verified once an artifact with the proposed fingerprint exists.
 */
export function verifyAppliedDecision(run: SimulationRunVersion, live: SimulationArtifactVersion | null): SimulationVerification {
  if (!live) return { verified: false, artifactId: run.artifactId, artifactUpdatedAtAfter: null }
  const liveTime = parseTime(live.updatedAt)
  const fingerprintMatches = typeof live.fingerprint === 'string'
    && live.fingerprint.length > 0
    && live.fingerprint === run.proposalFingerprint
  return {
    verified: fingerprintMatches && isWrittenAfter(live.updatedAt, run.artifactVersion?.updatedAt ?? null),
    artifactId: live.artifactId ?? run.artifactId,
    artifactUpdatedAtAfter: liveTime === null ? null : new Date(liveTime),
  }
}
