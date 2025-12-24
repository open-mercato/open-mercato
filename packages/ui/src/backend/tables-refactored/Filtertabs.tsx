import React, { useState } from 'react';
import { SavedFilter } from './filterTypes';

interface FilterTabsProps {
  savedFilters: SavedFilter[];
  activeFilterId: string | null;
  onFilterSelect: (id: string | null) => void;
  onFilterRename: (id: string, newName: string) => void;
  onFilterDelete: (id: string) => void;
}

const FilterTabs: React.FC<FilterTabsProps> = ({
  savedFilters,
  activeFilterId,
  onFilterSelect,
  onFilterRename,
  onFilterDelete,
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
    </div>
  );
};

export default FilterTabs;