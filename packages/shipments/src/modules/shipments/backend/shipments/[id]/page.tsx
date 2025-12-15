'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ChevronDown, ChevronRight, Package, ContainerIcon, Truck, FolderOpen, CheckCheck } from 'lucide-react'
import { SearchableSelect } from '../../../components/SearchableSelect'
import { ShipmentContainers } from '../../../components/ShipmentContainers'
import { ShipmentDocuments } from '../../../components/ShipmentDocuments'
import { ShipmentTasks } from '../../../components/ShipmentTasks'

const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
        'ORDERED': 'bg-gray-100 text-gray-800',
        'BOOKED': 'bg-blue-100 text-blue-800',
        'LOADING': 'bg-yellow-100 text-yellow-800',
        'DEPARTED': 'bg-purple-100 text-purple-800',
        'TRANSSHIPMENT': 'bg-orange-100 text-orange-800',
        'PRE_ARRIVAL': 'bg-indigo-100 text-indigo-800',
        'IN_PORT': 'bg-cyan-100 text-cyan-800',
        'DELIVERED': 'bg-green-100 text-green-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
}

const getModeColor = (mode: string) => {
    const colors: Record<string, string> = {
        'AIR': 'bg-sky-100 text-sky-800',
        'RAIL': 'bg-amber-100 text-amber-800',
        'SEA': 'bg-blue-100 text-blue-800',
        'MIXED': 'bg-violet-100 text-violet-800'
    }
    return colors[mode] || 'bg-gray-100 text-gray-800'
}



type FieldType = 'text' | 'textarea' | 'select' | 'datetime-local' | 'number' | 'searchable-select'

type SearchableConfig = {
    endpoint: string
    labelKey?: string | ((item: any) => string)
    valueKey?: string
    searchParam?: string
    defaultLimit?: number
}

const Field = ({
    label,
    value,
    displayValue,
    field,
    type = 'text',
    options,
    onSave,
    small = false,
    searchableConfig
}: {
    label: string
    value?: any
    displayValue?: string
    field?: string
    type?: FieldType
    options?: { value: string; label: string }[]
    onSave: (field: string, value: any) => Promise<void>
    small?: boolean
    searchableConfig?: SearchableConfig
}) => {
    const [editing, setEditing] = useState(false)
    const [tempValue, setTempValue] = useState(value || '')

    useEffect(() => {
        setTempValue(value || '')
    }, [value])

    const handleSave = async () => {
        if (field) {
            await onSave(field, tempValue)
        }
        setEditing(false)
    }

    const handleCancel = () => {
        setTempValue(value || '')
        setEditing(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && type !== 'textarea') {
            handleSave()
        } else if (e.key === 'Escape') {
            handleCancel()
        }
    }

    const isEmpty = !value || value === ''
    const isStatus = field === 'status'
    const isMode = field === 'mode'

    return (
        <div className={`flex justify-start gap-4 items-center ${small ? 'py-1' : 'py-2'} border-b border-gray-100`}>
            <span className="text-gray-600 text-xs font-bold">{label}</span>
            {editing && field ? (
                <div className="flex items-center gap-2">
                    {type === 'searchable-select' && searchableConfig ? (
                        <div className="flex items-center gap-2">
                            <SearchableSelect
                                endpoint={searchableConfig.endpoint}
                                value={tempValue}
                                onChange={async (val) => {
                                    setTempValue(val || '')
                                    if (field) {
                                        await onSave(field, val)
                                    }
                                    setEditing(false)
                                }}
                                labelKey={searchableConfig.labelKey}
                                valueKey={searchableConfig.valueKey}
                                searchParam={searchableConfig.searchParam}
                                defaultLimit={searchableConfig.defaultLimit}
                                className="min-w-[200px]"
                            />
                            <button
                                onClick={handleSave}
                                className="text-green-600 hover:text-green-800 text-xs"
                            >
                                ✓
                            </button>
                            <button
                                onClick={handleCancel}
                                className="text-red-600 hover:text-red-800 text-xs"
                            >
                                ✕
                            </button>
                        </div>
                    ) : type === 'select' ? (
                        <>
                            <select
                                value={tempValue}
                                onChange={(e) => setTempValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                className="bg-white border border-gray-300 text-gray-900 px-2 py-0.5 rounded text-xs"
                            >
                                {options?.map((opt: any) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            <button
                                onClick={handleSave}
                                className="text-green-600 hover:text-green-800 text-xs"
                            >
                                ✓
                            </button>
                            <button
                                onClick={handleCancel}
                                className="text-red-600 hover:text-red-800 text-xs"
                            >
                                ✕
                            </button>
                        </>
                    ) : type === 'datetime-local' ? (
                        <>
                            <input
                                type="datetime-local"
                                value={tempValue}
                                onChange={(e) => setTempValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                className="bg-white border border-gray-300 text-gray-900 px-2 py-0.5 rounded text-xs"
                            />
                            <button
                                onClick={handleSave}
                                className="text-green-600 hover:text-green-800 text-xs"
                            >
                                ✓
                            </button>
                            <button
                                onClick={handleCancel}
                                className="text-red-600 hover:text-red-800 text-xs"
                            >
                                ✕
                            </button>
                        </>
                    ) : (
                        <>
                            <input
                                type={type}
                                value={tempValue}
                                onChange={(e) => setTempValue(type === 'number' ? Number(e.target.value) : e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                className="bg-white border border-gray-300 text-gray-900 px-2 py-0.5 rounded text-xs"
                            />
                            <button
                                onClick={handleSave}
                                className="text-green-600 hover:text-green-800 text-xs"
                            >
                                ✓
                            </button>
                            <button
                                onClick={handleCancel}
                                className="text-red-600 hover:text-red-800 text-xs"
                            >
                                ✕
                            </button>
                        </>
                    )}
                </div>
            ) : isEmpty && field ? (
                <button
                    onClick={() => setEditing(true)}
                    className="text-gray-400 text-xs border border-dashed border-gray-300 px-2 py-0.5 rounded hover:border-gray-400"
                >
                    + {label}
                </button>
            ) : (
                <span
                    onClick={() => field && setEditing(true)}
                    className={`text-xs ${isStatus
                        ? `${getStatusColor(value)} px-2 py-1 rounded-full font-medium ${field ? 'cursor-pointer' : ''}`
                        : isMode
                            ? `${getModeColor(value)} px-2 py-1 rounded-full font-medium ${field ? 'cursor-pointer' : ''}`
                            : `text-gray-900 ${field ? 'cursor-pointer hover:bg-gray-50 px-2 py-0.5 rounded' : ''}`
                        }`}
                >
                    {displayValue || `${value}`.replace(/_/g, ' ') || '-'}
                </span>
            )}
        </div>
    )
}

const CollapsibleSection = ({ title, children, defaultOpen = true, icon: Icon }: any) => {
    const [isOpen, setIsOpen] = useState(defaultOpen)

    return (
        <div className="bg-white border border-gray-200 rounded mb-3">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
            >
                <div className="flex items-center gap-2">
                    {Icon && <Icon className="w-4 h-4 text-gray-600" />}
                    <h2 className="text-xs uppercase text-gray-700 font-semibold">{title}</h2>
                </div>
                {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
            </button>
            {isOpen && <div className="px-3 pb-3">{children}</div>}
        </div>
    )
}

export default function ShipmentDetail() {
    const params = useParams<{ id: string; slug: [] }>()
    const router = useRouter()
    const shipmentId = !params?.id && Array.isArray(params?.slug) ? params.slug[params.slug.length - 1] : params?.id
    const isCreateMode = shipmentId === 'create'

    const [shipment, setShipment] = useState<any>({
        status: 'BOOKED'
    })
    const [currentId, setCurrentId] = useState<string | null>(isCreateMode ? null : shipmentId)
    const [loading, setLoading] = useState(!isCreateMode)

    useEffect(() => {
        if (!isCreateMode && shipmentId) {
            loadShipment()
        } else if (isCreateMode) {
            setLoading(false)
        }
    }, [shipmentId])

    const loadShipment = async () => {
        const result = await apiCall(`/api/shipments/${shipmentId}`) as any
        setShipment(result.result)
        setLoading(false)
    }

    const handleFieldSave = async (field: string, value: any) => {
        if (!currentId) {
            const payload = {
                [field]: value,
                status: 'BOOKED'
            }
            const result = await apiCall('/api/shipments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload as any
            }) as any

            const newId = result.result.id
            setCurrentId(newId)
            setShipment(result.result)
            router.replace(`/backend/shipments/${newId}`)
        } else {
            const response = await apiCall(`/api/shipments/${currentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: value })
            })

            setShipment({ ...shipment, ...(response.result ?? {}) })
        }
    }

    const formatDate = (date?: string) => {
        if (!date) return ''
        const d = new Date(date)
        return d.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric'
        })
    }

    if (loading) return <div className="p-6">Loading...</div>

    return (
        <div className="bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-orange-500 rounded p-2">
                        <Package className="w-5 h-5 text-white" />
                    </div>
                    <h1 className="text-lg font-semibold text-gray-900">
                        {shipment?.internalReference || 'New Shipment'}
                    </h1>
                </div>
                <button
                    onClick={() => router.push('/backend/shipments')}
                    className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1 border border-gray-300 rounded"
                >
                    ← Back
                </button>
            </div>

            {/* Main Content */}
            <div className="p-4 max-w-full mx-auto">
                {/* Business Card Section */}
                <CollapsibleSection title="Details" defaultOpen={true} icon={Package}>
                    <div className="grid grid-cols-2 gap-6">
                        {/* Left Column - References & Route */}
                        <div>
                            <Field
                                label="Internal Reference"
                                value={shipment?.internalReference}
                                field="internalReference"
                                onSave={handleFieldSave}
                                small
                            />
                            <Field
                                label="Client Reference"
                                value={shipment?.clientReference}
                                field="clientReference"
                                onSave={handleFieldSave}
                                small
                            />
                            <Field
                                label="Booking Number"
                                value={shipment?.bookingNumber}
                                field="bookingNumber"
                                onSave={handleFieldSave}
                                small
                            />

                            <div className="mt-3 pt-3 border-t border-gray-200">
                                <div className="grid grid-cols-3 gap-2 mb-2">
                                    <Field
                                        label="Origin"
                                        value={shipment?.originLocation}
                                        field="originLocation"
                                        type="searchable-select"
                                        displayValue={shipment?.originLocation}
                                        searchableConfig={{
                                            endpoint: '/api/shipments/dictionaries/sea_ports',
                                            labelKey: 'label',
                                            valueKey: 'value',
                                            defaultLimit: 50
                                        }}
                                        onSave={handleFieldSave}
                                        small
                                    />
                                    <Field
                                        label="ETD"
                                        value={formatDate(shipment?.etd)}
                                        field="etd"
                                        type="datetime-local"
                                        onSave={(field: string, value: string) =>
                                            handleFieldSave(field, value ? new Date(value).toISOString() : null)
                                        }
                                        small
                                    />
                                    <Field
                                        label="ATD"
                                        value={formatDate(shipment?.atd)}
                                        field="atd"
                                        type="datetime-local"
                                        onSave={(field: string, value: string) =>
                                            handleFieldSave(field, value ? new Date(value).toISOString() : null)
                                        }
                                        small
                                    />
                                </div>
                                <div className="grid grid-cols-3 gap-2">

                                    <Field
                                        label="Destination"
                                        value={shipment?.destinationLocation}
                                        field="destinationLocation"
                                        type="searchable-select"
                                        displayValue={shipment?.destinationLocation}
                                        searchableConfig={{
                                            endpoint: '/api/shipments/dictionaries/sea_ports',
                                            labelKey: 'label',
                                            valueKey: 'value',
                                            defaultLimit: 50
                                        }}
                                        onSave={handleFieldSave}
                                        small
                                    />
                                    <Field
                                        label="ETA"
                                        value={formatDate(shipment?.eta)}
                                        field="eta"
                                        type="datetime-local"
                                        onSave={(field: string, value: string) =>
                                            handleFieldSave(field, value ? new Date(value).toISOString() : null)
                                        }
                                        small
                                    />
                                    <Field
                                        label="ATA"
                                        value={formatDate(shipment?.ata)}
                                        field="ata"
                                        type="datetime-local"
                                        onSave={(field: string, value: string) =>
                                            handleFieldSave(field, value ? new Date(value).toISOString() : null)
                                        }
                                        small
                                    />
                                </div>
                            </div>
                            {/* Middle Column - Status & Parties */}
                            <div>
                                <Field
                                    label="Status"
                                    value={shipment?.status}
                                    field="status"
                                    type="select"
                                    options={[
                                        { value: 'ORDERED', label: 'Ordered' },
                                        { value: 'BOOKED', label: 'Booked' },
                                        { value: 'LOADING', label: 'Loading' },
                                        { value: 'DEPARTED', label: 'Departed' },
                                        { value: 'TRANSSHIPMENT', label: 'Transshipment' },
                                        { value: 'PRE_ARRIVAL', label: 'Pre-Arrival' },
                                        { value: 'IN_PORT', label: 'In Port' },
                                        { value: 'DELIVERED', label: 'Delivered' }
                                    ]}
                                    onSave={handleFieldSave}
                                    small
                                />
                                <Field
                                    label="Carrier"
                                    value={shipment?.carrier?.id || shipment?.carrier}
                                    displayValue={shipment?.carrier?.label || shipment?.carrier?.name || shipment?.carrier}
                                    field="carrier"
                                    type="searchable-select"
                                    searchableConfig={{
                                        endpoint: '/api/shipments/dictionaries/sea_carriers',
                                        labelKey: 'label',
                                        valueKey: 'value',
                                        defaultLimit: 50
                                    }}
                                    onSave={handleFieldSave}
                                    small
                                />
                                <Field
                                    label="Shipper"
                                    value={shipment?.shipper?.primaryEmail ?? shipment?.shipper?.displayName}
                                    field="shipperId"
                                    type="searchable-select"
                                    displayValue={shipment?.shipper?.primaryEmail ?? shipment?.shipper?.displayName}
                                    searchableConfig={{
                                        endpoint: '/api/shipments/entities/person',
                                        labelKey: 'displayName',
                                        valueKey: 'id',
                                        defaultLimit: 50
                                    }}
                                    onSave={handleFieldSave}
                                    small
                                />
                                <Field
                                    label="Consignee"
                                    value={shipment?.consignee?.primaryEmail ?? shipment?.consignee?.displayName}
                                    field="consigneeId"
                                    type="searchable-select"
                                    displayValue={shipment?.consignee?.primaryEmail ?? shipment?.consignee?.displayName}
                                    searchableConfig={{
                                        endpoint: '/api/shipments/entities/person',
                                        labelKey: 'displayName',
                                        valueKey: 'id',
                                        defaultLimit: 50
                                    }}
                                    onSave={handleFieldSave}
                                    small
                                />
                            </div>
                        </div>



                        {/* Right Column - Company & Weights */}
                        <div className="border-l border-gray-200 pl-6">
                            <Field
                                label="Mode"
                                value={shipment?.mode}
                                field="mode"
                                type="select"
                                options={[
                                    { value: '', label: 'Select...' },
                                    { value: 'AIR', label: 'Air' },
                                    { value: 'RAIL', label: 'Rail' },
                                    { value: 'SEA', label: 'Sea' },
                                    { value: 'MIXED', label: 'Mixed' }
                                ]}
                                onSave={handleFieldSave}
                                small
                            />
                            <Field
                                label="Client"
                                value={shipment?.client?.displayName}
                                field="clientId"
                                type="searchable-select"
                                displayValue={shipment?.client?.name}
                                searchableConfig={{
                                    endpoint: '/api/shipments/entities/company',
                                    labelKey: 'displayName',
                                    valueKey: 'id',
                                    defaultLimit: 50
                                }}
                                onSave={handleFieldSave}
                                small
                            />
                            <Field
                                label="Contact Person"
                                value={shipment?.contactPerson?.primaryEmail ?? shipment?.contactPerson?.displayName}
                                field="contactPersonId"
                                type="searchable-select"
                                displayValue={shipment?.contactPerson?.primaryEmail ?? shipment?.contactPerson?.displayName}
                                searchableConfig={{
                                    endpoint: '/api/shipments/entities/person',
                                    labelKey: 'displayName',
                                    valueKey: 'id',
                                    defaultLimit: 50
                                }}
                                onSave={handleFieldSave}
                                small
                            />
                            <Field
                                label="Assigned To"
                                value={shipment?.assignedTo?.email ?? shipment?.assignedTo?.name}
                                field="assignedToId"
                                type="searchable-select"
                                displayValue={shipment?.assignedTo?.email ?? shipment?.assignedTo?.name}
                                searchableConfig={{
                                    endpoint: '/api/shipments/entities/user',
                                    labelKey: 'email',
                                    valueKey: 'id',
                                    defaultLimit: 50
                                }}
                                onSave={handleFieldSave}
                                small
                            />
                            <div className="my-3 border-t border-gray-200 pt-3">
                                <Field
                                    label="Total Pieces"
                                    value={shipment?.totalPieces}
                                    field="totalPieces"
                                    type="number"
                                    onSave={handleFieldSave}
                                    small
                                />
                                <Field
                                    label="Total Actual Weight"
                                    value={shipment?.totalActualWeight}
                                    field="totalActualWeight"
                                    type="number"
                                    onSave={handleFieldSave}
                                    small
                                />
                                <Field
                                    label="Total Chargeable Weight"
                                    value={shipment?.totalChargeableWeight}
                                    field="totalChargeableWeight"
                                    type="number"
                                    onSave={handleFieldSave}
                                    small
                                />
                                <Field
                                    label="Total Volume"
                                    value={shipment?.totalVolume}
                                    field="totalVolume"
                                    type="number"
                                    onSave={handleFieldSave}
                                    small
                                />
                                <Field
                                    label="Amount"
                                    value={shipment?.amount}
                                    field="amount"
                                    type="number"
                                    onSave={handleFieldSave}
                                    small
                                />
                            </div>
                        </div>
                    </div>
                </CollapsibleSection>

                {/* Details Section */}
                <CollapsibleSection title="Cargo details" defaultOpen={true} icon={ContainerIcon}>
                    <div className="text-gray-500 text-sm py-8 text-center">
                        <ShipmentContainers shipmentId={shipment.id} />
                    </div>
                </CollapsibleSection>

                {/* Truck Section */}
                <CollapsibleSection title="Truck" defaultOpen={false} icon={Truck}>
                    <div className="text-gray-500 text-sm py-8 text-center">
                        Truck information will appear here
                    </div>
                </CollapsibleSection>

                {/* Documents Section */}
                <CollapsibleSection title="Documents" defaultOpen={true} icon={FolderOpen}>
                    <ShipmentDocuments shipmentId={shipmentId} />
                </CollapsibleSection>

                <CollapsibleSection title="Tasks" defaultOpen={true} icon={CheckCheck}>
                    <ShipmentTasks shipmentId={shipmentId} />
                </CollapsibleSection>

            </div>
        </div>
    )
}