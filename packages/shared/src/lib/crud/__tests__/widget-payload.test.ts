import {
  CRUD_WIDGET_PAYLOAD_KEY,
  addCrudWidgetPayload,
  buildCrudWidgetPayload,
  mergeCrudWidgetPayload,
  stripCrudWidgetPayload,
} from '../widget-payload'

describe('CRUD widget payload', () => {
  it('groups active injected fields by module and omits hidden or non-JSON values', () => {
    const payload = buildCrudWidgetPayload(
      [
        { moduleId: 'relations', fields: [{ id: 'relatedPersonId' }, { id: 'relationType' }] },
        { moduleId: 'relations', fields: [{ id: 'hidden' }] },
      ],
      { relatedPersonId: 'person-1', relationType: 'father', hidden: 'secret', callback: () => {} },
      new Set(['hidden']),
    )

    expect(payload).toEqual({
      relations: { relatedPersonId: 'person-1', relationType: 'father' },
    })
  })

  it('merges nested scopes by module and strips the reserved key for entity input', () => {
    const merged = mergeCrudWidgetPayload(
      { relations: { relatedPersonId: 'person-1' } },
      { relations: { relationType: 'father' } },
    )
    const body = addCrudWidgetPayload({ name: 'Alex' }, merged)

    expect(body).toEqual({
      name: 'Alex',
      [CRUD_WIDGET_PAYLOAD_KEY]: {
        relations: { relatedPersonId: 'person-1', relationType: 'father' },
      },
    })
    expect(stripCrudWidgetPayload(body)).toEqual({ name: 'Alex' })
  })
})
