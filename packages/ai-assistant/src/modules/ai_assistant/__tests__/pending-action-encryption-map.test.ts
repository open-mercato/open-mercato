import { defaultEncryptionMaps } from '../encryption'

describe('pending action encryption map', () => {
  it('covers proposal inputs, diffs and execution output', () => {
    const map = defaultEncryptionMaps.find(
      (entry) => entry.entityId === 'ai_assistant:ai_pending_action',
    )
    expect(map?.fields.map((field) => field.field)).toEqual(
      expect.arrayContaining([
        'normalized_input',
        'field_diff',
        'records',
        'failed_records',
        'side_effects_summary',
        'execution_result',
      ]),
    )
  })
})
