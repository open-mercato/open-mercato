/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import english from '../../i18n/en.json'
import { entries } from '../entries/overlays'

function wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale="en" dict={english}>{children}</I18nProvider>
}

const dialog = entries.find(entry => entry.id === 'dialog')!
const presentationVariants = dialog.variants.filter(variant => /^(header|footer|status-horizontal|status-vertical)-/.test(variant.id))

it('shows every dialog presentation variant inline without opening overlays or capturing focus', () => {
  const { container } = render(<>{presentationVariants.map(variant => <React.Fragment key={variant.id}>{variant.render()}</React.Fragment>)}</>, { wrapper })
  expect(container.querySelectorAll('[data-dialog-preview]')).toHaveLength(presentationVariants.length)
  expect(screen.getAllByRole('heading', { name: english['design_system.gallery.samples.overlay.title'] })).toHaveLength(presentationVariants.length)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: english['design_system.gallery.samples.overlay.openDialog'] })).not.toBeInTheDocument()
  expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
  expect(document.activeElement).toBe(document.body)
  expect(document.body.style.pointerEvents).not.toBe('none')
})

it('preserves an interactive example for trying actual dialog behavior', () => {
  render(<>{dialog.variants.find(variant => variant.id === 'default')!.render()}</>, { wrapper })
  fireEvent.click(screen.getByRole('button', { name: english['design_system.gallery.samples.overlay.openDialog'] }))
  expect(screen.getByRole('dialog')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: english['design_system.gallery.samples.overlay.cancel'] }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
