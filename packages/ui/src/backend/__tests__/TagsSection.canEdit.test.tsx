/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { TagsSection, type TagOption, type TagsSectionLabels } from '../detail/TagsSection'

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const labels: TagsSectionLabels = {
  loading: 'Loading…',
  placeholder: 'Add tag',
  empty: 'No tags',
  loadError: 'Load failed',
  createError: 'Create failed',
  updateError: 'Update failed',
  labelRequired: 'Label required',
  saveShortcut: 'Save',
  cancelShortcut: 'Cancel',
  edit: 'Edit',
  cancel: 'Cancel',
  success: 'Tags updated',
}

function renderSection(overrides: Partial<React.ComponentProps<typeof TagsSection>> = {}) {
  const props: React.ComponentProps<typeof TagsSection> = {
    title: 'Tags',
    tags: [{ id: 'id-alpha', label: 'alpha' }] as TagOption[],
    loadOptions: jest.fn(async () => [] as TagOption[]),
    createTag: jest.fn(async (label: string) => ({ id: `id-${label}`, label })),
    onSave: jest.fn(async () => {}),
    labels,
    ...overrides,
  }
  return render(
    <I18nProvider locale="en" dict={{}}>
      <TagsSection {...props} />
    </I18nProvider>,
  )
}

// The hover pencil is decorative (aria-hidden), so it is unreachable by role or text;
// its visibility lives entirely in the class list.
function hoverPencil(container: HTMLElement): HTMLElement {
  const span = container.querySelector<HTMLElement>('span[aria-hidden="true"]')
  if (!span) throw new Error('hover pencil not rendered')
  return span
}

describe('TagsSection — canEdit hides the edit affordances', () => {
  it('offers both affordances when editing is permitted', () => {
    const { container } = renderSection()

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(hoverPencil(container).className).toContain('group-hover/tags:opacity-100')
    expect(hoverPencil(container).className).not.toContain('hidden')
  })

  it('renders neither the header Edit button nor the hover pencil when editing is denied', () => {
    const { container } = renderSection({ canEdit: false })

    // Without this, a denied viewer saw a rendered-but-disabled Edit button.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    // Without this, the pencil still faded in on hover over a card that does nothing on click.
    expect(hoverPencil(container).className).toContain('hidden')
    expect(hoverPencil(container).className).not.toContain('group-hover/tags:opacity-100')
  })
})
