/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FloorPlanCanvas } from '../components/floorPlan/FloorPlanCanvas'
import type { FloorPlanLayout, FloorPlanUnit } from '../components/floorPlan/floorPlanModel'
import { PlacementEditor } from '../components/placement/PlacementEditor'
import type { FloorLayoutData } from '../components/floor/types'

const STAMP = '2026-11-01T00:00:00.000Z'
const FLOOR = { id: 'floor-1', number: 1, name: 'First', sizeX: 20, sizeY: 10, updatedAt: STAMP }

function unit(id: string, x: number, y: number): FloorPlanUnit {
  return {
    id,
    name: `Unit ${id}`,
    spaceId: 'space-1',
    catalogCategoryId: 'category-1',
    catalogProductId: 'product-1',
    categoryName: null,
    productName: null,
    use: 'leasable',
    hasBlockers: false,
    updatedAt: STAMP,
    x,
    y,
    width: 2,
    depth: 2,
    status: 'available',
  }
}

function layoutOf(units: FloorPlanUnit[]): FloorPlanLayout {
  return {
    building: { id: 'building-1', name: 'Cedar Hall', address: 'Main 1', status: 'active', updatedAt: STAMP },
    floor: FLOOR,
    floors: [FLOOR],
    spaces: [{ id: 'space-1', name: 'Whole floor', purpose: null, isDefault: true, unitCount: units.length, updatedAt: STAMP, x: 0, y: 0, width: 20, depth: 10 }],
    units,
    commonAreas: [],
  }
}

describe('floor plan keyboard access', () => {
  it('keeps a single tab stop among the unit tiles and moves it with the arrow keys', () => {
    const layout = layoutOf([unit('a', 0, 0), unit('b', 4, 0), unit('c', 8, 0)])
    renderWithProviders(<FloorPlanCanvas layout={layout} selectedUnitId={null} onSelectUnit={jest.fn()} />)
    const tiles = ['a', 'b', 'c'].map((id) => screen.getByTestId(`pm-floor-plan-unit-${id}`))

    expect(tiles.map((tile) => tile.tabIndex)).toEqual([0, -1, -1])

    act(() => tiles[0].focus())
    fireEvent.keyDown(tiles[0], { key: 'ArrowRight' })

    expect(document.activeElement).toBe(tiles[1])
    expect(tiles.map((tile) => tile.tabIndex)).toEqual([-1, 0, -1])
  })

  it('puts the tab stop on the selected unit', () => {
    const layout = layoutOf([unit('a', 0, 0), unit('b', 4, 0)])
    renderWithProviders(<FloorPlanCanvas layout={layout} selectedUnitId="b" onSelectUnit={jest.fn()} />)

    expect(screen.getByTestId('pm-floor-plan-unit-a').tabIndex).toBe(-1)
    expect(screen.getByTestId('pm-floor-plan-unit-b').tabIndex).toBe(0)
  })
})

describe('placement editor announcements', () => {
  it('includes the new position in the live region so a keyboard move is announced', () => {
    const layout: FloorLayoutData = layoutOf([])
    const values: Record<string, unknown> = { x: 1, y: 1, width: 2, depth: 2 }
    const setValue = jest.fn((id: string, value: unknown) => {
      values[id] = value
    })
    const view = renderWithProviders(
      <PlacementEditor kind="common_area" layout={layout} selfId={null} label="Kitchen" values={values} setValue={setValue} onIssuesChange={jest.fn()} />,
    )
    const status = screen.getByTestId('placement-status')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status.textContent).toContain('1, 1')

    fireEvent.keyDown(screen.getByTestId('placement-target'), { key: 'ArrowRight' })
    view.rerender(
      <PlacementEditor kind="common_area" layout={layout} selfId={null} label="Kitchen" values={{ ...values }} setValue={setValue} onIssuesChange={jest.fn()} />,
    )

    expect(setValue).toHaveBeenCalledWith('x', 1.5)
    expect(screen.getByTestId('placement-status').textContent).toContain('1.5, 1')
  })
})
