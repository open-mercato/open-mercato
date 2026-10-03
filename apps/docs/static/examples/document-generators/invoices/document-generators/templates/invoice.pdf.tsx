import { Document, Page, Text, View, StyleSheet } from '@open-mercato/document-generators/modules/document_generators/providers/react-pdf/index'
import { documentTheme, DraftWatermark } from '@open-mercato/document-generators/modules/document_generators/templates/shared/index'
import { formatMoney } from '@open-mercato/document-generators/modules/document_generators/utils/index'
import type { InvoiceTemplateData } from './types'

const { colors, spacing, fontSize, fontFamily } = documentTheme

const styles = StyleSheet.create({
  page: { padding: spacing.xl, fontFamily, fontSize: fontSize.body, color: colors.foreground },
  title: { fontSize: fontSize.title, fontWeight: 'bold', marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  muted: { color: colors.muted },
})

export default function InvoicePdf({ data }: { data: Record<string, unknown> }) {
  const { labels, document: info, totals, locale, isDraft } = data as unknown as InvoiceTemplateData
  return (
    <Document title={`${labels.title} ${info.number}`}>
      <Page size="A4" style={styles.page}>
        {isDraft ? <DraftWatermark label={labels.draftWatermark} /> : null}
        <Text style={styles.title}>{`${labels.title} ${info.number}`}</Text>
        <View style={styles.row}>
          <Text style={styles.muted}>{labels.number}</Text>
          <Text>{info.number}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.muted}>{labels.total}</Text>
          <Text>{formatMoney(totals.total, totals.currency, locale)}</Text>
        </View>
      </Page>
    </Document>
  )
}
