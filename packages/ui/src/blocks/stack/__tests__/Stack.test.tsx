import * as React from 'react'
import { render } from '@testing-library/react'
import { Inline, Stack } from '../Stack'
import { stackFixtures } from '../fixtures'
import { stackPropsSchema } from '../../contracts/stack'

describe('Stack', () => {
  it('renders a column flex container with the default gap', () => {
    const { container } = render(<Stack>content</Stack>)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('flex-col')
    expect(root.className).toContain('gap-3')
  })

  it('applies gap, align, justify and wrap classes', () => {
    const { container } = render(
      <Stack gap={8} align="center" justify="between" wrap className="extra">
        content
      </Stack>,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('gap-8')
    expect(root.className).toContain('items-center')
    expect(root.className).toContain('justify-between')
    expect(root.className).toContain('flex-wrap')
    expect(root.className).toContain('extra')
  })

  it('maps every gap value to a literal class', () => {
    const gaps = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12] as const
    for (const gap of gaps) {
      const { container, unmount } = render(<Stack gap={gap} />)
      expect((container.firstElementChild as HTMLElement).className).toContain(`gap-${gap}`)
      unmount()
    }
  })

  it('renders Inline as a row', () => {
    const { container } = render(<Inline align="baseline" justify="end">content</Inline>)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('flex-row')
    expect(root.className).toContain('items-baseline')
    expect(root.className).toContain('justify-end')
    expect(root.className).not.toContain('flex-wrap')
  })

  it('parses every fixture against the contract schema', () => {
    for (const [name, fixture] of Object.entries(stackFixtures)) {
      expect({ name, ok: stackPropsSchema.safeParse(fixture).success }).toEqual({ name, ok: true })
    }
  })
})
