/**
 * @jest-environment jsdom
 *
 * Regression for #5923: the deals view switcher hardcoded all three tabs, so an
 * app that does not use one of them (typically Map, with no geocoded deal
 * addresses) could only remove it by forking the three pages that render the row.
 *
 * Both halves of the fix are asserted, because either can regress on its own.
 * `visibleViews` is the contract that hides a tab, and the pages resolving the row
 * through the component registry is what lets a host reach that prop at all —
 * reverting the call sites to `<ViewTabsRow …>` leaves every behavioural
 * assertion below green while restoring the exact problem the issue reported.
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import { registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

import {
  ViewTabsRow,
  VIEW_TABS_ROW_COMPONENT_ID,
  resolveVisibleViews,
  type ViewTabsRowProps,
} from '../ViewTabsRow'

function tabNames(): string[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent ?? '')
}

function selectedTabName(): string | undefined {
  return screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? undefined
}

afterEach(() => {
  registerComponentOverrides([])
  cleanup()
})

describe('ViewTabsRow visibleViews', () => {
  it('renders every view in canonical order when the host passes no subset', () => {
    render(<ViewTabsRow active="list" />)

    expect(tabNames()).toEqual(['Kanban', 'List', 'Map'])
    expect(selectedTabName()).toBe('List')
    expect(screen.getByRole('tab', { name: 'Kanban' })).toHaveAttribute('href', '/backend/customers/deals/pipeline')
    expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('href', '/backend/customers/deals/map')
  })

  it('hides a view the host left out of visibleViews', () => {
    render(<ViewTabsRow active="list" visibleViews={['kanban', 'list']} />)

    expect(tabNames()).toEqual(['Kanban', 'List'])
    expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull()
  })

  it('keeps the active view visible even when the host excluded it', () => {
    render(<ViewTabsRow active="map" visibleViews={['kanban', 'list']} />)

    expect(tabNames()).toEqual(['Kanban', 'List', 'Map'])
    expect(selectedTabName()).toBe('Map')
  })

  it('renders only the active tab for an empty subset instead of an empty tab row', () => {
    render(<ViewTabsRow active="kanban" visibleViews={[]} />)

    expect(tabNames()).toEqual(['Kanban'])
  })
})

describe('resolveVisibleViews', () => {
  it('keeps canonical order regardless of the order the host listed', () => {
    expect(resolveVisibleViews('kanban', ['map', 'kanban'])).toEqual(['kanban', 'map'])
  })

  it('deduplicates repeated entries', () => {
    expect(resolveVisibleViews('list', ['list', 'list', 'kanban'])).toEqual(['kanban', 'list'])
  })

  it('drops values that are not deals views', () => {
    const fromUntypedConfig = ['kanban', 'timeline'] as unknown as ViewTabsRowProps['visibleViews']

    expect(resolveVisibleViews('kanban', fromUntypedConfig)).toEqual(['kanban'])
  })
})

describe('component-registry wiring', () => {
  function Host() {
    const Resolved = useRegisteredComponent<ViewTabsRowProps>(VIEW_TABS_ROW_COMPONENT_ID, ViewTabsRow)
    return <Resolved active="list" />
  }

  it('lets a props-mode override hide a tab without touching the host page', () => {
    registerComponentOverrides([
      {
        target: { componentId: VIEW_TABS_ROW_COMPONENT_ID },
        priority: 50,
        metadata: { module: 'test' },
        propsTransform: (props) => ({ ...(props as ViewTabsRowProps), visibleViews: ['kanban', 'list'] }),
      },
    ])

    render(<Host />)

    expect(tabNames()).toEqual(['Kanban', 'List'])
  })

  it('renders the platform default when no override is registered', () => {
    render(<Host />)

    expect(tabNames()).toEqual(['Kanban', 'List', 'Map'])
  })

  it.each([
    ['kanban', path.join(__dirname, '..', '..', 'page.tsx')],
    ['list', path.join(__dirname, '..', '..', '..', 'page.tsx')],
    ['map', path.join(__dirname, '..', '..', '..', 'map', 'page.tsx')],
  ])('resolves the row through the registry on the %s page', (_view, pagePath) => {
    const source = readFileSync(pagePath, 'utf8')

    expect(source).toContain('VIEW_TABS_ROW_COMPONENT_ID')
    // `<ViewTabsRow …>` as an element, not the `useRegisteredComponent<ViewTabsRowProps>`
    // type argument the resolved call site legitimately carries.
    expect(source).not.toMatch(/<ViewTabsRow[\s/>]/)
  })
})
