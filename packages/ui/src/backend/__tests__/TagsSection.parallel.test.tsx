/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

type Deferred = { resolve: () => void; promise: Promise<void> }

function createDeferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = () => res()
  })
  return { resolve, promise }
}

function renderSection(overrides: Partial<React.ComponentProps<typeof TagsSection>> = {}) {
  const props: React.ComponentProps<typeof TagsSection> = {
    title: 'Tags',
    tags: [],
    loadOptions: jest.fn(async () => [] as TagOption[]),
    createTag: jest.fn(async (label: string) => ({ id: `id-${label}`, label })),
    onSave: jest.fn(async () => {}),
    labels,
    ...overrides,
  }
  render(
    <I18nProvider locale="en" dict={{}}>
      <TagsSection {...props} />
    </I18nProvider>,
  )
  return props
}

async function startEditingAndAddTags(tags: string[]) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  })
  const input = await screen.findByPlaceholderText('Add tag')
  for (const tag of tags) {
    await act(async () => {
      fireEvent.change(input, { target: { value: tag } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
  }
  return input
}

describe('TagsSection — parallel tag creation (issue #3291)', () => {
  it('dispatches createTag for all new tags concurrently instead of waiting for each to settle', async () => {
    const deferreds: Deferred[] = []
    let inFlight = 0
    let maxConcurrent = 0
    const createTag = jest.fn(async (label: string) => {
      inFlight += 1
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      const deferred = createDeferred()
      deferreds.push(deferred)
      await deferred.promise
      inFlight -= 1
      return { id: `id-${label}`, label }
    })
    const onSave = jest.fn(async () => {})

    renderSection({ createTag, onSave })
    await startEditingAndAddTags(['alpha', 'beta', 'gamma'])

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    await waitFor(() => expect(createTag).toHaveBeenCalledTimes(3))
    // With the sequential implementation only one createTag would be in flight at a
    // time (maxConcurrent === 1); the parallel implementation keeps all three pending.
    expect(maxConcurrent).toBe(3)

    await act(async () => {
      deferreds.forEach((deferred) => deferred.resolve())
      await Promise.resolve()
    })

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const saveArgs = onSave.mock.calls[0][0] as { added: TagOption[] }
    expect(saveArgs.added.map((tag) => tag.label).sort()).toEqual(['alpha', 'beta', 'gamma'])
  })
})
