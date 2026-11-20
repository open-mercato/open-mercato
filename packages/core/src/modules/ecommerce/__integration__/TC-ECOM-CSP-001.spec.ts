import { test, expect } from '@playwright/test'
import { buildBrandingPreviewDocument } from '../components/storeBrandingForm'

test('branding srcDoc retains its styles under the production document CSP', async ({ page }) => {
  const response = await page.goto('/login')
  expect(response?.ok()).toBe(true)
  const nonce = await page.locator('#om-theme-init').evaluate((script: HTMLScriptElement) => script.nonce)
  expect(nonce).toBeTruthy()
  expect(response?.headers()['content-security-policy']).toContain(`'nonce-${nonce}'`)
  const srcDoc = buildBrandingPreviewDocument({ primaryColor: '#123456', backgroundColor: '#abcdef' }, {
    storeName: 'CSP preview',
    navShop: 'Shop',
    navCategories: 'Categories',
    navCart: 'Cart',
    heroTitle: 'Preview',
    heroText: 'Preview content',
    heroButton: 'Shop',
    productName: 'Product',
    productPrice: '29.00 EUR',
  }, nonce)
  await page.evaluate((documentHtml) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', '')
    iframe.setAttribute('data-testid', 'csp-branding-preview')
    iframe.srcdoc = documentHtml
    document.body.appendChild(iframe)
  }, srcDoc)
  const preview = page.frameLocator('[data-testid="csp-branding-preview"]')
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(171, 205, 239)')
  await expect(preview.locator('body')).toHaveCSS('margin-top', '0px')
  await expect(preview.locator('html')).toHaveCSS('--primary', '#123456')
})
