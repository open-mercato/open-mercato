import { Document } from '@react-pdf/renderer'
import '../../../../shared/theme' // registers Inter font family as side effect
import { CoverPage } from './CoverPage'
import { QuotePage } from './QuotePage'
import type { PdfDocumentData } from '../types'

export function SalesOfferDocument({ data }: { data: PdfDocumentData }) {
  return (
    <Document style={{ fontFamily: 'Inter' }}>
      <CoverPage data={data} />
      <QuotePage data={data} />
    </Document>
  )
}
