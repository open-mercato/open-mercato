// HOT.tsx


'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from 'react';
import { useVirtualizer, VirtualItem } from '@tanstack/react-virtual';

import { createCellStore, CellStore } from './store';
import {
  CellStoreContext,
  useCellStore,
  useCellState,
  useStickyOffsets,
  useKeyboardNavigation,
  useCopyHandler,
} from './hooks';
import {
  createCellHandlers,
  createRowHandlers,
  createMouseHandlers,
  createColumnHeaderHandlers,
  createRowHeaderHandlers,
  createContextMenuHandlers,
  createResizeHandlers,
} from './handlers';
import { dispatch, useMediator } from './events/events';
import { getCellRenderer } from './renderers';
import { getCellEditor } from './editors';
import {
  HOTProps,
  ColumnDef,
  ContextMenuState,
  SortState,
  FilterRow,
  SavedFilter,
  TableEvents,
  CellSaveStartEvent,
  CellSaveSuccessEvent,
  CellSaveErrorEvent,
  NewRowSaveSuccessEvent,
  NewRowSaveErrorEvent,
} from './types';

// Import external components (keep these as separate files)
import FilterBuilder from './Filterbuilder';
import FilterTabs from './Filtertabs';
import SearchBar from './components/search/SearchBar';
import ContextMenu from './components/context-menu/ContextMenu';

if (typeof window !== 'undefined') {
  import('./HOT.css');
}

// ============================================
// CELL COMPONENT
// ============================================
interface CellProps {
  row: number;
  col: number;
  colConfig: ColumnDef;
  stickyLeft?: number;
  stickyRight?: number;
}

const Cell: React.FC<CellProps> = memo(({ row, col, colConfig, stickyLeft, stickyRight }) => {
  const store = useCellStore();
  const state = useCellState(row, col);
  const inputRef = useRef<any>(null);
  const rowData = store.getRowData(row);

  const handleSave = useCallback(
    (value?: any) => {
      const newValue = value !== undefined ? value : store.getCellValue(row, col);
      const oldValue = store.getCellValue(row, col);

      if (String(oldValue ?? '') !== String(newValue ?? '')) {
        store.setCellValue(row, col, newValue);
      }
      store.clearEditing();
    },
    [store, row, col]
  );

  const handleCancel = useCallback(() => {
    store.clearEditing();
  }, [store]);

  const handleChange = useCallback(
    (value: any) => {
      // For intermediate changes during editing, we don't update the store
      // The editor holds its own local state
    },
    []
  );

  // Focus input when editing starts
  useEffect(() => {
    if (state.isEditing && inputRef.current) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          // Move cursor to end of text instead of selecting all
          const length = inputRef.current.value?.length || 0;
          inputRef.current.selectionStart = length;
          inputRef.current.selectionEnd = length;
        }
      }, 0);
    }
  }, [state.isEditing]);

  const style: React.CSSProperties = {
    width: colConfig.width || 100,
    flexBasis: colConfig.width || 100,
    flexShrink: 0,
    flexGrow: 0,
    position: 'relative',
  };

  if (stickyLeft !== undefined) {
    style.position = 'sticky';
    style.left = stickyLeft;
    style.zIndex = 2;
  } else if (stickyRight !== undefined) {
    style.position = 'sticky';
    style.right = stickyRight;
    style.zIndex = 2;
  }

  const renderer = getCellRenderer(colConfig);
  const renderedValue = renderer(state.value, rowData, colConfig, row, col);

  return (
    <td
      className={`hot-cell ${colConfig.readOnly ? 'read-only' : ''}`}
      style={style}
      data-row={row}
      data-col={col}
      data-cell-selected={state.isSelected}
      data-in-range={state.isInRange}
      data-range-top={state.rangeEdges.top}
      data-range-bottom={state.rangeEdges.bottom}
      data-range-left={state.rangeEdges.left}
      data-range-right={state.rangeEdges.right}
      data-save-state={state.saveState}
      data-sticky-left={stickyLeft !== undefined}
      data-sticky-right={stickyRight !== undefined}
    >
      {state.isEditing
        ? getCellEditor(
          colConfig,
          state.value,
          handleChange,
          handleSave,
          handleCancel,
          rowData,
          row,
          col,
          inputRef
        )
        : renderedValue}
    </td>
  );
});

Cell.displayName = 'Cell';

// ============================================
// ROW HEADER CELL COMPONENT
// ============================================
interface RowHeaderCellProps {
  row: number;
  isNewRow: boolean;
  isInRowRange: boolean;
  rowRangeEdges: { top?: boolean; bottom?: boolean };
  onCancel: () => void;
  onDoubleClick: (e: React.MouseEvent) => void;
}

const RowHeaderCell: React.FC<RowHeaderCellProps> = memo(
  ({ row, isNewRow, isInRowRange, rowRangeEdges, onCancel, onDoubleClick }) => {
    return (
      <td
        className="hot-row-header"
        data-row={row}
        data-row-header="true"
        data-in-row-range={isInRowRange}
        data-row-range-top={rowRangeEdges.top}
        data-row-range-bottom={rowRangeEdges.bottom}
        onDoubleClick={onDoubleClick}
        style={{
          width: 50,
          flexBasis: 50,
          flexShrink: 0,
          flexGrow: 0,
          position: 'sticky',
          left: 0,
          zIndex: 3,
        }}
      >
        {isNewRow ? (
          <button
            className="hot-row-cancel-btn-header"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            title="Cancel"
          >
            ✕
          </button>
        ) : (
          row + 1
        )}
      </td>
    );
  }
);

RowHeaderCell.displayName = 'RowHeaderCell';

// ============================================
// VIRTUAL ROW COMPONENT
// ============================================
interface VirtualRowProps {
  rowIndex: number;
  columns: ColumnDef[];
  virtualRow: VirtualItem;
  rowHeaders: boolean;
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
  actionsColumnWidth: number;
  onSaveNewRow: (rowIndex: number) => void;
  onCancelNewRow: (rowIndex: number) => void;
  onRowHeaderDoubleClick: (e: React.MouseEvent, rowIndex: number) => void;
}

const VirtualRow: React.FC<VirtualRowProps> = memo(
  ({
    rowIndex,
    columns,
    virtualRow,
    rowHeaders,
    leftOffsets,
    rightOffsets,
    actionsColumnWidth,
    onSaveNewRow,
    onCancelNewRow,
    onRowHeaderDoubleClick,
  }) => {
    const store = useCellStore();
    const selection = store.getSelection();
    const isNewRow = store.isNewRow(rowIndex);

    // Row-level selection state (for row headers)
    const isInRowRange =
      selection.type === 'rowRange' &&
      selection.anchor &&
      selection.focus &&
      rowIndex >= Math.min(selection.anchor.row, selection.focus.row) &&
      rowIndex <= Math.max(selection.anchor.row, selection.focus.row);

    const rowRangeEdges = {
      top:
        isInRowRange && selection.anchor && selection.focus
          ? rowIndex === Math.min(selection.anchor.row, selection.focus.row)
          : false,
      bottom:
        isInRowRange && selection.anchor && selection.focus
          ? rowIndex === Math.max(selection.anchor.row, selection.focus.row)
          : false,
    };

    return (
      <tr
        data-row={rowIndex}
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
          <RowHeaderCell
            row={rowIndex}
            isNewRow={isNewRow}
            isInRowRange={isInRowRange}
            rowRangeEdges={rowRangeEdges}
            onCancel={() => onCancelNewRow(rowIndex)}
            onDoubleClick={(e) => onRowHeaderDoubleClick(e, rowIndex)}
          />
        )}

        {columns.map((col, colIndex) => (
          <Cell
            key={colIndex}
            row={rowIndex}
            col={colIndex}
            colConfig={{ ...col, width: store.getColumnWidth(colIndex) }}
            stickyLeft={leftOffsets[colIndex]}
            stickyRight={rightOffsets[colIndex]}
          />
        ))}

        {/* Actions column */}
        <td
          className="hot-cell hot-actions-cell"
          style={{
            width: actionsColumnWidth,
            flexBasis: actionsColumnWidth,
            flexShrink: 0,
            flexGrow: 0,
            position: 'sticky',
            right: 0,
            zIndex: 2,
          }}
          data-row={rowIndex}
          data-col={columns.length}
          data-actions-cell="true"
          data-sticky-right={true}
        >
          {isNewRow && (
            <button
              className="hot-row-save-btn"
              onClick={(e) => {
                e.stopPropagation();
                onSaveNewRow(rowIndex);
              }}
              title="Save"
            >
              Save
            </button>
          )}
        </td>
      </tr>
    );
  }
);

VirtualRow.displayName = 'VirtualRow';

// ============================================
// COLUMN HEADERS COMPONENT
// ============================================
interface ColumnHeadersProps {
  columns: ColumnDef[];
  rowHeaders: boolean;
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
  totalWidth: number;
  sortState: SortState;
  actionsColumnWidth: number;
  onSort: (colIndex: number) => void;
  onResizeStart: (e: React.MouseEvent, colIndex: number) => void;
  onDoubleClick: (e: React.MouseEvent, colIndex: number) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
}

const ColumnHeaders: React.FC<ColumnHeadersProps> = memo(
  ({
    columns,
    rowHeaders,
    leftOffsets,
    rightOffsets,
    totalWidth,
    sortState,
    actionsColumnWidth,
    onSort,
    onResizeStart,
    onDoubleClick,
    onMouseDown,
    onMouseMove,
  }) => {
    const store = useCellStore();
    const selection = store.getSelection();

    return (
      <div
        className="hot-headers-sticky"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
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
                    zIndex: 4,
                  }}
                />
              )}

              {columns.map((col, colIndex) => {
                const isInColRange =
                  selection.type === 'colRange' &&
                  selection.anchor &&
                  selection.focus &&
                  colIndex >= Math.min(selection.anchor.col, selection.focus.col) &&
                  colIndex <= Math.max(selection.anchor.col, selection.focus.col);

                const colWidth = store.getColumnWidth(colIndex);

                const headerStyle: React.CSSProperties = {
                  width: colWidth,
                  flexBasis: colWidth,
                  flexShrink: 0,
                  flexGrow: 0,
                  position: 'relative',
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
                    onDoubleClick={(e) => onDoubleClick(e, colIndex)}
                    style={headerStyle}
                    data-col={colIndex}
                    data-in-col-range={isInColRange}
                    data-sticky-left={leftOffsets[colIndex] !== undefined}
                    data-sticky-right={rightOffsets[colIndex] !== undefined}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                      }}
                    >
                      <span>{col.title || col.data}</span>
                      <button
                        className="hot-col-sort-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSort(colIndex);
                        }}
                        title={
                          sortState.columnIndex === colIndex && sortState.direction
                            ? `Sorted ${sortState.direction === 'asc' ? 'ascending' : 'descending'}`
                            : 'Click to sort'
                        }
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: '2px 4px',
                          display: 'flex',
                          alignItems: 'center',
                          fontSize: '12px',
                          color: sortState.columnIndex === colIndex ? '#3b82f6' : '#9ca3af',
                          transition: 'color 0.2s',
                        }}
                      >
                        {sortState.columnIndex === colIndex && sortState.direction === 'asc' && '↑'}
                        {sortState.columnIndex === colIndex && sortState.direction === 'desc' && '↓'}
                        {(sortState.columnIndex !== colIndex || sortState.direction === null) && '⇅'}
                      </button>
                    </div>
                    <div
                      className="hot-col-resize-handle"
                      onMouseDown={(e) => onResizeStart(e, colIndex)}
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: '5px',
                        cursor: 'col-resize',
                        zIndex: 10,
                      }}
                    />
                  </th>
                );
              })}

              {/* Actions header */}
              <th
                className="hot-col-header"
                style={{
                  width: actionsColumnWidth,
                  flexBasis: actionsColumnWidth,
                  flexShrink: 0,
                  flexGrow: 0,
                  position: 'sticky',
                  right: 0,
                  zIndex: 3,
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
        </table>
      </div>
    );
  }
);

ColumnHeaders.displayName = 'ColumnHeaders';

// ============================================
// MAIN HOT COMPONENT
// ============================================
const HOT: React.FC<HOTProps> = ({
  data = [],
  columns = [],
  colHeaders = true,
  rowHeaders = false,
  height = 'auto',
  width = 'auto',
  idColumnName = 'id',
  tableName = 'Table Name',
  tableRef,
  columnActions,
  rowActions,
}) => {
  // -------------------- STORE --------------------
  const storeRef = useRef<CellStore | null>(null);

  const cols = useMemo(() => {
    if (columns.length > 0) return columns;
    if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      return Object.keys(data[0])
        .filter((k) => k !== '_isNew')
        .map((k) => ({ data: k }));
    }
    return [];
  }, [columns, data]);

  if (!storeRef.current) {
    storeRef.current = createCellStore(data, cols);
  }
  const store = storeRef.current;

  // -------------------- UI STATE (isolated, doesn't affect cells) --------------------
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>({
    columnIndex: null,
    direction: null,
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // -------------------- REFS --------------------
  const dragStateRef = useRef({
    isDragging: false,
    type: null as 'cell' | 'row' | 'column' | null,
    start: null as { row: number; col: number } | null,
  });

  const actionsColumnWidth = 80;

  // -------------------- SYNC DATA TO STORE --------------------
  useEffect(() => {
    store.setData(data);
  }, [data, store]);

  // -------------------- COMPUTED --------------------
  const { leftOffsets, rightOffsets } = useStickyOffsets(cols, store, rowHeaders);

  const totalWidth = useMemo(() => {
    return (
      cols.reduce((sum, _, idx) => sum + store.getColumnWidth(idx), 0) +
      (rowHeaders ? 50 : 0) +
      actionsColumnWidth
    );
  }, [cols, store, rowHeaders, actionsColumnWidth]);

  // -------------------- VIRTUALIZER --------------------
  const rowVirtualizer = useVirtualizer({
    count: store.getRowCount(),
    getScrollElement: () => tableRef?.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  // -------------------- DRAG HANDLERS --------------------
  const handleDragStart = useCallback(
    (row: number, col: number, type: 'cell' | 'row' | 'column') => {
      dragStateRef.current = { isDragging: true, type, start: { row, col } };

      if (type === 'row') {
        store.setSelection({
          type: 'rowRange',
          anchor: { row, col: 0 },
          focus: { row, col: cols.length - 1 },
        });
      } else if (type === 'column') {
        store.setSelection({
          type: 'colRange',
          anchor: { row: 0, col },
          focus: { row: store.getRowCount() - 1, col },
        });
      } else {
        store.setSelection({
          type: 'range',
          anchor: { row, col },
          focus: { row, col },
        });
      }
    },
    [store, cols.length]
  );

  const handleDragMove = useCallback(
    (row: number, col: number) => {
      if (!dragStateRef.current.isDragging) return;

      const selection = store.getSelection();
      if (!selection.anchor) return;

      if (dragStateRef.current.type === 'row') {
        store.setSelection({
          ...selection,
          focus: { row, col: cols.length - 1 },
        });
      } else if (dragStateRef.current.type === 'column') {
        store.setSelection({
          ...selection,
          focus: { row: store.getRowCount() - 1, col },
        });
      } else {
        store.setSelection({
          ...selection,
          focus: { row, col },
        });
      }
    },
    [store, cols.length]
  );

  const handleDragEnd = useCallback(() => {
    dragStateRef.current = { isDragging: false, type: null, start: null };
  }, []);

  // -------------------- HANDLERS --------------------
  const { handleCellSave } = createCellHandlers(store, cols, tableRef, idColumnName);
  const { handleAddRow, handleSaveNewRow, handleCancelNewRow } = createRowHandlers(
    store,
    cols,
    tableRef
  );
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick } =
    createMouseHandlers(store, cols, dragStateRef, handleDragStart, handleDragMove, handleDragEnd);
  const { handleColumnSort, handleColumnHeaderDoubleClick, handleColumnHeaderMouseDown } =
    createColumnHeaderHandlers(
      store,
      cols,
      tableRef,
      sortState,
      setSortState,
      setContextMenu,
      columnActions
    );
  const { handleRowHeaderDoubleClick } = createRowHeaderHandlers(
    store,
    tableRef,
    setContextMenu,
    rowActions
  );
  const { handleContextMenuAction, handleContextMenuClose } = createContextMenuHandlers(
    store,
    cols,
    tableRef,
    contextMenu,
    setContextMenu
  );
  const { handleResizeStart } = createResizeHandlers(store);

  // -------------------- KEYBOARD HANDLER --------------------
  const handleKeyDown = useKeyboardNavigation(store, cols.length, handleCellSave);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // -------------------- COPY HANDLER --------------------
  const handleCopy = useCopyHandler(store);

  useEffect(() => {
    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [handleCopy]);

  // -------------------- GLOBAL MOUSE UP --------------------
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragStateRef.current.isDragging) {
        handleDragEnd();
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleDragEnd]);

  // -------------------- EVENT MEDIATORS --------------------
  useMediator<CellSaveStartEvent>(
    TableEvents.CELL_SAVE_START,
    useCallback(
      (payload) => {
        store.setSaveState(payload.rowIndex, payload.colIndex, 'saving');
      },
      [store]
    ),
    tableRef
  );

  useMediator<CellSaveSuccessEvent>(
    TableEvents.CELL_SAVE_SUCCESS,
    useCallback(
      (payload) => {
        store.setSaveState(payload.rowIndex, payload.colIndex, 'success');
        setTimeout(() => store.setSaveState(payload.rowIndex, payload.colIndex, null), 2000);
      },
      [store]
    ),
    tableRef
  );

  useMediator<CellSaveErrorEvent>(
    TableEvents.CELL_SAVE_ERROR,
    useCallback(
      (payload) => {
        store.setSaveState(payload.rowIndex, payload.colIndex, 'error');
        setTimeout(() => store.setSaveState(payload.rowIndex, payload.colIndex, null), 3000);
      },
      [store]
    ),
    tableRef
  );

  useMediator<NewRowSaveSuccessEvent>(
    TableEvents.NEW_ROW_SAVE_SUCCESS,
    useCallback(
      (payload) => {
        store.markRowAsSaved(payload.rowIndex, payload.savedRowData);
      },
      [store]
    ),
    tableRef
  );

  useMediator<NewRowSaveErrorEvent>(
    TableEvents.NEW_ROW_SAVE_ERROR,
    useCallback(
      (payload) => {
        // Keep as new row, could show error state
        console.error('Failed to save new row:', payload.error);
      },
      []
    ),
    tableRef
  );

  // -------------------- FILTER HANDLERS --------------------
  const handleToggleFilter = useCallback(() => {
    setFilterExpanded((prev) => {
      const newExpanded = !prev;
      if (newExpanded && filterRows.length === 0) {
        setFilterRows([
          {
            id: `filter-${Date.now()}`,
            field: cols[0]?.data || '',
            operator: 'is_any_of',
            values: [],
          },
        ]);
      }
      return newExpanded;
    });
  }, [filterRows.length, cols]);

  const handleClearFilters = useCallback(() => {
    setFilterRows([]);
    setActiveFilterId(null);
  }, []);

  const handleSaveFilter = useCallback(
    (name: string) => {
      const newFilter: SavedFilter = {
        id: `filter-${Date.now()}`,
        name,
        rows: filterRows,
      };
      const updated = [...savedFilters, newFilter];
      setSavedFilters(updated);
      localStorage.setItem('table-saved-filters', JSON.stringify(updated));
      setActiveFilterId(newFilter.id);
    },
    [filterRows, savedFilters]
  );

  const handleFilterSelect = useCallback(
    (id: string | null) => {
      setActiveFilterId(id);
      if (id === null) {
        setFilterRows([]);
      } else {
        const filter = savedFilters.find((f) => f.id === id);
        if (filter) {
          setFilterRows(filter.rows);
        }
      }
    },
    [savedFilters]
  );

  const handleFilterRename = useCallback(
    (id: string, newName: string) => {
      const updated = savedFilters.map((f) => (f.id === id ? { ...f, name: newName } : f));
      setSavedFilters(updated);
      localStorage.setItem('table-saved-filters', JSON.stringify(updated));
    },
    [savedFilters]
  );

  const handleFilterDelete = useCallback(
    (id: string) => {
      const updated = savedFilters.filter((f) => f.id !== id);
      setSavedFilters(updated);
      localStorage.setItem('table-saved-filters', JSON.stringify(updated));
      if (activeFilterId === id) {
        setActiveFilterId(null);
        setFilterRows([]);
      }
    },
    [savedFilters, activeFilterId]
  );

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

  // -------------------- RENDER --------------------
  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <CellStoreContext.Provider value={store}>
      <div className="hot-container" style={{ height, width, position: 'relative' }}>
        {/* Toolbar */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-white">
          <h3 className="text-base font-semibold text-gray-900">{tableName}</h3>
          <div className="flex items-center gap-2">
            <SearchBar tableRef={tableRef} placeholder="Search..." />
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
        </div>

        {/* Filter Builder */}
        <FilterBuilder
          columns={cols}
          filterRows={filterRows}
          onFilterRowsChange={setFilterRows}
          onClear={handleClearFilters}
          onSave={handleSaveFilter}
          isExpanded={filterExpanded}
          onToggle={handleToggleFilter}
        />

        {/* Table Container */}
        <div
          ref={tableRef}
          className="hot-virtual-container"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          style={{
            height: typeof height === 'string' && height !== 'auto' ? height : '600px',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          {/* Column Headers */}
          {colHeaders && (
            <ColumnHeaders
              columns={cols}
              rowHeaders={rowHeaders}
              leftOffsets={leftOffsets}
              rightOffsets={rightOffsets}
              totalWidth={totalWidth}
              sortState={sortState}
              actionsColumnWidth={actionsColumnWidth}
              onSort={handleColumnSort}
              onResizeStart={handleResizeStart}
              onDoubleClick={handleColumnHeaderDoubleClick}
              onMouseDown={(e) => handleColumnHeaderMouseDown(e, handleDragStart)}
              onMouseMove={handleMouseMove}
            />
          )}

          {/* Virtual Body */}
          <table className="hot-table" style={{ width: `${totalWidth}px` }}>
            <tbody
              style={{
                display: 'block',
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: 'relative',
              }}
            >
              {virtualRows.map((virtualRow) => (
                <VirtualRow
                  key={virtualRow.index}
                  rowIndex={virtualRow.index}
                  columns={cols}
                  virtualRow={virtualRow}
                  rowHeaders={rowHeaders}
                  leftOffsets={leftOffsets}
                  rightOffsets={rightOffsets}
                  actionsColumnWidth={actionsColumnWidth}
                  onSaveNewRow={handleSaveNewRow}
                  onCancelNewRow={handleCancelNewRow}
                  onRowHeaderDoubleClick={handleRowHeaderDoubleClick}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Filter Tabs */}
        <FilterTabs
          savedFilters={savedFilters}
          activeFilterId={activeFilterId}
          onFilterSelect={handleFilterSelect}
          onFilterRename={handleFilterRename}
          onFilterDelete={handleFilterDelete}
        />

        {/* Context Menu */}
        {contextMenu && (
          <ContextMenu
            isOpen={contextMenu.isOpen}
            position={contextMenu.position}
            actions={contextMenu.actions}
            onClose={handleContextMenuClose}
            onActionClick={handleContextMenuAction}
          />
        )}
      </div>
    </CellStoreContext.Provider>
  );
};

export default HOT;
