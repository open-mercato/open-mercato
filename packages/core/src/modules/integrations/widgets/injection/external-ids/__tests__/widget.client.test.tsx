/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react'
import ExternalIdsWidget from '../widget.client'
import type { ExternalIdMapping } from '@open-mercato/shared/modules/integrations/types'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

const STATUS_DOT_TOKENS: Record<ExternalIdMapping['syncStatus'], string> = {
  synced: 'bg-status-success-icon',
  pending: 'bg-status-warning-icon',
  error: 'bg-status-error-icon',
  not_synced: 'bg-status-neutral-icon',
}

const LEGACY_STATUS_COLORS = ['bg-green-500', 'bg-yellow-500', 'bg-red-500', 'bg-gray-400']

const ALL_STATUSES = Object.keys(STATUS_DOT_TOKENS) as ExternalIdMapping['syncStatus'][]

function renderWidget(syncStatus: ExternalIdMapping['syncStatus']) {
  const mappings: Record<string, ExternalIdMapping> = {
    shopify: { externalId: 'ext-123', syncStatus },
  }
  const data: Record<string, unknown> = { _integrations: mappings }
  return render(<ExternalIdsWidget context={undefined} data={data} />)
}

describe('ExternalIdsWidget sync status dots', () => {
  it.each(ALL_STATUSES)('renders the semantic status token for %s', (status) => {
    const { container } = renderWidget(status)
    const dot = container.querySelector('span[aria-hidden="true"]')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain(STATUS_DOT_TOKENS[status])
  })

  it('never renders hardcoded Tailwind status colors', () => {
    for (const status of ALL_STATUSES) {
      const { container } = renderWidget(status)
      for (const legacyColor of LEGACY_STATUS_COLORS) {
        expect(container.innerHTML).not.toContain(legacyColor)
      }
    }
  })
})
