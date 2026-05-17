jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!vars) return fallback
    return Object.entries(vars).reduce((s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)), fallback)
  },
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { FilteredEmptyResults } from '../FilteredEmptyResults'

describe('FilteredEmptyResults', () => {
  it('renders title with entityNamePlural interpolated', () => {
    render(<FilteredEmptyResults entityNamePlural="people" canRemoveLast onClearAll={() => {}} onRemoveLast={() => {}} />)
    expect(screen.getByText(/no people match these filters/i)).toBeInTheDocument()
  })

  it('calls onClearAll on Clear button click', () => {
    const onClearAll = jest.fn()
    render(<FilteredEmptyResults entityNamePlural="people" canRemoveLast onClearAll={onClearAll} onRemoveLast={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }))
    expect(onClearAll).toHaveBeenCalled()
  })

  it('calls onRemoveLast on Remove last click', () => {
    const onRemoveLast = jest.fn()
    render(<FilteredEmptyResults entityNamePlural="people" canRemoveLast onClearAll={() => {}} onRemoveLast={onRemoveLast} />)
    fireEvent.click(screen.getByRole('button', { name: /remove last filter/i }))
    expect(onRemoveLast).toHaveBeenCalled()
  })

  it('disables remove last when canRemoveLast=false', () => {
    render(<FilteredEmptyResults entityNamePlural="people" canRemoveLast={false} onClearAll={() => {}} onRemoveLast={() => {}} />)
    expect(screen.getByRole('button', { name: /remove last filter/i })).toBeDisabled()
  })
})
