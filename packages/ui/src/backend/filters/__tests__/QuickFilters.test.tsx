jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { QuickFilters, type FilterPreset } from '../QuickFilters'
import { createEmptyTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'

const presets: FilterPreset[] = [
  { id: 'recent', labelKey: 'ui.test.recent', iconName: 'clock', build: () => createEmptyTree() },
  { id: 'mine', labelKey: 'ui.test.mine', build: () => createEmptyTree() },
]

describe('QuickFilters', () => {
  it('renders nothing when no presets', () => {
    const { container } = render(<QuickFilters presets={[]} userId="u1" onApply={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a chip per preset', () => {
    render(<QuickFilters presets={presets} userId="u1" onApply={() => {}} />)
    expect(screen.getByRole('button', { name: /ui.test.recent/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ui.test.mine/i })).toBeInTheDocument()
  })

  it('calls onApply with the built tree on click and passes userId+now', () => {
    const onApply = jest.fn()
    const build = jest.fn(() => createEmptyTree())
    render(<QuickFilters presets={[{ id: 'mine', labelKey: 'k', build }]} userId="u-42" onApply={onApply} />)
    fireEvent.click(screen.getByRole('button'))
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-42', now: expect.any(Date) }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
