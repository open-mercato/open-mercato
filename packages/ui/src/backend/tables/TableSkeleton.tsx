'use client';

import React from 'react';

interface TableSkeletonProps {
  /** Number of skeleton rows to display */
  rows?: number;
  /** Number of skeleton columns to display */
  columns?: number;
  /** Whether to show row headers */
  rowHeaders?: boolean;
  /** Whether to show column headers */
  colHeaders?: boolean;
  /** Height of the skeleton container */
  height?: string | number;
  /** Width of the skeleton container */
  width?: string | number;
  /** Table name to display in header */
  tableName?: string;
  /** Column widths array (defaults to 100px each) */
  columnWidths?: number[];
}

const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rows = 10,
  columns = 6,
  rowHeaders = true,
  colHeaders = true,
  height = '600px',
  width = 'auto',
  tableName = 'Loading...',
  columnWidths = []
}) => {
  const getColumnWidth = (index: number) => {
    return columnWidths[index] || 100;
  };

  const totalWidth = 
    (rowHeaders ? 50 : 0) + 
    Array.from({ length: columns }, (_, i) => getColumnWidth(i)).reduce((a, b) => a + b, 0);

  return (
    <div className="hot-container table-skeleton" style={{ height, width }}>
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-white">
        <div className="skeleton-text" style={{ width: '150px', height: '20px' }}>
          <span style={{ opacity: 0 }}>{tableName}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="skeleton-button" style={{ width: '120px', height: '32px' }} />
          <div className="skeleton-button" style={{ width: '32px', height: '32px' }} />
        </div>
      </div>

      {/* Table Container */}
      <div 
        className="hot-virtual-container"
        style={{
          height: typeof height === 'string' && height !== 'auto' ? height : '600px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Column Headers */}
        {colHeaders && (
          <div className="hot-headers-sticky">
            <table className="hot-table" style={{ width: `${totalWidth}px` }}>
              <thead>
                <tr style={{ display: 'flex' }}>
                  {rowHeaders && (
                    <th
                      className="hot-row-header skeleton-header"
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
                  {Array.from({ length: columns }, (_, colIndex) => (
                    <th
                      key={colIndex}
                      className="hot-col-header skeleton-header"
                      style={{
                        width: getColumnWidth(colIndex),
                        flexBasis: getColumnWidth(colIndex),
                        flexShrink: 0,
                        flexGrow: 0
                      }}
                    />
                  ))}
                </tr>
              </thead>
            </table>
          </div>
        )}

        {/* Table Body */}
        <table className="hot-table" style={{ width: `${totalWidth}px` }}>
          <tbody>
            {Array.from({ length: rows }, (_, rowIndex) => (
              <tr
                key={rowIndex}
                style={{
                  display: 'flex',
                }}
              >
                {rowHeaders && (
                  <td
                    className="hot-row-header skeleton-cell"
                    style={{
                      width: 50,
                      flexBasis: 50,
                      flexShrink: 0,
                      flexGrow: 0,
                      position: 'sticky',
                      left: 0,
                      zIndex: 3
                    }}
                  />
                )}
                {Array.from({ length: columns }, (_, colIndex) => (
                  <td
                    key={colIndex}
                    className="hot-cell skeleton-cell"
                    style={{
                      width: getColumnWidth(colIndex),
                      flexBasis: getColumnWidth(colIndex),
                      flexShrink: 0,
                      flexGrow: 0
                    }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TableSkeleton;