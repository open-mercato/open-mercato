// store.ts

import {
  CellId,
  SelectionState,
  SelectionBounds,
  CellState,
  SaveStateType,
  CellSubscriber,
  ColumnDef,
  RangeEdges,
} from './types';

export interface CellStore {
  // --- Reads (imperative, no subscription) ---
  getCellValue(row: number, col: number): any;
  getRowData(row: number): any;
  getRowCount(): number;
  getSelection(): SelectionState;
  getSelectionBounds(): SelectionBounds | null;
  getEditingCell(): { row: number; col: number } | null;
  getSaveState(row: number, col: number): SaveStateType;
  isNewRow(row: number): boolean;
  getColumnWidth(col: number): number;
  getColumnWidths(): Map<number, number>;

  // Derived for cell rendering
  getCellState(row: number, col: number): CellState;

  // For copy/paste operations
  getCellsInSelection(): { row: number; col: number; value: any }[];

  // --- Writes (trigger revisions) ---
  setCellValue(row: number, col: number, value: any): void;
  setRowData(row: number, data: any): void;
  setSelection(selection: SelectionState): void;
  setEditingCell(row: number, col: number): void;
  clearEditing(): void;
  setSaveState(row: number, col: number, state: SaveStateType): void;
  setColumnWidth(col: number, width: number): void;

  // Bulk data operations
  setData(data: any[]): void;
  addRow(rowData: any, atIndex?: number): void;
  removeRow(rowIndex: number): void;
  markRowAsNew(rowIndex: number, isNew: boolean): void;
  markRowAsSaved(rowIndex: number, savedData: any): void;

  // --- Subscriptions ---
  subscribe(row: number, col: number, callback: CellSubscriber): () => void;
  getRevision(row: number, col: number): number;

  // --- Internal ---
  bumpRevision(row: number, col: number): void;
  bumpRevisions(cells: Array<{ row: number; col: number }>): void;
  bumpRowRevisions(row: number, colCount: number): void;
}

export function createCellStore(initialData: any[], columns: ColumnDef[]): CellStore {
  // Internal state
  const cellData = new Map<CellId, any>();
  const rowDataMap = new Map<number, any>();
  const revisions = new Map<CellId, number>();
  const subscribers = new Map<CellId, Set<CellSubscriber>>();
  const saveStates = new Map<CellId, SaveStateType>();
  const newRowFlags = new Set<number>();
  const columnWidths = new Map<number, number>();

  let selection: SelectionState = { type: null, anchor: null, focus: null };
  let editingCell: { row: number; col: number } | null = null;
  let rowCount = initialData.length;

  // Cache, invalidated on selection change
  let boundsCache: SelectionBounds | null = null;

  const getCellId = (row: number, col: number): CellId => `${row}:${col}`;

  const calcBounds = (): SelectionBounds | null => {
    if (!selection.anchor || !selection.focus) return null;

    if (selection.type === 'rowRange') {
      return {
        startRow: Math.min(selection.anchor.row, selection.focus.row),
        endRow: Math.max(selection.anchor.row, selection.focus.row),
        startCol: 0,
        endCol: columns.length - 1,
      };
    }

    if (selection.type === 'colRange') {
      return {
        startRow: 0,
        endRow: rowCount - 1,
        startCol: Math.min(selection.anchor.col, selection.focus.col),
        endCol: Math.max(selection.anchor.col, selection.focus.col),
      };
    }

    return {
      startRow: Math.min(selection.anchor.row, selection.focus.row),
      endRow: Math.max(selection.anchor.row, selection.focus.row),
      startCol: Math.min(selection.anchor.col, selection.focus.col),
      endCol: Math.max(selection.anchor.col, selection.focus.col),
    };
  };

  const notify = (row: number, col: number) => {
    const id = getCellId(row, col);
    const subs = subscribers.get(id);
    if (subs) {
      subs.forEach((cb) => cb());
    }
  };

  const bumpRevision = (row: number, col: number) => {
    const id = getCellId(row, col);
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    notify(row, col);
  };

  const bumpRevisions = (cells: Array<{ row: number; col: number }>) => {
    // First bump all revisions
    cells.forEach(({ row, col }) => {
      const id = getCellId(row, col);
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
    });
    // Then notify all (batch notifications)
    cells.forEach(({ row, col }) => notify(row, col));
  };

  const bumpRowRevisions = (row: number, colCount: number) => {
    const cells: Array<{ row: number; col: number }> = [];
    for (let col = 0; col < colCount; col++) {
      cells.push({ row, col });
    }
    bumpRevisions(cells);
  };

  const isCellInBounds = (row: number, col: number, bounds: SelectionBounds): boolean => {
    return (
      row >= bounds.startRow &&
      row <= bounds.endRow &&
      col >= bounds.startCol &&
      col <= bounds.endCol
    );
  };

  const getRangeEdges = (row: number, col: number, bounds: SelectionBounds): RangeEdges => ({
    top: row === bounds.startRow,
    bottom: row === bounds.endRow,
    left: col === bounds.startCol,
    right: col === bounds.endCol,
  });

  // Initialize data
  const initializeData = (data: any[]) => {
    cellData.clear();
    rowDataMap.clear();
    rowCount = data.length;

    data.forEach((row, rowIndex) => {
      rowDataMap.set(rowIndex, row);
      columns.forEach((col, colIndex) => {
        const value = row[col.data];
        cellData.set(getCellId(rowIndex, colIndex), value);
      });
    });
  };

  // Initialize with provided data
  initializeData(initialData);

  // Initialize column widths from column definitions
  columns.forEach((col, idx) => {
    if (col.width) {
      columnWidths.set(idx, col.width);
    }
  });

  const store: CellStore = {
    // --- Reads ---
    getCellValue(row: number, col: number): any {
      return cellData.get(getCellId(row, col));
    },

    getRowData(row: number): any {
      return rowDataMap.get(row);
    },

    getRowCount(): number {
      return rowCount;
    },

    getSelection(): SelectionState {
      return selection;
    },

    getSelectionBounds(): SelectionBounds | null {
      if (!boundsCache) {
        boundsCache = calcBounds();
      }
      return boundsCache;
    },

    getEditingCell(): { row: number; col: number } | null {
      return editingCell;
    },

    getSaveState(row: number, col: number): SaveStateType {
      return saveStates.get(getCellId(row, col)) ?? null;
    },

    isNewRow(row: number): boolean {
      return newRowFlags.has(row);
    },

    getColumnWidth(col: number): number {
      return columnWidths.get(col) ?? columns[col]?.width ?? 100;
    },

    getColumnWidths(): Map<number, number> {
      return new Map(columnWidths);
    },

    getCellState(row: number, col: number): CellState {
      const bounds = this.getSelectionBounds();
      const isInRange = bounds ? isCellInBounds(row, col, bounds) : false;

      const isSelected =
        selection.type === 'cell' &&
        selection.anchor?.row === row &&
        selection.anchor?.col === col;

      return {
        value: this.getCellValue(row, col),
        isSelected,
        isInRange,
        rangeEdges: isInRange && bounds ? getRangeEdges(row, col, bounds) : {},
        isEditing: editingCell?.row === row && editingCell?.col === col,
        saveState: this.getSaveState(row, col),
        isNewRow: this.isNewRow(row),
      };
    },

    getCellsInSelection(): { row: number; col: number; value: any }[] {
      const bounds = this.getSelectionBounds();
      if (!bounds) return [];

      const cells: { row: number; col: number; value: any }[] = [];
      for (let r = bounds.startRow; r <= bounds.endRow; r++) {
        for (let c = bounds.startCol; c <= bounds.endCol; c++) {
          cells.push({ row: r, col: c, value: this.getCellValue(r, c) });
        }
      }
      return cells;
    },

    // --- Writes ---
    setCellValue(row: number, col: number, value: any): void {
      const id = getCellId(row, col);
      cellData.set(id, value);

      // Also update rowData
      const rowData = rowDataMap.get(row);
      if (rowData && columns[col]) {
        rowData[columns[col].data] = value;
      }

      bumpRevision(row, col);
    },

    setRowData(row: number, data: any): void {
      rowDataMap.set(row, data);
      columns.forEach((col, colIndex) => {
        cellData.set(getCellId(row, colIndex), data[col.data]);
      });
      bumpRowRevisions(row, columns.length);
    },

    setSelection(newSelection: SelectionState): void {
      const oldBounds = this.getSelectionBounds();
      selection = newSelection;
      boundsCache = null; // invalidate cache
      const newBounds = this.getSelectionBounds();

      // Collect all affected cells
      const affected: Array<{ row: number; col: number }> = [];

      const addBoundsCells = (bounds: SelectionBounds | null) => {
        if (!bounds) return;
        for (let r = bounds.startRow; r <= bounds.endRow; r++) {
          for (let c = bounds.startCol; c <= bounds.endCol; c++) {
            affected.push({ row: r, col: c });
          }
        }
      };

      addBoundsCells(oldBounds);
      addBoundsCells(newBounds);

      // Dedupe
      const seen = new Set<CellId>();
      const unique = affected.filter(({ row, col }) => {
        const id = getCellId(row, col);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      bumpRevisions(unique);
    },

    setEditingCell(row: number, col: number): void {
      const prev = editingCell;
      editingCell = { row, col };

      if (prev) {
        bumpRevision(prev.row, prev.col);
      }
      bumpRevision(row, col);
    },

    clearEditing(): void {
      if (editingCell) {
        const { row, col } = editingCell;
        editingCell = null;
        bumpRevision(row, col);
      }
    },

    setSaveState(row: number, col: number, state: SaveStateType): void {
      const id = getCellId(row, col);
      if (state === null) {
        saveStates.delete(id);
      } else {
        saveStates.set(id, state);
      }
      bumpRevision(row, col);
    },

    setColumnWidth(col: number, width: number): void {
      columnWidths.set(col, width);
      // Bump all cells in this column that are currently subscribed
      subscribers.forEach((_, id) => {
        const [, c] = id.split(':').map(Number);
        if (c === col) {
          const [r] = id.split(':').map(Number);
          bumpRevision(r, c);
        }
      });
    },

    setData(data: any[]): void {
      initializeData(data);
      newRowFlags.clear();

      // Bump all subscribed cells
      subscribers.forEach((_, id) => {
        const [row, col] = id.split(':').map(Number);
        bumpRevision(row, col);
      });
    },

    addRow(rowData: any, atIndex: number = 0): void {
      // Shift all existing data down
      const newRowDataMap = new Map<number, any>();
      const newCellData = new Map<CellId, any>();
      const newRevisions = new Map<CellId, number>();
      const newSaveStates = new Map<CellId, SaveStateType>();
      const newNewRowFlags = new Set<number>();

      // Shift rows after insertion point
      rowDataMap.forEach((data, idx) => {
        const newIdx = idx >= atIndex ? idx + 1 : idx;
        newRowDataMap.set(newIdx, data);
      });

      // Shift cell data
      cellData.forEach((value, id) => {
        const [r, c] = id.split(':').map(Number);
        const newR = r >= atIndex ? r + 1 : r;
        newCellData.set(getCellId(newR, c), value);
      });

      // Shift revisions
      revisions.forEach((rev, id) => {
        const [r, c] = id.split(':').map(Number);
        const newR = r >= atIndex ? r + 1 : r;
        newRevisions.set(getCellId(newR, c), rev);
      });

      // Shift save states
      saveStates.forEach((state, id) => {
        const [r, c] = id.split(':').map(Number);
        const newR = r >= atIndex ? r + 1 : r;
        newSaveStates.set(getCellId(newR, c), state);
      });

      // Shift new row flags
      newRowFlags.forEach((idx) => {
        newNewRowFlags.add(idx >= atIndex ? idx + 1 : idx);
      });

      // Clear and repopulate
      rowDataMap.clear();
      cellData.clear();
      revisions.clear();
      saveStates.clear();
      newRowFlags.clear();

      newRowDataMap.forEach((data, idx) => rowDataMap.set(idx, data));
      newCellData.forEach((value, id) => cellData.set(id, value));
      newRevisions.forEach((rev, id) => revisions.set(id, rev));
      newSaveStates.forEach((state, id) => saveStates.set(id, state));
      newNewRowFlags.forEach((idx) => newRowFlags.add(idx));

      // Add new row
      rowDataMap.set(atIndex, rowData);
      columns.forEach((col, colIndex) => {
        cellData.set(getCellId(atIndex, colIndex), rowData[col.data] ?? '');
      });

      rowCount++;

      // Mark as new row
      newRowFlags.add(atIndex);

      // Bump all subscribed cells
      subscribers.forEach((_, id) => {
        const [row, col] = id.split(':').map(Number);
        bumpRevision(row, col);
      });
    },

    removeRow(rowIndex: number): void {
      // Shift all data up
      const newRowDataMap = new Map<number, any>();
      const newCellData = new Map<CellId, any>();
      const newRevisions = new Map<CellId, number>();
      const newSaveStates = new Map<CellId, SaveStateType>();
      const newNewRowFlags = new Set<number>();

      rowDataMap.forEach((data, idx) => {
        if (idx < rowIndex) {
          newRowDataMap.set(idx, data);
        } else if (idx > rowIndex) {
          newRowDataMap.set(idx - 1, data);
        }
      });

      cellData.forEach((value, id) => {
        const [r, c] = id.split(':').map(Number);
        if (r < rowIndex) {
          newCellData.set(getCellId(r, c), value);
        } else if (r > rowIndex) {
          newCellData.set(getCellId(r - 1, c), value);
        }
      });

      revisions.forEach((rev, id) => {
        const [r, c] = id.split(':').map(Number);
        if (r < rowIndex) {
          newRevisions.set(getCellId(r, c), rev);
        } else if (r > rowIndex) {
          newRevisions.set(getCellId(r - 1, c), rev);
        }
      });

      saveStates.forEach((state, id) => {
        const [r, c] = id.split(':').map(Number);
        if (r < rowIndex) {
          newSaveStates.set(getCellId(r, c), state);
        } else if (r > rowIndex) {
          newSaveStates.set(getCellId(r - 1, c), state);
        }
      });

      newRowFlags.forEach((idx) => {
        if (idx < rowIndex) {
          newNewRowFlags.add(idx);
        } else if (idx > rowIndex) {
          newNewRowFlags.add(idx - 1);
        }
      });

      // Clear and repopulate
      rowDataMap.clear();
      cellData.clear();
      revisions.clear();
      saveStates.clear();
      newRowFlags.clear();

      newRowDataMap.forEach((data, idx) => rowDataMap.set(idx, data));
      newCellData.forEach((value, id) => cellData.set(id, value));
      newRevisions.forEach((rev, id) => revisions.set(id, rev));
      newSaveStates.forEach((state, id) => saveStates.set(id, state));
      newNewRowFlags.forEach((idx) => newRowFlags.add(idx));

      rowCount--;

      // Bump all subscribed cells
      subscribers.forEach((_, id) => {
        const [row, col] = id.split(':').map(Number);
        bumpRevision(row, col);
      });
    },

    markRowAsNew(rowIndex: number, isNew: boolean): void {
      if (isNew) {
        newRowFlags.add(rowIndex);
      } else {
        newRowFlags.delete(rowIndex);
      }
      bumpRowRevisions(rowIndex, columns.length);
    },

    markRowAsSaved(rowIndex: number, savedData: any): void {
      newRowFlags.delete(rowIndex);
      rowDataMap.set(rowIndex, savedData);
      columns.forEach((col, colIndex) => {
        cellData.set(getCellId(rowIndex, colIndex), savedData[col.data]);
      });
      bumpRowRevisions(rowIndex, columns.length);
    },

    // --- Subscriptions ---
    subscribe(row: number, col: number, callback: CellSubscriber): () => void {
      const id = getCellId(row, col);
      if (!subscribers.has(id)) {
        subscribers.set(id, new Set());
      }
      subscribers.get(id)!.add(callback);

      return () => {
        const subs = subscribers.get(id);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) {
            subscribers.delete(id);
          }
        }
      };
    },

    getRevision(row: number, col: number): number {
      return revisions.get(getCellId(row, col)) ?? 0;
    },

    bumpRevision,
    bumpRevisions,
    bumpRowRevisions,
  };

  return store;
}
