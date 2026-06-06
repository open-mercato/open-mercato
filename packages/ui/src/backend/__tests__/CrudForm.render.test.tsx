/** @jest-environment jsdom */
jest.setTimeout(15000)

const triggerInjectionEventMock = jest.fn(async (_event: string, data: Record<string, unknown>) => ({
  ok: true,
  data,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerInjectionEventMock }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

describe('CrudForm SSR render', () => {
  it('renders base fields', () => {
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'is_done', label: 'Done', type: 'checkbox' },
    ]
    const html = renderToString(
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(CrudForm as any, {
          title: 'Form',
          fields,
          onSubmit: () => {},
        })
      )
    )
    expect(html).toContain('Title')
    expect(html).toContain('Done')
  })
})

describe('CrudForm initialValues', () => {
  const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]

  beforeEach(() => {
    triggerInjectionEventMock.mockClear()
  })

  function getInput(container: HTMLElement): HTMLInputElement {
    return container.querySelector('[data-crud-field-id="name"] input[type="text"]') as HTMLInputElement
  }

  it('syncs fields when initialValues data changes', async () => {
    const { container, rerender } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />
    )

    expect(getInput(container).value).toBe('Alice')

    await act(async () => {
      rerender(
        <CrudForm title="Form" fields={fields} initialValues={{ name: 'Bob' }} onSubmit={() => {}} />
      )
    })

    expect(getInput(container).value).toBe('Bob')
  })

  it('shows the selected label when select options arrive after the saved value', async () => {
    const makeFields = (options: Array<{ label: string; value: string }>): CrudField[] => [
      { id: 'teamId', label: 'Team', type: 'select', options },
    ]

    const { getByRole, rerender } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={makeFields([])}
        initialValues={{ teamId: 'team-1' }}
        onSubmit={() => {}}
      />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.select.emptyOption': '—',
        },
      },
    )

    expect(getByRole('combobox')).not.toHaveTextContent('Engineering')

    await act(async () => {
      rerender(
        <CrudForm
          title="Form"
          fields={makeFields([{ value: 'team-1', label: 'Engineering' }])}
          initialValues={{ teamId: 'team-1' }}
          onSubmit={() => {}}
        />,
      )
    })

    await waitFor(() => {
      expect(getByRole('combobox')).toHaveTextContent('Engineering')
    })
  })

  it('does not submit when a listbox multi-select option is clicked', async () => {
    const onSubmit = jest.fn()
    const fields: CrudField[] = [
      {
        id: 'assignees',
        label: 'Assignees',
        type: 'select',
        multiple: true,
        listbox: true,
        options: [
          { value: 'alice', label: 'alice' },
          { value: 'bob', label: 'bob' },
        ],
      },
    ]

    renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ assignees: [] }} onSubmit={onSubmit} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
          'ui.forms.listbox.searchPlaceholder': 'Search...',
          'ui.forms.listbox.noMatches': 'No matches',
        },
      },
    )

    const aliceOption = screen.getByRole('button', { name: 'alice' })
    expect(aliceOption).toHaveAttribute('type', 'button')

    fireEvent.click(aliceOption)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not re-invoke loadOptions on parent re-render (#814)', async () => {
    const loader = jest.fn().mockResolvedValue([{ label: 'A', value: 'a' }])
    const baseFields: CrudField[] = [
      { id: 'pick', label: 'Pick', type: 'combobox', loadOptions: loader },
    ]
    const { rerender } = renderWithProviders(
      <CrudForm title="Form" fields={baseFields} onSubmit={() => {}} />
    )
    await act(() => Promise.resolve())
    const callsAfterMount = loader.mock.calls.length

    await act(async () => {
      rerender(
        <CrudForm title="Form" fields={[...baseFields]} onSubmit={() => {}} />
      )
    })
    await act(() => Promise.resolve())
    // After the infinite-loop fix (#845), a new fields array reference may
    // trigger one additional loadOptions call; verify it does not spiral.
    expect(loader.mock.calls.length).toBeLessThanOrEqual(callsAfterMount + 1)
  })

  it('re-invokes loadOptions and refreshes cached options when the loader identity changes (#1538)', async () => {
    const firstLoader = jest.fn().mockResolvedValue([{ label: 'Alpha', value: 'alpha' }])
    const secondLoader = jest.fn().mockResolvedValue([{ label: 'Beta', value: 'beta' }])
    const makeFields = (loader: (q?: string) => Promise<{ label: string; value: string }[]>): CrudField[] => [
      { id: 'pick', label: 'Pick', type: 'combobox', loadOptions: loader },
    ]

    const { rerender, container } = renderWithProviders(
      <CrudForm title="Form" fields={makeFields(firstLoader)} onSubmit={() => {}} />
    )
    await act(() => Promise.resolve())
    expect(firstLoader).toHaveBeenCalled()
    expect(secondLoader).not.toHaveBeenCalled()

    await act(async () => {
      rerender(
        <CrudForm title="Form" fields={makeFields(secondLoader)} onSubmit={() => {}} />
      )
    })
    await act(() => Promise.resolve())

    // The new loader MUST run because it captures different parent state
    // (e.g. tenant scope). Reusing cached options from the old loader would
    // leak cross-scope values such as roles from another tenant.
    expect(secondLoader).toHaveBeenCalled()
    const fieldNode = container.querySelector('[data-crud-field-id="pick"]')
    expect(fieldNode).not.toBeNull()
  })

  it('does not reset fields on initialValues reference churn', async () => {
    const { container, rerender } = renderWithProviders(
      <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />
    )

    const input = getInput(container)
    expect(input.value).toBe('Alice')

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Alice edited' } })
    })

    expect(input.value).toBe('Alice edited')

    await act(async () => {
      rerender(
        <CrudForm title="Form" fields={fields} initialValues={{ name: 'Alice' }} onSubmit={() => {}} />
      )
    })

    expect(input.value).toBe('Alice edited')
  })

  it('hides destructive and submit actions when rendered in read-only mode', () => {
    const { queryByRole, getByText } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ id: 'link_1', name: 'Alice' }}
        readOnly
        readOnlyOverlay={<div>Locked overlay</div>}
        deleteVisible
        onSubmit={() => {}}
        onDelete={() => {}}
      />
    )

    expect(getByText('Locked overlay')).toBeInTheDocument()
    expect(queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('autofocuses the first combobox without opening suggestions on mount', async () => {
    jest.useFakeTimers()

    const loadOptions = jest.fn().mockResolvedValue([{ label: 'Alpha', value: 'alpha' }])
    const fields: CrudField[] = [
      { id: 'primary_choice', label: 'Primary choice', type: 'combobox', loadOptions },
      { id: 'secondary_title', label: 'Secondary title', type: 'text' },
    ]

    const { container, queryByRole } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
        },
      },
    )

    const comboboxInput = container.querySelector('[data-crud-field-id="primary_choice"] input[type="text"]') as HTMLInputElement | null
    expect(comboboxInput).not.toBeNull()

    await waitFor(() => {
      expect(document.activeElement).toBe(comboboxInput)
    })

    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })

    expect(queryByRole('button', { name: 'Alpha' })).toBeNull()
    jest.useRealTimers()
  })

  it('autofocuses the first relation field on mount', async () => {
    const loadOptions = jest.fn().mockResolvedValue([{ label: 'Alpha', value: 'alpha' }])
    const fields: CrudField[] = [
      { id: 'primary_choice', label: 'Primary choice', type: 'relation', loadOptions },
      { id: 'secondary_title', label: 'Secondary title', type: 'text' },
    ]

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
        },
      },
    )

    const relationInput = container.querySelector('[data-crud-field-id="primary_choice"] input[type="text"]') as HTMLInputElement | null
    expect(relationInput).not.toBeNull()

    await waitFor(() => {
      expect(document.activeElement).toBe(relationInput)
    })
  })

  it('respects disableInitialFocus', async () => {
    const fields: CrudField[] = [
      { id: 'title', label: 'Title', type: 'text' },
      { id: 'summary', label: 'Summary', type: 'text' },
    ]

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} disableInitialFocus onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
        },
      },
    )

    const titleInput = container.querySelector('[data-crud-field-id="title"] input[type="text"]') as HTMLInputElement | null
    expect(titleInput).not.toBeNull()

    await waitFor(() => {
      expect(document.activeElement).not.toBe(titleInput)
    })
  })

  it('can autofocus the first combobox after initial loading is finished', async () => {
    jest.useFakeTimers()

    const loadOptions = jest.fn().mockResolvedValue([{ label: 'Alpha', value: 'alpha' }])
    const fields: CrudField[] = [
      { id: 'primary_choice', label: 'Primary choice', type: 'combobox', loadOptions },
      { id: 'secondary_title', label: 'Secondary title', type: 'text' },
    ]

    const { container, rerender, queryByRole } = renderWithProviders(
      <CrudForm title="Form" fields={fields} disableInitialFocus onSubmit={() => {}} />,
      {
        dict: {
          'ui.forms.actions.save': 'Save',
        },
      },
    )

    const comboboxInput = container.querySelector('[data-crud-field-id="primary_choice"] input[type="text"]') as HTMLInputElement | null
    expect(comboboxInput).not.toBeNull()
    expect(document.activeElement).not.toBe(comboboxInput)

    await act(async () => {
      rerender(<CrudForm title="Form" fields={fields} onSubmit={() => {}} />)
      jest.advanceTimersByTime(250)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(comboboxInput)
    })

    await waitFor(() => {
      expect(queryByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    })

    jest.useRealTimers()
  })
})
