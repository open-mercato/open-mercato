/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { InlineMultilineEditor, InlineNextInteractionEditor, InlineTextEditor, renderMultilineMarkdownDisplay } from '../InlineEditors'

// jsdom does not provide requestAnimationFrame by default.
;(global as any).requestAnimationFrame =
  (global as any).requestAnimationFrame || ((cb: FrameRequestCallback) => setTimeout(cb, 0))

jest.mock('next/dynamic', () => () => {
  return function MockDynamicComponent(props: any) {
    return <div data-testid="dynamic-import" {...props} />
  }
})

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => (
    <button type={props.type || 'button'} {...props}>
      {children}
    </button>
  ),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label?: string }) => <div>{label ?? 'loading'}</div>,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/inputs/PhoneNumberField', () => ({
  PhoneNumberField: ({ value, onValueChange, placeholder }: any) => (
    <input
      data-testid="phone-input"
      value={value ?? ''}
      onChange={(event) => onValueChange?.(event.target.value)}
      placeholder={placeholder}
    />
  ),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('../../../backend/hooks/useEmailDuplicateCheck', () => ({
  useEmailDuplicateCheck: () => ({ duplicate: null, checking: false }),
}))

jest.mock('../../../utils/phoneDuplicates', () => ({
  lookupPhoneDuplicate: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/AppearanceSelector', () => ({
  AppearanceSelector: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

describe('Inline next interaction editor', () => {
  it('shows the scheduled date and name while keeping the reference ID in edit mode', () => {
    const scheduledAt = '2026-11-20T14:00:00.000Z'
    const activityName = 'Follow-up call'
    const referenceId = '8eea1658-bc4d-4566-9624-ac2bf04d3680'

    render(
      <InlineNextInteractionEditor
        label="Next interaction"
        valueAt={scheduledAt}
        valueName={activityName}
        valueRefId={referenceId}
        valueIcon={null}
        valueColor={null}
        emptyLabel="No next interaction"
        onSave={jest.fn()}
      />,
    )

    expect(screen.getByText(formatDateTime(scheduledAt))).toBeInTheDocument()
    expect(screen.getByText(activityName)).toBeInTheDocument()
    expect(screen.queryByText(referenceId, { exact: false })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByDisplayValue(referenceId)).toBeInTheDocument()
  })
})

describe('Inline multiline editors', () => {
  it('renders markdown preview and falls back to empty label', () => {
    const { rerender } = render(
      <>
        {renderMultilineMarkdownDisplay({
          value: 'Hello **world**',
          emptyLabel: 'Empty state',
        })}
      </>,
    )

    expect(screen.getByText('Hello **world**')).toBeInTheDocument()

    rerender(
      <>
        {renderMultilineMarkdownDisplay({
          value: '   ',
          emptyLabel: 'Empty state',
        })}
      </>,
    )

    expect(screen.getByText('Empty state')).toBeInTheDocument()
  })

  it('activates edit mode on click and shows save shortcut label', () => {
    const handleSave = jest.fn().mockResolvedValue(undefined)
    const { container } = render(
      <InlineMultilineEditor
        label="Description"
        value="Link text"
        placeholder="Description"
        emptyLabel="No description"
        onSave={handleSave}
        renderDisplay={({ value }) => (
          <a href="https://example.com" data-testid="description-link">
            {value}
          </a>
        )}
        activateOnClick
      />,
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('cursor-pointer')

    const link = screen.getByTestId('description-link')
    fireEvent.click(link)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByText('Save ⌘⏎ / Ctrl+Enter')).toBeInTheDocument()
  })
})

describe('Inline text editor', () => {
  it('renders save shortcut label with fallback text', () => {
    const handleSave = jest.fn().mockResolvedValue(undefined)
    render(
      <InlineTextEditor
        label="Domain"
        value="https://example.com"
        placeholder="Domain"
        emptyLabel="No domain"
        onSave={handleSave}
        activateOnClick
        type="url"
      />,
    )

    fireEvent.click(screen.getByRole('link'))

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByText('Save ⌘⏎ / Ctrl+Enter')).toBeInTheDocument()
  })
})
