// DynamicTable.tsx


'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { createCellStore, CellStore } from './store/index';
import {
  CellStoreContext,
  useStickyOffsets,
  useKeyboardNavigation,
  useCopyHandler,
} from './hooks/index';
import {
  createCellHandlers,
  createRowHandlers,
  createDragHandlers,
  createMouseHandlers,
  createColumnHeaderHandlers,
  createRowHeaderHandlers,
  createContextMenuHandlers,
  createResizeHandlers,
  createFilterHandlers,
  DragState,
} from './handlers/index';
import { dispatch, useEventHandlers } from './events/events';
import {
  DynamicTableProps,
  ContextMenuState,
  SortState,
  FilterRow,
  TableEvents,
  FilterChangeEvent,
} from './types/index';

// Import components
import FilterBuilder from './components/FilterBuilder';
import FilterTabs from './components/FilterTabs';
import SearchBar from './components/SearchBar';
import ContextMenu from './components/ContextMenu';
import VirtualRow from './components/VirtualRow';
import ColumnHeaders from './components/ColumnHeaders';
import Debugger from './components/Debugger';

if (typeof window !== 'undefined') {
  import('./styles/DynamicTable.css');
}

// ============================================
// MAIN DYNAMIC TABLE COMPONENT
// ============================================
const DynamicTable: React.FC<DynamicTableProps> = ({
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
  pagination,
  savedFilters = [],
  activeFilterId: controlledActiveFilterId,
  debug = false,
}) => {
  // -------------------- REFS --------------------
  const storeRef = useRef<CellStore | null>(null);
  const dragStateRef = useRef<DragState>({
    isDragging: false,
    type: null,
    start: null,
  });

  // -------------------- CONSTANTS --------------------
  const actionsColumnWidth = 80;

  // -------------------- STORE INITIALIZATION --------------------
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

  // -------------------- STATE --------------------
  const [rowCount, setRowCount] = useState(store.getRowCount());
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [internalActiveFilterId, setInternalActiveFilterId] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>({
    columnIndex: null,
    direction: null,
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // -------------------- DERIVED STATE --------------------
  const activeFilterId = controlledActiveFilterId !== undefined ? controlledActiveFilterId : internalActiveFilterId;

  // -------------------- COMPUTED VALUES --------------------
  const { leftOffsets, rightOffsets } = useStickyOffsets(cols, store, rowHeaders);

  const totalWidth = useMemo(() => {
    return (
      cols.reduce((sum, _, idx) => sum + store.getColumnWidth(idx), 0) +
      (rowHeaders ? 50 : 0) +
      actionsColumnWidth
    );
  }, [cols, store, rowHeaders, actionsColumnWidth]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => tableRef?.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  // -------------------- HANDLERS --------------------
  const { handleCellSave } = createCellHandlers(store, cols, tableRef, idColumnName);
  const { handleAddRow, handleSaveNewRow, handleCancelNewRow } = createRowHandlers(
    store,
    cols,
    tableRef
  );
  const dragHandlers = createDragHandlers(store, cols, dragStateRef);
  const { handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick } =
    createMouseHandlers(store, cols, dragStateRef, dragHandlers);
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
  const {
    handleToggleFilter,
    handleClearFilters,
    handleSaveFilter,
    handleFilterSelect,
    handleFilterRename,
    handleFilterDelete,
  } = createFilterHandlers({
    tableRef,
    columns: cols,
    filterRows,
    setFilterRows,
    setFilterExpanded,
    setInternalActiveFilterId,
    savedFilters,
    activeFilterId,
  });
  const handleKeyDown = useKeyboardNavigation(store, cols.length, handleCellSave);
  const handleCopy = useCopyHandler(store);

  // -------------------- EFFECTS --------------------
  // Sync data to store
  useEffect(() => {
    store.setData(data);
  }, [data, store]);

  // Subscribe to store-level changes (row add/remove)
  useEffect(() => {
    return store.subscribeToStore(() => {
      setRowCount(store.getRowCount());
    });
  }, [store]);

  // Keyboard navigation
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Copy handler
  useEffect(() => {
    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [handleCopy]);

  // Global mouse up for drag end
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragStateRef.current.isDragging) {
        dragHandlers.handleDragEnd();
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [dragHandlers]);

  // Dispatch FILTER_CHANGE when filters change
  useEffect(() => {
    dispatch<FilterChangeEvent>(
      tableRef.current!,
      TableEvents.FILTER_CHANGE,
      { filters: filterRows, savedFilterId: activeFilterId },
    );
  }, [filterRows, activeFilterId, tableRef]);

  // -------------------- EVENT HANDLERS --------------------
  useEventHandlers({
    [TableEvents.CELL_SAVE_START]: (payload) => {
      store.setSaveState(payload.rowIndex, payload.colIndex, 'saving');
    },
    [TableEvents.CELL_SAVE_SUCCESS]: (payload) => {
      store.setSaveState(payload.rowIndex, payload.colIndex, 'success');
      setTimeout(() => store.setSaveState(payload.rowIndex, payload.colIndex, null), 2000);
    },
    [TableEvents.CELL_SAVE_ERROR]: (payload) => {
      store.setSaveState(payload.rowIndex, payload.colIndex, 'error');
      setTimeout(() => store.setSaveState(payload.rowIndex, payload.colIndex, null), 3000);
    },
    [TableEvents.NEW_ROW_SAVE_SUCCESS]: (payload) => {
      store.markRowAsSaved(payload.rowIndex, payload.savedRowData);
    },
    [TableEvents.NEW_ROW_SAVE_ERROR]: (payload) => {
      console.error('Failed to save new row:', payload.error);
    },
  }, tableRef);

  // -------------------- RENDER --------------------

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
              onMouseDown={(e) => handleColumnHeaderMouseDown(e, dragHandlers.handleDragStart)}
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
                  onCellSave={handleCellSave}
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
          pagination={pagination}
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

        {/* Debugger */}
        {debug && <Debugger tableRef={tableRef} />}
      </div>
    </CellStoreContext.Provider>
  );
};

export default DynamicTable;
