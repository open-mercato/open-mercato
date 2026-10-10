import { createElement, type PropsWithChildren } from 'react'
import { Page as ReactPdfPage, type PageProps } from '@react-pdf/renderer'
import { getPdfFontRegistry } from './font-registry'

export { Document, Text, View, Image, Link, Svg, Path, Rect, Circle, StyleSheet } from '@react-pdf/renderer'
export type { DocumentProps, PageProps, TextProps, ViewProps } from '@react-pdf/renderer'

export function Page({ style, children, ...props }: PropsWithChildren<PageProps>) {
  const ownStyles = style === undefined ? [] : Array.isArray(style) ? style : [style]
  return createElement(ReactPdfPage, { ...props, style: [{ fontFamily: getPdfFontRegistry().fontFamily }, ...ownStyles] }, children)
}
