import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ColumnDef, FilterRow, FilterColor } from '../types/index';
import { SortRule, PerspectiveConfig, generatePerspectiveId } from '../types/perspective';
import ColumnsPopover from './ColumnsPopover';
import FilterPopover from './FilterPopover';
import SortPopover from './SortPopover';

// Color palette for perspectives
const COLOR_PALETTE: { color: FilterColor; bg: string; border: string }[] = [
  { color: 'blue', bg: '#dbeafe', border: '#93c5fd' },
  { color: 'green', bg: '#dcfce7', border: '#86efac' },
  { color: 'teal', bg: '#ccfbf1', border: '#5eead4' },
  { color: 'purple', bg: '#f3e8ff', border: '#d8b4fe' },
  { color: 'pink', bg: '#fce7f3', border: '#f9a8d4' },
  { color: 'red', bg: '#fee2e2', border: '#fca5a5' },
  { color: 'orange', bg: '#ffedd5', border: '#fdba74' },
  { color: 'yellow', bg: '#fef9c3', border: '#fde047' },
];

interface PerspectiveToolbarProps {
  columns: ColumnDef[];
  visibleColumns: string[];
  hiddenColumns: string[];
  filters: FilterRow[];
  sortRules: SortRule[];
  onColumnVisibilityChange: (visible: string[], hidden: string[]) => void;
  onColumnOrderChange: (newOrder: string[]) => void;
  onFiltersChange: (filters: FilterRow[]) => void;
  onSortRulesChange: (rules: SortRule[]) => void;
  onSavePerspective: (perspective: PerspectiveConfig) => void;
}

type OpenPopover = 'columns' | 'filter' | 'sort' | 'save' | null;

const PerspectiveToolbar: React.FC<PerspectiveToolbarProps> = ({
  columns,
  visibleColumns,
  hiddenColumns,
  filters,
  sortRules,
  onColumnVisibilityChange,
  onColumnOrderChange,
  onFiltersChange,
  onSortRulesChange,
  onSavePerspective,
}) => {
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [saveName, setSaveName] = useState('');
  const [saveColor, setSaveColor] = useState<FilterColor>('blue');

  const columnsButtonRef = useRef<HTMLButtonElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const savePopoverRef = useRef<HTMLDivElement>(null);

  // Close save popover on outside click
  useEffect(() => {
    if (openPopover !== 'save') return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        savePopoverRef.current &&
        !savePopoverRef.current.contains(e.target as Node) &&
        saveButtonRef.current &&
        !saveButtonRef.current.contains(e.target as Node)
      ) {
        setOpenPopover(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openPopover]);

  // Position save popover
  useEffect(() => {
    if (openPopover !== 'save' || !saveButtonRef.current || !savePopoverRef.current) return;

    const anchor = saveButtonRef.current.getBoundingClientRect();
    const popover = savePopoverRef.current;

    popover.style.top = `${anchor.bottom + 4}px`;
    popover.style.right = `${window.innerWidth - anchor.right}px`;
  }, [openPopover]);

  const togglePopover = useCallback((popover: OpenPopover) => {
    setOpenPopover(prev => prev === popover ? null : popover);
  }, []);

  const handleSave = useCallback(() => {
    if (saveName.trim()) {
      const perspective: PerspectiveConfig = {
        id: generatePerspectiveId(),
        name: saveName.trim(),
        color: saveColor,
        columns: {
          visible: visibleColumns,
          hidden: hiddenColumns,
        },
        filters: filters,
        sorting: sortRules,
      };
      onSavePerspective(perspective);
      setSaveName('');
      setOpenPopover(null);
    }
  }, [saveName, saveColor, visibleColumns, hiddenColumns, filters, sortRules, onSavePerspective]);

  // Count active settings
  const hiddenCount = hiddenColumns.length;
  const filterCount = filters.length;
  const sortCount = sortRules.length;
  const hasChanges = hiddenCount > 0 || filterCount > 0 || sortCount > 0;

  return (
    <div className="perspective-toolbar" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      {/* Columns Button */}
      <button
        ref={columnsButtonRef}
        onClick={() => togglePopover('columns')}
        className={`perspective-btn ${openPopover === 'columns' ? 'active' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: openPopover === 'columns' ? '#f3f4f6' : 'white',
          color: hiddenCount > 0 ? '#3b82f6' : '#374151',
          fontSize: 13,
          cursor: 'pointer',
          fontWeight: hiddenCount > 0 ? 500 : 400,
        }}
      >
        Columns
        {hiddenCount > 0 && (
          <span style={{
            background: '#dbeafe',
            color: '#1d4ed8',
            padding: '1px 6px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 500,
          }}>
            {hiddenCount} hidden
          </span>
        )}
      </button>

      {/* Filter Button */}
      <button
        ref={filterButtonRef}
        onClick={() => togglePopover('filter')}
        className={`perspective-btn ${openPopover === 'filter' ? 'active' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: openPopover === 'filter' ? '#f3f4f6' : 'white',
          color: filterCount > 0 ? '#3b82f6' : '#374151',
          fontSize: 13,
          cursor: 'pointer',
          fontWeight: filterCount > 0 ? 500 : 400,
        }}
      >
        Filter
        {filterCount > 0 && (
          <span style={{
            background: '#dbeafe',
            color: '#1d4ed8',
            padding: '1px 6px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 500,
          }}>
            {filterCount}
          </span>
        )}
      </button>

      {/* Sort Button */}
      <button
        ref={sortButtonRef}
        onClick={() => togglePopover('sort')}
        className={`perspective-btn ${openPopover === 'sort' ? 'active' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: openPopover === 'sort' ? '#f3f4f6' : 'white',
          color: sortCount > 0 ? '#3b82f6' : '#374151',
          fontSize: 13,
          cursor: 'pointer',
          fontWeight: sortCount > 0 ? 500 : 400,
        }}
      >
        Sort
        {sortCount > 0 && (
          <span style={{
            background: '#dbeafe',
            color: '#1d4ed8',
            padding: '1px 6px',
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 500,
          }}>
            {sortCount}
          </span>
        )}
      </button>

      {/* Save Button */}
      {hasChanges && (
        <button
          ref={saveButtonRef}
          onClick={() => togglePopover('save')}
          className={`perspective-btn save-btn ${openPopover === 'save' ? 'active' : ''}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            border: '1px solid #3b82f6',
            borderRadius: 6,
            background: '#3b82f6',
            color: 'white',
            fontSize: 13,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Save Perspective
        </button>
      )}

      {/* Columns Popover */}
      <ColumnsPopover
        columns={columns}
        visibleColumns={visibleColumns}
        hiddenColumns={hiddenColumns}
        onColumnVisibilityChange={onColumnVisibilityChange}
        onColumnOrderChange={onColumnOrderChange}
        isOpen={openPopover === 'columns'}
        onClose={() => setOpenPopover(null)}
        anchorRef={columnsButtonRef}
      />

      {/* Filter Popover */}
      <FilterPopover
        columns={columns}
        filters={filters}
        onFiltersChange={onFiltersChange}
        isOpen={openPopover === 'filter'}
        onClose={() => setOpenPopover(null)}
        anchorRef={filterButtonRef}
      />

      {/* Sort Popover */}
      <SortPopover
        columns={columns}
        sortRules={sortRules}
        onSortRulesChange={onSortRulesChange}
        isOpen={openPopover === 'sort'}
        onClose={() => setOpenPopover(null)}
        anchorRef={sortButtonRef}
      />

      {/* Save Popover */}
      {openPopover === 'save' && (
        <div
          ref={savePopoverRef}
          className="perspective-popover save-popover"
          style={{
            position: 'fixed',
            zIndex: 10000,
            background: 'white',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
            border: '1px solid #e5e7eb',
            width: 280,
            padding: 12,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              Perspective name
            </label>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Enter name..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSave();
                }
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
              Color
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {COLOR_PALETTE.map((item) => (
                <button
                  key={item.color}
                  onClick={() => setSaveColor(item.color)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: saveColor === item.color ? `2px solid ${item.border}` : '2px solid transparent',
                    background: item.bg,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title={item.color}
                />
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!saveName.trim()}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              borderRadius: 6,
              background: saveName.trim() ? '#3b82f6' : '#e5e7eb',
              color: saveName.trim() ? 'white' : '#9ca3af',
              fontSize: 13,
              fontWeight: 500,
              cursor: saveName.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
};

export default PerspectiveToolbar;
