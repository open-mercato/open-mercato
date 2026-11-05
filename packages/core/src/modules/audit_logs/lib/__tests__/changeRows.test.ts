import { extractChangeRows } from '../changeRows'

describe('extractChangeRows', () => {
  it('supports recorded from/to changes', () => {
    expect(extractChangeRows({
      status: { from: 'lead', to: 'customer' },
    }, null)).toEqual([
      { field: 'status', from: 'lead', to: 'customer' },
    ])
  })

  it('supports old/new changes and resolves dotted snapshot paths', () => {
    expect(extractChangeRows({
      'entity.displayName': { old: 'Acme', new: 'Copperleaf Design Co.' },
      lifecycleStage: 'qualified',
    }, {
      entity: { displayName: 'Acme' },
      lifecycleStage: 'lead',
    })).toEqual([
      { field: 'entity.displayName', from: 'Acme', to: 'Copperleaf Design Co.' },
      { field: 'lifecycleStage', from: 'lead', to: 'qualified' },
    ])
  })
})
