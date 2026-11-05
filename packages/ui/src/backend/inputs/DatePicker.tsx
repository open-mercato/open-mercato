/**
 * @deprecated Import from `@open-mercato/ui/primitives/date-picker` instead.
 *
 * This shim preserves the legacy import path
 * `@open-mercato/ui/backend/inputs/DatePicker` for existing consumers
 * (CrudForm, example pages) while the DatePicker is promoted to a
 * primitive in DS Foundation v3.
 *
 * Default footer is the Figma-aligned `'apply-cancel'` mode (per user
 * directive 2026-05-09 — "zmień globalnie"). Consumers that explicitly
 * need the legacy `Today` / `Clear` footer can pass `footer="today-clear"`.
 *
 * Migration: replace
 *   import { DatePicker } from '@open-mercato/ui/backend/inputs/DatePicker'
 * with
 *   import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
 */

"use client"

import * as React from 'react'
import {
  DatePicker as DatePickerPrimitive,
  type DatePickerProps as DatePickerPrimitivePropsBase,
  type DatePickerFooter,
} from '../../primitives/date-picker'

export type DatePickerProps = DatePickerPrimitivePropsBase

/** @deprecated Use `DatePicker` from `@open-mercato/ui/primitives/date-picker`. */
export function DatePicker(props: DatePickerProps) {
  return <DatePickerPrimitive {...props} />
}

export type { DatePickerFooter }
