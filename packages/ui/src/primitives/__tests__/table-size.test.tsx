/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../table'

function renderTable(size?: 'compact' | 'default' | 'comfortable') {
  return render(
    <Table size={size}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Acme</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )
}

describe('Table row sizes', () => {
  it.each([
    [undefined, 'h-10'],
    ['compact', 'h-8'],
    ['comfortable', 'h-12'],
  ] as const)('size %s gives header and body cells %s with 16 px horizontal padding', (size, height) => {
    const { container } = renderTable(size)
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    const cell = container.querySelector('[data-slot="table-cell"]') as HTMLElement
    expect(container.querySelector('table')).toHaveAttribute('data-size', size ?? 'default')
    for (const node of [head, cell]) {
      expect(node.className).toContain(height)
      expect(node.className).toContain('px-4')
    }
  })
})
