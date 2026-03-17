export type Provider = {
  providerKey: string
}

export type Address = {
  countryCode: string
  postalCode: string
  city: string
  line1: string
  line2?: string
}

export type PackageDimension = {
  weightKg: number
  lengthCm: number
  widthCm: number
  heightCm: number
}

export type ShippingRate = {
  serviceCode: string
  serviceName: string
  amount: number
  currencyCode: string
  estimatedDays?: number
}

export type DocumentAddress = {
  id: string
  purpose: string | null
  address_line1: string
  address_line2?: string | null
  city?: string | null
  postal_code?: string | null
  country?: string | null
}

export type LabelFormat = 'pdf' | 'zpl' | 'png'

export type WizardStep = 'provider' | 'configure' | 'confirm'

export type AddressFieldsProps = {
  prefix: string
  address: Address
  onChange: (address: Address) => void
  disabled?: boolean
}

export type PackageEditorProps = {
  packages: PackageDimension[]
  onChange: (packages: PackageDimension[]) => void
  disabled?: boolean
}

export type ContactInfo = {
  phone: string
  email: string
}

export type ContactFieldsProps = {
  prefix: string
  contact: ContactInfo
  onChange: (contact: ContactInfo) => void
  disabled?: boolean
}

export type DropOffPoint = {
  id: string
  name: string
  type: string
  city: string
  postalCode: string
  street: string
  latitude?: number
  longitude?: number
}
