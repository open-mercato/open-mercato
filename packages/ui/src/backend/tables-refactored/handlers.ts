// handlers.ts

import { CellStore } from './store';
import {
  ColumnDef,
  TableEvents,
  CellEditSaveEvent,
  NewRowSaveEvent,
  NewRowSaveStartEvent,
  ColumnSortEvent,
  ColumnContextMenuEvent,
  RowContextMenuEvent,
  ContextMenuAction,
  ContextMenuState,
  SortState,
} from './types';
import { dispatch } from './events/events';

// ============================================
// CELL HANDLERS
// ============================================
export function createCellHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>,
  idColumnName: string
) {
  const handleCellSave = (row: number, col: number, newValue: any) => {
    const oldValue = store.getCellValue(row, col);
    const rowData = store.getRowData(row);
    
    // Skip if value unchanged
    if (String(oldValue ?? '') === String(newValue ?? '')) {
      store.clearEditing();
      return;
    }

    // Update store
    store.setCellValue(row, col, newValue);
    store.clearEditing();

    // Only dispatch event if not a new row
    if (!store.isNewRow(row)) {
      const parsedValue = parseValueByType(newValue, columns[col]);
      
      dispatch<CellEditSaveEvent>(tableRef.current as HTMLElement, TableEvents.CELL_EDIT_SAVE, {
        rowIndex: row,
        colIndex: col,
        oldValue,
        newValue: parsedValue,
        prop: columns[col].data,
        rowData,
        id: rowData?.[idColumnName],
      });
    }
  };

  const handleCellCancel = () => {
    store.clearEditing();
  };

  const handleStartEditing = (row: number, col: number) => {
    const column = columns[col];
    if (column?.readOnly) return;
    store.setEditingCell(row, col);
  };

  return {
    handleCellSave,
    handleCellCancel,
    handleStartEditing,
  };
}

// ============================================
// ROW HANDLERS
// ============================================
export function createRowHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>
) {
  const handleAddRow = () => {
    const newRowData = columns.reduce(
      (acc, col) => ({ ...acc, [col.data]: '' }),
      { _isNew: true }
    );
    
    store.addRow(newRowData, 0);
    store.setEditingCell(0, 0);
  };

  const handleSaveNewRow = (rowIndex: number) => {
    const rowData = { ...store.getRowData(rowIndex) };
    delete rowData._isNew;

    dispatch<NewRowSaveStartEvent>(
      tableRef.current as HTMLElement,
      TableEvents.NEW_ROW_SAVE_START,
      { rowIndex }
    );

    dispatch<NewRowSaveEvent>(tableRef.current as HTMLElement, TableEvents.NEW_ROW_SAVE, {
      rowIndex,
      rowData,
    });
  };

  const handleCancelNewRow = (rowIndex: number) => {
    store.removeRow(rowIndex);
  };

  return {
    handleAddRow,
    handleSaveNewRow,
    handleCancelNewRow,
  };
}

// ============================================
// MOUSE HANDLERS
// ============================================
export function createMouseHandlers(
  store: CellStore,
  columns: ColumnDef[],
  dragStateRef: React.MutableRefObject<{ isDragging: boolean; type: string | null; start: { row: number; col: number } | null }>,
  onDragStart: (row: number, col: number, type: 'cell' | 'row' | 'column') => void,
  onDragMove: (row: number, col: number) => void,
  onDragEnd: () => void
) {
  const handleMouseDown = (e: React.MouseEvent) => {
    // Save any current editing
    const editing = store.getEditingCell();
    if (editing) {
      store.clearEditing();
    }

    const cell = (e.target as HTMLElement).closest('td');
    if (!cell) return;

    // Ignore clicks on action buttons
    if ((e.target as HTMLElement).closest('.hot-row-cancel-btn, .hot-row-save-btn')) {
      return;
    }

    // Ignore clicks on actions cell
    if (cell.getAttribute('data-actions-cell') === 'true') {
      return;
    }

    const isRowHeader = cell.getAttribute('data-row-header') === 'true';
    const row = parseInt(cell.getAttribute('data-row') || '', 10);

    if (isRowHeader && !isNaN(row)) {
      onDragStart(row, 0, 'row');
      e.preventDefault();
      return;
    }

    const col = parseInt(cell.getAttribute('data-col') || '', 10);

    if (!isNaN(row) && !isNaN(col)) {
      onDragStart(row, col, 'cell');
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStateRef.current.isDragging) return;

    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('td');
    if (!cell) return;

    if (cell.getAttribute('data-row-header') === 'true' && dragStateRef.current.type !== 'row') {
      return;
    }

    if (cell.getAttribute('data-actions-cell') === 'true') {
      return;
    }

    const row = parseInt(cell.getAttribute('data-row') || '', 10);
    const col = parseInt(cell.getAttribute('data-col') || '', 10);

    if (!isNaN(row) && !isNaN(col)) {
      onDragMove(row, col);
    } else if (!isNaN(row) && dragStateRef.current.type === 'row') {
      onDragMove(row, columns.length - 1);
    }
  };

  const handleMouseUp = () => {
    if (dragStateRef.current.isDragging) {
      onDragEnd();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('td');
    if (!cell) return;

    if (cell.getAttribute('data-row-header') === 'true') return;
    if (cell.getAttribute('data-actions-cell') === 'true') return;

    const row = parseInt(cell.getAttribute('data-row') || '', 10);
    const col = parseInt(cell.getAttribute('data-col') || '', 10);

    if (!isNaN(row) && !isNaN(col)) {
      const column = columns[col];
      if (!column?.readOnly) {
        store.setEditingCell(row, col);
      }
    }
  };

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
  };
}

// ============================================
// COLUMN HEADER HANDLERS
// ============================================
export function createColumnHeaderHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>,
  sortState: SortState,
  setSortState: React.Dispatch<React.SetStateAction<SortState>>,
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>,
  columnActions?: (column: ColumnDef, colIndex: number) => ContextMenuAction[]
) {
  const handleColumnSort = (colIndex: number) => {
    const col = columns[colIndex];
    let newDirection: 'asc' | 'desc' | null;

    if (sortState.columnIndex === colIndex) {
      if (sortState.direction === null) {
        newDirection = 'asc';
      } else if (sortState.direction === 'asc') {
        newDirection = 'desc';
      } else {
        newDirection = null;
      }
    } else {
      newDirection = 'asc';
    }

    setSortState({
      columnIndex: newDirection === null ? null : colIndex,
      direction: newDirection,
    });

    dispatch<ColumnSortEvent>(tableRef.current as HTMLElement, TableEvents.COLUMN_SORT, {
      columnIndex: colIndex,
      columnName: col.data,
      direction: newDirection,
    });
  };

  const handleColumnHeaderDoubleClick = (e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!columnActions) return;

    const actions = columnActions(columns[colIndex], colIndex);

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      actions,
      type: 'column',
      index: colIndex,
    });
  };

  const handleColumnHeaderMouseDown = (
    e: React.MouseEvent,
    onDragStart: (row: number, col: number, type: 'cell' | 'row' | 'column') => void
  ) => {
    const header = (e.target as HTMLElement).closest('th');
    if (!header || header.classList.contains('hot-row-header')) return;

    const col = parseInt(header.getAttribute('data-col') || '', 10);
    if (isNaN(col)) return;

    onDragStart(0, col, 'column');
    e.preventDefault();
  };

  return {
    handleColumnSort,
    handleColumnHeaderDoubleClick,
    handleColumnHeaderMouseDown,
  };
}

// ============================================
// ROW HEADER HANDLERS
// ============================================
export function createRowHeaderHandlers(
  store: CellStore,
  tableRef: React.RefObject<HTMLDivElement | null>,
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>,
  rowActions?: (rowData: any, rowIndex: number) => ContextMenuAction[]
) {
  const handleRowHeaderDoubleClick = (e: React.MouseEvent, rowIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!rowActions) return;

    const rowData = store.getRowData(rowIndex);
    const actions = rowActions(rowData, rowIndex);

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      actions,
      type: 'row',
      index: rowIndex,
    });
  };

  return {
    handleRowHeaderDoubleClick,
  };
}

// ============================================
// CONTEXT MENU HANDLERS
// ============================================
export function createContextMenuHandlers(
  store: CellStore,
  columns: ColumnDef[],
  tableRef: React.RefObject<HTMLDivElement | null>,
  contextMenu: ContextMenuState | null,
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
) {
  const handleContextMenuAction = (actionId: string) => {
    if (!contextMenu) return;

    if (contextMenu.type === 'column') {
      dispatch<ColumnContextMenuEvent>(
        tableRef.current as HTMLElement,
        TableEvents.COLUMN_CONTEXT_MENU_ACTION,
        {
          columnIndex: contextMenu.index!,
          columnName: columns[contextMenu.index!].data,
          actionId,
        }
      );
    } else if (contextMenu.type === 'row') {
      const rowData = store.getRowData(contextMenu.index!);
      dispatch<RowContextMenuEvent>(
        tableRef.current as HTMLElement,
        TableEvents.ROW_CONTEXT_MENU_ACTION,
        {
          rowIndex: contextMenu.index!,
          rowData,
          actionId,
        }
      );
    }

    setContextMenu(null);
  };

  const handleContextMenuClose = () => {
    setContextMenu(null);
  };

  return {
    handleContextMenuAction,
    handleContextMenuClose,
  };
}

// ============================================
// RESIZE HANDLERS
// ============================================
export function createResizeHandlers(store: CellStore) {
  let resizingCol: number | null = null;
  let startX = 0;
  let startWidth = 0;

  const handleResizeStart = (e: React.MouseEvent, colIndex: number) => {
    e.stopPropagation();
    e.preventDefault();

    resizingCol = colIndex;
    startX = e.clientX;
    startWidth = store.getColumnWidth(colIndex);

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (resizingCol === null) return;

    const diff = e.clientX - startX;
    const newWidth = Math.max(50, startWidth + diff);

    store.setColumnWidth(resizingCol, newWidth);
  };

  const handleResizeEnd = () => {
    resizingCol = null;
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  };

  return {
    handleResizeStart,
  };
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function parseValueByType(value: any, col: ColumnDef): any {
  if (!col.type) return value;

  if (value === '' || value === null || value === undefined) {
    return null;
  }

  switch (col.type) {
    case 'numeric':
      const parsed = parseFloat(value);
      return isNaN(parsed) ? null : parsed;

    case 'date':
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;

    case 'boolean':
      return value === 'true' || value === '1' || value === 'yes' || value === true;

    default:
      return value;
  }
}
