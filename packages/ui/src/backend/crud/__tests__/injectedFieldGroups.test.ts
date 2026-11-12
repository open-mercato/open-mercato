import type { InjectionFieldDefinition } from '@open-mercato/shared/modules/widgets/injection'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { CrudFormGroup } from '../../CrudForm'
import {
  INJECTED_FIELDS_FALLBACK_GROUP_ID,
  placeInjectedFieldsInGroups,
  type InjectedFieldWidgetPlacement,
} from '../injectedFieldGroups'

function field(id: string, group?: string, extra: Partial<InjectionFieldDefinition> = {}): InjectionFieldDefinition {
  return { id, label: id, type: 'text', group, ...extra } as InjectionFieldDefinition
}

function fieldIds(group: CrudFormGroup | undefined): string[] {
  return (group?.fields ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.id))
}

const groupPlacement: InjectedFieldWidgetPlacement = {
  kind: 'group',
  column: 2,
  groupLabel: 'wms.widgets.catalog.inventoryProfile.groupLabel',
  groupDescription: 'wms.widgets.catalog.inventoryProfile.groupDescription',
}

describe('placeInjectedFieldsInGroups (#6142)', () => {
  it('inserts a field into the declared group it targets, honoring placement', () => {
    const groups: CrudFormGroup[] = [{ id: 'general', fields: ['title', 'sku'] }]
    const placed = placeInjectedFieldsInGroups(
      groups,
      [field('subtitle', 'general', { placement: { position: InjectionPosition.After, relativeTo: 'title' } })],
      new Map(),
    )
    expect(fieldIds(placed[0])).toEqual(['title', 'subtitle', 'sku'])
    expect(groups[0].fields).toEqual(['title', 'sku'])
  })

  it('renders fields of an undeclared group-kind injection as their own card', () => {
    const groups: CrudFormGroup[] = [
      { id: 'general', fields: ['title'] },
      { id: 'custom', kind: 'customFields', title: 'Custom attributes' },
    ]
    const definitions = [field('wms.manageInventory', 'wms.inventoryProfile'), field('wms.safetyStock', 'wms.inventoryProfile')]
    const placements = new Map(definitions.map((definition) => [definition.id, groupPlacement]))

    const placed = placeInjectedFieldsInGroups(groups, definitions, placements)

    expect(placed.map((group) => group.id)).toEqual(['general', 'custom', 'wms.inventoryProfile'])
    const card = placed[2]
    expect(card.title).toBe(groupPlacement.groupLabel)
    expect(card.description).toBe(groupPlacement.groupDescription)
    expect(card.column).toBe(2)
    expect(fieldIds(card)).toEqual(['wms.manageInventory', 'wms.safetyStock'])
    expect(fieldIds(placed[0])).toEqual(['title'])
  })

  it('never falls back into a customFields group, which ignores group.fields', () => {
    const fallbacks: string[] = []
    const placed = placeInjectedFieldsInGroups(
      [
        { id: 'general', fields: ['title'] },
        { id: 'custom', kind: 'customFields' },
      ],
      [field('example.priority', 'missing')],
      new Map(),
      (definition) => fallbacks.push(definition.id),
    )
    expect(fieldIds(placed[0])).toEqual(['title', 'example.priority'])
    expect(fieldIds(placed[1])).toEqual([])
    expect(fallbacks).toEqual(['example.priority'])
  })

  it('synthesizes a host group when no declared group renders plain fields', () => {
    const placed = placeInjectedFieldsInGroups(
      [{ id: 'custom', kind: 'customFields' }],
      [field('example.priority', 'missing')],
      new Map(),
    )
    expect(placed.map((group) => group.id)).toEqual(['custom', INJECTED_FIELDS_FALLBACK_GROUP_ID])
    expect(fieldIds(placed[1])).toEqual(['example.priority'])
  })

  it('does not duplicate a field the host already declares', () => {
    const placed = placeInjectedFieldsInGroups(
      [{ id: 'general', fields: ['title', 'subtitle'] }],
      [field('subtitle', 'general')],
      new Map(),
    )
    expect(fieldIds(placed[0])).toEqual(['title', 'subtitle'])
  })
})
