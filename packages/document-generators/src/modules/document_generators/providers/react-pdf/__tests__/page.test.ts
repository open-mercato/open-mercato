import type { ReactElement } from 'react'
import { Page } from '../index'
import { getPdfFontRegistry } from '../font-registry'
import { DEFAULT_REACT_PDF_CONFIG } from '../config'

jest.mock('@react-pdf/renderer', () => ({ Page: 'PAGE', Font: { register: jest.fn() } }))

type PageElement = ReactElement<{ style: unknown[] }>

describe('Page', () => {
  it('uses Helvetica before any font configuration is applied', () => {
    const page = Page({ style: { padding: 32 } }) as PageElement
    expect(page.props.style).toEqual([{ fontFamily: 'Helvetica' }, { padding: 32 }])
  })

  it('applies the configured font family and lets the template override it', () => {
    getPdfFontRegistry().applyConfig({ ...DEFAULT_REACT_PDF_CONFIG, fontFamily: 'Times-Roman' })
    expect((Page({ style: { padding: 32 } }) as PageElement).props.style).toEqual([{ fontFamily: 'Times-Roman' }, { padding: 32 }])
    expect((Page({ style: [{ fontFamily: 'Courier' }] }) as PageElement).props.style).toEqual([{ fontFamily: 'Times-Roman' }, { fontFamily: 'Courier' }])
  })
})
