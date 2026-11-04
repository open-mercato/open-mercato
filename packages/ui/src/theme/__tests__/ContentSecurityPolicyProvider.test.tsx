import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ContentSecurityPolicyProvider, useContentSecurityPolicyNonce } from '../ContentSecurityPolicyProvider'
import { BrandStyleRuntime } from '../BrandStyleRuntime'
import { BRAND_STYLE_ELEMENT_ID, saveBrandStyle } from '../brand-style'

function Consumer() {
  const nonce = useContentSecurityPolicyNonce()
  return <style data-testid="module-style" nonce={nonce}>{'.example{display:block}'}</style>
}

afterEach(() => {
  saveBrandStyle(null)
  window.localStorage.clear()
  delete (globalThis as typeof globalThis & { __webpack_nonce__?: string }).__webpack_nonce__
})

it('keeps the original document nonce across client navigation', () => {
  const view = render(<ContentSecurityPolicyProvider nonce="documentNonce"><Consumer /></ContentSecurityPolicyProvider>)
  expect(screen.getByTestId('module-style')).toHaveAttribute('nonce', 'documentNonce')
  view.rerender(<ContentSecurityPolicyProvider nonce="navigationNonce"><Consumer /></ContentSecurityPolicyProvider>)
  expect(screen.getByTestId('module-style')).toHaveAttribute('nonce', 'documentNonce')
  expect((globalThis as typeof globalThis & { __webpack_nonce__?: string }).__webpack_nonce__).toBe('documentNonce')
})

it('adds the document nonce to dynamic brand styles', () => {
  saveBrandStyle({
    version: 1,
    logo: null,
    light: { '--primary': '#124488', '--primary-hover': '#113366', '--primary-foreground': '#FFFFFF' },
    dark: { '--primary': '#AACCFF', '--primary-hover': '#88AADD', '--primary-foreground': '#000000' },
  })
  render(<ContentSecurityPolicyProvider nonce="documentNonce"><BrandStyleRuntime /></ContentSecurityPolicyProvider>)
  expect(document.getElementById(BRAND_STYLE_ELEMENT_ID)).toHaveAttribute('nonce', 'documentNonce')
})
