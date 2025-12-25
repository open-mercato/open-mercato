import React, { useState } from 'react';
import { SavedFilter, PaginationProps } from '../types/index';

interface FilterTabsProps {
  savedFilters: SavedFilter[];
  activeFilterId: string | null;
  onFilterSelect: (id: string | null) => void;
  onFilterRename: (id: string, newName: string) => void;
  onFilterDelete: (id: string) => void;
  pagination?: PaginationProps;
}

const FilterTabs: React.FC<FilterTabsProps> = ({
  savedFilters,
  activeFilterId,
  onFilterSelect,
  onFilterRename,
  onFilterDelete,
  pagination,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleDoubleClick = (filter: SavedFilter) => {
    setEditingId(filter.id);
    setEditValue(filter.name);
  };

  const handleRename = (id: string) => {
    if (editValue.trim()) {
      onFilterRename(id, editValue.trim());
    }
    setEditingId(null);
  };

  const defaultLimitOptions = [10, 25, 50, 100];
  const limitOptions = pagination?.limitOptions || defaultLimitOptions;

  return (
    <div className="filter-tabs">
      <div className="filter-tabs-scroll">
        <button
          className={`filter-tab ${activeFilterId === null ? 'active' : ''}`}
          onClick={() => onFilterSelect(null)}
        >
          All
        </button>

        {savedFilters.map(filter => (
          <div key={filter.id} className="filter-tab-wrapper">
            {editingId === filter.id ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => handleRename(filter.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(filter.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="filter-tab-input"
                autoFocus
              />
            ) : (
              <>
                <button
                  className={`filter-tab ${activeFilterId === filter.id ? 'active' : ''}`}
                  onClick={() => onFilterSelect(filter.id)}
                  onDoubleClick={() => handleDoubleClick(filter)}
                >
                  {filter.name}
                </button>
                <button
                  className="filter-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterDelete(filter.id);
                  }}
                  title="Delete filter"
                >
                  ×
                </button>
              </>
            )}
          </div>
        ))}
      </div>

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
    </div>
  );
};

export default FilterTabs;
