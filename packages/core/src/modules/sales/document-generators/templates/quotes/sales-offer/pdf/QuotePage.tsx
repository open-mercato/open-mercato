import React from 'react'
import { Page, StyleSheet, Text, View } from '@open-mercato/document-generators/modules/document_generators/providers/react-pdf'
import { colors } from '@open-mercato/document-generators/modules/document_generators/templates/shared/theme'
import { formatMoney } from '@open-mercato/document-generators/modules/document_generators/utils/formatMoney'
import type { PdfDocumentData } from '../types'

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.white,
    padding: 56,
    flexDirection: 'column',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: 600,
    color: colors.text,
    marginBottom: 6,
  },
  meta: {
    flexDirection: 'row',
    gap: 32,
    marginBottom: 28,
  },
  metaItem: {
    flexDirection: 'column',
    gap: 2,
  },
  metaLabel: {
    fontSize: 8,

    fontWeight: 600,
    color: colors.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: 10,

    fontWeight: 500,
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  tableHeaderCell: {
    fontSize: 8,

    fontWeight: 600,
    color: colors.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  colTitle: { flex: 1 },
  colQty: { width: 50, textAlign: 'right' },
  colUnit: { width: 80, textAlign: 'right' },
  colTotal: { width: 80, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowTitle: {
    fontSize: 10.5,

    fontWeight: 600,
    color: colors.text,
    marginBottom: 2,
  },
  rowDesc: {
    fontSize: 9.5,

    fontWeight: 400,
    color: colors.muted,
    lineHeight: 1.5,
  },
  rowCell: {
    fontSize: 10.5,

    fontWeight: 400,
    color: colors.text,
    textAlign: 'right',
    paddingTop: 1,
  },
  totalsSection: {
    marginTop: 20,
    alignSelf: 'flex-end',
    width: 220,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  totalsLabel: {
    fontSize: 10,

    fontWeight: 400,
    color: colors.muted,
  },
  totalsValue: {
    fontSize: 10,

    fontWeight: 500,
    color: colors.text,
  },
  totalsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 12,

    fontWeight: 600,
    color: colors.text,
  },
  totalValue: {
    fontSize: 12,

    fontWeight: 600,
    color: colors.dark,
  },
  notes: {
    marginTop: 28,
    padding: 14,
    backgroundColor: colors.lightBg,
    borderRadius: 4,
  },
  notesLabel: {
    fontSize: 8,

    fontWeight: 600,
    color: colors.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  notesText: {
    fontSize: 10,

    fontWeight: 400,
    color: colors.muted,
    lineHeight: 1.6,
  },
})

export function QuotePage({ data }: { data: PdfDocumentData }) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.pageTitle}>{data.labels.quote}</Text>

      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>{data.labels.client}</Text>
          <Text style={styles.metaValue}>{data.client.company ?? data.client.name}</Text>
        </View>
        {data.client.email ? (
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>{data.labels.email}</Text>
            <Text style={styles.metaValue}>{data.client.email}</Text>
          </View>
        ) : null}
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>{data.labels.validUntil}</Text>
          <Text style={styles.metaValue}>{data.document.validUntil ?? '—'}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, styles.colTitle]}>{data.labels.item}</Text>
        <Text style={[styles.tableHeaderCell, styles.colQty]}>{data.labels.quantity}</Text>
        <Text style={[styles.tableHeaderCell, styles.colUnit]}>{data.labels.unitPrice}</Text>
        <Text style={[styles.tableHeaderCell, styles.colTotal]}>{data.labels.total}</Text>
      </View>

      {data.lines.map((line, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.colTitle}>
            <Text style={styles.rowTitle}>{line.title}</Text>
            {line.description ? (
              <Text style={styles.rowDesc}>{line.description}</Text>
            ) : null}
          </View>
          <Text style={[styles.rowCell, styles.colQty]}>{line.quantity}</Text>
          <Text style={[styles.rowCell, styles.colUnit]}>
            {formatMoney(line.unitPrice, line.currency, data.locale)}
          </Text>
          <Text style={[styles.rowCell, styles.colTotal]}>
            {formatMoney(line.total, line.currency, data.locale)}
          </Text>
        </View>
      ))}

      <View style={styles.totalsSection}>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>{data.labels.net}</Text>
          <Text style={styles.totalsValue}>
            {formatMoney(data.totals.subtotal, data.totals.currency, data.locale)}
          </Text>
        </View>
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>{data.labels.tax}</Text>
          <Text style={styles.totalsValue}>
            {formatMoney(data.totals.tax, data.totals.currency, data.locale)}
          </Text>
        </View>
        <View style={styles.totalsDivider} />
        <View style={styles.totalsRow}>
          <Text style={styles.totalLabel}>{data.labels.amountDue}</Text>
          <Text style={styles.totalValue}>
            {formatMoney(data.totals.total, data.totals.currency, data.locale)}
          </Text>
        </View>
      </View>

      {data.notes ? (
        <View style={styles.notes}>
          <Text style={styles.notesLabel}>{data.labels.notes}</Text>
          <Text style={styles.notesText}>{data.notes}</Text>
        </View>
      ) : null}
    </Page>
  )
}
