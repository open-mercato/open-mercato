/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../table'

describe('Table primitive (Phase B.6 polish)', () => {
  it('renders a <table> with data-slot attributes for each slot', () => {
    const { container } = render(
      <Table>
        <TableCaption>Members directory</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Jan</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>1 member</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    expect(container.querySelector('[data-slot="table"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-caption"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-header"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-body"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-footer"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="table-row"]').length).toBe(3)
    expect(container.querySelector('[data-slot="table-head"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="table-cell"]')).not.toBeNull()
  })

  it('TableHeader gets bg-muted/40 strip per Figma', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Col</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const head = container.querySelector('[data-slot="table-header"]') as HTMLElement
    expect(head.className).toContain('bg-muted/40')
  })

  it('TableFooter gets bordered top + bg-muted/40 strip', () => {
    const { container } = render(
      <Table>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    const footer = container.querySelector('[data-slot="table-footer"]') as HTMLElement
    expect(footer.className).toContain('border-t')
    expect(footer.className).toContain('bg-muted/40')
    expect(footer.className).toContain('font-medium')
  })

  it('TableRow gets hover:bg-muted/30 by default + border-b last:border-b-0', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const row = container.querySelector('tbody [data-slot="table-row"]') as HTMLElement
    expect(row.className).toContain('hover:bg-muted/30')
    expect(row.className).toContain('border-b')
    expect(row.className).toContain('last:border-b-0')
    expect(row.className).toContain('transition-colors')
  })

  it('Striped variant adds even-row bg-muted/20 via context', () => {
    const { container } = render(
      <Table variant="striped">
        <TableBody>
          <TableRow>
            <TableCell>1</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>2</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const root = container.querySelector('[data-slot="table"]') as HTMLElement
    expect(root.getAttribute('data-variant')).toBe('striped')
    const rows = Array.from(
      container.querySelectorAll('tbody [data-slot="table-row"]'),
    ) as HTMLElement[]
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.className).toContain('even:bg-muted/20')
    }
  })

  it('Default variant data-variant attribute reads "default"', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const root = container.querySelector('[data-slot="table"]') as HTMLElement
    expect(root.getAttribute('data-variant')).toBe('default')
    const row = container.querySelector('tbody [data-slot="table-row"]') as HTMLElement
    expect(row.className).not.toContain('even:bg-muted/20')
  })

  it('TableHead keeps text-muted-foreground + font-medium + whitespace-nowrap', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Header</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const head = container.querySelector('[data-slot="table-head"]') as HTMLElement
    expect(head.className).toContain('text-muted-foreground')
    expect(head.className).toContain('font-medium')
    expect(head.className).toContain('whitespace-nowrap')
    expect(head.className).toContain('px-4')
    expect(head.className).toContain('py-2')
  })

  it('TableCell keeps the original px-4 py-2 padding (backward compat)', () => {
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>cell</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const cell = container.querySelector('[data-slot="table-cell"]') as HTMLElement
    expect(cell.className).toContain('px-4')
    expect(cell.className).toContain('py-2')
  })

  it('forwards className on every slot', () => {
    const { container } = render(
      <Table className="t-custom">
        <TableCaption className="cap-custom">cap</TableCaption>
        <TableHeader className="head-custom">
          <TableRow className="row-custom">
            <TableHead className="th-custom">x</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="body-custom">
          <TableRow>
            <TableCell className="cell-custom">x</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter className="foot-custom">
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    expect(container.querySelector('[data-slot="table"]')!.className).toContain('t-custom')
    expect(container.querySelector('[data-slot="table-caption"]')!.className).toContain('cap-custom')
    expect(container.querySelector('[data-slot="table-header"]')!.className).toContain('head-custom')
    expect(container.querySelector('[data-slot="table-row"]')!.className).toContain('row-custom')
    expect(container.querySelector('[data-slot="table-head"]')!.className).toContain('th-custom')
    expect(container.querySelector('[data-slot="table-body"]')!.className).toContain('body-custom')
    expect(container.querySelector('[data-slot="table-cell"]')!.className).toContain('cell-custom')
    expect(container.querySelector('[data-slot="table-footer"]')!.className).toContain('foot-custom')
  })
})
