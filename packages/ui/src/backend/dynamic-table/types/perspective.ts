// types/perspective.ts

import { FilterRow, FilterColor } from './index';

// ============================================
// PERSPECTIVE DATA STRUCTURES
// ============================================

export interface SortRule {
  id: string;
  field: string;
  direction: 'asc' | 'desc';
}

export interface ColumnConfig {
  /** Column data keys in display order (visible columns) */
  visible: string[];
  /** Hidden column data keys */
  hidden: string[];
}

export interface PerspectiveConfig {
  id: string;
  name: string;
  color?: FilterColor;
  columns: ColumnConfig;
  filters: FilterRow[];
  sorting: SortRule[];
}

// ============================================
// PERSPECTIVE EVENT TYPES
// ============================================

export interface PerspectiveSaveEvent {
  perspective: PerspectiveConfig;
}

export interface PerspectiveSelectEvent {
  id: string | null;
  config: PerspectiveConfig | null;
}

export interface PerspectiveRenameEvent {
  id: string;
  newName: string;
}

export interface PerspectiveDeleteEvent {
  id: string;
}

export interface PerspectiveChangeEvent {
  /** Partial config - only changed fields */
  config: Partial<Omit<PerspectiveConfig, 'id' | 'name'>>;
}

// ============================================
// TABLE EVENTS EXTENSION
// ============================================

export const PerspectiveEvents = {
  PERSPECTIVE_SAVE: 'table:perspective:save',
  PERSPECTIVE_SELECT: 'table:perspective:select',
  PERSPECTIVE_RENAME: 'table:perspective:rename',
  PERSPECTIVE_DELETE: 'table:perspective:delete',
  PERSPECTIVE_CHANGE: 'table:perspective:change',
} as const;

// Type mapping for perspective event payloads
export type PerspectiveEventPayloads = {
  [PerspectiveEvents.PERSPECTIVE_SAVE]: PerspectiveSaveEvent;
  [PerspectiveEvents.PERSPECTIVE_SELECT]: PerspectiveSelectEvent;
  [PerspectiveEvents.PERSPECTIVE_RENAME]: PerspectiveRenameEvent;
  [PerspectiveEvents.PERSPECTIVE_DELETE]: PerspectiveDeleteEvent;
  [PerspectiveEvents.PERSPECTIVE_CHANGE]: PerspectiveChangeEvent;
};

// Type for perspective event handler map
export type PerspectiveEventHandlers = {
  [K in keyof PerspectiveEventPayloads]?: (payload: PerspectiveEventPayloads[K]) => void;
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Creates a default perspective config from column definitions
 */
export function createDefaultPerspective(
  columns: { data: string }[],
  hiddenColumns: string[] = []
): Omit<PerspectiveConfig, 'id' | 'name'> {
  const allColumnKeys = columns.map(col => col.data);
  const visible = allColumnKeys.filter(key => !hiddenColumns.includes(key));
  const hidden = hiddenColumns.filter(key => allColumnKeys.includes(key));

  return {
    columns: { visible, hidden },
    filters: [],
    sorting: [],
  };
}

/**
 * Merges a partial perspective config with defaults
 */
export function mergePerspectiveConfig(
  base: Omit<PerspectiveConfig, 'id' | 'name'>,
  partial: Partial<Omit<PerspectiveConfig, 'id' | 'name'>>
): Omit<PerspectiveConfig, 'id' | 'name'> {
  return {
    columns: partial.columns ?? base.columns,
    filters: partial.filters ?? base.filters,
    sorting: partial.sorting ?? base.sorting,
  };
}

/**
 * Generates a unique ID for new perspective items
 */
export function generatePerspectiveId(): string {
  return `perspective-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generates a unique ID for sort rules
 */
export function generateSortRuleId(): string {
  return `sort-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
