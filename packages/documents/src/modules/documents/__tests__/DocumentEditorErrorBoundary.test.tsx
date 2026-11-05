/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DocumentEditorErrorBoundary } from '../backend/documents/[id]/DocumentEditorErrorBoundary'

describe('DocumentEditorErrorBoundary', () => {
  it('contains an editor initialization failure and retries it without replacing the page', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    let shouldReject = true
    const onRetry = jest.fn(() => { shouldReject = false })

    function EditorIsland() {
      if (shouldReject) throw new Error('editor initialization failed')
      return <div>Editor ready</div>
    }

    render(
      <main aria-label="Document detail">
        <p>Document header remains mounted</p>
        <DocumentEditorErrorBoundary
          resetKey="document:0"
          onRetry={onRetry}
          fallback={(retry) => <button type="button" onClick={retry}>Retry editor</button>}
        >
          <EditorIsland />
        </DocumentEditorErrorBoundary>
      </main>,
    )

    expect(screen.getByText('Document header remains mounted')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry editor' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Editor ready')).toBeTruthy()
    expect(screen.getByText('Document header remains mounted')).toBeTruthy()
    errorSpy.mockRestore()
  })
})
