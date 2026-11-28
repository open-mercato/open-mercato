import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { FormSaveBar } from '../FormSaveBar'
import { formSaveBarFixtures } from '../fixtures'
import type { FormSaveBarProps } from '../../contracts/form-save-bar'

const mockWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string, fields?: Record<string, unknown>) => mockWarn(message, fields),
    error: () => undefined,
    child: () => logger,
  }
  return { createLogger: () => logger }
})

const dict = {
  ui: { blocks: { formSaveBar: { label: 'Form changes', dirty: 'Unsaved changes', save: 'Save', moreActions: 'More actions' } } },
}

function renderBar(props: FormSaveBarProps) {
  return renderWithProviders(<FormSaveBar {...props} />, { dict })
}

function collectIconNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectIconNames)
  if (!value || typeof value !== 'object' || React.isValidElement(value)) return []
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'icon' && typeof entry === 'string' ? [entry] : collectIconNames(entry),
  )
}

const noop = () => undefined
const base = { saveState: 'dirty', placement: 'inline', onSave: noop } satisfies Partial<FormSaveBarProps>

describe('FormSaveBar extra actions as links', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('renders an extra action with an href as a link inside the menu', () => {
    const onAction = jest.fn()
    renderBar({
      ...base,
      actions: [
        { key: 'history', label: 'Open history', icon: 'clock', href: '/customers/1/history' },
        { key: 'copy', label: 'Save as copy' },
        { key: 'locked', label: 'Export', href: '/export', disabled: true },
      ],
      onAction,
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const link = screen.getByRole('link', { name: 'Open history' })
    expect(link).toHaveAttribute('href', '/customers/1/history')
    expect(link).toHaveAttribute('data-slot', 'form-save-bar-menu-link')
    expect(screen.queryByRole('link', { name: 'Save as copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Export' })).not.toBeInTheDocument()
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(fireEvent.click(screen.getByRole('link', { name: 'Open history' }))).toBe(false)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('history')
  })

  it('renders no link for the existing fixtures', () => {
    renderBar(formSaveBarFixtures.withActions)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Save as copy')).toBeInTheDocument()
    expect(document.querySelector('a')).toBeNull()
  })
})

describe('FormSaveBar icon names', () => {
  beforeEach(() => mockWarn.mockClear())

  it('warns once per unknown icon name', () => {
    renderBar({ ...base, actions: [{ key: 'copy', label: 'Save as copy', icon: 'no-such-icon-form-save-bar' }], onAction: noop })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][1]).toEqual({ icon: 'no-such-icon-form-save-bar' })
  })

  it('uses only registered icon names in its fixtures', () => {
    const names = [...new Set(collectIconNames(formSaveBarFixtures))]
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => resolveRegisteredLucideIcon(name) === null)).toEqual([])
  })
})
