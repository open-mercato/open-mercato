import type { AddressCustomFieldStructure } from '@open-mercato/ui/backend/detail/AddressCustomFields'
import { selectAddressValuesForCopy } from '../addressCustomValueClient'

function structure(definitions: AddressCustomFieldStructure['definitions']): AddressCustomFieldStructure {
  return { entityId: 'sales:sales_document_address', status: 'ready', definitions, fields: [], retry: () => {} }
}

describe('selectAddressValuesForCopy', () => {
  it('previews book values when the destination accepts the same scoped definition', () => {
    const source = structure([
      { key: 'memo', kind: 'text' },
      { key: 'dock', kind: 'select', options: [{ value: 'old', label: 'Old entrance' }] },
      { key: 'route_code', kind: 'text' },
      { key: 'parked', kind: 'text', formEditable: false },
      { key: 'question', kind: 'text' },
    ])
    const target = structure([
      { key: 'memo', kind: 'text' },
      { key: 'dock', kind: 'select', options: [{ value: 'active', label: 'Active entrance' }] },
      { key: 'route_code', kind: 'text', validation: [{ rule: 'regex', param: '^[0-9]+$', message: 'Digits only' }] },
      { key: 'parked', kind: 'text' },
      { key: 'question', kind: 'boolean' },
    ])

    expect(selectAddressValuesForCopy({
      memo: 'Call ahead', dock: 'old', route_code: 'north', parked: 'Inactive', question: 'yes',
    }, source, target)).toEqual({ memo: 'Call ahead' })
  })

  it('waits for the two definition sets before previewing values', () => {
    const fields = structure([{ key: 'memo', kind: 'text' }])
    expect(selectAddressValuesForCopy({ memo: 'Call ahead' }, { ...fields, status: 'loading' }, fields)).toBeNull()
  })
})
