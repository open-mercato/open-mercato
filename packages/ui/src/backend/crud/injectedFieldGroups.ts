import type { InjectionFieldDefinition } from '@open-mercato/shared/modules/widgets/injection'
import { insertByInjectionPlacement } from '@open-mercato/shared/modules/widgets/injection-position'
import type { CrudFormGroup } from '../CrudForm'

export type InjectedFieldWidgetPlacement = {
  kind?: 'tab' | 'group' | 'stack'
  groupLabel?: string
  groupDescription?: string
  column?: 1 | 2
}

export const INJECTED_FIELDS_FALLBACK_GROUP_ID = '__injected-fields__'

function hostsPlainFields(group: CrudFormGroup): boolean {
  return group.kind !== 'customFields' && !group.bare
}

function entryId(entry: NonNullable<CrudFormGroup['fields']>[number]): string {
  return typeof entry === 'string' ? entry : entry.id
}

/**
 * Places injected field definitions into the host form's groups.
 *
 * - A field whose `group` matches a declared group is inserted there (honoring `placement`).
 * - A field whose `group` is not declared, injected by a widget mapped with `kind: 'group'`,
 *   gets its own card built from the injection-table `groupLabel`/`groupDescription`/`column`.
 * - Any other field falls back to the last group that renders plain fields — never into a
 *   `customFields` or `bare` group, which do not render `group.fields` and would drop it.
 *   A field that explicitly names a `customFields` or `bare` group is still placed there and,
 *   like any non-field entry of such a group, is not rendered.
 */
export function placeInjectedFieldsInGroups(
  groups: CrudFormGroup[],
  definitions: InjectionFieldDefinition[],
  placementByFieldId: ReadonlyMap<string, InjectedFieldWidgetPlacement | undefined>,
  onFallback?: (definition: InjectionFieldDefinition) => void,
): CrudFormGroup[] {
  const placed: CrudFormGroup[] = groups.map((group) => ({ ...group, fields: [...(group.fields ?? [])] }))
  let fallbackIndex = -1
  for (let index = placed.length - 1; index >= 0; index -= 1) {
    if (hostsPlainFields(placed[index])) {
      fallbackIndex = index
      break
    }
  }

  for (const definition of definitions) {
    let index = definition.group ? placed.findIndex((group) => group.id === definition.group) : -1
    if (index < 0) {
      const placement = placementByFieldId.get(definition.id)
      if (definition.group && placement?.kind === 'group') {
        placed.push({
          id: definition.group,
          title: placement.groupLabel,
          description: placement.groupDescription,
          column: placement.column === 2 ? 2 : 1,
          fields: [],
        })
        index = placed.length - 1
      } else {
        onFallback?.(definition)
        if (fallbackIndex < 0) {
          placed.push({ id: INJECTED_FIELDS_FALLBACK_GROUP_ID, fields: [] })
          fallbackIndex = placed.length - 1
        }
        index = fallbackIndex
      }
    }
    const fieldEntries = placed[index].fields ?? []
    if (fieldEntries.some((entry) => entryId(entry) === definition.id)) continue
    placed[index].fields = insertByInjectionPlacement(fieldEntries, definition.id, definition.placement, entryId)
  }
  return placed
}
