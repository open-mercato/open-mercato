import React, { memo, useRef, useEffect, useCallback } from 'react';
import { useCellStore, useCellState } from '../hooks/index';
import { getCellRenderer } from './renderers';
import { getCellEditor } from './editors';
import { ColumnDef } from '../types/index';

export interface CellProps {
  row: number;
  col: number;
  colConfig: ColumnDef;
  stickyLeft?: number;
  stickyRight?: number;
  onCellSave: (row: number, col: number, newValue: any) => void;
}

const Cell: React.FC<CellProps> = memo(({ row, col, colConfig, stickyLeft, stickyRight, onCellSave }) => {
  const store = useCellStore();
  const state = useCellState(row, col);
  const inputRef = useRef<any>(null);
  const rowData = store.getRowData(row);

  // Get value from rowData using the column's data key (not numeric index)
  // This ensures correct values are displayed when columns are reordered
  const cellValue = rowData?.[colConfig.data];

  const handleSave = useCallback(
    (value?: any) => {
      const newValue = value !== undefined ? value : cellValue;
      onCellSave(row, col, newValue);
    },
    [cellValue, row, col, onCellSave]
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
  const renderedValue = renderer(cellValue, rowData, colConfig, row, col);
  const hasCustomRenderer = typeof colConfig.renderer === 'function';

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
      data-custom-renderer={hasCustomRenderer || undefined}
    >
      {state.isEditing
        ? getCellEditor(
          colConfig,
          cellValue,
          handleChange,
          handleSave,
          handleCancel,
          rowData,
          row,
          col,
          inputRef
        )
        : hasCustomRenderer
          ? renderedValue
          : <span className="cell-content" title={typeof cellValue === 'string' ? cellValue : undefined}>{renderedValue}</span>}
    </td>
  );
});

Cell.displayName = 'Cell';

export default Cell;
