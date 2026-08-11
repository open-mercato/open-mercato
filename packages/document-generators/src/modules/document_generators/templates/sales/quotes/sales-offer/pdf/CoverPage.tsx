import React from 'react'
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { colors } from '../../../../shared/theme'
import type { PdfDocumentData } from '../types'

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.dark,
    padding: 50,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  glow: {
    position: 'absolute',
    width: 555,
    height: 555,
    borderRadius: 700,
    backgroundColor: '#1e2535',
    top: -15,
    left: -190,
    opacity: 0.4,
  },
  header: {
    fontSize: 12,
    color: '#8899aa',

    fontWeight: 600,
    letterSpacing: 2,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    color: '#8899aa',

    fontWeight: 600,
    letterSpacing: 2,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  clientName: {
    fontSize: 56,
    color: colors.white,

    fontWeight: 600,
    lineHeight: 1.1,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: '#8899aa',

    fontWeight: 400,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  footerLeft: {
    flexDirection: 'column',
    gap: 2,
  },
  footerCompany: {
    fontSize: 11,
    color: colors.white,

    fontWeight: 600,
  },
  footerContact: {
    fontSize: 9,
    color: '#8899aa',

    fontWeight: 400,
  },
  date: {
    fontSize: 11,
    color: '#8899aa',

    fontWeight: 600,
    letterSpacing: 2,
  },
})

export function CoverPage({ data }: { data: PdfDocumentData }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.glow} />

      <Text style={styles.header}>{data.seller.company.toUpperCase()}</Text>

      <View style={styles.centerContent}>
        <Text style={styles.label}>Oferta handlowa · {data.document.number}</Text>
        <Text style={styles.clientName}>{data.client.company ?? data.client.name}</Text>
        <Text style={styles.subtitle}>Propozycja współpracy</Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Text style={styles.footerCompany}>{data.seller.name}</Text>
          <Text style={styles.footerContact}>{data.seller.email}</Text>
          {data.seller.phone ? (
            <Text style={styles.footerContact}>{data.seller.phone}</Text>
          ) : null}
        </View>
        <Text style={styles.date}>{data.document.date.toUpperCase()}</Text>
      </View>
    </Page>
  )
}
