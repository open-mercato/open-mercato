import { verifyAppliedDecision } from '../verification'

const RUN = {
  artifactId: '11111111-1111-4111-8111-111111111111',
  artifactVersion: { updatedAt: '2026-10-09T10:00:00.000Z', fingerprint: 'old' },
  proposalFingerprint: 'proposed',
}

describe('decision verification (S15)', () => {
  it('verifies a later write whose fingerprint equals the simulated proposal', () => {
    expect(verifyAppliedDecision(RUN, { artifactId: RUN.artifactId, updatedAt: '2026-10-09T11:00:00.000Z', fingerprint: 'proposed' })).toEqual({
      verified: true,
      artifactId: RUN.artifactId,
      artifactUpdatedAtAfter: new Date('2026-10-09T11:00:00.000Z'),
    })
  })

  it('does not verify a different definition or an unchanged artifact', () => {
    expect(verifyAppliedDecision(RUN, { artifactId: RUN.artifactId, updatedAt: '2026-10-09T11:00:00.000Z', fingerprint: 'something-else' }).verified).toBe(false)
    expect(verifyAppliedDecision(RUN, { artifactId: RUN.artifactId, updatedAt: '2026-10-09T10:00:00.000Z', fingerprint: 'proposed' }).verified).toBe(false)
    expect(verifyAppliedDecision(RUN, { artifactId: RUN.artifactId, updatedAt: '2026-10-09T09:00:00.000Z', fingerprint: 'proposed' }).verified).toBe(false)
  })

  it('does not verify a missing artifact and keeps the run artifact id', () => {
    expect(verifyAppliedDecision(RUN, null)).toEqual({ verified: false, artifactId: RUN.artifactId, artifactUpdatedAtAfter: null })
  })

  it('verifies a created artifact (apply = create) and an artifact without updatedAt by fingerprint', () => {
    const unsaved = { artifactId: null, artifactVersion: null, proposalFingerprint: 'proposed' }
    expect(verifyAppliedDecision(unsaved, { artifactId: 'new-id', updatedAt: '2026-10-09T11:00:00.000Z', fingerprint: 'proposed' })).toEqual(expect.objectContaining({ verified: true, artifactId: 'new-id' }))
    expect(verifyAppliedDecision({ ...unsaved, artifactVersion: { updatedAt: null, fingerprint: 'x' } }, { artifactId: 'id', updatedAt: null, fingerprint: 'proposed' }).verified).toBe(true)
    expect(verifyAppliedDecision(unsaved, { artifactId: 'id', updatedAt: null, fingerprint: null }).verified).toBe(false)
  })
})
