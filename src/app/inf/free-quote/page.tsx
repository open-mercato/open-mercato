"use client"

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

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

  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  const transportOptions: { id: TransportType; labelKey: string; labelFallback: string; icon: string }[] = [
    { id: 'sea', labelKey: 'freeQuote.transportTypes.sea', labelFallback: 'Sea', icon: '🚢' },
    { id: 'road', labelKey: 'freeQuote.transportTypes.road', labelFallback: 'Road', icon: '🚛' },
    { id: 'rail', labelKey: 'freeQuote.transportTypes.rail', labelFallback: 'Rail', icon: '🚂' },
    { id: 'air', labelKey: 'freeQuote.transportTypes.air', labelFallback: 'Air', icon: '✈️' },
  ]

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
                ? 'bg-[#EB5C2E] text-white'
                : step === currentStep
                ? 'bg-[#EB5C2E] text-white'
                : 'bg-gray-200 text-gray-500'
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
                step < currentStep ? 'bg-[#EB5C2E]' : 'bg-gray-200'
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
        <h2 className="text-xl font-semibold text-[#14363C] mb-2">
          {translate('freeQuote.step1.title', 'Choose transport type')}
        </h2>
        <p className="text-gray-500 text-sm">
          {translate('freeQuote.step1.description', 'Choose the type of transport you are interested in')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {transportOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFormData({ ...formData, transportType: option.id })}
            className={`p-6 rounded-xl border-2 transition-all ${
              formData.transportType === option.id
                ? 'border-[#EB5C2E] bg-[#EB5C2E]/10'
                : 'border-gray-200 bg-gray-50 hover:border-gray-300'
            }`}
          >
            <div className="text-4xl mb-3">{option.icon}</div>
            <div className={`font-medium ${formData.transportType === option.id ? 'text-[#EB5C2E]' : 'text-[#14363C]'}`}>
              {translate(option.labelKey, option.labelFallback)}
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[#14363C] mb-2">
          {translate('freeQuote.step2.title', 'Pickup location')}
        </h2>
        <p className="text-gray-500 text-sm">
          {translate('freeQuote.step2.description', 'Enter the pickup location')}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="startLocation" className="text-gray-700">
          {translate('freeQuote.step2.label', 'Pickup location')}<span className="text-[#EB5C2E]">*</span>
        </Label>
        <Input
          id="startLocation"
          type="text"
          value={formData.startLocation}
          onChange={(e) => setFormData({ ...formData, startLocation: e.target.value })}
          placeholder={translate('freeQuote.step2.placeholder', 'e.g. Warsaw, Poland')}
          className="h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#14363C] focus:ring-[#14363C]"
        />
      </div>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[#14363C] mb-2">
          {translate('freeQuote.step3.title', 'Delivery location')}
        </h2>
        <p className="text-gray-500 text-sm">
          {translate('freeQuote.step3.description', 'Enter the delivery location')}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="destinationLocation" className="text-gray-700">
          {translate('freeQuote.step3.label', 'Delivery location')}<span className="text-[#EB5C2E]">*</span>
        </Label>
        <Input
          id="destinationLocation"
          type="text"
          value={formData.destinationLocation}
          onChange={(e) => setFormData({ ...formData, destinationLocation: e.target.value })}
          placeholder={translate('freeQuote.step3.placeholder', 'e.g. Berlin, Germany')}
          className="h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#14363C] focus:ring-[#14363C]"
        />
      </div>
    </div>
  )

  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[#14363C] mb-2">
          {translate('freeQuote.step4.title', 'Contact details')}
        </h2>
        <p className="text-gray-500 text-sm">
          {translate('freeQuote.step4.description', 'Enter your contact details so we can send you the quote')}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName" className="text-gray-700">
            {translate('freeQuote.step4.firstName', 'First name')}<span className="text-[#EB5C2E]">*</span>
          </Label>
          <Input
            id="firstName"
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            placeholder="Jan"
            className="h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#14363C] focus:ring-[#14363C]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName" className="text-gray-700">
            {translate('freeQuote.step4.lastName', 'Last name')}<span className="text-[#EB5C2E]">*</span>
          </Label>
          <Input
            id="lastName"
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            placeholder="Kowalski"
            className="h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#14363C] focus:ring-[#14363C]"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone" className="text-gray-700">
          {translate('freeQuote.step4.phone', 'Phone number')}<span className="text-[#EB5C2E]">*</span>
        </Label>
        <Input
          id="phone"
          type="tel"
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          placeholder="+48 123 456 789"
          className="h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#14363C] focus:ring-[#14363C]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email" className="text-gray-700">
          {translate('freeQuote.step4.email', 'Email address')}<span className="text-[#EB5C2E]">*</span>
        </Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="jan.kowalski@firma.pl"
          className="h-11 border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-[#14363C] focus:ring-[#14363C]"
        />
      </div>
    </div>
  )

  const renderSuccess = () => (
    <div className="text-center space-y-6 py-8">
      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
        <svg className="w-10 h-10 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-[#14363C] mb-2">
          {translate('freeQuote.success.title', 'Thank you!')}
        </h2>
        <p className="text-gray-600">
          {translate('freeQuote.success.description', 'Your quote request has been successfully submitted. We will contact you within 24 hours.')}
        </p>
      </div>
      <div className="pt-4">
        <Link
          href="/inf"
          className="inline-flex items-center rounded-[6px] bg-[#EB5C2E] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d4522a]"
        >
          {translate('freeQuote.success.backHome', 'Back to home page')}
        </Link>
      </div>
    </div>
  )

  return (
    <main className="min-h-svh w-full bg-white">
      <Header />

      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-[#14363C] to-[#1F5058] pt-32 pb-16 lg:pt-40 lg:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              {translate('freeQuote.title', 'Free transport quote')}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              {translate('freeQuote.subtitle', 'Want to quickly and efficiently know the costs of your transport? Fill out the form below and get a free transport cost quote.')}
            </p>
          </div>
        </div>
        {/* Decorative wave */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg className="w-full h-12 text-gray-50" viewBox="0 0 1440 48" fill="currentColor" preserveAspectRatio="none">
            <path d="M0,48 L1440,48 L1440,0 C1200,32 960,48 720,48 C480,48 240,32 0,0 L0,48 Z" />
          </svg>
        </div>
      </section>

      {/* Form Section */}
      <section className="bg-gray-50 py-16 lg:py-24">
        <div className="mx-auto max-w-xl px-6 lg:px-8">
          <Card className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <CardContent className="p-8 lg:p-10">
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
                        className="px-6 py-3 rounded-[6px] border-2 border-gray-300 text-gray-700 font-medium transition-colors hover:border-[#14363C] hover:text-[#14363C]"
                      >
                        {translate('freeQuote.buttons.back', 'Back')}
                      </button>
                    ) : (
                      <div />
                    )}

                    {currentStep < totalSteps ? (
                      <button
                        type="button"
                        onClick={handleNext}
                        disabled={!canProceed()}
                        className="px-6 py-3 rounded-[6px] bg-[#EB5C2E] text-white font-medium transition-colors hover:bg-[#d4522a] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {translate('freeQuote.buttons.next', 'Next')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canProceed()}
                        className="px-6 py-3 rounded-[6px] bg-[#EB5C2E] text-white font-medium transition-colors hover:bg-[#d4522a] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {translate('freeQuote.buttons.submit', 'Submit')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
    </main>
  )
}
