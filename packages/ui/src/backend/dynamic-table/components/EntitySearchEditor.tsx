'use client'

import * as React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../../utils/api'

const POPUP_MAX_HEIGHT = 200

export type SearchResult = {
  entityId: string
  recordId: string
  presenter: {
    title: string
    subtitle?: string
    icon?: string
    badge?: string
  }
  fields?: Record<string, unknown>
}

export type EntitySearchEditorConfig = {
  entityType: string
  extractValue: (result: SearchResult) => string
  additionalFields?: (result: SearchResult) => Record<string, any>
  formatOption?: (result: SearchResult) => {
    primary: string
    secondary?: string
  }
  placeholder?: string
  transformInput?: (value: string) => string
  minQueryLength?: number
  debounceMs?: number
  noResultsText?: string
  searchingText?: string
  // Search API configuration
  searchUrl?: string
  searchStrategy?: string
  searchLimit?: number
}

type EntitySearchEditorProps = {
  config: EntitySearchEditorConfig
  value: any
  onChange: (newValue: any) => void
  onSave: (newValue?: any) => void
  onCancel: () => void
  rowData?: any
}

function calculatePopupPosition(cellRef: React.RefObject<HTMLElement | null>) {
  if (!cellRef.current) return { top: 0, left: 0, width: 0 }

  const rect = cellRef.current.getBoundingClientRect()
  const viewportHeight = window.innerHeight

  const spaceBelow = viewportHeight - rect.bottom
  const spaceAbove = rect.top

  let top: number
  if (spaceBelow >= POPUP_MAX_HEIGHT || spaceBelow >= spaceAbove) {
    top = rect.bottom + 2
  } else {
    top = rect.top - Math.min(POPUP_MAX_HEIGHT, spaceAbove) - 2
  }

  return {
    top,
    left: rect.left,
    width: Math.max(rect.width, 200),
  }
}

function defaultFormatOption(result: SearchResult): { primary: string; secondary?: string } {
  return {
    primary: result.presenter.title,
    secondary: result.presenter.subtitle,
  }
}

export function EntitySearchEditor({
  config,
  value,
  onChange,
  onSave,
  onCancel,
  rowData,
}: EntitySearchEditorProps) {
  const {
    entityType,
    extractValue,
    additionalFields,
    formatOption = defaultFormatOption,
    placeholder = 'Type to search...',
    transformInput,
    minQueryLength = 2,
    debounceMs = 300,
    noResultsText = 'No results found',
    searchingText = 'Searching...',
    searchUrl = '/api/search/search',
    searchStrategy = 'meilisearch',
    searchLimit = 20,
  } = config

  const [showDropdown, setShowDropdown] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })
  const [textValue, setTextValue] = useState(String(value ?? ''))
  const [results, setResults] = useState<SearchResult[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [hasUserTyped, setHasUserTyped] = useState(false)

  const cellRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isClickingDropdownRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Position cursor at end of text on mount
  useEffect(() => {
    setTimeout(() => {
      if (cellRef.current) {
        const length = cellRef.current.value?.length || 0
        cellRef.current.selectionStart = length
        cellRef.current.selectionEnd = length
      }
    }, 0)
  }, [])

  // Debounce search query
  useEffect(() => {
    if (!hasUserTyped) return
    const timer = setTimeout(() => {
      setDebouncedQuery(textValue)
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [textValue, hasUserTyped, debounceMs])

  // Fetch results from search API
  useEffect(() => {
    if (!hasUserTyped || debouncedQuery.length < minQueryLength) {
      setResults([])
      setShowDropdown(false)
      return
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    const controller = new AbortController()
    abortControllerRef.current = controller

    const fetchResults = async () => {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          q: debouncedQuery,
          strategies: searchStrategy,
          entityTypes: entityType,
          limit: String(searchLimit),
        })

        const response = await apiFetch(`${searchUrl}?${params.toString()}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('Search failed')
        }

        const data = await response.json()
        setResults(data.results || [])
        setShowDropdown(true)
        setHighlightedIndex(0)
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Entity search error:', error)
          setResults([])
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchResults()

    return () => controller.abort()
  }, [debouncedQuery, entityType, minQueryLength, searchUrl, searchStrategy, searchLimit])

  // Update position
  useEffect(() => {
    if (cellRef.current) {
      const pos = calculatePopupPosition(cellRef)
      setPosition(pos)
    }

    const updatePosition = () => {
      if (cellRef.current && showDropdown) {
        const pos = calculatePopupPosition(cellRef)
        setPosition(pos)
      }
    }

    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [showDropdown])

  // Click outside handling
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const isOutsideCell = cellRef.current && !cellRef.current.contains(e.target as Node)
      const isOutsideDropdown = !dropdownRef.current || !dropdownRef.current.contains(e.target as Node)

      if (isOutsideCell && isOutsideDropdown) {
        setShowDropdown(false)
        onSave(textValue)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onSave, textValue])

  const handleOptionClick = useCallback((result: SearchResult) => {
    // Set this immediately to prevent blur from interfering
    isClickingDropdownRef.current = true
    const selectedValue = extractValue(result)

    // Apply additional fields to rowData if configured
    if (additionalFields && rowData) {
      const extraFields = additionalFields(result)
      Object.assign(rowData, extraFields)
    }

    setTextValue(selectedValue)
    setShowDropdown(false)
    onChange(selectedValue)
    // Call onSave directly - setTimeout can fail if component unmounts
    onSave(selectedValue)
  }, [extractValue, additionalFields, rowData, onChange, onSave])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()

      if (showDropdown && results.length > 0) {
        const selected = results[highlightedIndex]
        handleOptionClick(selected)
      } else {
        setShowDropdown(false)
        onSave(textValue)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setShowDropdown(false)
      onCancel()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev =>
        prev < results.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0)
    } else if (e.key === 'Tab') {
      setShowDropdown(false)
      onSave(textValue)
    }
  }, [showDropdown, results, highlightedIndex, handleOptionClick, onSave, onCancel, textValue])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let val = e.target.value
    if (transformInput) {
      val = transformInput(val)
    }
    setTextValue(val)
    onChange(val)
    setHasUserTyped(true)
  }, [onChange, transformInput])

  return (
    <>
      <textarea
        ref={cellRef}
        value={textValue}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Only save if not clicking on dropdown
          if (!isClickingDropdownRef.current) {
            onSave(textValue)
          }
        }}
        autoFocus
        className="hot-cell-editor hot-dropdown-editor"
        placeholder={placeholder}
      />

      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          className="hot-editor-popup hot-dropdown-popup"
          style={{
            position: 'absolute',
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            maxHeight: `${POPUP_MAX_HEIGHT}px`,
            overflowY: 'auto',
            zIndex: 10000,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
          onMouseDown={() => {
            isClickingDropdownRef.current = true
          }}
          onMouseUp={() => {
            isClickingDropdownRef.current = false
          }}
        >
          {isLoading ? (
            <div className="hot-dropdown-option" style={{ color: '#888', padding: '8px 12px' }}>
              {searchingText}
            </div>
          ) : results.length === 0 ? (
            <div className="hot-dropdown-option" style={{ color: '#888', padding: '8px 12px' }}>
              {noResultsText}
            </div>
          ) : (
            results.map((result, index) => {
              const { primary, secondary } = formatOption(result)

              return (
                <div
                  key={result.recordId}
                  className={`hot-dropdown-option ${index === highlightedIndex ? 'highlighted' : ''}`}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    backgroundColor: index === highlightedIndex ? '#f0f0f0' : 'transparent',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleOptionClick(result)
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div style={{ fontWeight: 500 }}>{primary}</div>
                  {secondary && (
                    <div style={{ fontSize: '12px', color: '#666' }}>{secondary}</div>
                  )}
                </div>
              )
            })
          )}
        </div>,
        document.body
      )}
    </>
  )
}

// Factory function to create a DynamicTable-compatible editor
export type DynamicTableEditorFn = (
  value: any,
  onChange: (v: any) => void,
  onSave: (v?: any) => void,
  onCancel: () => void,
  rowData: any,
  col: any,
  rowIndex: number,
  colIndex: number
) => React.ReactNode

export function createEntitySearchEditor(
  config: EntitySearchEditorConfig
): DynamicTableEditorFn {
  return (value, onChange, onSave, onCancel, rowData) => (
    <EntitySearchEditor
      config={config}
      value={value}
      onChange={onChange}
      onSave={onSave}
      onCancel={onCancel}
      rowData={rowData}
    />
  )
}
