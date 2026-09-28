/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import ExternalIdsWidget from '../widget.client'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegrationTitle: (id: string) => ({ shopify: 'Shopify', akeneo: 'Akeneo' })[id] ?? id,
}))

describe('ExternalIdsWidget accessibility', () => {
  test('identifies external links by integration', () => {
    render(
      <ExternalIdsWidget
        context={{}}
        data={{
          _integrations: {
            shopify: {
              externalId: 'product-1',
              externalUrl: 'https://example.com/shopify/product-1',
              syncStatus: 'synced',
            },
            akeneo: {
              externalId: 'product-2',
              externalUrl: 'https://example.com/akeneo/product-2',
              syncStatus: 'pending',
            },
          },
        }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Open in external system — Shopify' })).toHaveAttribute(
      'href',
      'https://example.com/shopify/product-1',
    )
    expect(screen.getByRole('link', { name: 'Open in external system — Akeneo' })).toHaveAttribute(
      'href',
      'https://example.com/akeneo/product-2',
    )
  })
})
