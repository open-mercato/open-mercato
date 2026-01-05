// perspectiveHandlers.ts

import React from 'react';
import { dispatch } from '../events/events';
import {
  ColumnDef,
  FilterRow,
  FilterColor,
  TableEvents,
} from '../types/index';
import {
  SortRule,
  PerspectiveConfig,
  PerspectiveSaveEvent,
  PerspectiveSelectEvent,
  PerspectiveRenameEvent,
  PerspectiveDeleteEvent,
  PerspectiveChangeEvent,
  generatePerspectiveId,
  ColumnConfig,
} from '../types/perspective';

// ============================================
// PERSPECTIVE STATE INTERFACE
// ============================================

export interface PerspectiveState {
  /** Visible columns in display order */
  visibleColumns: string[];
  /** Hidden columns */
  hiddenColumns: string[];
  /** Active filter rules */
  filters: FilterRow[];
  /** Active sort rules */
  sortRules: SortRule[];
}

// ============================================
// HANDLER DEPENDENCIES
// ============================================

export interface PerspectiveHandlersDeps {
  tableRef: React.RefObject<HTMLElement | null>;
  columns: ColumnDef[];
  savedPerspectives: PerspectiveConfig[];
  activePerspectiveId: string | null;
  // State setters
  setVisibleColumns: React.Dispatch<React.SetStateAction<string[]>>;
  setHiddenColumns: React.Dispatch<React.SetStateAction<string[]>>;
  setFilters: React.Dispatch<React.SetStateAction<FilterRow[]>>;
  setSortRules: React.Dispatch<React.SetStateAction<SortRule[]>>;
  setInternalActivePerspectiveId: React.Dispatch<React.SetStateAction<string | null>>;
}

// ============================================
// CREATE PERSPECTIVE HANDLERS
// ============================================

export function createPerspectiveHandlers({
  tableRef,
  columns,
  savedPerspectives,
  activePerspectiveId,
  setVisibleColumns,
  setHiddenColumns,
  setFilters,
  setSortRules,
  setInternalActivePerspectiveId,
}: PerspectiveHandlersDeps) {
  // -------------------- Column Handlers --------------------

  const handleColumnVisibilityChange = (visible: string[], hidden: string[]) => {
    setVisibleColumns(visible);
    setHiddenColumns(hidden);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: {
          columns: { visible, hidden },
        },
      }
    );
  };

  const handleColumnOrderChange = (newOrder: string[]) => {
    setVisibleColumns(newOrder);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: {
          columns: {
            visible: newOrder,
            hidden: [], // Will be filled by the component
          },
        },
      }
    );
  };

  // -------------------- Filter Handlers --------------------

  const handleFiltersChange = (filters: FilterRow[]) => {
    setFilters(filters);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { filters },
      }
    );
  };

  // -------------------- Sort Handlers --------------------

  const handleSortRulesChange = (rules: SortRule[]) => {
    setSortRules(rules);

    // Dispatch change event
    dispatch<PerspectiveChangeEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: { sorting: rules },
      }
    );
  };

  // -------------------- Perspective Save/Select/Delete --------------------

  const handleSavePerspective = (perspective: PerspectiveConfig) => {
    // Dispatch save event with full perspective data ready for API
    dispatch<PerspectiveSaveEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_SAVE,
      { perspective }
    );

    // Set as active
    setInternalActivePerspectiveId(perspective.id);
  };

  const handlePerspectiveSelect = (id: string | null) => {
    setInternalActivePerspectiveId(id);

    if (id === null) {
      // Reset to default (all columns visible, no filters, no sorting)
      const allColumnKeys = columns.map(c => c.data);
      setVisibleColumns(allColumnKeys);
      setHiddenColumns([]);
      setFilters([]);
      setSortRules([]);

      dispatch<PerspectiveSelectEvent>(
        tableRef.current as HTMLElement,
        TableEvents.PERSPECTIVE_SELECT,
        { id: null, config: null }
      );
    } else {
      const perspective = savedPerspectives.find(p => p.id === id);
      if (perspective) {
        setVisibleColumns(perspective.columns.visible);
        setHiddenColumns(perspective.columns.hidden);
        setFilters(perspective.filters);
        setSortRules(perspective.sorting);

        dispatch<PerspectiveSelectEvent>(
          tableRef.current as HTMLElement,
          TableEvents.PERSPECTIVE_SELECT,
          { id, config: perspective }
        );
      }
    }
  };

  const handlePerspectiveRename = (id: string, newName: string) => {
    dispatch<PerspectiveRenameEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_RENAME,
      { id, newName }
    );
  };

  const handlePerspectiveDelete = (id: string) => {
    dispatch<PerspectiveDeleteEvent>(
      tableRef.current as HTMLElement,
      TableEvents.PERSPECTIVE_DELETE,
      { id }
    );

    // If deleting active perspective, reset
    if (activePerspectiveId === id) {
      setInternalActivePerspectiveId(null);
      const allColumnKeys = columns.map(c => c.data);
      setVisibleColumns(allColumnKeys);
      setHiddenColumns([]);
      setFilters([]);
      setSortRules([]);
    }
  };

  return {
    // Column handlers
    handleColumnVisibilityChange,
    handleColumnOrderChange,
    // Filter handlers
    handleFiltersChange,
    // Sort handlers
    handleSortRulesChange,
    // Perspective management
    handleSavePerspective,
    handlePerspectiveSelect,
    handlePerspectiveRename,
    handlePerspectiveDelete,
  };
}

// ============================================
// UTILITY: Initialize State from Perspective
// ============================================

export function initializePerspectiveState(
  columns: ColumnDef[],
  perspective?: PerspectiveConfig | null,
  defaultHiddenColumns: string[] = []
): PerspectiveState {
  if (perspective) {
    return {
      visibleColumns: perspective.columns.visible,
      hiddenColumns: perspective.columns.hidden,
      filters: perspective.filters,
      sortRules: perspective.sorting,
    };
  }

  // Default state
  const allColumnKeys = columns.map(c => c.data);
  const visibleColumns = allColumnKeys.filter(k => !defaultHiddenColumns.includes(k));
  const hiddenColumns = defaultHiddenColumns.filter(k => allColumnKeys.includes(k));

  return {
    visibleColumns,
    hiddenColumns,
    filters: [],
    sortRules: [],
  };
}
