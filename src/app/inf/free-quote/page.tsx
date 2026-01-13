"use client"

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type TransportType = 'sea' | 'road' | 'rail' | 'air' | null

interface FormData {
  transportType: TransportType
  startLocation: string
  destinationLocation: string
  firstName: string
  lastName: string
  phone: string
  email: string
}

const transportOptions: { id: TransportType; label: string; icon: string }[] = [
  { id: 'sea', label: 'Sea', icon: '🚢' },
  { id: 'road', label: 'Road', icon: '🚛' },
  { id: 'rail', label: 'Rail', icon: '🚂' },
  { id: 'air', label: 'Air', icon: '✈️' },
]

export default function INFFreeQuotePage() {
  const [currentStep, setCurrentStep] = useState(1)
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    transportType: null,
    startLocation: '',
    destinationLocation: '',
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
  })

  const totalSteps = 4

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return formData.transportType !== null
      case 2:
        return formData.startLocation.trim() !== ''
      case 3:
        return formData.destinationLocation.trim() !== ''
      case 4:
        return (
          formData.firstName.trim() !== '' &&
          formData.lastName.trim() !== '' &&
          formData.phone.trim() !== '' &&
          formData.email.trim() !== ''
        )
      default:
        return false
    }
  }

  const handleNext = () => {
    if (currentStep < totalSteps && canProceed()) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = () => {
    if (canProceed()) {
      // Mock submission - just show success
      console.log('Form submitted:', formData)
      setSubmitted(true)
    }
  }

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3, 4].map((step) => (
        <div key={step} className="flex items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              step < currentStep
                ? 'bg-[#E67E5E] text-white'
                : step === currentStep
                ? 'bg-[#E67E5E] text-white'
                : 'bg-[#2a2a2a] text-gray-500'
            }`}
          >
            {step < currentStep ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              step
            )}
          </div>
          {step < totalSteps && (
            <div
              className={`w-12 h-1 mx-1 rounded ${
                step < currentStep ? 'bg-[#E67E5E]' : 'bg-[#2a2a2a]'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Choose your transport type</h2>
        <p className="text-gray-400 text-sm">Select the type of transport you're interested in</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {transportOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFormData({ ...formData, transportType: option.id })}
            className={`p-6 rounded-xl border-2 transition-all ${
              formData.transportType === option.id
                ? 'border-[#E67E5E] bg-[#E67E5E]/10'
                : 'border-gray-700 bg-[#2a2a2a] hover:border-gray-600'
            }`}
          >
            <div className="text-4xl mb-3">{option.icon}</div>
            <div className={`font-medium ${formData.transportType === option.id ? 'text-[#E67E5E]' : 'text-white'}`}>
              {option.label}
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Starting location</h2>
        <p className="text-gray-400 text-sm">Enter the pickup location for your shipment</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="startLocation" className="text-gray-300">
          Starting location<span className="text-[#E67E5E]">*</span>
        </Label>
        <Input
          id="startLocation"
          type="text"
          value={formData.startLocation}
          onChange={(e) => setFormData({ ...formData, startLocation: e.target.value })}
          placeholder="e.g. Warsaw, Poland"
          className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]"
        />
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Destination</h2>
        <p className="text-gray-400 text-sm">Enter the delivery location for your shipment</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="destinationLocation" className="text-gray-300">
          Destination<span className="text-[#E67E5E]">*</span>
        </Label>
        <Input
          id="destinationLocation"
          type="text"
          value={formData.destinationLocation}
          onChange={(e) => setFormData({ ...formData, destinationLocation: e.target.value })}
          placeholder="e.g. Berlin, Germany"
          className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]"
        />
      </div>
    </div>
  )

  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Contact information</h2>
        <p className="text-gray-400 text-sm">Enter your contact details so we can send you the quote</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName" className="text-gray-300">
            First name<span className="text-[#E67E5E]">*</span>
          </Label>
          <Input
            id="firstName"
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName" className="text-gray-300">
            Last name<span className="text-[#E67E5E]">*</span>
          </Label>
          <Input
            id="lastName"
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone" className="text-gray-300">
          Phone number<span className="text-[#E67E5E]">*</span>
        </Label>
        <Input
          id="phone"
          type="tel"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="text-gray-300">
          Email address<span className="text-[#E67E5E]">*</span>
        </Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className="border-gray-700 bg-[#2a2a2a] text-white placeholder:text-gray-500 focus:border-[#E67E5E] focus:ring-[#E67E5E]"
        />
      </div>
    </div>
  )

  const renderSuccess = () => (
    <div className="text-center space-y-6 py-8">
      <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
        <svg className="w-10 h-10 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-white mb-2">Thank you!</h2>
        <p className="text-gray-400">
          Your quote request has been submitted successfully. We'll get back to you within 24 hours.
        </p>
      </div>
      <div className="pt-4">
        <Link
          href="/"
          className="inline-flex items-center rounded-full bg-[#E67E5E] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9705a]"
        >
          Back to home
        </Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-svh w-full bg-[#0f0f0f]">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-12">
          <Link href="/">
            <Image
              src="/fms/inf-logo.svg"
              alt="INF Shipping Solutions"
              width={120}
              height={40}
            />
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-[#E67E5E] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d9705a]"
          >
            Sign in
          </Link>
        </header>

        {/* Main content */}
        <div className="flex flex-col items-center justify-center">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white sm:text-4xl mb-3">
              Free quote for your transport
            </h1>
            <p className="text-gray-400 text-lg">
              Getting a transport service quote has never been easier — in just 4 simple steps
            </p>
          </div>

          <Card className="w-full max-w-xl border-0 bg-[#1c1c1c] shadow-2xl">
            <CardContent className="p-8">
              {submitted ? (
                renderSuccess()
              ) : (
                <>
                  {renderStepIndicator()}

                  {currentStep === 1 && renderStep1()}
                  {currentStep === 2 && renderStep2()}
                  {currentStep === 3 && renderStep3()}
                  {currentStep === 4 && renderStep4()}

                  <div className="flex justify-between mt-8">
                    {currentStep > 1 ? (
                      <button
                        type="button"
                        onClick={handleBack}
                        className="px-6 py-3 rounded-full border-2 border-gray-600 text-gray-300 font-medium transition-colors hover:border-gray-500 hover:text-white"
                      >
                        Back
                      </button>
                    ) : (
                      <div />
                    )}

                    {currentStep < totalSteps ? (
                      <button
                        type="button"
                        onClick={handleNext}
                        disabled={!canProceed()}
                        className="px-6 py-3 rounded-full bg-[#E67E5E] text-white font-medium transition-colors hover:bg-[#d9705a] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canProceed()}
                        className="px-6 py-3 rounded-full bg-[#E67E5E] text-white font-medium transition-colors hover:bg-[#d9705a] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Submit
                      </button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
