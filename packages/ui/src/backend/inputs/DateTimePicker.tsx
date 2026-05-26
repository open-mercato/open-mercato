/**
 * @deprecated Import `DatePicker` from `@open-mercato/ui/primitives/date-picker`
 * and pass `withTime` instead. The standalone `DateTimePicker` is replaced by
 * a `withTime` prop on the unified primitive in DS Foundation v3.
 *
 * Default footer is the Figma-aligned `'apply-cancel'` mode (per user
 * directive 2026-05-09 — "zmień globalnie"). Consumers that explicitly
 * need the legacy `Today` / `Clear` footer can pass `footer="today-clear"`.
 *
 * Migration: replace
 *   import { DateTimePicker } from '@open-mercato/ui/backend/inputs/DateTimePicker'
 *   <DateTimePicker value={...} onChange={...} />
 * with
 *   import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
 *   <DatePicker value={...} onChange={...} withTime />
 */

"use client"

import * as React from 'react'
import {
  DatePicker as DatePickerPrimitive,
  type DatePickerProps as DatePickerPrimitiveProps,
} from '../../primitives/date-picker'

export type DateTimePickerProps = Omit<DatePickerPrimitiveProps, 'withTime'>

/** @deprecated Use `DatePicker withTime` from `@open-mercato/ui/primitives/date-picker`. */
export function DateTimePicker(props: DateTimePickerProps) {
  return <DatePickerPrimitive {...props} withTime />
}
