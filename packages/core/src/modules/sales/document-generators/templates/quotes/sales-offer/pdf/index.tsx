import { Document } from '@open-mercato/document-generators/modules/document_generators/providers/react-pdf'

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
