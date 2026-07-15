/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

const runMutationMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn(async () => false) }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('../backend/documents/components/useTemplateDetail', () => ({
  useTemplateDetail: () => ({ template: null, isLoading: false, error: null, retry: jest.fn() }),
}))

jest.mock('../backend/documents/components/TemplateBodyEditor', () => ({
  TemplateBodyEditor: () => <div data-testid="template-body-editor" />,
}))

jest.mock('../backend/documents/components/TemplateSlotsEditor', () => ({
  TEMPLATE_SLOT_KEY_PATTERN: /^[a-z][a-zA-Z0-9]*$/,
  TemplateSlotsEditor: () => <div data-testid="template-slots-editor" />,
}))

import { TemplateEditorDialog } from '../backend/documents/components/TemplateEditorDialog'

describe('TemplateEditorDialog submission', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationMock.mockReturnValue(new Promise(() => undefined))
  })

  it('submits only once when Cmd+Enter repeats before React disables the controls', () => {
    render(
      <TemplateEditorDialog
        open
        template={null}
        onOpenChange={jest.fn()}
        onSaved={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('documents.templates.fields.name'), {
      target: { value: 'Release checklist' },
    })
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })

    expect(runMutationMock).toHaveBeenCalledTimes(1)
  })
})
