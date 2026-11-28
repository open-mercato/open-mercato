/** @jest-environment jsdom */
jest.setTimeout(15000)

// Regression guard for #8642: the two-column `7fr_3fr` group grid's column
// wrapper divs must carry `min-w-0`. Without it, a grid item's automatic
// minimum width defaults to its content's min-content size (an arbitrary
// Tailwind `grid-cols-[7fr_3fr]` value has no `minmax(0, …)` safety net,
// unlike the built-in `grid-cols-N` utilities), so an unbreakable long word
// anywhere in column 1 (e.g. a long pasted display name) inflates the whole
// grid track — and the whole page — regardless of `break-words` on the text
// itself deeper in the tree.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text' },
]

const groups: CrudFormGroup[] = [
  { id: 'main', label: 'Main', fields: ['name'], column: 1 },
  { id: 'side', label: 'Side', fields: ['name'], column: 2 },
]

describe('CrudForm two-column group grid min-width (#8642)', () => {
  it('gives both column wrapper divs min-w-0 so unbreakable content cannot inflate the grid track', () => {
    const { container } = renderWithProviders(
      React.createElement(CrudForm as never, {
        title: 'Company',
        entityId: 'customers:company',
        fields,
        groups,
        onSubmit: () => {},
      }),
    )

    const twoColumnGrid = Array.from(container.querySelectorAll('div')).find((node) =>
      node.className.includes('7fr_3fr'),
    )
    expect(twoColumnGrid).toBeTruthy()

    const columnWrappers = Array.from(twoColumnGrid!.children) as HTMLElement[]
    expect(columnWrappers.length).toBeGreaterThanOrEqual(2)
    for (const wrapper of columnWrappers) {
      expect(wrapper.className.split(/\s+/)).toContain('min-w-0')
    }
  })
})
