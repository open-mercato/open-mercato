/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { FrontendLayout } from '../Layout'

jest.mock('../../backend/FlashMessages', () => ({
  FlashMessages: () => null,
}))

function NothingToShow() {
  return null
}

// A footer element is always truthy, even when its component renders nothing
// (e.g. an injection spot with no widgets). The wrapper must then hide itself
// instead of leaving an empty bordered strip at the bottom of the page.
describe('FrontendLayout footer', () => {
  it('hides the footer wrapper while the footer renders nothing', () => {
    const { container } = render(
      <FrontendLayout footer={<NothingToShow />}>
        <div>Page</div>
      </FrontendLayout>,
    )

    const footerWrapper = container.querySelector('.border-t')
    expect(footerWrapper).not.toBeNull()
    expect(footerWrapper).toHaveClass('empty:hidden')
    expect(footerWrapper).toBeEmptyDOMElement()
  })

  it('renders the footer content inside the wrapper', () => {
    const { container } = render(
      <FrontendLayout footer={<p>Footer links</p>}>
        <div>Page</div>
      </FrontendLayout>,
    )

    expect(screen.getByText('Footer links')).toBeInTheDocument()
    expect(container.querySelector('.border-t')).not.toBeEmptyDOMElement()
  })
})
