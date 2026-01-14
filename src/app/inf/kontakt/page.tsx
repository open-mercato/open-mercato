'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

const contacts = [
  {
    name: 'Karol Cettler',
    role: 'Business Development',
    email: 'karol.cettler@infshipping.com',
    phone: '+48 451 255 414',
  },
  {
    name: 'Damian Janiszewski',
    role: 'Business Development',
    email: 'damian.janiszewski@infshipping.com',
    phone: '+48 797 487 797',
  },
]

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    phone: '',
    message: '',
    consent: false,
  })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    console.log('Form submitted:', formData)
    setSubmitted(true)
  }

  return (
    <main className="min-h-svh w-full bg-white">
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-gray-200">
        <div
          className="pointer-events-none absolute right-[5%] top-[10%] h-[500px] w-[500px] rounded-full opacity-30"
          style={{
            background: 'radial-gradient(circle, rgba(27, 77, 92, 0.2) 0%, rgba(27, 77, 92, 0.1) 50%, transparent 70%)',
            filter: 'blur(60px)',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Porozmawiajmy o Twoim transporcie
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Opowiedz nam o swoich potrzebach zwiazanych z transportem i logistyka, a my zaproponujemy Ci optymalne rozwiazanie w najlepszej cenie!
            </p>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-16 lg:grid-cols-2">
            {/* Contact Form */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Wyslij wiadomosc</h2>
              <p className="mt-2 text-gray-600">
                Wypelnij formularz, a skontaktujemy sie z Toba jak najszybciej.
              </p>

              {submitted ? (
                <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900">Dziekujemy!</h3>
                  <p className="mt-2 text-gray-600">
                    Twoja wiadomosc zostala wyslana. Skontaktujemy sie z Toba wkrotce.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                        Imie i nazwisko <span className="text-[#E8754B]">*</span>
                      </label>
                      <input
                        type="text"
                        id="name"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-[#1B4D5C] focus:outline-none focus:ring-1 focus:ring-[#1B4D5C]"
                      />
                    </div>
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                        Firmowy adres e-mail <span className="text-[#E8754B]">*</span>
                      </label>
                      <input
                        type="email"
                        id="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-[#1B4D5C] focus:outline-none focus:ring-1 focus:ring-[#1B4D5C]"
                      />
                    </div>
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label htmlFor="subject" className="block text-sm font-medium text-gray-700">
                        Temat wiadomosci
                      </label>
                      <input
                        type="text"
                        id="subject"
                        value={formData.subject}
                        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                        className="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-[#1B4D5C] focus:outline-none focus:ring-1 focus:ring-[#1B4D5C]"
                      />
                    </div>
                    <div>
                      <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                        Numer telefonu <span className="text-[#E8754B]">*</span>
                      </label>
                      <input
                        type="tel"
                        id="phone"
                        required
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-[#1B4D5C] focus:outline-none focus:ring-1 focus:ring-[#1B4D5C]"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-gray-700">
                      Tresc wiadomosci <span className="text-[#E8754B]">*</span>
                    </label>
                    <textarea
                      id="message"
                      required
                      rows={5}
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="mt-2 block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-[#1B4D5C] focus:outline-none focus:ring-1 focus:ring-[#1B4D5C]"
                    />
                  </div>

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="consent"
                      required
                      checked={formData.consent}
                      onChange={(e) => setFormData({ ...formData, consent: e.target.checked })}
                      className="mt-1 h-4 w-4 rounded border-gray-300 bg-white text-[#1B4D5C] focus:ring-[#1B4D5C]"
                    />
                    <label htmlFor="consent" className="text-sm text-gray-600">
                      Wyrazam zgode na przetwarzanie moich danych osobowych zgodnie z{' '}
                      <Link href="/inf/polityka-prywatnosci" className="text-[#E8754B] hover:underline">
                        Polityka prywatnosci
                      </Link>
                      . <span className="text-[#E8754B]">*</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
                  >
                    Wyslij wiadomosc
                  </button>
                </form>
              )}
            </div>

            {/* Contact Info */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Dane kontaktowe</h2>
              <p className="mt-2 text-gray-600">
                Mozesz rowniez skontaktowac sie z nami bezposrednio.
              </p>

              {/* Contact Persons */}
              <div className="mt-8 space-y-6">
                {contacts.map((contact, index) => (
                  <div key={index} className="rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30">
                    <h3 className="text-lg font-semibold text-gray-900">{contact.name}</h3>
                    <p className="text-sm text-[#1B4D5C]">{contact.role}</p>
                    <div className="mt-4 space-y-2">
                      <a href={`mailto:${contact.email}`} className="flex items-center gap-3 text-gray-600 hover:text-gray-900">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {contact.email}
                      </a>
                      <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="flex items-center gap-3 text-gray-600 hover:text-gray-900">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        {contact.phone}
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {/* Company Info */}
              <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30">
                <h3 className="text-lg font-semibold text-gray-900">Dane firmy</h3>
                <div className="mt-4 space-y-3 text-gray-600">
                  <p>
                    <span className="text-gray-400">Adres:</span><br />
                    ul Weglowa 22/122<br />
                    81-341 Gdynia, Poland
                  </p>
                  <p>
                    <span className="text-gray-400">NIP:</span> 6152069288
                  </p>
                  <p>
                    <span className="text-gray-400">Telefon:</span>{' '}
                    <a href="tel:+48786660935" className="hover:text-gray-900">+48 786 660 935</a>
                  </p>
                  <p>
                    <span className="text-gray-400">Email:</span>{' '}
                    <a href="mailto:info@infshipping.com" className="hover:text-gray-900">info@infshipping.com</a>
                  </p>
                  <p>
                    <span className="text-gray-400">Sprzedaz:</span>{' '}
                    <a href="mailto:sales@infshipping.com" className="hover:text-gray-900">sales@infshipping.com</a>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
