/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { ViewChip } from '../views/ViewChip'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

// Coverage for issue #5846: the chip's "this view is active" state used to live
// only in its Tailwind classes (`bg-brand-violet/10 border-brand-violet/30 ...`),
// so the only way to assert it was to string-match `className` on `.parentElement`.
// That broke on any restyle and left the state invisible to assistive technology.
// The chip now carries `data-active` on its root and `aria-current` on the button
// the user actually activates, mirroring how `pagination.tsx` marks the current page.

type ChipProps = React.ComponentProps<typeof ViewChip>

function renderChip(overrides: Partial<ChipProps> = {}) {
  const props: ChipProps = {
    id: 'view-1',
    label: 'My view',
    kind: 'personal',
    isActive: false,
    disabled: false,
    isShared: false,
    isRenaming: false,
    renameValue: '',
    canApplyToRoles: false,
    deleting: false,
    onActivate: jest.fn(),
    onRenameValueChange: jest.fn(),
    onRenameConfirm: jest.fn(),
    onRenameCancel: jest.fn(),
    onClone: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  }
  return renderWithProviders(<ViewChip {...props} />, { dict: {} })
}

describe('ViewChip active-state hook', () => {
  it('marks the active chip with data-active="true" and aria-current on its activate button', () => {
    const { container } = renderChip({ isActive: true, label: 'Active view' })

    expect(container.querySelector('[data-active="true"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Active view' })).toHaveAttribute('aria-current', 'true')
  })

  it('marks an inactive chip with data-active="false" and omits aria-current entirely', () => {
    const { container } = renderChip({ isActive: false, label: 'Inactive view' })

    expect(container.querySelector('[data-active="false"]')).toBeInTheDocument()
    expect(container.querySelector('[data-active="true"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Inactive view' })).not.toHaveAttribute('aria-current')
  })

  it('exposes the active state without depending on the chip styling', () => {
    const { container } = renderChip({ isActive: true, label: 'Styled view' })

    const chip = container.querySelector('[data-active]') as HTMLElement
    expect(chip).toBeInTheDocument()

    // Strip every class off the chip: the semantic hook must survive a restyle
    // that drops or renames the `border-brand-violet/30` marker the old assertion read.
    chip.className = ''
    expect(chip.getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('button', { name: 'Styled view' })).toHaveAttribute('aria-current', 'true')
  })

  it('keeps the hook on the chip root while the view is being renamed', () => {
    const { container } = renderChip({ isActive: true, isRenaming: true, renameValue: 'Draft name' })

    expect(container.querySelector('[data-active="true"]')).toBeInTheDocument()
  })
})
