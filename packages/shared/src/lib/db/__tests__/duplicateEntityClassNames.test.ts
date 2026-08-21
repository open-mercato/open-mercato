import {
  findDuplicateEntityClassNames,
  formatDuplicateEntityClassNamesWarning,
} from '../duplicateEntityClassNames'

describe('findDuplicateEntityClassNames', () => {
  it('reports nothing for an empty or single-entry list', () => {
    expect(findDuplicateEntityClassNames([])).toEqual([])
    expect(findDuplicateEntityClassNames([{ className: 'Invoice', moduleId: 'billing' }])).toEqual([])
  })

  it('reports nothing when class names differ', () => {
    const groups = findDuplicateEntityClassNames([
      { className: 'Invoice', moduleId: 'billing' },
      { className: 'Ledger', moduleId: 'subscriptions' },
    ])

    expect(groups).toEqual([])
  })

  it('reports a name declared by two modules', () => {
    const groups = findDuplicateEntityClassNames([
      { className: 'Invoice', moduleId: 'billing', sourcePath: 'modules/billing/data/entities.ts' },
      { className: 'Invoice', moduleId: 'subscriptions', sourcePath: 'modules/subscriptions/data/entities.ts' },
    ])

    expect(groups).toEqual([
      {
        className: 'Invoice',
        sources: [
          { moduleId: 'billing', sourcePath: 'modules/billing/data/entities.ts' },
          { moduleId: 'subscriptions', sourcePath: 'modules/subscriptions/data/entities.ts' },
        ],
      },
    ])
  })

  it('treats identical module and path as the same class, not a collision', () => {
    const groups = findDuplicateEntityClassNames([
      { className: 'Invoice', moduleId: 'billing', sourcePath: 'modules/billing/data/entities.ts' },
      { className: 'Invoice', moduleId: 'billing', sourcePath: 'modules/billing/data/entities.ts' },
    ])

    expect(groups).toEqual([])
  })

  it('treats a shared target as the same class reached twice', () => {
    const target = class Invoice {}
    const groups = findDuplicateEntityClassNames([
      { className: 'Invoice', moduleId: 'billing', target },
      { className: 'Invoice', moduleId: 'subscriptions', target },
    ])

    expect(groups).toEqual([])
  })

  it('collects three-way collisions and multiple names in one pass', () => {
    const groups = findDuplicateEntityClassNames([
      { className: 'Invoice', moduleId: 'billing' },
      { className: 'Ledger', moduleId: 'billing' },
      { className: 'Invoice', moduleId: 'subscriptions' },
      { className: 'Ledger', moduleId: 'subscriptions' },
      { className: 'Ledger', moduleId: 'reporting' },
    ])

    expect(groups.map((group) => group.className)).toEqual(['Invoice', 'Ledger'])
    expect(groups[1].sources.map((source) => source.moduleId)).toEqual(['billing', 'subscriptions', 'reporting'])
  })

  it('keeps unidentifiable entries distinct so a collision fails open', () => {
    // Neither entry names a module, a file, or a class, so nothing distinguishes them.
    // Collapsing them into one bucket would hide a genuine collision.
    const groups = findDuplicateEntityClassNames([{ className: 'Invoice' }, { className: 'Invoice' }])

    expect(groups).toHaveLength(1)
    expect(groups[0].sources).toHaveLength(2)
  })

  it('skips entries without a class name', () => {
    expect(findDuplicateEntityClassNames([{ className: '' }, { className: '' }])).toEqual([])
  })
})

describe('formatDuplicateEntityClassNamesWarning', () => {
  it('names the class, the modules and the source files', () => {
    const message = formatDuplicateEntityClassNamesWarning([
      {
        className: 'Invoice',
        sources: [
          { moduleId: 'billing', sourcePath: '/repo/modules/billing/data/entities.ts' },
          { moduleId: 'subscriptions', sourcePath: '/repo/modules/subscriptions/data/entities.ts' },
        ],
      },
    ])

    expect(message).toContain('Duplicate entity class name(s) defined by more than one enabled module: "Invoice".')
    expect(message).toContain('  Invoice')
    expect(message).toContain('    - billing (/repo/modules/billing/data/entities.ts)')
    expect(message).toContain('    - subscriptions (/repo/modules/subscriptions/data/entities.ts)')
    expect(message).toContain('Rename all but one of the classes below')
  })

  it('lists every colliding name in one message', () => {
    const message = formatDuplicateEntityClassNamesWarning([
      { className: 'Invoice', sources: [{ moduleId: 'a' }, { moduleId: 'b' }] },
      { className: 'Ledger', sources: [{ moduleId: 'a' }, { moduleId: 'b' }] },
    ])

    expect(message).toContain('"Invoice", "Ledger"')
    expect(message).toContain('  Invoice')
    expect(message).toContain('  Ledger')
  })

  it('degrades gracefully when the module id or path is unavailable', () => {
    const message = formatDuplicateEntityClassNamesWarning([
      {
        className: 'Invoice',
        sources: [
          { moduleId: undefined, sourcePath: '/repo/a/entities.ts' },
          { moduleId: undefined, sourcePath: undefined },
        ],
      },
    ])

    expect(message).toContain('    - /repo/a/entities.ts')
    expect(message).toContain('    - unknown module')
  })

  it('omits a source path that degraded to a bare class name', () => {
    // MikroORM derives the decorator path by parsing a stack trace and falls back to
    // the class name when that parse fails.
    const message = formatDuplicateEntityClassNamesWarning([
      { className: 'Invoice', sources: [{ moduleId: 'billing', sourcePath: 'Invoice' }] },
    ])

    const sourceLine = message.split('\n').find((line) => line.startsWith('    - '))
    expect(sourceLine).toBe('    - billing')
  })
})
