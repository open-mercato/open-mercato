import { intersectFeatureGrants, type FeatureGrantSet } from '../features'

function grants(features: string[], isSuperAdmin = false): FeatureGrantSet {
  return { features, isSuperAdmin }
}

describe('intersectFeatureGrants', () => {
  it('keeps exact matches only', () => {
    expect(intersectFeatureGrants(grants(['a.view', 'a.edit']), grants(['a.view', 'b.view']))).toEqual(
      grants(['a.view']),
    )
  })

  it('narrows a module wildcard to the concrete feature on the other side', () => {
    expect(intersectFeatureGrants(grants(['a.*']), grants(['a.b']))).toEqual(grants(['a.b']))
    expect(intersectFeatureGrants(grants(['a.b']), grants(['a.*']))).toEqual(grants(['a.b']))
  })

  it('returns empty for disjoint wildcards', () => {
    expect(intersectFeatureGrants(grants(['a.*']), grants(['b.*']))).toEqual(grants([]))
  })

  it('keeps an identical wildcard and narrows nested wildcards', () => {
    expect(intersectFeatureGrants(grants(['a.*']), grants(['a.*']))).toEqual(grants(['a.*']))
    expect(intersectFeatureGrants(grants(['a.*']), grants(['a.b.*']))).toEqual(grants(['a.b.*']))
  })

  it('treats the global wildcard as identity', () => {
    expect(intersectFeatureGrants(grants(['*']), grants(['b.view', 'a.*']))).toEqual(
      grants(['a.*', 'b.view']),
    )
    expect(intersectFeatureGrants(grants(['a.*']), grants(['*']))).toEqual(grants(['a.*']))
    expect(intersectFeatureGrants(grants(['*']), grants(['*']))).toEqual(grants(['*']))
  })

  it('collapses a super-admin side to the other side', () => {
    expect(intersectFeatureGrants(grants([], true), grants(['b.x', 'a.x', 'a.x']))).toEqual(
      grants(['a.x', 'b.x']),
    )
    expect(intersectFeatureGrants(grants(['a.x']), grants([], true))).toEqual(grants(['a.x']))
  })

  it('stays super-admin when both sides are', () => {
    expect(intersectFeatureGrants(grants([], true), grants([], true))).toEqual(grants([], true))
  })

  it('returns empty when either side is empty', () => {
    expect(intersectFeatureGrants(grants([]), grants(['a.*']))).toEqual(grants([]))
    expect(intersectFeatureGrants(grants(['a.*']), grants([]))).toEqual(grants([]))
    expect(intersectFeatureGrants(grants([]), grants([], true))).toEqual(grants([]))
  })

  it('dedupes and sorts the result', () => {
    expect(
      intersectFeatureGrants(grants(['b.x', 'a.x', 'a.x', 'a.*']), grants(['a.x', 'b.x', 'b.x'])),
    ).toEqual(grants(['a.x', 'b.x']))
  })
})
