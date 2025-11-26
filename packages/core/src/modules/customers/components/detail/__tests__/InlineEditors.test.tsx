/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { InlineMultilineEditor, InlineTextEditor, renderMultilineMarkdownDisplay } from '../InlineEditors'

// jsdom does not provide requestAnimationFrame by default.
;(global as any).requestAnimationFrame =
  (global as any).requestAnimationFrame || ((cb: FrameRequestCallback) => setTimeout(cb, 0))

const reactMarkdownMock = jest.fn((props: any) => <div data-testid="react-markdown">{props.children}</div>)

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: (props: any) => reactMarkdownMock(props),
}))

jest.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('next/dynamic', () => () => {
  return function MockDynamicComponent(props: any) {
    return <div data-testid="dynamic-import" {...props} />
  }
})

jest.mock('@uiw/react-md-editor', () => (props: any) => {
  return <textarea data-testid="markdown-editor" value={props.value ?? ''} onChange={(event) => props.onChange?.(event.target.value)} />
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

jest.mock('../../../backend/hooks/useEmailDuplicateCheck', () => ({
  useEmailDuplicateCheck: () => ({ duplicate: null, checking: false }),
}))

jest.mock('../../../utils/phoneDuplicates', () => ({
  lookupPhoneDuplicate: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/AppearanceSelector', () => ({
  AppearanceSelector: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

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

    expect(reactMarkdownMock).toHaveBeenCalledWith(
      expect.objectContaining({
        children: 'Hello **world**',
        remarkPlugins: expect.any(Array),
      }),
    )

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
