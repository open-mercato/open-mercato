/**
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals'
import {
  InjectionPosition,
  insertByInjectionPlacement,
} from '@open-mercato/shared/modules/widgets/injection-position'

type Item = { id: string }

describe('injection-position', () => {
  it('should resolve insertion order for before/after/first/last', () => {
    let items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    items = insertByInjectionPlacement(items, { id: 'x' }, { position: InjectionPosition.Before, relativeTo: 'b' }, (entry) => entry.id)
    items = insertByInjectionPlacement(items, { id: 'y' }, { position: InjectionPosition.After, relativeTo: 'a' }, (entry) => entry.id)
    items = insertByInjectionPlacement(items, { id: 'z' }, { position: InjectionPosition.First }, (entry) => entry.id)
    items = insertByInjectionPlacement(items, { id: 'w' }, { position: InjectionPosition.Last }, (entry) => entry.id)

    expect(items.map((entry) => entry.id)).toEqual(['z', 'a', 'y', 'x', 'b', 'c', 'w'])
  })

  it('should append item when relative target is missing', () => {
    const items = insertByInjectionPlacement(
      [{ id: 'a' }],
      { id: 'x' },
      { position: InjectionPosition.Before, relativeTo: 'missing' },
      (entry) => entry.id,
    )

    expect(items.map((entry) => entry.id)).toEqual(['a', 'x'])
  })
})
