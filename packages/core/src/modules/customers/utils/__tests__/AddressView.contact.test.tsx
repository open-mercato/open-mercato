import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AddressView } from '../addressFormat'

// The backward-compatibility promise of the contact block (spec
// 2026-08-10-address-contact-and-tax-fields): with no `contactLabels` supplied, AddressView's output
// is BYTE-IDENTICAL to what it always rendered — even when the address carries the new keys. A
// third-party module calling the component exactly as before must observe zero change on merge.
describe('AddressView contact block', () => {
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

  it('renders byte-identical output without labels, even when the address carries contact keys', () => {
    const before = renderToStaticMarkup(<AddressView address={postalOnly} format="street_first" />)
    const after = renderToStaticMarkup(<AddressView address={withContact} format="street_first" />)
    expect(after).toBe(before)
  })

  it('renders the contact block only on opt-in, labelled and after the postal lines', () => {
    const html = renderToStaticMarkup(
      <AddressView
        address={withContact}
        format="street_first"
        contactLabels={{ taxId: 'Tax ID', phone: 'Phone' }}
      />,
    )
    expect(html).toContain('Tax ID: 1234567890')
    expect(html).toContain('Phone: +44 20 7946 0000')
    // Postal lines stay first — the contact block trails the address, never interleaves it.
    expect(html.indexOf('Baker Street')).toBeLessThan(html.indexOf('Tax ID'))
  })

  it('self-hides: labels supplied but no contact values renders the postal address alone', () => {
    const html = renderToStaticMarkup(
      <AddressView address={postalOnly} format="street_first" contactLabels={{ taxId: 'Tax ID', phone: 'Phone' }} />,
    )
    expect(html).toBe(renderToStaticMarkup(<AddressView address={postalOnly} format="street_first" />))
  })

  it('still renders nothing for an address with neither postal nor contact content', () => {
    expect(renderToStaticMarkup(<AddressView address={{}} format="street_first" contactLabels={{ phone: 'Phone' }} />)).toBe('')
  })
})
