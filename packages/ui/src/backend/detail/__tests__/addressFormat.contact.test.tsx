import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AddressView, formatAddressContactPairs } from '../addressFormat'

// `packages/ui/src/backend/detail/addressFormat.tsx` and
// `packages/core/src/modules/customers/utils/addressFormat.tsx` are the documented near-identical
// twins: they differ only in an import and the `AddressFormatStrategy` alias, and the spec forbids
// copying one over the other. Nothing enforced that the contact block behaves the same in both, so
// this mirrors the core suite's contract onto the `ui` copy — the twin can no longer drift silently
// while its tests live only under `customers/utils/__tests__`.
describe('ui addressFormat — contact block parity with the customers twin', () => {
  const postalOnly = {
    addressLine1: 'Baker Street',
    buildingNumber: '10',
    postalCode: 'NW1',
    city: 'London',
  }
  const withContact = {
    ...postalOnly,
    phone: '+44 20 7946 0000',
    taxId: '1234567890',
    taxIdType: 'pl_nip',
  }
  const labels = { taxId: 'Tax ID', phone: 'Phone' }

  it('keeps the contact details out of the postal lines', () => {
    const html = renderToStaticMarkup(<AddressView address={withContact} format="street_first" />)
    expect(html).not.toContain('1234567890')
    expect(html).not.toContain('+44 20 7946 0000')
  })

  it('returns pairs in a stable order, tax id first, keyed on the stable field name', () => {
    expect(formatAddressContactPairs(withContact, labels)).toEqual([
      { field: 'taxId', label: 'Tax ID', value: '1234567890' },
      { field: 'phone', label: 'Phone', value: '+44 20 7946 0000' },
    ])
  })

  it('renders byte-identical output without labels, even carrying contact keys', () => {
    const before = renderToStaticMarkup(<AddressView address={postalOnly} format="street_first" />)
    const after = renderToStaticMarkup(<AddressView address={withContact} format="street_first" />)
    expect(after).toBe(before)
  })

  it('renders the contact block on opt-in, after the postal lines', () => {
    const html = renderToStaticMarkup(
      <AddressView address={withContact} format="street_first" contactLabels={labels} />,
    )
    expect(html).toContain('Tax ID: 1234567890')
    expect(html).toContain('Phone: +44 20 7946 0000')
    expect(html.indexOf('Baker Street')).toBeLessThan(html.indexOf('Tax ID'))
  })

  it('emits the contact lines alone for a contact-only address — the sales tile case', () => {
    // The document tiles render the block beside an editor that already shows the street, so they
    // pass an address with no postal fields at all.
    const html = renderToStaticMarkup(
      <AddressView
        address={{ addressLine1: null, taxId: '1234567890', taxIdType: 'pl_nip' }}
        format="street_first"
        contactLabels={labels}
      />,
    )
    expect(html).toContain('Tax ID: 1234567890')
    expect(html).not.toContain('Baker Street')
  })

  it('self-hides when labelled but the address carries no contact values', () => {
    expect(renderToStaticMarkup(<AddressView address={postalOnly} format="street_first" contactLabels={labels} />)).toBe(
      renderToStaticMarkup(<AddressView address={postalOnly} format="street_first" />),
    )
  })
  // Mirrors the core suite: the twin must resolve a by-type label map and gate visibility the same
  // way, or the same address reads differently depending on which surface rendered it.
  describe('tax id labelled by type', () => {
    const BY_TYPE = { plNip: 'NIP', euVat: 'EU VAT', other: 'Tax number' }
    const labelFor = (taxIdType: string | null) =>
      formatAddressContactPairs({ addressLine1: null, taxId: '1234567890', taxIdType }, { taxId: BY_TYPE })[0]?.label

    it('names each type, and falls back to the neutral label for the rest', () => {
      expect(labelFor('pl_nip')).toBe('NIP')
      expect(labelFor('eu_vat')).toBe('EU VAT')
      expect(labelFor('other')).toBe('Tax number')
      expect(labelFor('us_ein')).toBe('Tax number')
      expect(labelFor(null)).toBe('Tax number')
    })

    it('still accepts a plain string — the map is additive', () => {
      expect(
        formatAddressContactPairs({ addressLine1: null, taxId: '1234567890', taxIdType: 'pl_nip' }, { taxId: 'Tax ID' }),
      ).toEqual([{ field: 'taxId', label: 'Tax ID', value: '1234567890' }])
    })
  })

})
