import {
  buildCrudWidgetPayload,
} from '../widget-payload'
import {
  EXTENSION_PAYLOAD_TRANSPORT_KEY,
  extractExtensionPayload,
  mergeExtensionPayload,
} from '../../umes/extension-payload'

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

  it('omits a module whose injected fields have no serializable values', () => {
    const payload = buildCrudWidgetPayload(
      [{ moduleId: 'relations', fields: [{ id: 'relatedPersonId' }] }],
      {},
    )

    expect(payload).toBeUndefined()
  })

  it('merges nested scopes by module and extracts the transport key before entity validation', () => {
    const merged = mergeExtensionPayload(
      { relations: { relatedPersonId: 'person-1' } },
      { relations: { relationType: 'father' } },
    )
    const { entityBody, extensionPayload } = extractExtensionPayload({
      name: 'Alex',
      [EXTENSION_PAYLOAD_TRANSPORT_KEY]: merged,
    })

    expect(extensionPayload).toEqual({
      relations: { relatedPersonId: 'person-1', relationType: 'father' },
    })
    expect(entityBody).toEqual({ name: 'Alex' })
  })
})
