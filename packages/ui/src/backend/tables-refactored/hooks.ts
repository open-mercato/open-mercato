// hooks.ts

import { useCallback, useContext, useSyncExternalStore, createContext } from 'react';
import { CellStore } from './store';
import { CellState, DragState, SelectionState } from './types';

// ============================================
// CONTEXT
// ============================================
export const CellStoreContext = createContext<CellStore | null>(null);

export const useCellStore = (): CellStore => {
  const store = useContext(CellStoreContext);
  if (!store) {
    throw new Error('useCellStore must be used within CellStoreContext.Provider');
  }
  return store;
};

// ============================================
// CELL STATE HOOK
// ============================================
export function useCellState(row: number, col: number): CellState {
  const store = useCellStore();

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(row, col, onStoreChange),
    [store, row, col]
  );

  const getSnapshot = useCallback(() => store.getRevision(row, col), [store, row, col]);

  // This triggers re-render when revision changes
  useSyncExternalStore(subscribe, getSnapshot);

  // Return fresh state on each render
  return store.getCellState(row, col);
}

// ============================================
// SELECTION HOOK (for components that need selection without cell subscription)
// ============================================
export function useSelection(): SelectionState {
  const store = useCellStore();
  return store.getSelection();
}

// ============================================
// DRAG HANDLING HOOK
// ============================================
export function useDragHandling(
  store: CellStore,
  colCount: number
): {
  dragState: React.MutableRefObject<DragState>;
  handleDragStart: (row: number, col: number, type: 'cell' | 'row' | 'column') => void;
  handleDragMove: (row: number, col: number) => void;
  handleDragEnd: () => void;
} {
  const dragState = { current: { isDragging: false, type: null, start: null } as DragState };

  const handleDragStart = useCallback(
    (row: number, col: number, type: 'cell' | 'row' | 'column') => {
      dragState.current = {
        isDragging: true,
        type,
        start: { row, col },
      };

      if (type === 'row') {
        store.setSelection({
          type: 'rowRange',
          anchor: { row, col: 0 },
          focus: { row, col: colCount - 1 },
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
    [store, colCount]
  );

  const handleDragMove = useCallback(
    (row: number, col: number) => {
      if (!dragState.current.isDragging || !dragState.current.start) return;

      const selection = store.getSelection();
      if (!selection.anchor) return;

      if (dragState.current.type === 'row') {
        store.setSelection({
          ...selection,
          focus: { row, col: colCount - 1 },
        });
      } else if (dragState.current.type === 'column') {
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
    [store, colCount]
  );

  const handleDragEnd = useCallback(() => {
    dragState.current = { isDragging: false, type: null, start: null };
  }, []);

  return {
    dragState,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
  };
}

// ============================================
// KEYBOARD NAVIGATION HOOK
// ============================================
export function useKeyboardNavigation(
  store: CellStore,
  colCount: number,
  onTabSave?: (row: number, col: number, value: any) => void
) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const selection = store.getSelection();
      const editing = store.getEditingCell();
      const bounds = store.getSelectionBounds();

      // Enter to start editing
      if (e.key === 'Enter' && !editing && bounds) {
        if (bounds.startRow === bounds.endRow && bounds.startCol === bounds.endCol) {
          e.preventDefault();
          store.setEditingCell(bounds.startRow, bounds.startCol);
          return;
        }
      }

      // Escape to cancel editing
      if (e.key === 'Escape' && editing) {
        e.preventDefault();
        store.clearEditing();
        return;
      }

      // Tab navigation
      if (e.key === 'Tab') {
        e.preventDefault();

        const direction = e.shiftKey ? -1 : 1;
        let currentRow: number;
        let currentCol: number;

        if (editing) {
          currentRow = editing.row;
          currentCol = editing.col;

          // Trigger save callback before moving
          if (onTabSave) {
            onTabSave(currentRow, currentCol, store.getCellValue(currentRow, currentCol));
          }
        } else if (bounds && bounds.startRow === bounds.endRow && bounds.startCol === bounds.endCol) {
          currentRow = bounds.startRow;
          currentCol = bounds.startCol;
        } else {
          return;
        }

        let nextCol = currentCol + direction;
        let nextRow = currentRow;

        if (nextCol >= colCount) {
          nextCol = 0;
          nextRow++;
        } else if (nextCol < 0) {
          nextCol = colCount - 1;
          nextRow--;
        }

        if (nextRow >= 0 && nextRow < store.getRowCount()) {
          store.clearEditing();
          store.setSelection({
            type: 'range',
            anchor: { row: nextRow, col: nextCol },
            focus: { row: nextRow, col: nextCol },
          });
          store.setEditingCell(nextRow, nextCol);
        }
        return;
      }

      // Arrow navigation (only when not editing)
      if (!editing && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        if (!bounds || bounds.startRow !== bounds.endRow || bounds.startCol !== bounds.endCol) {
          return;
        }

        let nextRow = bounds.startRow;
        let nextCol = bounds.startCol;

        switch (e.key) {
          case 'ArrowUp':
            nextRow = Math.max(0, nextRow - 1);
            break;
          case 'ArrowDown':
            nextRow = Math.min(store.getRowCount() - 1, nextRow + 1);
            break;
          case 'ArrowLeft':
            nextCol = Math.max(0, nextCol - 1);
            break;
          case 'ArrowRight':
            nextCol = Math.min(colCount - 1, nextCol + 1);
            break;
        }

        store.setSelection({
          type: 'range',
          anchor: { row: nextRow, col: nextCol },
          focus: { row: nextRow, col: nextCol },
        });
      }
    },
    [store, colCount, onTabSave]
  );

  return handleKeyDown;
}

// ============================================
// COPY HANDLER HOOK
// ============================================
export function useCopyHandler(store: CellStore) {
  const handleCopy = useCallback(
    (e: ClipboardEvent) => {
      const cells = store.getCellsInSelection();
      if (cells.length === 0) return;

      const bounds = store.getSelectionBounds();
      if (!bounds) return;

      const rowCount = bounds.endRow - bounds.startRow + 1;
      const colCount = bounds.endCol - bounds.startCol + 1;

      const grid: string[][] = Array.from({ length: rowCount }, () =>
        Array.from({ length: colCount }, () => '')
      );

      cells.forEach((cell) => {
        const r = cell.row - bounds.startRow;
        const c = cell.col - bounds.startCol;
        grid[r][c] = String(cell.value ?? '');
      });

      const text = grid.map((row) => row.join('\t')).join('\n');

      if (e.clipboardData) {
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
      }
    },
    [store]
  );

  return handleCopy;
}

// ============================================
// STICKY OFFSETS HOOK
// ============================================
export function useStickyOffsets(
  columns: { sticky?: 'left' | 'right'; width?: number }[],
  store: CellStore,
  rowHeaders: boolean
): {
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
} {
  const leftOffsets: (number | undefined)[] = [];
  const rightOffsets: (number | undefined)[] = [];

  let leftOffset = rowHeaders ? 50 : 0;
  let rightOffset = 0;

  // Calculate left sticky offsets
  columns.forEach((col, index) => {
    const colWidth = store.getColumnWidth(index);

    if (col.sticky === 'left') {
      leftOffsets[index] = leftOffset;
      leftOffset += colWidth;
    } else {
      leftOffsets[index] = undefined;
    }
  });

  // Calculate right sticky offsets (need to go backwards)
  const rightStickyCols: { index: number; width: number }[] = [];
  columns.forEach((col, index) => {
    if (col.sticky === 'right') {
      rightStickyCols.push({ index, width: store.getColumnWidth(index) });
    }
  });

  rightStickyCols.reverse().forEach(({ index, width }) => {
    rightOffsets[index] = rightOffset;
    rightOffset += width;
  });

  // Fill undefined for non-sticky columns
  columns.forEach((col, index) => {
    if (col.sticky !== 'right') {
      rightOffsets[index] = undefined;
    }
  });

  return { leftOffsets, rightOffsets };
}
