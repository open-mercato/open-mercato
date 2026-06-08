"use client"

import * as React from 'react'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { Input } from '../primitives/input'
import { InlineInput } from '../primitives/inline-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select'
import { Plus, Trash2, ChevronRight, ChevronDown, Code, LayoutList } from 'lucide-react'
import { useConfirmDialog } from './confirm-dialog'
import type { ConfirmDialogOptions } from './confirm-dialog'

function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(' ')
}

export type JsonBuilderProps = {
    value: any
    onChange: (value: any) => void
    disabled?: boolean
    error?: string
}

type JsonNodeType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

type ConfirmFn = (options?: ConfirmDialogOptions) => Promise<boolean>

function getJsonType(value: any): JsonNodeType {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    return typeof value as JsonNodeType
}

function defaultValueForType(type: JsonNodeType): any {
    switch (type) {
        case 'string': return ""
        case 'number': return 0
        case 'boolean': return false
        case 'object': return {}
        case 'array': return []
        case 'null': return null
    }
}

function toRawString(value: any): string {
    if (value === null || value === undefined) return '{}'
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
}

export function JsonBuilder({
    value,
    onChange,
    disabled,
    error
}: JsonBuilderProps) {
    const [mode, setMode] = React.useState<'raw' | 'builder'>('raw')
    const [rawString, setRawString] = React.useState(() => toRawString(value))
    const [rawDirty, setRawDirty] = React.useState(false)
    const [parseError, setParseError] = React.useState<string | null>(null)
    const { confirm, ConfirmDialogElement } = useConfirmDialog()

    React.useEffect(() => {
        if (value === null && !disabled) {
            onChange({})
        }
    }, [value, disabled, onChange])

    // Mirror external value changes (e.g. async record load, builder edits) into
    // the raw textarea only while the user has NOT started typing in it. Once the
    // textarea is dirty it becomes the source of truth, so re-deriving it from
    // `value` on every keystroke — the parent's onChange identity changes each
    // render — would clobber typing and make Raw JSON uneditable (issue #2817).
    React.useEffect(() => {
        if (rawDirty) return
        if (value !== null && typeof value === 'object') {
            setRawString(JSON.stringify(value, null, 2))
            setParseError(null)
        }
    }, [value, rawDirty])

    const handleRawChange = (str: string) => {
        setRawDirty(true)
        setRawString(str)
        try {
            if (str.trim() === '') {
                onChange({})
                setParseError(null)
            } else {
                const parsed = JSON.parse(str)
                onChange(parsed)
                setParseError(null)
            }
        } catch (e) {
            onChange(str)
            setParseError("Invalid JSON")
        }
    }

    const switchToRaw = () => {
        // Re-sync the textarea from the current value and let it mirror external
        // changes again until the user edits it.
        setRawDirty(false)
        setRawString(toRawString(value))
        setParseError(null)
        setMode('raw')
    }

    const switchToBuilder = () => {
        try {
            if (typeof value === 'string') {
                JSON.parse(value)
            }
            setMode('builder')
        } catch (e) {
            alert("Cannot switch to Builder mode: Invalid JSON")
        }
    }

    return (
        <div className="space-y-4 border rounded-md p-4 bg-card">
            <div className="flex items-center space-x-2 border-b pb-2 mb-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(mode === 'raw' && "bg-muted text-foreground")}
                    onClick={switchToRaw}
                >
                    <Code className="w-4 h-4" />
                    Raw JSON
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(mode === 'builder' && "bg-muted text-foreground")}
                    onClick={switchToBuilder}
                >
                    <LayoutList className="w-4 h-4" />
                    Builder
                </Button>
            </div>

            {mode === 'raw' ? (
                <div className="space-y-2">
                    <textarea
                        value={rawString}
                        onChange={(e) => handleRawChange(e.target.value)}
                        onBlur={() => {
                            try {
                                const parsed = JSON.parse(rawString)
                                setRawString(JSON.stringify(parsed, null, 2))
                            } catch { }
                        }}
                        placeholder='{"key": "value"}'
                        className="w-full rounded border px-3 py-2 min-h-[300px] text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={disabled}
                    />
                    {parseError && (
                        <div className="text-xs text-red-600">Invalid JSON format</div>
                    )}
                </div>
            ) : (
                <div className="min-h-[300px] text-sm overflow-x-auto">
                    {typeof value === 'object' && value !== null ? (
                        <JsonNode
                            data={value}
                            onChange={onChange}
                            readOnly={disabled}
                            confirm={confirm}
                            isRoot
                        />
                    ) : (
                        <div className="text-muted-foreground italic p-4 text-center">
                            Value is not an object or array. Switch to Raw to edit.
                        </div>
                    )}
                </div>
            )}

            {error && <div className="text-xs text-red-600">{error}</div>}
            {ConfirmDialogElement}
        </div>
    )
}

interface JsonNodeProps {
    data: any
    onChange: (val: any) => void
    onDelete?: () => void
    readOnly?: boolean
    label?: string
    isRoot?: boolean
    confirm?: ConfirmFn
}

function JsonNode({ data, onChange, onDelete, readOnly, label, isRoot, confirm }: JsonNodeProps) {
    const type = getJsonType(data)
    const isContainer = type === 'object' || type === 'array'
    const [collapsed, setCollapsed] = React.useState(false)

    const handleTypeChange = async (newType: JsonNodeType) => {
        if (newType === type) return
        // Switching away from a non-empty container discards its contents. Ask
        // for confirmation first so configured properties aren't lost silently
        // (issue #2817). The Select is controlled by the derived type, so when
        // the user cancels we simply leave the data untouched and the control
        // snaps back to its previous value.
        const itemCount = type === 'object'
            ? Object.keys(data).length
            : type === 'array'
                ? (data as any[]).length
                : 0
        if (itemCount > 0 && confirm) {
            const noun = type === 'object'
                ? `${itemCount} ${itemCount === 1 ? 'property' : 'properties'}`
                : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
            const confirmed = await confirm({
                title: 'Change value type?',
                text: `Changing the type from ${type} to ${newType} will discard the ${noun} currently configured. This cannot be undone.`,
                confirmText: 'Discard and change',
                variant: 'destructive',
            })
            if (!confirmed) return
        }
        onChange(defaultValueForType(newType))
    }

    const handleAddKey = () => {
        if (type === 'object') {
            const newKey = `newKey_${Object.keys(data).length}`
            onChange({ ...data, [newKey]: "" })
        } else if (type === 'array') {
            onChange([...data, ""])
        }
    }

    const handleChildChange = (key: string | number, newVal: any) => {
        if (type === 'object') {
            onChange({ ...data, [key]: newVal })
        } else if (type === 'array') {
            const arr = [...data]
            arr[Number(key)] = newVal
            onChange(arr)
        }
    }

    const handleKeyRename = (oldKey: string, newKey: string) => {
        if (oldKey === newKey) return
        const keys = Object.keys(data)
        const newData: any = {}
        keys.forEach(k => {
            if (k === oldKey) {
                newData[newKey] = data[k]
            } else {
                newData[k] = data[k]
            }
        })
        onChange(newData)
    }

    const handleChildDelete = (key: string | number) => {
        if (type === 'object') {
            const newData = { ...data }
            delete newData[key as string]
            onChange(newData)
        } else if (type === 'array') {
            onChange(data.filter((_: any, i: number) => i !== key))
        }
    }

    return (
        <div className={cn("pl-0", !isRoot && "pl-4 border-l border-border ml-1")}>
            <div className="flex items-start gap-2 py-1 group">

                {isContainer && (
                    <IconButton type="button" variant="ghost" size="xs" className="mt-1 text-muted-foreground hover:text-foreground" onClick={() => setCollapsed(!collapsed)}>
                        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </IconButton>
                )}
                {!isContainer && !isRoot && <div className="w-3" />} {/* Spacer */}

                {label !== undefined && !isRoot && (
                    <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground font-mono">
                            {label}
                        </span>
                        <span className="text-muted-foreground text-xs">:</span>
                    </div>
                )}

                <div className="flex-1 flex gap-2 items-center flex-wrap">

                    {!readOnly && (
                        <Select
                            value={type}
                            onValueChange={(next) => { void handleTypeChange(next as JsonNodeType) }}
                        >
                            <SelectTrigger size="sm" className="w-auto min-w-[6rem]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="string">String</SelectItem>
                                <SelectItem value="number">Number</SelectItem>
                                <SelectItem value="boolean">Boolean</SelectItem>
                                <SelectItem value="object">Object</SelectItem>
                                <SelectItem value="array">Array</SelectItem>
                                <SelectItem value="null">Null</SelectItem>
                            </SelectContent>
                        </Select>
                    )}

                    {type === 'string' && (
                        <Input
                            size="sm"
                            className="flex-1 min-w-0 sm:min-w-[120px]"
                            value={data}
                            onChange={e => onChange(e.target.value)}
                            disabled={readOnly}
                        />
                    )}
                    {type === 'number' && (
                        <Input
                            type="number"
                            size="sm"
                            className="flex-1 w-full sm:w-[100px]"
                            value={data}
                            onChange={e => onChange(parseFloat(e.target.value) || 0)}
                            disabled={readOnly}
                        />
                    )}
                    {type === 'boolean' && (
                        <Select
                            value={String(data)}
                            onValueChange={(next) => onChange(next === 'true')}
                            disabled={readOnly}
                        >
                            <SelectTrigger size="sm" className="flex-1 w-full sm:w-[100px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="true">true</SelectItem>
                                <SelectItem value="false">false</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                    {type === 'null' && <span className="text-xs text-muted-foreground">null</span>}
                    {isContainer && (
                        <span className="text-xs text-muted-foreground">
                            {type === 'object' ? `{ ${Object.keys(data).length} items }` : `[ ${data.length} items ]`}
                        </span>
                    )}

                    {onDelete && !readOnly && (
                        <IconButton
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove item"
                            onClick={onDelete}
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </IconButton>
                    )}
                </div>
            </div>

            {isContainer && !collapsed && (
                <div className="flex flex-col gap-1 w-full pl-2">
                    {type === 'object' && Object.entries(data).map(([key, val], idx) => (
                        <div key={idx} className="flex">
                            <div className="pt-2">
                                {/* Key Renamer */}
                                <InlineInput
                                    className="w-full sm:w-[100px]"
                                    inputClassName="text-right text-xs font-mono pr-1"
                                    value={key}
                                    onChange={(e) => handleKeyRename(key, e.target.value)}
                                    disabled={readOnly}
                                />
                            </div>
                            <div className="flex-1">
                                <JsonNode
                                    data={val}
                                    onChange={(v) => handleChildChange(key, v)}
                                    onDelete={() => handleChildDelete(key)}
                                    readOnly={readOnly}
                                    confirm={confirm}
                                />
                            </div>
                        </div>
                    ))}

                    {type === 'array' && (data as any[]).map((val, idx) => (
                        <JsonNode
                            key={idx}
                            label={String(idx)}
                            data={val}
                            onChange={(v) => handleChildChange(idx, v)}
                            onDelete={() => handleChildDelete(idx)}
                            readOnly={readOnly}
                            confirm={confirm}
                        />
                    ))}

                    {!readOnly && (
                        <div className="pl-4 mt-1">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleAddKey}
                                className="h-6 text-xs"
                            >
                                <Plus className="w-3 h-3 mr-1" />
                                Add {type === 'object' ? 'Property' : 'Item'}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
