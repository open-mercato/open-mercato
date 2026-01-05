"use client"

import * as React from 'react'
import { Check, ChevronDown, X, Search } from 'lucide-react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery } from '@tanstack/react-query'

type SearchableSelectProps<T = any> = {
    endpoint: string
    value?: string | null
    onChange: (value: string | null, item: T | null) => void
    labelKey?: keyof T | ((item: T) => string)
    valueKey?: keyof T
    searchParam?: string
    defaultLimit?: number
    placeholder?: string
    disabled?: boolean
    className?: string
    autoOpen?: boolean
}

export function SearchableSelect<T extends Record<string, any>>({
    endpoint,
    value,
    onChange,
    labelKey = 'name' as keyof T,
    valueKey = 'id' as keyof T,
    searchParam = 'search',
    defaultLimit = 100,
    placeholder = 'Select...',
    disabled = false,
    className = '',
    autoOpen = true
}: SearchableSelectProps<T>) {
    const [isOpen, setIsOpen] = React.useState(autoOpen)
    const [searchQuery, setSearchQuery] = React.useState('')
    const [debouncedSearch, setDebouncedSearch] = React.useState('')
    const containerRef = React.useRef<HTMLDivElement>(null)
    const searchInputRef = React.useRef<HTMLInputElement>(null)

    const getLabel = (item: T): string => {
        if (typeof labelKey === 'function') {
            return labelKey(item)
        }
        return String(item[labelKey] || '')
    }

    // Debounce search query
    React.useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery)
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    // Fetch options with React Query
    const { data, isLoading } = useQuery({
        queryKey: ['searchable-select', endpoint, debouncedSearch, defaultLimit],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (debouncedSearch) params.set(searchParam, debouncedSearch)
            params.set('limit', String(defaultLimit))

            const url = `${endpoint}?${params.toString()}`
            const result = await apiCall<{ items?: T[] }>(url)
            return result.result?.items || []
        },
        staleTime: 5 * 60 * 1000, // 5 minutes
        enabled: isOpen || !!value, // Fetch when opened or if there's a value to display
    })

    const options = data || []
    const selectedItem = React.useMemo(
        () => options.find((item) => String(item[valueKey]) === String(value)) || null,
        [options, value, valueKey]
    )

    // Click outside handler
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    // Focus search input when opened
    React.useEffect(() => {
        if (isOpen && searchInputRef.current) {
            searchInputRef.current.focus()
        }
    }, [isOpen])

    const handleSelect = (item: T) => {
        const newValue = String(item[valueKey])
        onChange(newValue, item)
        setIsOpen(false)
        setSearchQuery('')
    }

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation()
        onChange(null, null)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsOpen(false)
        }
    }

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className="w-full flex items-center justify-between gap-2 bg-white border border-gray-300 text-gray-900 px-2 py-0.5 rounded text-xs hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="truncate">
                    {selectedItem ? getLabel(selectedItem) : placeholder}
                </span>
                <div className="flex items-center gap-1">
                    {selectedItem && !disabled && (
                        <X
                            className="w-3 h-3 text-gray-400 hover:text-gray-600"
                            onClick={handleClear}
                        />
                    )}
                    <ChevronDown className="w-3 h-3 text-gray-400" />
                </div>
            </button>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded shadow-lg">
                    <div className="p-2 border-b border-gray-200">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Search..."
                                className="w-full pl-7 pr-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto">
                        {isLoading ? (
                            <div className="p-4 text-center text-xs text-gray-500">
                                Loading...
                            </div>
                        ) : options.length === 0 ? (
                            <div className="p-4 text-center text-xs text-gray-500">
                                No options found
                            </div>
                        ) : (
                            options.map((item) => {
                                const itemValue = String(item[valueKey])
                                const isSelected = itemValue === String(value)
                                return (
                                    <button
                                        key={itemValue}
                                        type="button"
                                        onClick={() => handleSelect(item)}
                                        className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left hover:bg-gray-100 ${isSelected ? 'bg-blue-50' : ''
                                            }`}
                                    >
                                        <span className="truncate">{getLabel(item)}</span>
                                        {isSelected && <Check className="w-3 h-3 text-blue-600" />}
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}