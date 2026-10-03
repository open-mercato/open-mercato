import { Document, Page, Text, View, StyleSheet } from '@open-mercato/document-generators/modules/document_generators/providers/react-pdf/index'
import {
  documentTheme,
  OpenMercatoLogo,
} from '@open-mercato/document-generators/modules/document_generators/templates/shared/index'
import { formatDate, formatMoney } from '@open-mercato/document-generators/modules/document_generators/utils/index'
import type { OrderInvoiceData } from '../types'

const { colors, spacing, fontSize, borderWidth, fontFamily } = documentTheme

const styles = StyleSheet.create({
  page: {
    padding: spacing.xl,
    fontFamily,
    fontSize: fontSize.body,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  title: { fontSize: fontSize.title, fontWeight: 'bold' },
  meta: { alignItems: 'flex-end' },
  metaRow: { flexDirection: 'row', marginBottom: spacing.xs },
  metaLabel: { color: colors.muted, marginRight: spacing.sm },
  parties: { flexDirection: 'row', marginBottom: spacing.lg },
  party: { flex: 1, paddingRight: spacing.md },
  sectionLabel: {
    fontSize: fontSize.small,
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  partyName: { fontWeight: 'bold', marginBottom: spacing.xs },
  muted: { color: colors.muted, marginBottom: spacing.xs },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: borderWidth,
    borderBottomColor: colors.foreground,
    paddingBottom: spacing.sm,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: borderWidth,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  colItem: { flex: 4, paddingRight: spacing.sm },
  colQuantity: { flex: 1, textAlign: 'right' },
  colUnitPrice: { flex: 2, textAlign: 'right' },
  colTotal: { flex: 2, textAlign: 'right' },
  lineDescription: { color: colors.muted, fontSize: fontSize.small, marginTop: spacing.xs },
  totals: { alignSelf: 'flex-end', width: '45%', marginTop: spacing.md },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: borderWidth,
    borderTopColor: colors.foreground,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    fontWeight: 'bold',
    fontSize: fontSize.heading / 1.5,
  },
  notes: { marginTop: spacing.lg },
})

function formatQuantity(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
}

export default function OrderInvoicePdf({ data }: { data: Record<string, unknown> }) {
  const invoice = data as unknown as OrderInvoiceData
  const { labels, document: documentInfo, client, seller, lines, totals, notes, locale } = invoice

  return (
    <Document title={`${labels.title} ${documentInfo.number}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <OpenMercatoLogo />
            <Text style={styles.title}>{labels.title}</Text>
          </View>
          <View style={styles.meta}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{labels.number}</Text>
              <Text>{documentInfo.number}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{labels.date}</Text>
              <Text>{formatDate(documentInfo.date, locale)}</Text>
            </View>
            {documentInfo.dueDate ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>{labels.dueDate}</Text>
                <Text>{formatDate(documentInfo.dueDate, locale)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.sectionLabel}>{labels.client}</Text>
            <Text style={styles.partyName}>{client.name}</Text>
            {client.company ? <Text style={styles.muted}>{client.company}</Text> : null}
            {client.address ? <Text style={styles.muted}>{client.address}</Text> : null}
            {client.email ? <Text style={styles.muted}>{client.email}</Text> : null}
          </View>
          {seller ? (
            <View style={styles.party}>
              <Text style={styles.sectionLabel}>{labels.seller}</Text>
              <Text style={styles.partyName}>{seller.name}</Text>
              {seller.email ? <Text style={styles.muted}>{seller.email}</Text> : null}
              {seller.phone ? <Text style={styles.muted}>{seller.phone}</Text> : null}
            </View>
          ) : null}
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.colItem}>{labels.item}</Text>
          <Text style={styles.colQuantity}>{labels.quantity}</Text>
          <Text style={styles.colUnitPrice}>{labels.unitPrice}</Text>
          <Text style={styles.colTotal}>{labels.total}</Text>
        </View>
        {lines.map((line, index) => (
          <View key={`${index}-${line.title}`} style={styles.tableRow} wrap={false}>
            <View style={styles.colItem}>
              <Text>{line.title}</Text>
              {line.description ? <Text style={styles.lineDescription}>{line.description}</Text> : null}
            </View>
            <Text style={styles.colQuantity}>{formatQuantity(line.quantity, locale)}</Text>
            <Text style={styles.colUnitPrice}>{formatMoney(line.unitPrice, line.currency, locale)}</Text>
            <Text style={styles.colTotal}>{formatMoney(line.total, line.currency, locale)}</Text>
          </View>
        ))}

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text>{labels.subtotal}</Text>
            <Text>{formatMoney(totals.subtotal, totals.currency, locale)}</Text>
          </View>
          {totals.discount !== 0 ? (
            <View style={styles.totalRow}>
              <Text>{labels.discount}</Text>
              <Text>{formatMoney(-Math.abs(totals.discount), totals.currency, locale)}</Text>
            </View>
          ) : null}
          {totals.shipping !== 0 ? (
            <View style={styles.totalRow}>
              <Text>{labels.shipping}</Text>
              <Text>{formatMoney(totals.shipping, totals.currency, locale)}</Text>
            </View>
          ) : null}
          {totals.surcharge !== 0 ? (
            <View style={styles.totalRow}>
              <Text>{labels.surcharge}</Text>
              <Text>{formatMoney(totals.surcharge, totals.currency, locale)}</Text>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <Text>{labels.tax}</Text>
            <Text>{formatMoney(totals.tax, totals.currency, locale)}</Text>
          </View>
          <View style={styles.grandTotal}>
            <Text>{labels.grandTotal}</Text>
            <Text>{formatMoney(totals.total, totals.currency, locale)}</Text>
          </View>
          {totals.paid > 0 ? (
            <View style={styles.totalRow}>
              <Text>{labels.paid}</Text>
              <Text>{formatMoney(totals.paid, totals.currency, locale)}</Text>
            </View>
          ) : null}
          {totals.paid > 0 ? (
            <View style={styles.totalRow}>
              <Text>{labels.outstanding}</Text>
              <Text>{formatMoney(totals.outstanding, totals.currency, locale)}</Text>
            </View>
          ) : null}
        </View>

        {notes ? (
          <View style={styles.notes}>
            <Text style={styles.sectionLabel}>{labels.notes}</Text>
            <Text>{notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
