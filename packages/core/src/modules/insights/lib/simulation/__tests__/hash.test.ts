import { canonicalJson, computeSimulationInputsHash, floorToUtcHour, jsonByteLength, jsonDepth } from '../hash'

const BASE = {
  kind: 'business_rules.rule_backtest',
  proposal: { ruleId: 'R1', conditionExpression: { field: 'status', operator: '=', value: 'won' } },
  artifactKind: 'business_rules.rule',
  artifactId: '11111111-1111-4111-8111-111111111111',
  artifactVersion: { updatedAt: '2026-10-09T10:00:00.000Z', fingerprint: 'abc' },
  windowFrom: new Date('2026-07-01T10:15:00.000Z'),
  windowTo: new Date('2026-10-01T10:45:00.000Z'),
  engineVersion: 1,
  contributionVersion: 1,
  requesterUserId: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
}

describe('simulation inputs hash (S11)', () => {
  it('canonicalizes key order, dates and dropped values', () => {
    expect(canonicalJson({ b: 1, a: [new Date('2026-01-01T00:00:00Z'), undefined, Number.NaN], c: undefined })).toBe('{"a":["2026-01-01T00:00:00.000Z",null,null],"b":1}')
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe(canonicalJson({ z: { x: 2, y: 1 } }))
  })

  it('is stable within the same UTC hour and changes across hours', () => {
    const same = computeSimulationInputsHash({ ...BASE, windowFrom: new Date('2026-07-01T10:59:59.999Z'), windowTo: new Date('2026-10-01T10:00:00.000Z') })
    expect(same).toBe(computeSimulationInputsHash(BASE))
    expect(computeSimulationInputsHash({ ...BASE, windowTo: new Date('2026-10-01T11:00:00.000Z') })).not.toBe(same)
    expect(floorToUtcHour(new Date('2026-10-01T10:45:12.345Z'))).toBe('2026-10-01T10:00:00.000Z')
  })

  it('binds the hash to the requester, the organization, the artifact version and the versions', () => {
    const base = computeSimulationInputsHash(BASE)
    expect(computeSimulationInputsHash({ ...BASE, requesterUserId: '44444444-4444-4444-8444-444444444444' })).not.toBe(base)
    expect(computeSimulationInputsHash({ ...BASE, organizationId: '55555555-5555-4555-8555-555555555555' })).not.toBe(base)
    expect(computeSimulationInputsHash({ ...BASE, artifactVersion: { updatedAt: '2026-10-09T10:00:01.000Z', fingerprint: 'abc' } })).not.toBe(base)
    expect(computeSimulationInputsHash({ ...BASE, engineVersion: 2 })).not.toBe(base)
    expect(computeSimulationInputsHash({ ...BASE, contributionVersion: 2 })).not.toBe(base)
    expect(computeSimulationInputsHash({ ...BASE, proposal: { ...BASE.proposal, ruleId: 'R2' } })).not.toBe(base)
    expect(computeSimulationInputsHash({ ...BASE, requesterUserId: BASE.requesterUserId.toUpperCase() })).toBe(base)
  })

  it('measures input size and depth', () => {
    expect(jsonByteLength({ text: 'ż' })).toBe(Buffer.byteLength('{"text":"ż"}', 'utf8'))
    expect(jsonDepth('scalar', 64)).toBe(0)
    expect(jsonDepth({ a: { b: [1, { c: 1 }] } }, 64)).toBe(4)
    let nested: Record<string, unknown> = {}
    const root = nested
    for (let index = 0; index < 80; index += 1) {
      const child: Record<string, unknown> = {}
      nested.next = child
      nested = child
    }
    expect(jsonDepth(root, 64)).toBeGreaterThan(64)
  })
})
