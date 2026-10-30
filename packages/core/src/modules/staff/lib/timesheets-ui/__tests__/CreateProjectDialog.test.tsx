/**
 * @jest-environment jsdom
 *
 * U6: the create-project dialog shipped without any `onKeyDown`, and `CrudForm`
 * bails out of its own Enter handling as soon as a modifier is held — so the
 * ⌘↵ every other dialog in this feature answers to did nothing here.
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateProjectDialog } from '../CreateProjectDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: unknown) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

/**
 * The real `CrudForm` is covered in `packages/ui`; what matters here is that the
 * dialog reaches the `<form>` it renders and submits it, so the stand-in is the
 * smallest thing with that shape.
 */
jest.mock('@open-mercato/ui/backend/CrudForm', () => {
  const ReactModule = jest.requireActual('react') as typeof React
  type Props = {
    onSubmit?: (values: Record<string, unknown>) => Promise<void> | void
    extraActions?: React.ReactNode
  }
  const CrudForm = ({ onSubmit, extraActions }: Props) =>
    ReactModule.createElement(
      'form',
      {
        'data-testid': 'crud-form',
        onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          void onSubmit?.(mockSubmittedValues)
        },
      },
      [
        ReactModule.createElement('input', { key: 'name', 'data-testid': 'project-name', name: 'name' }),
        ReactModule.createElement('button', { key: 'submit', type: 'submit' }, 'Create'),
        ReactModule.createElement('span', { key: 'extra' }, extraActions),
      ],
    )
  return { __esModule: true, CrudForm }
})

const mockCreateCrud = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
}))

const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

const mockFlash = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'

/** The shape `buildProjectPayload` reads; only the two required texts matter here. */
const mockSubmittedValues = {
  name: 'Migracja B2B',
  code: 'MIG',
  status: 'active',
  billableByDefault: true,
  codeManual: false,
}

function renderDialog(props: Partial<React.ComponentProps<typeof CreateProjectDialog>> = {}) {
  const onOpenChange = props.onOpenChange ?? jest.fn()
  const onProjectCreated = props.onProjectCreated ?? jest.fn()
  const utils = render(
    <CreateProjectDialog open onOpenChange={onOpenChange} onProjectCreated={onProjectCreated} />,
  )
  return { ...utils, onOpenChange, onProjectCreated }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateCrud.mockResolvedValue({ result: { id: PROJECT_ID, name: 'Migracja B2B', code: 'MIG' } })
  mockApiCall.mockResolvedValue({ ok: true, result: { member: null } })
})

describe('CreateProjectDialog — keyboard submit (U6)', () => {
  it('creates the project on ⌘↵', async () => {
    const { onProjectCreated } = renderDialog()

    fireEvent.keyDown(screen.getByTestId('create-project-dialog'), { key: 'Enter', metaKey: true })

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    expect(mockCreateCrud.mock.calls[0][0]).toBe('staff/timesheets/time-projects')
    await waitFor(() => expect(onProjectCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROJECT_ID }),
    ))
  })

  it('creates the project on Ctrl+↵ as well', async () => {
    renderDialog()

    fireEvent.keyDown(screen.getByTestId('create-project-dialog'), { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
  })

  it('leaves a plain ↵ to the form itself', () => {
    renderDialog()

    fireEvent.keyDown(screen.getByTestId('create-project-dialog'), { key: 'Enter' })

    expect(mockCreateCrud).not.toHaveBeenCalled()
  })

  it('still closes on Escape', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(mockCreateCrud).not.toHaveBeenCalled()
  })
})
