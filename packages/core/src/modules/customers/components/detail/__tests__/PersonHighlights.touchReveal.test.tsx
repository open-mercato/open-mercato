/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PersonHighlights } from '../PersonHighlights'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/backend/customers/people/person-1',
}))

const COARSE_POINTER_REVEAL = '[@media(hover:none)]:opacity-100'

// The Company trigger labels itself from ui.forms.actions.edit, while the shared inline
// editors use ui.detail.inline.edit. Naming the Company one distinctly is what lets these
// assertions single it out instead of matching the four shared triggers beside it.
const dict = {
  'ui.forms.actions.edit': 'Edit company',
  'ui.forms.actions.cancel': 'Cancel company edit',
}

const noopValidator = () => null

function renderHighlights() {
  return renderWithProviders(
    <PersonHighlights
      person={{ id: 'person-1', displayName: 'Ada Lovelace' }}
      profile={null}
      validators={{ email: noopValidator, phone: noopValidator, displayName: noopValidator }}
      onDisplayNameSave={jest.fn()}
      onPrimaryEmailSave={jest.fn()}
      onPrimaryPhoneSave={jest.fn()}
      onStatusSave={jest.fn()}
      onNextInteractionSave={jest.fn()}
      onDelete={jest.fn()}
      isDeleting={false}
      onCompanySave={jest.fn()}
    />,
    { dict },
  )
}

describe('PersonHighlights edit triggers on coarse-pointer devices (#5947)', () => {
  it('reveals the hand-rolled Company trigger, which the shared constant does not reach', () => {
    renderHighlights()

    // The Company panel activates only once a company is assigned, and then it navigates to
    // that company rather than opening this editor. So while the trigger sits at opacity-0
    // under `hover: none`, the Company field cannot be set, changed or cleared at all.
    const trigger = screen.getByRole('button', { name: 'Edit company' })
    expect(trigger.className.split(/\s+/)).toContain(COARSE_POINTER_REVEAL)
  })

  it('reveals the shared inline-editor triggers on the same panel', () => {
    renderHighlights()

    // Those four pass their own hover-only triggerClassName, so they only stay reachable
    // because tailwind-merge keeps the constant's arbitrary variant alongside the override.
    const triggers = screen.getAllByRole('button', { name: 'Edit' })
    expect(triggers.length).toBeGreaterThan(1)

    for (const trigger of triggers) {
      expect(trigger.className.split(/\s+/)).toContain(COARSE_POINTER_REVEAL)
    }
  })
})
