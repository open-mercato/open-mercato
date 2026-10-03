import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { buildTemplateColumns, groupTemplatesForCatalogue } from '../TemplatesListTableColumns'

function template(id: string, module: string): TemplateMeta {
  return {
    id,
    label: id,
    description: '',
    module,
    resourceKind: 'order',
    documentType: 'invoice',
    format: 'pdf',
    tags: [],
  }
}

describe('TemplatesListTableColumns', () => {
  it('builds the seven catalogue columns in order', () => {
    const columns = buildTemplateColumns((key) => key)
    expect(columns.map((column) => (column as { accessorKey: string }).accessorKey)).toEqual([
      'id',
      'label',
      'resourceKind',
      'documentType',
      'format',
      'description',
      'note',
    ])
  })

  it('groups templates into one sorted group per module', () => {
    const groups = groupTemplatesForCatalogue([template('b1', 'sales'), template('a1', 'catalog'), template('b2', 'sales')])
    expect(groups.map(([moduleId]) => moduleId)).toEqual(['catalog', 'sales'])
    expect(groups[1][1].map((entry) => entry.id)).toEqual(['b1', 'b2'])
  })
})
