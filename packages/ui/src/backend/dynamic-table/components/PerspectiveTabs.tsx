import React, { useState } from 'react';
import { PaginationProps } from '../types/index';
import { PerspectiveConfig } from '../types/perspective';

interface PerspectiveTabsProps {
  savedPerspectives: PerspectiveConfig[];
  activePerspectiveId: string | null;
  onPerspectiveSelect: (id: string | null) => void;
  onPerspectiveRename: (id: string, newName: string) => void;
  onPerspectiveDelete: (id: string) => void;
  pagination?: PaginationProps;
  /** Custom content rendered at the start of the bottom bar (before tabs) */
  startContent?: React.ReactNode;
  /** Custom content rendered at the end of the bottom bar (after pagination) */
  endContent?: React.ReactNode;
  /** Toolbar to render in the bottom bar (between tabs and pagination) */
  toolbar?: React.ReactNode;
}

const PerspectiveTabs: React.FC<PerspectiveTabsProps> = ({
  savedPerspectives,
  activePerspectiveId,
  onPerspectiveSelect,
  onPerspectiveRename,
  onPerspectiveDelete,
  pagination,
  startContent,
  endContent,
  toolbar,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleDoubleClick = (perspective: PerspectiveConfig) => {
    setEditingId(perspective.id);
    setEditValue(perspective.name);
  };

  const handleRename = (id: string) => {
    if (editValue.trim()) {
      onPerspectiveRename(id, editValue.trim());
    }
    setEditingId(null);
  };

  // Get indicators for a perspective
  const getIndicators = (perspective: PerspectiveConfig) => {
    const indicators: string[] = [];
    if (perspective.columns.hidden.length > 0) {
      indicators.push(`${perspective.columns.hidden.length} hidden`);
    }
    if (perspective.filters.length > 0) {
      indicators.push(`${perspective.filters.length} filter${perspective.filters.length > 1 ? 's' : ''}`);
    }
    if (perspective.sorting.length > 0) {
      indicators.push(`${perspective.sorting.length} sort${perspective.sorting.length > 1 ? 's' : ''}`);
    }
    return indicators;
  };

  const defaultLimitOptions = [10, 25, 50, 100];
  const limitOptions = pagination?.limitOptions || defaultLimitOptions;

  return (
    <div className="filter-tabs perspective-tabs">
      {/* Custom slot: start content */}
      {startContent}

      <div className="filter-tabs-scroll">
        <button
          className={`filter-tab ${activePerspectiveId === null ? 'active' : ''}`}
          onClick={() => onPerspectiveSelect(null)}
        >
          All
        </button>

        {savedPerspectives.map(perspective => {
          const indicators = getIndicators(perspective);

          return (
            <div key={perspective.id} className="filter-tab-wrapper">
              {editingId === perspective.id ? (
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => handleRename(perspective.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename(perspective.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="filter-tab-input"
                  autoFocus
                />
              ) : (
                <>
                  <button
                    className={`filter-tab ${activePerspectiveId === perspective.id ? 'active' : ''}`}
                    data-color={perspective.color}
                    onClick={() => onPerspectiveSelect(perspective.id)}
                    onDoubleClick={() => handleDoubleClick(perspective)}
                    title={indicators.length > 0 ? indicators.join(', ') : undefined}
                  >
                    <span>{perspective.name}</span>
                  </button>
                  <button
                    className="filter-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPerspectiveDelete(perspective.id);
                    }}
                    title="Delete perspective"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Toolbar (positioned between tabs and pagination) */}
      {toolbar}

      {pagination && (
        <div className="pagination-container">
          <div className="pagination-limit">
            <span>Rows per page:</span>
            <select
              value={pagination.limit}
              onChange={(e) => pagination.onLimitChange(Number(e.target.value))}
              className="pagination-limit-select"
            >
              {limitOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="pagination-info">
            <span>
              Page {pagination.currentPage} of {pagination.totalPages}
            </span>
          </div>

          <div className="pagination-controls">
            <button
              className="pagination-btn"
              onClick={() => pagination.onPageChange(1)}
              disabled={pagination.currentPage <= 1}
              title="First page"
            >
              ««
            </button>
            <button
              className="pagination-btn"
              onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage <= 1}
              title="Previous page"
            >
              «
            </button>
            <button
              className="pagination-btn"
              onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage >= pagination.totalPages}
              title="Next page"
            >
              »
            </button>
            <button
              className="pagination-btn"
              onClick={() => pagination.onPageChange(pagination.totalPages)}
              disabled={pagination.currentPage >= pagination.totalPages}
              title="Last page"
            >
              »»
            </button>
          </div>
        </div>
      )}

      {/* Custom slot: end content */}
      {endContent}
    </div>
  );
};

export default PerspectiveTabs;
