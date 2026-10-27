import { planFloorResize } from '../lib/floorLayout'
import type { CommonArea, Space, Unit } from '../data/entities'

function space(input: Partial<Space> & Pick<Space, 'id' | 'name'>): Space {
  return { x: '0', y: '0', width: '10', depth: '10', isDefault: false, ...input } as Space
}

function unit(input: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'spaceId'>): Unit {
  return { x: '0', y: '0', width: '2', depth: '2', ...input } as Unit
}

function area(input: Partial<CommonArea> & Pick<CommonArea, 'id' | 'name'>): CommonArea {
  return { x: '0', y: '0', width: '2', depth: '2', ...input } as CommonArea
}

const current = { x: 0, y: 0, width: 20, depth: 10 }

describe('planFloorResize', () => {
  it('resizes a default space that covers the whole floor together with it', () => {
    const whole = space({ id: 's1', name: 'Whole floor', width: '20', depth: '10', isDefault: true })
    const plan = planFloorResize(current, { x: 0, y: 0, width: 30, depth: 12 }, [whole], [unit({ id: 'u1', name: 'Office', spaceId: 's1' })], [])
    expect(plan.outside).toEqual([])
    expect(plan.defaultSpace?.id).toBe('s1')
  })

  it('names the unit a smaller floor would leave outside its default space', () => {
    const whole = space({ id: 's1', name: 'Whole floor', width: '20', depth: '10', isDefault: true })
    const office = unit({ id: 'u1', name: 'Office 202', spaceId: 's1', x: '15', width: '4' })
    const plan = planFloorResize(current, { x: 0, y: 0, width: 16, depth: 10 }, [whole], [office], [])
    expect(plan.outside).toEqual(['Office 202'])
  })

  it('names spaces and common areas that would fall outside a divided floor', () => {
    const left = space({ id: 's1', name: 'Reception', width: '8', depth: '10', isDefault: true })
    const right = space({ id: 's2', name: 'Parking', x: '12', width: '8', depth: '10' })
    const kitchen = area({ id: 'a1', name: 'Kitchen', x: '9', y: '7', width: '2', depth: '3' })
    const plan = planFloorResize(current, { x: 0, y: 0, width: 18, depth: 9 }, [left, right], [], [kitchen])
    expect(plan.defaultSpace).toBeNull()
    expect(plan.outside).toEqual(['Reception', 'Parking', 'Kitchen'])
  })
})
