import React, { useState, memo, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import './HOT.css';
import { getCellRenderer, ColumnConfig } from './renderers';
import {dispatch, useMediator} from "./events/events"
import { CellSaveErrorEvent, CellSaveStartEvent, CellSaveSuccessEvent, TableEvents, NewRowSaveEvent, NewRowSaveStartEvent, NewRowSaveSuccessEvent, NewRowSaveErrorEvent, FilterChangeEvent } from './events/types';
import FilterBuilder from './FilterBuilder';
import FilterTabs from './FilterTabs';
import { FilterRow, SavedFilter, applyFilters } from './filterTypes';

interface TableCellProps {
  value: any;
  rowIndex: number;
  colIndex: number;
  col: ColumnConfig;
  rowData: any;
  isRowHeader?: boolean;
  isCellSelected?: boolean;
  isRowSelected?: boolean;
  isColSelected?: boolean;
  hasCellSelected?: boolean;
  isInRange?: boolean;
  rangeEdges?: {
    top?: boolean;
    bottom?: boolean;
    left?: boolean;
    right?: boolean;
  };
  isInRowRange?: boolean;
  rowRangeEdges?: {
    top?: boolean;
    bottom?: boolean;
  };
  isInColRange?: boolean;
  colRangeEdges?: {
    left?: boolean;
    right?: boolean;
  };
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onEditKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onEditBlur?: () => void;
  editInputRef?: React.RefObject<HTMLTextAreaElement | null>;
  saveState?: CellSaveState;
  isNewRow?: boolean;
  isFirstDataCell?: boolean;
  onCancelRow?: () => void;
  stickyLeft?: number;
  stickyRight?: number;
  rowSaveState?: 'saving' | 'success' | 'error' | null;
}

interface CellSaveState {
  status: 'saving' | 'success' | 'error' | null;
  timestamp: number;
}

// Memoized TableCell component
const TableCell = memo<TableCellProps>(({ 
  value, 
  rowIndex, 
  colIndex, 
  col,
  rowData,
  isRowHeader,
  isCellSelected,
  isRowSelected,
  isColSelected,
  hasCellSelected,
  isInRange,
  rangeEdges = {},
  isInRowRange,
  rowRangeEdges = {},
  isInColRange,
  colRangeEdges = {},
  isEditing,
  editValue,
  onEditChange,
  onEditKeyDown,
  onEditBlur,
  editInputRef,
  saveState,
  isNewRow,
  isFirstDataCell,
  onCancelRow,
  stickyLeft,
  stickyRight,
  rowSaveState
}) => {
  if (isRowHeader) {
    return (
      <td 
        className="hot-row-header" 
        data-row={rowIndex}
        data-row-header="true"
        data-has-selected-cell={hasCellSelected}
        data-in-row-range={isInRowRange}
        style={{
          width: 50,
          flexBasis: 50,
          flexShrink: 0,
          flexGrow: 0,
          position: 'sticky',
          left: 0,
          zIndex: 3
        }}
      >
        {isNewRow ? (
          <button
            className="hot-row-cancel-btn-header"
            onClick={(e) => {
              e.stopPropagation();
              onCancelRow?.();
            }}
            title="Cancel"
          >
            ✕
          </button>
        ) : (
          rowIndex + 1
        )}
      </td>
    );
  }

  // Get renderer for this column
  const renderer = getCellRenderer(col);
  const renderedValue = renderer(value, rowData, col, rowIndex, colIndex);
  const isCustomRenderer = typeof col.renderer === 'function';

  const cellStyle: React.CSSProperties = { 
    width: col.width || 100,
    flexBasis: col.width || 100,
    flexShrink: 0,
    flexGrow: 0,
    position: 'relative'
  };

  if (stickyLeft !== undefined) {
    cellStyle.position = 'sticky';
    cellStyle.left = stickyLeft;
    cellStyle.zIndex = 2;
  } else if (stickyRight !== undefined) {
    cellStyle.position = 'sticky';
    cellStyle.right = stickyRight;
    cellStyle.zIndex = 2;
  }

  return (
    <td
      className={`hot-cell ${col.readOnly ? 'read-only' : ''}`}
      style={cellStyle}
      data-row={rowIndex}
      data-col={colIndex}
      data-custom-renderer={isCustomRenderer}
      data-cell-selected={isCellSelected}
      data-col-selected={isColSelected}
      data-in-range={isInRange}
      data-range-top={rangeEdges.top}
      data-range-bottom={rangeEdges.bottom}
      data-range-left={rangeEdges.left}
      data-range-right={rangeEdges.right}
      data-in-row-range={isInRowRange}
      data-row-range-top={rowRangeEdges.top}
      data-row-range-bottom={rowRangeEdges.bottom}
      data-in-col-range={isInColRange}
      data-col-range-left={colRangeEdges.left}
      data-col-range-right={colRangeEdges.right}
      data-save-state={saveState?.status}
      data-row-save-state={rowSaveState}
      data-sticky-left={stickyLeft !== undefined}
      data-sticky-right={stickyRight !== undefined}
    >
      {isEditing ? (
        <textarea
          ref={editInputRef}
          value={editValue}
          onChange={onEditChange}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          className="hot-cell-editor"
        />
      ) : (
        renderedValue
      )}
    </td>
  );
});

TableCell.displayName = 'TableCell';

interface SelectionState {
  type: 'cell' | 'row' | 'column' | 'range' | 'rowRange' | 'colRange' | null;
  row: number | null;
  col: number | null;
  range: {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  } | null;
  rowRange: {
    start: number;
    end: number;
  } | null;
  colRange: {
    start: number;
    end: number;
  } | null;
}

interface EditingState {
  row: number | null;
  col: number | null;
  value: string;
}

interface HOTProps {
  data?: any[];
  columns?: ColumnConfig[];
  colHeaders?: boolean | string[];
  rowHeaders?: boolean;
  height?: string | number;
  width?: string | number;
  idColumName?: string;
  tableName?: string;
  tableRef: React.RefObject<HTMLDivElement | null>;
}

const HOT: React.FC<HOTProps> = ({ 
  data = [], 
  columns = [],
  colHeaders = true,
  rowHeaders = false,
  height = 'auto',
  width = 'auto',
  idColumName = 'id',
  tableName = 'Table Name',
  tableRef
}) => {
  const [tableData, setTableData] = useState(data);
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionState>({
    type: null,
    row: null,
    col: null,
    range: null,
    rowRange: null,
    colRange: null
  });
  const [cellSaveStates, setCellSaveStates] = useState<Map<string, CellSaveState>>(new Map());
  const [rowSaveStates, setRowSaveStates] = useState<Map<number, 'saving' | 'success' | 'error' | null>>(new Map());
  const [editing, setEditing] = useState<EditingState>({ row: null, col: null, value: '' });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<any>(null);
  const dragTypeRef = useRef<'cell' | 'row' | 'column' | null>(null);
  const lastUpdateRef = useRef(0);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const isTabbing = useRef(false);
  const THROTTLE_MS = 50;

  const isObjectData = tableData.length > 0 && typeof tableData[0] === 'object' && !Array.isArray(tableData[0]);

  const getCellKey = (row: number, col: number) => `${row},${col}`;

  const getColumns = (): ColumnConfig[] => {
    if (columns.length > 0) return columns;
    if (isObjectData && tableData.length > 0) {
      return Object.keys(tableData[0]).filter(key => key !== '_isNew').map(key => ({ data: key }));
    }
    if (tableData.length > 0 && Array.isArray(tableData[0])) {
      return tableData[0].map((_: any, index: number) => ({ data: index }));
    }
    return [];
  };

  const cols = getColumns();

  // Load saved filters from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('table-saved-filters');
    if (stored) {
      try {
        setSavedFilters(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load saved filters', e);
      }
    }
  }, []);

  // Update tableData when data prop changes
  useEffect(() => {
    setTableData(data);
  }, [data]);

  // Emit filter change event whenever filters change
  useEffect(() => {
    const activeFilter = savedFilters.find(f => f.id === activeFilterId);
    const filtersToEmit = activeFilter ? activeFilter.rows : filterRows;
    
    dispatch(
      tableRef?.current as HTMLElement,
      TableEvents.FILTER_CHANGE,
      {
        filters: filtersToEmit,
        savedFilterId: activeFilterId
      } as FilterChangeEvent
    );
  }, [filterRows, savedFilters, activeFilterId, tableRef]);

  // Actions column configuration (always present, sticky right)
  const actionsColumn: ColumnConfig = {
    data: '_actions',
    title: 'Actions',
    width: 80,
    sticky: 'right',
    readOnly: true
  };

  // All columns including actions
  const allColumns = [...cols, actionsColumn];

  // Calculate sticky offsets
  const calculateStickyOffsets = () => {
    const leftOffsets: number[] = [];
    const rightOffsets: number[] = [];
    
    let leftOffset = rowHeaders ? 50 : 0;
    let rightOffset = 0;

    allColumns.forEach((col, index) => {
      if (col.sticky === 'left') {
        leftOffsets[index] = leftOffset;
        leftOffset += col.width || 100;
      } else if (col.sticky === 'right') {
        rightOffsets[index] = rightOffset;
        rightOffset += col.width || 100;
      }
    });

    return { leftOffsets, rightOffsets };
  };

  const { leftOffsets, rightOffsets } = calculateStickyOffsets();

  const getCellValue = useCallback((row: any, col: ColumnConfig) => {
    if (isObjectData) {
      return row[col.data];
    }
    return row[col.data];
  }, [isObjectData]);

  const getColHeader = (col: ColumnConfig, index: number): string => {
    if (Array.isArray(colHeaders)) return colHeaders[index];
    if (col.title) return col.title;
    if (isObjectData) return String(col.data);
    return String.fromCharCode(65 + index);
  };

  const isInRange = useCallback((r: number, c: number): boolean => {
    if (!selection.range) return false;
    const { startRow, endRow, startCol, endCol } = selection.range;
    return r >= startRow && r <= endRow && c >= startCol && c <= endCol;
  }, [selection.range]);

  const getRangeEdges = useCallback((r: number, c: number) => {
    if (!selection.range) return {};
    const { startRow, endRow, startCol, endCol } = selection.range;
    return {
      top: r === startRow,
      bottom: r === endRow,
      left: c === startCol,
      right: c === endCol
    };
  }, [selection.range]);

  const isInRowRange = useCallback((r: number): boolean => {
    if (!selection.rowRange) return false;
    const { start, end } = selection.rowRange;
    return r >= start && r <= end;
  }, [selection.rowRange]);

  const getRowRangeEdges = useCallback((r: number) => {
    if (!selection.rowRange) return {};
    const { start, end } = selection.rowRange;
    return {
      top: r === start,
      bottom: r === end
    };
  }, [selection.rowRange]);

  const isInColRange = useCallback((c: number): boolean => {
    if (!selection.colRange) return false;
    const { start, end } = selection.colRange;
    return c >= start && c <= end;
  }, [selection.colRange]);

  const getColRangeEdges = useCallback((c: number) => {
    if (!selection.colRange) return {};
    const { start, end } = selection.colRange;
    return {
      left: c === start,
      right: c === end
    };
  }, [selection.colRange]);

  const handleEditSave = useCallback(() => {
    if (editing.row === null || editing.col === null) return;

    // If we're tabbing, skip the blur-triggered save
    if (isTabbing.current) return;

    const oldValue = tableData[editing.row][cols[editing.col].data];
    const newValue = editing.value;
    
    // Only proceed if value changed
    if (String(oldValue ?? '') === newValue) {
      setEditing({ row: null, col: null, value: '' });
      return;
    }

    // Mutate data directly
    if (isObjectData) {
      tableData[editing.row][cols[editing.col].data] = newValue;
    } else {
      tableData[editing.row][cols[editing.col].data] = newValue;
    }
    
    // Force re-render
    setTableData([...tableData]);
    
    // Only dispatch save event if NOT a new row
    if (!tableData[editing.row]._isNew) {
      dispatch(
        tableRef?.current as HTMLElement,
        TableEvents.CELL_EDIT_SAVE,
        {
          rowIndex: editing.row,
          colIndex: editing.col,
          oldValue: oldValue,
          newValue: newValue,
          rowData: tableData[editing.row],
          id: isObjectData ? tableData[editing.row][idColumName] : undefined
        }
      );
    }
    
    setEditing({ row: null, col: null, value: '' });
  }, [editing, tableData, cols, isObjectData, idColumName]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (editing.row !== null) {
      handleEditSave();
    }
    
    const cell = (e.target as HTMLElement).closest('td');
    if (!cell) return;
    
    // Ignore clicks on action buttons
    if ((e.target as HTMLElement).closest('.hot-row-cancel-btn-header, .hot-row-save-btn')) {
      return;
    }

    // Ignore clicks on actions cell
    if (cell.getAttribute('data-actions-cell') === 'true') {
      return;
    }
    
    const isRowHeader = cell.getAttribute('data-row-header') === 'true';
    const row = parseInt(cell.getAttribute('data-row') || '', 10);
    
    if (isRowHeader) {
      dragStartRef.current = row;
      dragTypeRef.current = 'row';
      setIsDragging(true);
      setSelection({ 
        type: 'rowRange', 
        row: null, 
        col: null, 
        range: null, 
        rowRange: { start: row, end: row },
        colRange: null 
      });
      e.preventDefault();
      return;
    }
  
    const col = parseInt(cell.getAttribute('data-col') || '', 10);
    
    dragStartRef.current = { row, col };
    dragTypeRef.current = 'cell';
    setIsDragging(true);
    setSelection({ 
      type: 'range', 
      row: null, 
      col: null, 
      range: { startRow: row, endRow: row, startCol: col, endCol: col },
      rowRange: null,
      colRange: null
    });
    
    e.preventDefault();
  }, [editing.row, editing.col, handleEditSave]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || dragStartRef.current == null || !dragTypeRef.current) return;

    const now = Date.now();
    if (now - lastUpdateRef.current < THROTTLE_MS) return;
    lastUpdateRef.current = now;

    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('td');
    if (!cell) return;

    if (dragTypeRef.current === 'row') {
      const row = parseInt(cell.getAttribute('data-row') || '', 10);
      if (isNaN(row)) return;

      const startRow = dragStartRef.current;
      setSelection(prev => ({
        ...prev,
        rowRange: {
          start: Math.min(startRow, row),
          end: Math.max(startRow, row)
        }
      }));
    } else if (dragTypeRef.current === 'cell') {
      if (cell.getAttribute('data-row-header') === 'true') return;
      if (cell.getAttribute('data-actions-cell') === 'true') return;
      
      const row = parseInt(cell.getAttribute('data-row') || '', 10);
      const col = parseInt(cell.getAttribute('data-col') || '', 10);
      
      if (isNaN(row) || isNaN(col)) return;

      const { row: startRow, col: startCol } = dragStartRef.current;
      
      setSelection(prev => ({
        ...prev,
        range: {
          startRow: Math.min(startRow, row),
          endRow: Math.max(startRow, row),
          startCol: Math.min(startCol, col),
          endCol: Math.max(startCol, col)
        }
      }));
    }
  }, [isDragging, THROTTLE_MS]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      dragStartRef.current = null;
    }
  }, [isDragging]);

  const handleColHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    const header = (e.target as HTMLElement).closest('th');
    if (!header || header.classList.contains('hot-row-header')) return;

    const col = parseInt(header.getAttribute('data-col') || '', 10);
    if (isNaN(col)) return;

    dragStartRef.current = col;
    dragTypeRef.current = 'column';
    setIsDragging(true);
    setSelection({ 
      type: 'colRange', 
      row: null, 
      col: null, 
      range: null,
      rowRange: null,
      colRange: { start: col, end: col }
    });
    
    e.preventDefault();
  }, []);

  const handleColHeaderMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || dragStartRef.current == null || dragTypeRef.current !== 'column') return;

    const now = Date.now();
    if (now - lastUpdateRef.current < THROTTLE_MS) return;
    lastUpdateRef.current = now;

    const header = document.elementFromPoint(e.clientX, e.clientY)?.closest('th');
    if (!header || header.classList.contains('hot-row-header')) return;

    const col = parseInt(header.getAttribute('data-col') || '', 10);
    if (isNaN(col)) return;

    const startCol = dragStartRef.current;
    setSelection(prev => ({
      ...prev,
      colRange: {
        start: Math.min(startCol, col),
        end: Math.max(startCol, col)
      }
    }));
  }, [isDragging, THROTTLE_MS]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const cell = (e.target as HTMLElement).closest('td');
    if (!cell || cell.getAttribute('data-row-header') === 'true') return;
    if (cell.getAttribute('data-actions-cell') === 'true') return;
    
    const row = parseInt(cell.getAttribute('data-row') || '', 10);
    const col = parseInt(cell.getAttribute('data-col') || '', 10);
    
    if (isNaN(row) || isNaN(col)) return;
    
    setSelection({
      type: 'range',
      row: null,
      col: null,
      range: { startRow: row, endRow: row, startCol: col, endCol: col },
      rowRange: null,
      colRange: null
    });
    
    const currentValue = getCellValue(tableData[row], cols[col]);
    setEditing({ row, col, value: String(currentValue ?? '') });
  }, [tableData, cols, getCellValue]);

  const handleEditCancel = useCallback(() => {
    setEditing({ row: null, col: null, value: '' });
  }, []);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const editedRow = editing.row!;
      const editedCol = editing.col!;
      
      const oldValue = tableData[editedRow][cols[editedCol].data];
      const newValue = editing.value;
      
      const newData = [...tableData];
      if (isObjectData) {
        newData[editedRow] = { ...newData[editedRow], [cols[editedCol].data]: newValue };
      } else {
        newData[editedRow] = [...newData[editedRow]];
        newData[editedRow][cols[editedCol].data] = newValue;
      }
      setTableData(newData);
      
      // Dispatch save event if NOT a new row and value changed
      if (!newData[editedRow]._isNew && String(oldValue ?? '') !== newValue) {
        dispatch(
          tableRef?.current as HTMLElement,
          TableEvents.CELL_EDIT_SAVE,
          {
            rowIndex: editedRow,
            colIndex: editedCol,
            oldValue: oldValue,
            newValue: newValue,
            rowData: newData[editedRow],
            id: isObjectData ? newData[editedRow][idColumName] : undefined
          }
        );
      }
      
      const nextRow = editedRow + 1;
      if (nextRow < tableData.length) {
        const nextValue = getCellValue(newData[nextRow], cols[editedCol]);
        setSelection({
          type: 'range',
          row: null,
          col: null,
          range: { startRow: nextRow, endRow: nextRow, startCol: editedCol, endCol: editedCol },
          rowRange: null,
          colRange: null
        });
        setEditing({ row: nextRow, col: editedCol, value: String(nextValue ?? '') });
      } else {
        setEditing({ row: null, col: null, value: '' });
        setSelection({
          type: 'range',
          row: null,
          col: null,
          range: { startRow: editedRow, endRow: editedRow, startCol: editedCol, endCol: editedCol },
          rowRange: null,
          colRange: null
        });
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    }
  }, [editing, tableData, cols, isObjectData, getCellValue, handleEditCancel, idColumName, tableRef]);

  const handleAddRow = useCallback(() => {
    const newRow = isObjectData 
      ? { ...Object.keys(tableData[0] || {}).filter(k => k !== '_isNew').reduce((acc, key) => ({ ...acc, [key]: '' }), {}), _isNew: true }
      : new Array(cols.length).fill('');
    
    tableData.unshift(newRow);
    setTableData([...tableData]);

    // Set selection and editing state to first cell of new row
    const firstValue = getCellValue(newRow, cols[0]);
    setSelection({
      type: 'range',
      row: null,
      col: null,
      range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 },
      rowRange: null,
      colRange: null
    });
    setEditing({ row: 0, col: 0, value: String(firstValue ?? '') });
  }, [tableData, cols, isObjectData, getCellValue]);

  const handleToggleFilter = useCallback(() => {
    const newExpanded = !filterExpanded;
    setFilterExpanded(newExpanded);
    
    // Auto-add first filter row when expanding
    if (newExpanded && filterRows.length === 0) {
      const newRow: FilterRow = {
        id: `filter-${Date.now()}`,
        field: cols[0]?.data || '',
        operator: 'is_any_of',
        values: [],
      };
      setFilterRows([newRow]);
    }
  }, [filterExpanded, filterRows.length, cols]);

  const handleClearFilters = useCallback(() => {
    setFilterRows([]);
    setActiveFilterId(null);
  }, []);

  const handleSaveFilter = useCallback((name: string) => {
    const newFilter: SavedFilter = {
      id: `filter-${Date.now()}`,
      name: name,
      rows: filterRows,
    };

    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    localStorage.setItem('table-saved-filters', JSON.stringify(updated));
    setActiveFilterId(newFilter.id);

    // Emit event on save
    dispatch(
      tableRef?.current as HTMLElement,
      TableEvents.FILTER_CHANGE,
      {
        filters: filterRows,
        savedFilterId: newFilter.id
      } as FilterChangeEvent
    );
  }, [filterRows, savedFilters, tableRef]);

  const handleFilterSelect = useCallback((id: string | null) => {
    setActiveFilterId(id);
    if (id === null) {
      setFilterRows([]);
    } else {
      const filter = savedFilters.find(f => f.id === id);
      if (filter) {
        setFilterRows(filter.rows);
      }
    }
  }, [savedFilters]);

  const handleFilterRename = useCallback((id: string, newName: string) => {
    const updated = savedFilters.map(f => 
      f.id === id ? { ...f, name: newName } : f
    );
    setSavedFilters(updated);
    localStorage.setItem('table-saved-filters', JSON.stringify(updated));
  }, [savedFilters]);

  const handleFilterDelete = useCallback((id: string) => {
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    localStorage.setItem('table-saved-filters', JSON.stringify(updated));
    if (activeFilterId === id) {
      setActiveFilterId(null);
      setFilterRows([]);
    }
  }, [savedFilters, activeFilterId]);

  const handleSaveNewRow = useCallback((rowIndex: number) => {
    const rowData = { ...tableData[rowIndex] };

    // Dispatch NEW_ROW_SAVE_START event
    dispatch(
      tableRef?.current as HTMLElement,
      TableEvents.NEW_ROW_SAVE_START,
      {
        rowIndex
      } as NewRowSaveStartEvent
    );

    // Dispatch NEW_ROW_SAVE event
    dispatch(
      tableRef?.current as HTMLElement,
      TableEvents.NEW_ROW_SAVE,
      {
        rowIndex,
        rowData: rowData
      } as NewRowSaveEvent
    );
  }, [tableData, tableRef]);

  const handleCancelNewRow = useCallback((rowIndex: number) => {
    const newData = tableData.filter((_, idx) => idx !== rowIndex);
    setTableData(newData);
  }, [tableData]);

  useMediator<CellSaveStartEvent>(
    TableEvents.CELL_SAVE_START,
    useCallback((payload: CellSaveStartEvent) => {
      setCellSaveStates(prev => {
        const next = new Map(prev);
        next.set(getCellKey(payload.rowIndex, payload.colIndex), {
          status: 'saving',
          timestamp: Date.now()
        });
        return next;
      });
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  useMediator<CellSaveSuccessEvent>(
    TableEvents.CELL_SAVE_SUCCESS,
    useCallback((payload: CellSaveSuccessEvent) => {
      setCellSaveStates(prev => {
        const next = new Map(prev);
        next.set(getCellKey(payload.rowIndex, payload.colIndex), {
          status: 'success',
          timestamp: Date.now()
        });
        return next;
      });
      
      // Clear success state after 2 seconds
      setTimeout(() => {
        setCellSaveStates(prev => {
          const next = new Map(prev);
          next.delete(getCellKey(payload.rowIndex, payload.colIndex));
          return next;
        });
      }, 2000);
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  useMediator<CellSaveErrorEvent>(
    TableEvents.CELL_SAVE_ERROR,
    useCallback((payload: CellSaveErrorEvent) => {
      setCellSaveStates(prev => {
        const next = new Map(prev);
        next.set(getCellKey(payload.rowIndex, payload.colIndex), {
          status: 'error',
          timestamp: Date.now()
        });
        return next;
      });
      
      // Clear error state after 3 seconds
      setTimeout(() => {
        setCellSaveStates(prev => {
          const next = new Map(prev);
          next.delete(getCellKey(payload.rowIndex, payload.colIndex));
          return next;
        });
      }, 3000);
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  useMediator<NewRowSaveStartEvent>(
    TableEvents.NEW_ROW_SAVE_START,
    useCallback((payload: NewRowSaveStartEvent) => {
      setRowSaveStates(prev => {
        const next = new Map(prev);
        next.set(payload.rowIndex, 'saving');
        return next;
      });
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  useMediator<NewRowSaveSuccessEvent>(
    TableEvents.NEW_ROW_SAVE_SUCCESS,
    useCallback((payload: NewRowSaveSuccessEvent) => {
      // Update row data with saved data (including new ID)
      setTableData(prev => {
        const newData = [...prev];
        if (newData[payload.rowIndex]) {
          newData[payload.rowIndex] = { ...payload.savedRowData };
          delete newData[payload.rowIndex]._isNew;
        }
        return newData;
      });

      setRowSaveStates(prev => {
        const next = new Map(prev);
        next.set(payload.rowIndex, 'success');
        return next;
      });
      
      // Clear success state after 2 seconds
      setTimeout(() => {
        setRowSaveStates(prev => {
          const next = new Map(prev);
          next.delete(payload.rowIndex);
          return next;
        });
      }, 2000);
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  useMediator<NewRowSaveErrorEvent>(
    TableEvents.NEW_ROW_SAVE_ERROR,
    useCallback((payload: NewRowSaveErrorEvent) => {
      setRowSaveStates(prev => {
        const next = new Map(prev);
        next.set(payload.rowIndex, 'error');
        return next;
      });
      
      // Clear error state after 3 seconds
      setTimeout(() => {
        setRowSaveStates(prev => {
          const next = new Map(prev);
          next.delete(payload.rowIndex);
          return next;
        });
      }, 3000);
    }, []),
    tableRef as React.RefObject<HTMLElement>
  );

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isDragging, handleMouseUp]);

  useEffect(() => {
    if (editing.row !== null && editInputRef.current) {
      // Use setTimeout to ensure textarea is mounted and ready
      setTimeout(() => {
        if (editInputRef.current) {
          editInputRef.current.focus();
          const length = editInputRef.current.value.length;
          editInputRef.current.setSelectionRange(length, length);
        }
      }, 0);
    }
  }, [editing.row, editing.col]);

  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      if (!selection.type) return;

      let textData = '';

      if (selection.type === 'cell') {
        const row = tableData[selection.row!];
        const col = cols[selection.col!];
        textData = String(getCellValue(row, col) ?? '');
      } 
      else if (selection.type === 'range' && selection.range) {
        const { startRow, endRow, startCol, endCol } = selection.range;
        const rows = [];
        for (let r = startRow; r <= endRow; r++) {
          const row = tableData[r];
          const cells = [];
          for (let c = startCol; c <= endCol; c++) {
            const col = cols[c];
            cells.push(String(getCellValue(row, col) ?? ''));
          }
          rows.push(cells.join('\t'));
        }
        textData = rows.join('\n');
      }
      else if (selection.type === 'rowRange' && selection.rowRange) {
        const { start, end } = selection.rowRange;
        const rows = [];
        for (let r = start; r <= end; r++) {
          const row = tableData[r];
          const cells = cols.map(col => String(getCellValue(row, col) ?? ''));
          rows.push(cells.join('\t'));
        }
        textData = rows.join('\n');
      }
      else if (selection.type === 'colRange' && selection.colRange) {
        const { start, end } = selection.colRange;
        const rows = [];
        for (let r = 0; r < tableData.length; r++) {
          const row = tableData[r];
          const cells = [];
          for (let c = start; c <= end; c++) {
            const col = cols[c];
            cells.push(String(getCellValue(row, col) ?? ''));
          }
          rows.push(cells.join('\t'));
        }
        textData = rows.join('\n');
      }

      if (textData && e.clipboardData) {
        e.clipboardData.setData('text/plain', textData);
        e.preventDefault();
      }
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [selection, tableData, cols, getCellValue]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        
        if (editing.row !== null) {
          isTabbing.current = true;
          
          // Manually save the current cell
          const oldValue = tableData[editing.row][cols[editing.col!].data];
          const newValue = editing.value;
          
          if (String(oldValue ?? '') !== newValue) {
            if (isObjectData) {
              tableData[editing.row][cols[editing.col!].data] = newValue;
            } else {
              tableData[editing.row][cols[editing.col!].data] = newValue;
            }
            setTableData([...tableData]);
            
            if (!tableData[editing.row]._isNew) {
              dispatch(
                tableRef?.current as HTMLElement,
                TableEvents.CELL_EDIT_SAVE,
                {
                  rowIndex: editing.row,
                  colIndex: editing.col!,
                  oldValue: oldValue,
                  newValue: newValue,
                  rowData: tableData[editing.row],
                  id: isObjectData ? tableData[editing.row][idColumName] : undefined
                }
              );
            }
          }
          
          const direction = e.shiftKey ? -1 : 1;
          let nextCol = editing.col! + direction;
          let nextRow = editing.row;
          
          if (nextCol >= cols.length) {
            nextCol = 0;
            nextRow++;
          } else if (nextCol < 0) {
            nextCol = cols.length - 1;
            nextRow--;
          }
          
          if (nextRow >= 0 && nextRow < tableData.length) {
            const nextValue = getCellValue(tableData[nextRow], cols[nextCol]);
            setSelection({
              type: 'range',
              row: null,
              col: null,
              range: { startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol },
              rowRange: null,
              colRange: null
            });
            setEditing({ row: nextRow, col: nextCol, value: String(nextValue ?? '') });
            
            // Reset flag after state updates
            setTimeout(() => {
              isTabbing.current = false;
            }, 0);
          } else {
            isTabbing.current = false;
          }
          return;
        }
        
        let currentRow: number, currentCol: number;
        if (selection.type === 'range' && selection.range) {
          const { startRow, startCol, endRow, endCol } = selection.range;
          if (startRow === endRow && startCol === endCol) {
            currentRow = startRow;
            currentCol = startCol;
          } else {
            return;
          }
        } else {
          return;
        }
        
        const direction = e.shiftKey ? -1 : 1;
        let nextCol = currentCol + direction;
        let nextRow = currentRow;
        
        if (nextCol >= cols.length) {
          nextCol = 0;
          nextRow++;
        } else if (nextCol < 0) {
          nextCol = cols.length - 1;
          nextRow--;
        }
        
        if (nextRow >= 0 && nextRow < tableData.length) {
          const nextValue = getCellValue(tableData[nextRow], cols[nextCol]);
          setSelection({
            type: 'range',
            row: null,
            col: null,
            range: { startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol },
            rowRange: null,
            colRange: null
          });
          // Auto-enter edit mode on Tab
          setEditing({ row: nextRow, col: nextCol, value: String(nextValue ?? '') });
        }
      }
      
      if (e.key === 'Enter' && editing.row === null) {
        e.preventDefault();
        if (selection.type === 'range' && selection.range) {
          const { startRow, startCol, endRow, endCol } = selection.range;
          if (startRow === endRow && startCol === endCol) {
            const currentValue = getCellValue(tableData[startRow], cols[startCol]);
            setSelection({
              type: 'cell',
              row: startRow,
              col: startCol,
              range: null,
              rowRange: null,
              colRange: null
            });
            setEditing({ row: startRow, col: startCol, value: String(currentValue ?? '') });
          }
        }
      }
      
      if (editing.row === null && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        
        let currentRow: number, currentCol: number;
        
        if (selection.type === 'range' && selection.range) {
          const { startRow, startCol, endRow, endCol } = selection.range;
          if (startRow === endRow && startCol === endCol) {
            currentRow = startRow;
            currentCol = startCol;
          } else {
            return;
          }
        } else if (selection.type === 'cell') {
          currentRow = selection.row!;
          currentCol = selection.col!;
        } else {
          return;
        }
        
        let nextRow = currentRow;
        let nextCol = currentCol;
        
        switch (e.key) {
          case 'ArrowUp':
            nextRow = Math.max(0, currentRow - 1);
            break;
          case 'ArrowDown':
            nextRow = Math.min(tableData.length - 1, currentRow + 1);
            break;
          case 'ArrowLeft':
            nextCol = Math.max(0, currentCol - 1);
            break;
          case 'ArrowRight':
            nextCol = Math.min(cols.length - 1, currentCol + 1);
            break;
        }
        
        setSelection({
          type: 'range',
          row: null,
          col: null,
          range: { startRow: nextRow, endRow: nextRow, startCol: nextCol, endCol: nextCol },
          rowRange: null,
          colRange: null
        });
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selection, editing, tableData, cols, getCellValue, handleEditSave]);

  const rowVirtualizer = useVirtualizer({
    count: tableData.length,
    getScrollElement: () => tableRef?.current as HTMLElement,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalWidth = allColumns.reduce((sum, col) => sum + (col.width || 100), 0) + (rowHeaders ? 50 : 0);

  return (
    <div className="hot-container" style={{ height, width, position: 'relative' }}>
      <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-white">
        <h3 className="text-base font-semibold text-gray-900">
          {tableName}
        </h3>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleFilter}
            className="filter-toggle-btn-header"
            title="Build filter"
          >
            <span className={`toggle-icon ${filterExpanded ? 'expanded' : ''}`}>▼</span>
            Build Filter
          </button>
          <button
            onClick={handleAddRow}
            className="w-8 h-8 rounded border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 flex items-center justify-center text-lg text-gray-700 transition-colors"
            title="Add new row"
          >
            +
          </button>
        </div>
      </div>

      <FilterBuilder
        columns={cols}
        filterRows={filterRows}
        onFilterRowsChange={setFilterRows}
        onClear={handleClearFilters}
        onSave={handleSaveFilter}
        isExpanded={filterExpanded}
        onToggle={handleToggleFilter}
      />

      <div 
        ref={tableRef}
        className="hot-virtual-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onDoubleClick={handleDoubleClick}
        style={{
          height: typeof height === 'string' && height !== 'auto' ? height : '600px',
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {colHeaders && (
          <div 
            className="hot-headers-sticky"
            onMouseDown={handleColHeaderMouseDown}
            onMouseMove={handleColHeaderMouseMove}
          >
            <table className="hot-table" style={{ width: `${totalWidth}px` }}>
              <thead>
                <tr style={{ display: 'flex' }}>
                  {rowHeaders && (
                    <th 
                      className="hot-row-header" 
                      style={{ 
                        width: 50, 
                        flexBasis: 50, 
                        flexShrink: 0, 
                        flexGrow: 0,
                        position: 'sticky',
                        left: 0,
                        zIndex: 4
                      }}
                    />
                  )}
                  {allColumns.map((col, colIndex) => {
                    const isColSelected = selection.type === 'column' && selection.col === colIndex;
                    const hasCellSelected = selection.type === 'cell' && selection.col === colIndex;
                    const inColRange = isInColRange(colIndex);
                    const colEdges = getColRangeEdges(colIndex);
                    
                    const headerStyle: React.CSSProperties = { 
                      width: col.width || 100, 
                      flexBasis: col.width || 100, 
                      flexShrink: 0, 
                      flexGrow: 0 
                    };

                    if (leftOffsets[colIndex] !== undefined) {
                      headerStyle.position = 'sticky';
                      headerStyle.left = leftOffsets[colIndex];
                      headerStyle.zIndex = 3;
                    } else if (rightOffsets[colIndex] !== undefined) {
                      headerStyle.position = 'sticky';
                      headerStyle.right = rightOffsets[colIndex];
                      headerStyle.zIndex = 3;
                    }

                    return (
                      <th 
                        key={colIndex}
                        className="hot-col-header"
                        style={headerStyle}
                        data-col={colIndex}
                        data-col-selected={isColSelected}
                        data-has-selected-cell={hasCellSelected}
                        data-in-col-range={inColRange}
                        data-col-range-left={colEdges.left}
                        data-col-range-right={colEdges.right}
                        data-sticky-left={leftOffsets[colIndex] !== undefined}
                        data-sticky-right={rightOffsets[colIndex] !== undefined}
                      >
                        {getColHeader(col, colIndex)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
            </table>
          </div>
        )}

        <table className="hot-table" style={{ width: `${totalWidth}px` }}>
          <tbody
            style={{
              display: 'block',
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: 'relative',
            }}
          >
            {virtualRows.map((virtualRow) => {
              const row = tableData[virtualRow.index];
              const rowIndex = virtualRow.index;
              const isRowSelected = selection.type === 'row' && selection.row === rowIndex;
              const hasCellSelected = selection.type === 'cell' && selection.row === rowIndex;
              const rowInRowRange = isInRowRange(rowIndex);
              const rowRangeEdges = getRowRangeEdges(rowIndex);
              const isNewRow = row._isNew === true;
              const rowSaveState = rowSaveStates.get(rowIndex) || null;

              return (
                <tr
                  key={virtualRow.index}
                  data-row={rowIndex}
                  data-row-selected={isRowSelected}
                  data-is-new={isNewRow}
                  style={{
                    display: 'flex',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {rowHeaders && (
                    <TableCell 
                      value={undefined}
                      rowIndex={rowIndex}
                      colIndex={-1}
                      col={{} as ColumnConfig}
                      rowData={row}
                      isRowHeader={true}
                      hasCellSelected={hasCellSelected}
                      isInRowRange={rowInRowRange}
                      rowRangeEdges={rowRangeEdges}
                      isNewRow={isNewRow}
                      onCancelRow={() => handleCancelNewRow(rowIndex)}
                    />
                  )}
                  {cols.map((col, colIndex) => {
                    const isCellSelected = 
                      selection.type === 'cell' && 
                      selection.row === rowIndex && 
                      selection.col === colIndex;
                    const isColSelected = 
                      selection.type === 'column' && 
                      selection.col === colIndex;
                    const cellInRange = isInRange(rowIndex, colIndex);
                    const rangeEdges = getRangeEdges(rowIndex, colIndex);
                    const cellInColRange = isInColRange(colIndex);
                    const colRangeEdges = getColRangeEdges(colIndex);
                    const isEditingThisCell = editing.row === rowIndex && editing.col === colIndex;
                    const saveState = cellSaveStates.get(getCellKey(rowIndex, colIndex));

                    return (
                      <TableCell
                        key={colIndex}
                        value={getCellValue(row, col)}
                        rowIndex={rowIndex}
                        colIndex={colIndex}
                        col={col}
                        rowData={row}
                        isCellSelected={isCellSelected}
                        isRowSelected={isRowSelected}
                        isColSelected={isColSelected}
                        isInRange={cellInRange}
                        rangeEdges={rangeEdges}
                        isInRowRange={rowInRowRange}
                        rowRangeEdges={rowRangeEdges}
                        isInColRange={cellInColRange}
                        colRangeEdges={colRangeEdges}
                        isEditing={isEditingThisCell}
                        editValue={isEditingThisCell ? editing.value : undefined}
                        onEditChange={isEditingThisCell ? (e) => setEditing(prev => ({ ...prev, value: e.target.value })) : undefined}
                        onEditKeyDown={isEditingThisCell ? handleEditKeyDown : undefined}
                        onEditBlur={isEditingThisCell ? handleEditSave : undefined}
                        editInputRef={isEditingThisCell ? editInputRef : undefined}
                        saveState={saveState}
                        isNewRow={isNewRow}
                        isFirstDataCell={colIndex === 0}
                        onCancelRow={() => handleCancelNewRow(rowIndex)}
                        stickyLeft={leftOffsets[colIndex]}
                        stickyRight={rightOffsets[colIndex]}
                        rowSaveState={rowSaveState}
                      />
                    );
                  })}
                  {/* Actions column */}
                  <td
                    className="hot-cell hot-actions-cell"
                    style={{
                      width: actionsColumn.width,
                      flexBasis: actionsColumn.width,
                      flexShrink: 0,
                      flexGrow: 0,
                      position: 'sticky',
                      right: rightOffsets[allColumns.length - 1] || 0,
                      zIndex: 2
                    }}
                    data-row={rowIndex}
                    data-col={cols.length}
                    data-actions-cell="true"
                    data-sticky-right={true}
                    data-row-save-state={rowSaveState}
                  >
                    {isNewRow && (
                      <button
                        className="hot-row-save-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveNewRow(rowIndex);
                        }}
                        title="Save"
                      >
                        Save
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FilterTabs
        savedFilters={savedFilters}
        activeFilterId={activeFilterId}
        onFilterSelect={handleFilterSelect}
        onFilterRename={handleFilterRename}
        onFilterDelete={handleFilterDelete}
      />
    </div>
  );
};

export default HOT;