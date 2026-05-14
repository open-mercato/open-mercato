import {
  AlignLeft,
  AtSign,
  Calendar,
  CalendarClock,
  CheckSquare,
  Flag,
  FileText,
  GripVertical,
  Hash,
  Heading,
  List,
  ListChecks,
  Redo2,
  Rows,
  Sigma,
  SlidersHorizontal,
  Square,
  ToggleLeft,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react'

/**
 * Resolves a lucide icon name (as stored on `FieldTypeSpec.icon`) to a
 * concrete component. Names are lowercase-kebab to match the public lucide
 * site (e.g. `align-left`, `calendar-clock`); the fallback is `Square` per
 * R-5 in `.ai/specs/2026-05-10-forms-visual-builder.md`.
 *
 * The map is intentionally narrow — Phase A only registers icons referenced
 * by core field-type specs. Field types added in later phases extend this
 * map (or the registry can extend the catalog at runtime in a future spec).
 */
const ICON_TABLE: Record<string, LucideIcon> = {
  'align-left': AlignLeft,
  calendar: Calendar,
  'calendar-clock': CalendarClock,
  'check-square': CheckSquare,
  'file-text': FileText,
  'grip-vertical': GripVertical,
  hash: Hash,
  heading: Heading,
  list: List,
  'list-checks': ListChecks,
  rows: Rows,
  'sliders-horizontal': SlidersHorizontal,
  square: Square,
  'toggle-left': ToggleLeft,
  type: Type,
}

export function resolveLucideIcon(name: string | undefined): LucideIcon {
  if (!name) return Square
  return ICON_TABLE[name] ?? Square
}

export { AtSign, Flag, GripVertical, Sigma, Trash2, Undo2, Redo2 }
