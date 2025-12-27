import React, { memo } from 'react';

export interface RowHeaderCellProps {
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

export default RowHeaderCell;
