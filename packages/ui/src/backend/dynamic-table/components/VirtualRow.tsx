import React, { memo } from 'react';
import { VirtualItem } from '@tanstack/react-virtual';
import { useCellStore, useSelection } from '../hooks/index';
import { ColumnDef } from '../types/index';
import Cell from './Cell';
import RowHeaderCell from './RowHeaderCell';

export interface VirtualRowProps {
  rowIndex: number;
  columns: ColumnDef[];
  virtualRow: VirtualItem;
  rowHeaders: boolean;
  leftOffsets: (number | undefined)[];
  rightOffsets: (number | undefined)[];
  actionsColumnWidth: number;
  showActionsColumn?: boolean;
  stretchColumns?: boolean;
  totalWidth: number;
  storeRevision: number;
  onSaveNewRow: (rowIndex: number) => void;
  onCancelNewRow: (rowIndex: number) => void;
  onRowHeaderDoubleClick: (e: React.MouseEvent, rowIndex: number) => void;
  onCellSave: (row: number, col: number, newValue: any) => void;
  actionsRenderer?: (rowData: any, rowIndex: number) => React.ReactNode;
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
    showActionsColumn = true,
    stretchColumns = false,
    totalWidth,
    storeRevision: _storeRevision, // Used to invalidate memo when column widths change
    onSaveNewRow,
    onCancelNewRow,
    onRowHeaderDoubleClick,
    onCellSave,
    actionsRenderer,
  }) => {
    const store = useCellStore();
    const selection = useSelection();
    const isNewRow = store.isNewRow(rowIndex);
    const rowData = store.getRowData(rowIndex);

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
          width: stretchColumns ? '100%' : `${totalWidth}px`,
          height: `${virtualRow.size}px`,
          transform: `translateY(${virtualRow.start}px)`,
        }}
      >
        {rowHeaders && (
          <RowHeaderCell
            row={rowIndex}
            isNewRow={isNewRow}
            isInRowRange={!!isInRowRange}
            rowRangeEdges={rowRangeEdges}
            onCancel={() => onCancelNewRow(rowIndex)}
            onDoubleClick={(e) => onRowHeaderDoubleClick(e, rowIndex)}
          />
        )}

        {columns.map((col, colIndex) => (
          <Cell
            key={col.data}
            row={rowIndex}
            col={colIndex}
            colConfig={{ ...col, width: store.getColumnWidth(colIndex) }}
            stickyLeft={leftOffsets[colIndex]}
            stickyRight={rightOffsets[colIndex]}
            stretchColumns={stretchColumns}
            onCellSave={onCellSave}
          />
        ))}

        {/* Actions column */}
        {showActionsColumn && (
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
            {isNewRow ? (
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
            ) : (
              actionsRenderer?.(rowData, rowIndex)
            )}
          </td>
        )}
      </tr>
    );
  }
);

VirtualRow.displayName = 'VirtualRow';

export default VirtualRow;
