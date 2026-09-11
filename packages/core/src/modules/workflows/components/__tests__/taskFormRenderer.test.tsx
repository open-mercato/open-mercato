/**
 * @jest-environment jsdom
 *
 * External task form renderer binding (#4243, spec §6.1 §6).
 *
 * Two acceptance criteria live here: a registered `formKey` renders the
 * external form with its typed context, and an UNKNOWN key degrades to the
 * built-in form **with a visible notice** — never a blank screen.
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TaskFormFields } from '../work-inbox/TaskFormFields'
import {
  clearTaskFormRenderers,
  registerTaskFormRenderer,
  type TaskFormRendererProps,
} from '../../lib/task-form-registry'

const jsonSchema = {
  type: 'object' as const,
  properties: { amount: { type: 'number', title: 'Amount' } },
  required: ['amount'],
}

const studioSchema = {
  fields: [{ name: 'reason', type: 'text', label: 'Reason', required: true }],
} as never

function CreditCheckForm({ context }: TaskFormRendererProps) {
  return (
    <div>
      <p data-testid="external-form">external:{context.formKey}</p>
      <p data-testid="external-task">{context.taskName}</p>
    </div>
  )
}

beforeEach(() => {
  clearTaskFormRenderers()
})

describe('TaskFormFields — external renderer registry', () => {
  it('renders the registered renderer with its typed context', () => {
    registerTaskFormRenderer({ formKey: 'credit-check', Renderer: CreditCheckForm })

    renderWithProviders(
      <TaskFormFields
        formSchema={jsonSchema}
        values={{}}
        invalidField={null}
        onFieldChange={() => {}}
        formKey="credit-check"
        taskId="task-1"
        taskName="Approve the order"
      />
    )

    expect(screen.getByTestId('external-form')).toHaveTextContent('external:credit-check')
    expect(screen.getByTestId('external-task')).toHaveTextContent('Approve the order')
    expect(screen.queryByTestId('task-form-renderer-missing')).not.toBeInTheDocument()
  })

  it('degrades an unknown formKey to the built-in form WITH a visible notice', () => {
    renderWithProviders(
      <TaskFormFields
        formSchema={jsonSchema}
        values={{}}
        invalidField={null}
        onFieldChange={() => {}}
        formKey="not-loaded"
        taskId="task-1"
      />
    )

    const notice = screen.getByTestId('task-form-renderer-missing')
    expect(notice).toBeInTheDocument()
    expect(notice).toHaveAttribute('role', 'status')
    // The built-in form still rendered — degradation, never a blank screen.
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument()
  })

  it('says nothing extra when no formKey was authored', () => {
    renderWithProviders(
      <TaskFormFields
        formSchema={jsonSchema}
        values={{}}
        invalidField={null}
        onFieldChange={() => {}}
      />
    )

    expect(screen.queryByTestId('task-form-renderer-missing')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument()
  })
})

describe('TaskFormFields — the Studio authoring shape', () => {
  it('renders `{ fields: [...] }`, which used to render nothing at all', () => {
    renderWithProviders(
      <TaskFormFields
        formSchema={studioSchema}
        values={{}}
        invalidField={null}
        onFieldChange={() => {}}
      />
    )

    expect(screen.getByLabelText(/Reason/)).toBeInTheDocument()
  })
})
