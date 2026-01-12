// DynamicTable.tsx


'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
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
  DragState,
} from './handlers/index';
import { createPerspectiveHandlers, initializePerspectiveState } from './handlers/perspectiveHandlers';
import { dispatch, useEventHandlers } from './events/events';
import {
  ColumnDef,
  ContextMenuState,
  SortState,
  FilterRow,
  TableEvents,
  FilterChangeEvent,
  PaginationProps,
  ContextMenuAction,
  SavedFilter,
  TableUIConfig,
} from './types/index';
import {
  PerspectiveConfig,
  SortRule,
  PerspectiveChangeEvent,
} from './types/perspective';

// Import components
import PerspectiveToolbar from './components/PerspectiveToolbar';
import PerspectiveTabs from './components/PerspectiveTabs';
import SearchBar from './components/SearchBar';
import ContextMenu from './components/ContextMenu';
import VirtualRow from './components/VirtualRow';
import ColumnHeaders from './components/ColumnHeaders';
import Debugger from './components/Debugger';
import FullscreenOverlay from './components/FullscreenOverlay';
import { Maximize2 } from 'lucide-react';

if (typeof window !== 'undefined') {
  import('./styles/DynamicTable.css');
}

// ============================================
// PROPS INTERFACE
// ============================================

export interface DynamicTableProps {
  data?: any[];
  columns?: ColumnDef[];
  colHeaders?: boolean;
  rowHeaders?: boolean;
  height?: string | number;
  width?: string | number;
  idColumnName?: string;
  tableName?: string;
  tableRef: React.RefObject<HTMLDivElement | null>;
  /** Message to display when data is empty (e.g., "No addresses") */
  emptyMessage?: string;
  columnActions?: (column: ColumnDef, colIndex: number) => ContextMenuAction[];
  rowActions?: (rowData: any, rowIndex: number) => ContextMenuAction[];
  actionsRenderer?: (rowData: any, rowIndex: number) => React.ReactNode;
  pagination?: PaginationProps;
  /** When true, columns stretch proportionally to fill container width */
  stretchColumns?: boolean;

  // NEW - Perspective management
  savedPerspectives?: PerspectiveConfig[];
  activePerspectiveId?: string | null;
  defaultHiddenColumns?: string[];

  // DEPRECATED - Keep for backward compatibility (converts to perspectives internally)
  savedFilters?: SavedFilter[];
  activeFilterId?: string | null;
  hiddenColumns?: string[];

  // Debug mode - shows floating event log panel
  debug?: boolean;

  // UI visibility configuration
  uiConfig?: TableUIConfig;
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
  emptyMessage,
  columnActions,
  rowActions,
  actionsRenderer,
  pagination,
  // New perspective props
  savedPerspectives: propSavedPerspectives,
  activePerspectiveId: controlledActivePerspectiveId,
  defaultHiddenColumns = [],
  // Deprecated props (backward compatibility)
  savedFilters: deprecatedSavedFilters,
  activeFilterId: deprecatedActiveFilterId,
  hiddenColumns: deprecatedHiddenColumns = [],
  debug = false,
  uiConfig = {},
  stretchColumns = false,
}) => {
  // -------------------- BACKWARD COMPATIBILITY --------------------
  // Convert deprecated savedFilters to savedPerspectives format
  const savedPerspectives = useMemo(() => {
    if (propSavedPerspectives) {
      return propSavedPerspectives;
    }
    // Convert old savedFilters to perspectives
    if (deprecatedSavedFilters && deprecatedSavedFilters.length > 0) {
      return deprecatedSavedFilters.map(filter => ({
        id: filter.id,
        name: filter.name,
        color: filter.color,
        columns: {
          visible: columns.map(c => c.data),
          hidden: [],
        },
        filters: filter.rows,
        sorting: [],
      }));
    }
    return [];
  }, [propSavedPerspectives, deprecatedSavedFilters, columns]);

  // Use new prop or deprecated prop
  const controlledActiveId = controlledActivePerspectiveId !== undefined
    ? controlledActivePerspectiveId
    : deprecatedActiveFilterId;

  // Merge hidden columns from deprecated prop and new prop
  const initialHiddenColumns = useMemo(() => {
    return [...new Set([...defaultHiddenColumns, ...deprecatedHiddenColumns])];
  }, [defaultHiddenColumns, deprecatedHiddenColumns]);

  // -------------------- UI CONFIG --------------------
  const {
    hideToolbar = false,
    hideTitle = false,
    hideSearch = false,
    hideFilterButton = false,
    hideAddRowButton = false,
    hideBottomBar = false,
    hideActionsColumn = false,
    toolbarPosition = 'top',
    topBarStart,
    topBarEnd,
    bottomBarStart,
    bottomBarEnd,
    enableFullscreen = false,
    onFullscreenChange,
  } = uiConfig;

  // -------------------- REFS --------------------
  const storeRef = useRef<CellStore | null>(null);
  const dragStateRef = useRef<DragState>({
    isDragging: false,
    type: null,
    start: null,
  });

  // -------------------- CONSTANTS --------------------
  const actionsColumnWidth = 80;

  // -------------------- BASE COLUMNS --------------------
  const baseColumns = useMemo(() => {
    if (columns.length > 0) {
      return columns;
    }
    if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
      return Object.keys(data[0])
        .filter((k) => k !== '_isNew')
        .map((k) => ({ data: k }));
    }
    return [];
  }, [columns, data]);

  // -------------------- PERSPECTIVE STATE --------------------
  const initialState = useMemo(() => {
    // Find active perspective
    const activePerspective = controlledActiveId
      ? savedPerspectives.find(p => p.id === controlledActiveId)
      : null;
    return initializePerspectiveState(baseColumns, activePerspective, initialHiddenColumns);
  }, []); // Only compute on mount

  const [visibleColumns, setVisibleColumns] = useState<string[]>(initialState.visibleColumns);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(initialState.hiddenColumns);
  const [filters, setFilters] = useState<FilterRow[]>(initialState.filters);
  const [sortRules, setSortRules] = useState<SortRule[]>(initialState.sortRules);
  const [internalActivePerspectiveId, setInternalActivePerspectiveId] = useState<string | null>(
    controlledActiveId ?? null
  );

  // Active perspective ID (controlled or internal)
  const activePerspectiveId = controlledActiveId !== undefined
    ? controlledActiveId
    : internalActivePerspectiveId;

  // Display name: use perspective name if selected, otherwise default tableName
  const displayTableName = useMemo(() => {
    if (activePerspectiveId) {
      const activePerspective = savedPerspectives.find(p => p.id === activePerspectiveId);
      if (activePerspective) {
        return activePerspective.name;
      }
    }
    return tableName;
  }, [activePerspectiveId, savedPerspectives, tableName]);

  // -------------------- FULLSCREEN STATE --------------------
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [savedColumnWidths, setSavedColumnWidths] = useState<Map<number, number> | null>(null);

  // -------------------- COMPUTED COLUMNS (ordered by perspective) --------------------
  const cols = useMemo(() => {
    // Get columns in the order specified by visibleColumns
    const orderedCols: ColumnDef[] = [];
    for (const key of visibleColumns) {
      const col = baseColumns.find(c => c.data === key);
      if (col) {
        orderedCols.push(col);
      }
    }
    return orderedCols;
  }, [baseColumns, visibleColumns]);

  // -------------------- STORE INITIALIZATION --------------------
  if (!storeRef.current) {
    storeRef.current = createCellStore(data, cols);
  }
  const store = storeRef.current;

  // -------------------- OTHER STATE --------------------
  const [rowCount, setRowCount] = useState(store.getRowCount());
  const [storeRevision, setStoreRevision] = useState(0);
  const [sortState, setSortState] = useState<SortState>({
    columnIndex: null,
    direction: null,
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // -------------------- COMPUTED VALUES --------------------
  const { leftOffsets, rightOffsets } = useStickyOffsets(cols, store, rowHeaders);

  const showActionsColumn = !hideActionsColumn;

  const totalWidth = useMemo(() => {
    return (
      cols.reduce((sum, _, idx) => sum + store.getColumnWidth(idx), 0) +
      (rowHeaders ? 50 : 0) +
      (showActionsColumn ? actionsColumnWidth : 0)
    );
  }, [cols, store, rowHeaders, actionsColumnWidth, showActionsColumn, storeRevision]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => tableRef?.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  // Re-measure when fullscreen state changes
  useEffect(() => {
    // Small delay to ensure DOM is ready after fullscreen transition
    const timer = setTimeout(() => {
      rowVirtualizer.measure();
    }, 50);
    return () => clearTimeout(timer);
  }, [isFullscreen, rowVirtualizer]);

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

  // Perspective handlers
  const {
    handleColumnVisibilityChange,
    handleColumnOrderChange,
    handleFiltersChange,
    handleSortRulesChange,
    handleSavePerspective,
    handlePerspectiveSelect,
    handlePerspectiveRename,
    handlePerspectiveDelete,
  } = createPerspectiveHandlers({
    tableRef,
    columns: baseColumns,
    savedPerspectives,
    activePerspectiveId,
    setVisibleColumns,
    setHiddenColumns,
    setFilters,
    setSortRules,
    setInternalActivePerspectiveId,
  });

  const keyboardHandler = useKeyboardNavigation(store, cols.length, handleCellSave);
  const handleCopy = useCopyHandler(store);

  // Wrap keyboard handler for React event system
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    keyboardHandler(e.nativeEvent);
  }, [keyboardHandler]);

  // -------------------- FULLSCREEN HANDLERS --------------------
  const handleEnterFullscreen = () => {
    // Save current widths
    setSavedColumnWidths(store.getColumnWidths());

    // Calculate and apply scaled widths
    const padding = 48; // 24px padding each side
    const availableWidth = window.innerWidth - padding;
    const currentTotal = cols.reduce((sum, _, idx) => sum + store.getColumnWidth(idx), 0) +
      (rowHeaders ? 50 : 0) +
      (showActionsColumn ? actionsColumnWidth : 0);

    if (availableWidth > currentTotal) {
      const scaleFactor = availableWidth / currentTotal;
      cols.forEach((_, idx) => {
        const originalWidth = store.getColumnWidth(idx);
        const scaledWidth = Math.max(Math.round(originalWidth * scaleFactor), 60);
        store.setColumnWidth(idx, scaledWidth);
      });
    }

    setIsFullscreen(true);
    onFullscreenChange?.(true);
  };

  const handleExitFullscreen = () => {
    // Restore original widths
    if (savedColumnWidths) {
      savedColumnWidths.forEach((width, idx) => {
        store.setColumnWidth(idx, width);
      });
    }
    setSavedColumnWidths(null);
    setIsFullscreen(false);
    onFullscreenChange?.(false);
  };

  // -------------------- EFFECTS --------------------
  // Sync data to store
  useEffect(() => {
    store.setData(data);
  }, [data, store]);

  // Subscribe to store-level changes (row add/remove, column resize)
  useEffect(() => {
    return store.subscribeToStore(() => {
      setRowCount(store.getRowCount());
      setStoreRevision(prev => prev + 1);
    });
  }, [store]);

  // Keyboard navigation is now handled via onKeyDown prop on the table container
  // This ensures React synthetic events fire before the handler, allowing editors to save first

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

  // Dispatch FILTER_CHANGE when filters change (backward compatibility)
  useEffect(() => {
    dispatch<FilterChangeEvent>(
      tableRef.current!,
      TableEvents.FILTER_CHANGE,
      { filters, savedFilterId: activePerspectiveId },
    );
  }, [filters, activePerspectiveId, tableRef]);

  // Dispatch PERSPECTIVE_CHANGE when any config changes
  useEffect(() => {
    dispatch<PerspectiveChangeEvent>(
      tableRef.current!,
      TableEvents.PERSPECTIVE_CHANGE,
      {
        config: {
          columns: { visible: visibleColumns, hidden: hiddenColumns },
          filters,
          sorting: sortRules,
        },
      },
    );
  }, [visibleColumns, hiddenColumns, filters, sortRules, tableRef]);

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

  // Determine if we should fill available height
  const shouldFillHeight = height === '100%' || height === 'fill'

  // Table content shared between normal and fullscreen modes
  const tableContent = (
    <div
      className={`hot-container ${shouldFillHeight ? 'flex flex-col flex-1' : ''}`}
      style={{
        height: isFullscreen ? '100%' : (shouldFillHeight ? '100%' : height),
        width: isFullscreen ? '100%' : width,
        position: 'relative',
        ...(shouldFillHeight && { minHeight: 0 }),
      }}
    >
      {/* Combined Toolbar - Title, Perspective controls, Search, Add button */}
      {!hideToolbar && (
        <div className="flex items-center px-4 py-2 border-b border-gray-200 bg-white gap-4">
          {/* Custom slot: top bar start */}
          {topBarStart}

          {!hideTitle && (
            <h3 className="text-base font-semibold text-gray-900 whitespace-nowrap">{displayTableName}</h3>
          )}

          {/* Perspective Toolbar - only show in top when position is 'top' */}
          {!hideFilterButton && toolbarPosition === 'top' && (
            <PerspectiveToolbar
              columns={baseColumns}
              visibleColumns={visibleColumns}
              hiddenColumns={hiddenColumns}
              filters={filters}
              sortRules={sortRules}
              onColumnVisibilityChange={handleColumnVisibilityChange}
              onColumnOrderChange={handleColumnOrderChange}
              onFiltersChange={handleFiltersChange}
              onSortRulesChange={handleSortRulesChange}
              onSavePerspective={handleSavePerspective}
            />
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search, Fullscreen, and Add Row */}
          <div className="flex items-center gap-2">
            {!hideSearch && <SearchBar tableRef={tableRef} placeholder="Search..." />}
            {enableFullscreen && !isFullscreen && (
              <button
                onClick={handleEnterFullscreen}
                className="fullscreen-toggle-btn"
                title="Enter fullscreen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}
            {!hideAddRowButton && (
              <button
                onClick={handleAddRow}
                className="w-8 h-8 rounded border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 flex items-center justify-center text-lg text-gray-700 transition-colors"
                title="Add new row"
              >
                +
              </button>
            )}
          </div>

          {/* Custom slot: top bar end */}
          {topBarEnd}
        </div>
      )}

      {/* Table Container */}
      <div
        ref={tableRef}
        className={`hot-virtual-container ${shouldFillHeight ? 'flex-1' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        style={{
          height: isFullscreen ? 'calc(100% - 90px)' : (shouldFillHeight ? undefined : (typeof height === 'string' && height !== 'auto' ? height : '600px')),
          overflow: 'auto',
          position: 'relative',
          ...(shouldFillHeight && { minHeight: 0 }),
        }}
      >
        {/* Empty State Message */}
        {emptyMessage && rowCount === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-gray-500">
            {emptyMessage}
          </div>
        ) : (
          <>
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
                showActionsColumn={showActionsColumn}
                stretchColumns={stretchColumns}
                onSort={handleColumnSort}
                onResizeStart={handleResizeStart}
                onDoubleClick={handleColumnHeaderDoubleClick}
                onMouseDown={(e) => handleColumnHeaderMouseDown(e, dragHandlers.handleDragStart)}
                onMouseMove={handleMouseMove}
              />
            )}

            {/* Virtual Body */}
            <table className="hot-table" style={{ width: stretchColumns ? '100%' : `${totalWidth}px` }}>
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
                    showActionsColumn={showActionsColumn}
                    stretchColumns={stretchColumns}
                    totalWidth={totalWidth}
                    storeRevision={storeRevision}
                    onSaveNewRow={handleSaveNewRow}
                    onCancelNewRow={handleCancelNewRow}
                    onRowHeaderDoubleClick={handleRowHeaderDoubleClick}
                    onCellSave={handleCellSave}
                    actionsRenderer={actionsRenderer}
                  />
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Perspective Tabs / Bottom Bar */}
      {!hideBottomBar && (
        <PerspectiveTabs
          savedPerspectives={savedPerspectives}
          activePerspectiveId={activePerspectiveId}
          onPerspectiveSelect={handlePerspectiveSelect}
          onPerspectiveRename={handlePerspectiveRename}
          onPerspectiveDelete={handlePerspectiveDelete}
          pagination={pagination}
          startContent={bottomBarStart}
          endContent={bottomBarEnd}
          toolbar={!hideFilterButton && toolbarPosition === 'bottom' ? (
            <PerspectiveToolbar
              columns={baseColumns}
              visibleColumns={visibleColumns}
              hiddenColumns={hiddenColumns}
              filters={filters}
              sortRules={sortRules}
              onColumnVisibilityChange={handleColumnVisibilityChange}
              onColumnOrderChange={handleColumnOrderChange}
              onFiltersChange={handleFiltersChange}
              onSortRulesChange={handleSortRulesChange}
              onSavePerspective={handleSavePerspective}
            />
          ) : undefined}
        />
      )}

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
  );

  return (
    <CellStoreContext.Provider value={store}>
      {isFullscreen ? (
        <FullscreenOverlay
          isOpen={isFullscreen}
          onClose={handleExitFullscreen}
          tableName={displayTableName}
        >
          {tableContent}
        </FullscreenOverlay>
      ) : (
        tableContent
      )}
    </CellStoreContext.Provider>
  );
};

export default DynamicTable;
