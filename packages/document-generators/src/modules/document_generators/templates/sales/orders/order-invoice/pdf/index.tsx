import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { OpenMercatoLogo } from '../../../../shared/components/Logo'
import '../../../../shared/theme'
import { colors } from '../../../../shared/theme'
import type { OrderInvoiceData } from '../types'

const s = StyleSheet.create({
  page: { paddingHorizontal: 52, paddingVertical: 48, fontSize: 10, fontFamily: 'Inter', color: colors.text },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  title: { fontSize: 28, fontWeight: 600 },

  metaRow: { flexDirection: 'row', marginBottom: 28, gap: 48 },
  metaLabel: { fontSize: 9, color: colors.muted, marginBottom: 2 },
  metaValue: { fontWeight: 600 },

  parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  sellerName: { fontWeight: 600, fontSize: 11 },
  billToLabel: { fontSize: 9, color: colors.muted, marginBottom: 4 },
  clientName: { fontWeight: 600 },
  clientDetail: { color: colors.muted, marginTop: 1 },

  amountText: { fontSize: 20, fontWeight: 600, marginBottom: 6 },
  notesText: { color: colors.muted, marginTop: 10, marginBottom: 24 },

  divider: { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 16 },

  tableHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeaderText: { fontSize: 9, color: colors.muted },
  tableRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.light },
  colDesc: { flex: 1 },
  colQty: { width: 36, textAlign: 'right' },
  colUnit: { width: 72, textAlign: 'right' },
  colAmount: { width: 72, textAlign: 'right' },
  lineTitle: { fontWeight: 600 },
  lineDesc: { color: colors.muted, marginTop: 1, fontSize: 9 },

  totalsBlock: { marginTop: 8, alignItems: 'flex-end' },
  totalsRow: { flexDirection: 'row', paddingVertical: 3 },
  totalsLabel: { width: 90, color: colors.muted },
  totalsValue: { width: 80, textAlign: 'right' },
  totalDivider: { width: 170, borderBottomWidth: 1, borderBottomColor: colors.border, marginVertical: 4 },
  amountDueLabel: { width: 90, fontWeight: 600 },
  amountDueValue: { width: 80, textAlign: 'right', fontWeight: 600 },

  footer: { marginTop: 36, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.border },
  footerTitle: { fontWeight: 600, marginBottom: 4 },
  footerBody: { color: colors.muted, marginBottom: 12, lineHeight: 1.5 },
  payRow: { flexDirection: 'row', marginBottom: 3 },
  payLabel: { width: 100, color: colors.muted },

  strip: { marginTop: 24, color: colors.muted, fontSize: 9 },
})

export function OrderInvoiceDocument({ data }: { data: OrderInvoiceData }) {
  const cur = data.totals.currency
  const fmt = (n: number) => `${n.toFixed(2)} ${cur}`

  return (
    <Document>
      <Page size="A4" style={s.page}>

        <View style={s.header}>
          <Text style={s.title}>{data.labels.invoice}</Text>
          <OpenMercatoLogo />
        </View>

        <View style={s.metaRow}>
          <View>
            <Text style={s.metaLabel}>{data.labels.invoiceNumber}</Text>
            <Text style={s.metaValue}>{data.document.number}</Text>
          </View>
          <View>
            <Text style={s.metaLabel}>{data.labels.date}</Text>
            <Text style={s.metaValue}>{data.document.date}</Text>
          </View>
          {data.document.dueDate && (
            <View>
              <Text style={s.metaLabel}>{data.labels.dueDate}</Text>
              <Text style={s.metaValue}>{data.document.dueDate}</Text>
            </View>
          )}
        </View>

        <View style={s.parties}>
          <Text style={s.sellerName}>{data.seller.company || data.seller.name}</Text>
          <View>
            <Text style={s.billToLabel}>{data.labels.billTo}</Text>
            <Text style={s.clientName}>{data.client.name}</Text>
            {data.client.company && <Text style={s.clientDetail}>{data.client.company}</Text>}
            {data.client.email && <Text style={s.clientDetail}>{data.client.email}</Text>}
            {data.client.address && <Text style={s.clientDetail}>{data.client.address}</Text>}
          </View>
        </View>

        <Text style={s.amountText}>
          {fmt(data.totals.total)}{data.document.dueDate ? ` ${data.labels.due} ${data.document.dueDate}` : ''}
        </Text>
        {data.notes && <Text style={s.notesText}>{data.notes}</Text>}

        <View style={s.divider} />

        <View style={s.tableHeader}>
          <Text style={[s.colDesc, s.tableHeaderText]}>{data.labels.description}</Text>
          <Text style={[s.colQty, s.tableHeaderText]}>{data.labels.quantity}</Text>
          <Text style={[s.colUnit, s.tableHeaderText]}>{data.labels.unitPrice}</Text>
          <Text style={[s.colAmount, s.tableHeaderText]}>{data.labels.amount}</Text>
        </View>

        {data.lines.map((line, i) => (
          <View key={i} style={s.tableRow}>
            <View style={s.colDesc}>
              <Text style={s.lineTitle}>{line.title}</Text>
              {line.description && <Text style={s.lineDesc}>{line.description}</Text>}
            </View>
            <Text style={s.colQty}>{line.quantity}</Text>
            <Text style={s.colUnit}>{line.unitPrice.toFixed(2)}</Text>
            <Text style={s.colAmount}>{line.total.toFixed(2)}</Text>
          </View>
        ))}

        <View style={s.totalsBlock}>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>{data.labels.subtotal}</Text>
            <Text style={s.totalsValue}>{fmt(data.totals.subtotal)}</Text>
          </View>
          {data.totals.tax > 0 && (
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{data.labels.tax}</Text>
              <Text style={s.totalsValue}>{fmt(data.totals.tax)}</Text>
            </View>
          )}
          <View style={s.totalDivider} />
          <View style={s.totalsRow}>
            <Text style={s.amountDueLabel}>{data.labels.amountDue}</Text>
            <Text style={s.amountDueValue}>{fmt(data.totals.total)}</Text>
          </View>
        </View>

        {data.paymentDetails && (
          <View style={s.footer}>
            <Text style={s.footerTitle}>{data.labels.payByBankTransfer}</Text>
            <Text style={s.footerBody}>
              {data.labels.paymentInstructions}
            </Text>
            {data.paymentDetails.bankName && (
              <View style={s.payRow}>
                <Text style={s.payLabel}>{data.labels.bankName}</Text>
                <Text>{data.paymentDetails.bankName}</Text>
              </View>
            )}
            {data.paymentDetails.routingNumber && (
              <View style={s.payRow}>
                <Text style={s.payLabel}>{data.labels.routingNumber}</Text>
                <Text>{data.paymentDetails.routingNumber}</Text>
              </View>
            )}
            {data.paymentDetails.accountNumber && (
              <View style={s.payRow}>
                <Text style={s.payLabel}>{data.labels.accountNumber}</Text>
                <Text>{data.paymentDetails.accountNumber}</Text>
              </View>
            )}
            {data.paymentDetails.swiftCode && (
              <View style={s.payRow}>
                <Text style={s.payLabel}>{data.labels.swiftCode}</Text>
                <Text>{data.paymentDetails.swiftCode}</Text>
              </View>
            )}
          </View>
        )}

        <Text style={s.strip}>
          {data.document.number} · {fmt(data.totals.total)}{data.document.dueDate ? ` ${data.labels.due} ${data.document.dueDate}` : ''}
        </Text>

      </Page>
    </Document>
  )
}
