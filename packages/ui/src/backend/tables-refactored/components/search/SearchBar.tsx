import React, { useState, useCallback, useRef, useEffect } from 'react';
import { dispatch } from '../../events/events';
import { TableEvents, SearchEvent } from '../../events/types';
import './SearchBar.css';

interface SearchBarProps {
  tableRef: React.RefObject<HTMLElement>;
  placeholder?: string;
  debounceMs?: number;
}

const SearchBar: React.FC<SearchBarProps> = ({
  tableRef,
  placeholder = 'Search a product',
  debounceMs = 300,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);


  const dispatchSearchEvent = useCallback((value: string) => {
    if (tableRef.current) {
      dispatch<SearchEvent>(
        tableRef.current,
        TableEvents.SEARCH,
        {
          query: value,
          timestamp: Date.now(),
        }
      );
    }
  }, [tableRef]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);

    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      dispatchSearchEvent(value);
    }, debounceMs);
  }, [dispatchSearchEvent, debounceMs]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Clear debounce and dispatch immediately
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      dispatchSearchEvent(searchValue);
    } else if (e.key === 'Escape') {
      // Clear the search on Escape key
      setSearchValue('');
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      dispatchSearchEvent('');
      // Keep focus on input after clearing
      inputRef.current?.focus();
    }
  }, [searchValue, dispatchSearchEvent]);

  const handleClear = useCallback(() => {
    setSearchValue('');
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    dispatchSearchEvent('');
  }, [dispatchSearchEvent]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="search-bar">
      <div className="search-input-wrapper">
        <svg
          className="search-icon"
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"

        >
          <path
            d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <input
          type="text"
          value={searchValue}
          onChange={handleSearchChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="search-input"
          ref={inputRef}
        />
        {searchValue && (
          <button
            onClick={handleClear}
            className="search-clear-btn"
            aria-label="Clear search"
            type="button"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchBar;