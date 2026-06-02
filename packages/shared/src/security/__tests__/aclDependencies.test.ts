import {
  applyAddMissingDependency,
  applyRemoveDependents,
  applyRestoreDependency,
  resolveAclDependencyDiagnostics,
  type FeatureDescriptor,
} from '../aclDependencies'

const catalog: FeatureDescriptor[] = [
  { id: 'customers.people.view', title: 'View people', module: 'customers' },
  {
    id: 'customers.people.manage',
    title: 'Manage people',
    module: 'customers',
    dependsOn: ['customers.people.view'],
  },
  { id: 'customers.deals.view', title: 'View deals', module: 'customers', dependsOn: ['customers.people.view'] },
  { id: 'customers.deals.manage', title: 'Manage deals', module: 'customers', dependsOn: ['customers.deals.view'] },
  { id: 'customers.activities.view', title: 'View activities', module: 'customers' },
  {
    id: 'customers.widgets.todos',
    title: 'Todos widget',
    module: 'customers',
    dependsOn: ['customers.activities.view'],
  },
  {
    id: 'sales.orders.view',
    title: 'View orders',
    module: 'sales',
    dependsOn: ['customers.people.view', 'sales.channels.view-doesnt-exist'],
  },
]

describe('resolveAclDependencyDiagnostics', () => {
  it('returns empty diagnostics when granted is empty', () => {
    const result = resolveAclDependencyDiagnostics([], catalog)
    expect(result.missingDependencies).toEqual([])
    expect(result.orphanedDependents).toEqual([])
    expect(result.unknownReferences).toEqual([])
  })

  it('returns empty diagnostics when granted contains global wildcard', () => {
    const result = resolveAclDependencyDiagnostics(['*'], catalog)
    expect(result.missingDependencies).toEqual([])
    expect(result.orphanedDependents).toEqual([])
    expect(result.unknownReferences).toEqual([])
  })

  it('returns empty diagnostics when all granted features have their deps satisfied', () => {
    const result = resolveAclDependencyDiagnostics(
      ['customers.people.view', 'customers.people.manage', 'customers.deals.view', 'customers.deals.manage'],
      catalog,
    )
    expect(result.missingDependencies).toEqual([])
    expect(result.orphanedDependents).toEqual([])
  })

  it('flags a granted feature whose declared dependency is missing', () => {
    const result = resolveAclDependencyDiagnostics(['customers.people.manage'], catalog)
    expect(result.missingDependencies).toEqual([
      { feature: 'customers.people.manage', missing: ['customers.people.view'] },
    ])
  })

  it('treats module wildcards as satisfying matching deps', () => {
    const result = resolveAclDependencyDiagnostics(['customers.*', 'customers.people.manage'], catalog)
    expect(result.missingDependencies).toEqual([])
  })

  it('reports orphaned dependents when a parent is not granted but children are', () => {
    const result = resolveAclDependencyDiagnostics(['customers.people.manage', 'customers.deals.view'], catalog)
    // people.manage depends on people.view (not granted) → orphan parent: customers.people.view
    // deals.view depends on people.view → also orphan parent: customers.people.view
    expect(result.orphanedDependents).toEqual([
      {
        dependency: 'customers.people.view',
        dependents: ['customers.deals.view', 'customers.people.manage'],
      },
    ])
  })

  it('flags unknown references for deps that do not resolve to a registered feature', () => {
    const result = resolveAclDependencyDiagnostics(['sales.orders.view'], catalog)
    expect(result.unknownReferences).toEqual([
      {
        feature: 'sales.orders.view',
        missing: ['sales.channels.view-doesnt-exist'],
      },
    ])
  })

  it('skips wildcard dep targets from unknown-reference checks', () => {
    const wildcardCatalog: FeatureDescriptor[] = [
      { id: 'compose.feature', dependsOn: ['something.*'] },
    ]
    const result = resolveAclDependencyDiagnostics(['compose.feature'], wildcardCatalog)
    expect(result.unknownReferences).toEqual([])
    expect(result.missingDependencies).toEqual([
      { feature: 'compose.feature', missing: ['something.*'] },
    ])
  })

  it('does not double-count when the same dep is missing from multiple granted features', () => {
    const result = resolveAclDependencyDiagnostics(
      ['customers.deals.view', 'customers.deals.manage'],
      catalog,
    )
    // both depend (directly or transitively) on customers.people.view
    expect(result.orphanedDependents).toEqual([
      {
        dependency: 'customers.people.view',
        dependents: ['customers.deals.view'],
      },
    ])
    // deals.manage depends on deals.view which IS granted → no missing
    expect(result.missingDependencies).toEqual([
      { feature: 'customers.deals.view', missing: ['customers.people.view'] },
    ])
  })

  it('detects widget dependency violation when widget granted without underlying view', () => {
    const result = resolveAclDependencyDiagnostics(['customers.widgets.todos'], catalog)
    expect(result.missingDependencies).toEqual([
      { feature: 'customers.widgets.todos', missing: ['customers.activities.view'] },
    ])
  })

  it('ignores deps that are dropped/empty strings', () => {
    const weirdCatalog: FeatureDescriptor[] = [
      { id: 'a', dependsOn: ['', '   ', 'b'] },
      { id: 'b' },
    ]
    const result = resolveAclDependencyDiagnostics(['a'], weirdCatalog)
    expect(result.missingDependencies).toEqual([{ feature: 'a', missing: ['b'] }])
  })

  it('handles repeated entries in granted (dedupe via Set)', () => {
    const result = resolveAclDependencyDiagnostics(
      ['customers.people.manage', 'customers.people.manage'],
      catalog,
    )
    expect(result.missingDependencies).toEqual([
      { feature: 'customers.people.manage', missing: ['customers.people.view'] },
    ])
  })
})

describe('applyAddMissingDependency', () => {
  it('appends the dependency if not already present', () => {
    expect(applyAddMissingDependency(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('is a no-op when already present', () => {
    expect(applyAddMissingDependency(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })
  it('skips empty strings', () => {
    expect(applyAddMissingDependency(['a'], '')).toEqual(['a'])
    expect(applyAddMissingDependency(['a'], '   ')).toEqual(['a'])
  })
})

describe('applyRemoveDependents', () => {
  it('removes listed features from granted', () => {
    expect(applyRemoveDependents(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })
  it('removes multiple', () => {
    expect(applyRemoveDependents(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b'])
  })
  it('is a no-op for empty list', () => {
    expect(applyRemoveDependents(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('applyRestoreDependency', () => {
  it('adds the dependency back (alias of applyAddMissingDependency)', () => {
    expect(applyRestoreDependency(['a'], 'b')).toEqual(['a', 'b'])
  })
})
