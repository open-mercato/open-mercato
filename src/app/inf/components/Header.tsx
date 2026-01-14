'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const t = useT()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  const services = [
    { href: 'https://infshipping.com/uslugi/transport-morski/', labelKey: 'services.seaTransport.title', fallback: 'Sea transport' },
    { href: 'https://infshipping.com/uslugi/transport-drogowy/', labelKey: 'services.roadTransport.title', fallback: 'Road transport' },
    { href: 'https://infshipping.com/uslugi/agencja-celna/', labelKey: 'services.customsAgency.title', fallback: 'Customs agency' },
    { href: 'https://infshipping.com/uslugi/transport-kolejowy/', labelKey: 'services.railTransport.title', fallback: 'Rail transport' },
    { href: 'https://infshipping.com/uslugi/transport-lotniczy/', labelKey: 'services.airTransport.title', fallback: 'Air transport' },
    { href: 'https://infshipping.com/uslugi/logistyka-magazynowa/', labelKey: 'services.warehousing.title', fallback: 'Warehousing' },
  ]

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header className="relative z-50">
      {/* Main navigation */}
      <nav
        className={`fixed left-0 right-0 z-50 py-4 transition-all duration-300 ${
          isScrolled ? 'top-0 bg-[#14363C]/95 shadow-lg backdrop-blur-sm' : 'top-10 bg-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-6">
          {/* Logo */}
          <Link href="/inf" className="shrink-0">
            <Image
              src="/fms/inf-logo.svg"
              alt="INF Shipping Solutions"
              width={150}
              height={50}
              className="h-14 w-auto"
            />
          </Link>

          {/* Desktop navigation - teal container + CTA */}
          <div className="hidden items-center gap-2.5 lg:flex">
            {/* Nav links container */}
            <div className="flex items-center rounded-[6px] bg-[#1F5058]">
              {/* Usługi dropdown */}
              <div
                className="relative"
                onMouseEnter={() => setServicesOpen(true)}
                onMouseLeave={() => setServicesOpen(false)}
              >
                <Link
                  href="https://infshipping.com/uslugi/"
                  className="flex items-center gap-1 px-5 py-3 font-sans text-[16px] font-semibold text-white transition-colors hover:text-[#EB5C2E]"
                >
                  {translate('nav.services', 'Services')}
                  <svg
                    className={`h-4 w-4 transition-transform ${servicesOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </Link>
                {servicesOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-[6px] bg-[#1F5058] py-2 shadow-xl">
                    {services.map((service) => (
                      <Link
                        key={service.href}
                        href={service.href}
                        className="block px-4 py-2 font-sans text-sm text-white hover:bg-[#EB5C2E]"
                      >
                        {translate(service.labelKey, service.fallback)}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <Link
                href="https://infshipping.com/o-nas/"
                className="px-5 py-3 font-sans text-[16px] font-semibold text-white transition-colors hover:text-[#EB5C2E]"
              >
                {translate('nav.aboutUs', 'About Us')}
              </Link>
              <a
                href="https://infsourcing.com"
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-3 font-sans text-[16px] font-semibold text-white transition-colors hover:text-[#EB5C2E]"
              >
                {translate('nav.sourcing', 'Sourcing')}
              </a>
              <Link
                href="https://infshipping.com/kontakt/"
                className="px-5 py-3 font-sans text-[16px] font-semibold text-white transition-colors hover:text-[#EB5C2E]"
              >
                {translate('nav.contact', 'Contact')}
              </Link>
              <Link
                href="/inf/login"
                className="px-5 py-3 font-sans text-[16px] font-semibold text-white transition-colors hover:text-[#EB5C2E]"
              >
                {translate('nav.login', 'Login')}
              </Link>
            </div>

            {/* CTA Button - separate from nav container */}
            <Link
              href="/inf/free-quote"
              className="rounded-[6px] bg-[#EB5C2E] px-[26px] py-[17px] font-sans text-[15px] font-semibold text-white transition-colors hover:bg-[#14363C]"
            >
              {translate('nav.getFreeQuote', 'Get free quote')}
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            type="button"
            className="rounded-[6px] bg-[#1F5058] p-2 lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="mt-2 border-t border-gray-200 bg-white lg:hidden">
            <div className="space-y-1 px-6 pb-4 pt-4">
              <Link
                href="/inf/uslugi"
                className="block py-2 font-sans text-base font-semibold text-[#14363C] hover:text-[#EB5C2E]"
              >
                {translate('nav.services', 'Services')}
              </Link>
              {services.map((service) => (
                <Link
                  key={service.href}
                  href={service.href}
                  className="block py-2 pl-4 font-sans text-sm text-gray-600 hover:text-[#EB5C2E]"
                >
                  {translate(service.labelKey, service.fallback)}
                </Link>
              ))}
              <Link
                href="/inf/o-nas"
                className="block py-2 font-sans text-base font-semibold text-[#14363C] hover:text-[#EB5C2E]"
              >
                {translate('nav.aboutUs', 'About Us')}
              </Link>
              <a
                href="https://infsourcing.com"
                target="_blank"
                rel="noopener noreferrer"
                className="block py-2 font-sans text-base font-semibold text-[#14363C] hover:text-[#EB5C2E]"
              >
                {translate('nav.sourcing', 'Sourcing')}
              </a>
              <Link
                href="/inf/kontakt"
                className="block py-2 font-sans text-base font-semibold text-[#14363C] hover:text-[#EB5C2E]"
              >
                {translate('nav.contact', 'Contact')}
              </Link>
              <Link
                href="/inf/login"
                className="block py-2 font-sans text-base font-semibold text-[#14363C] hover:text-[#EB5C2E]"
              >
                {translate('nav.login', 'Login')}
              </Link>
              <div className="pt-4">
                <Link
                  href="/inf/free-quote"
                  className="block rounded-[6px] bg-[#EB5C2E] px-5 py-3 text-center font-sans text-sm font-semibold text-white transition-colors hover:bg-[#14363C]"
                >
                  {translate('nav.getFreeQuote', 'Get free quote')}
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}
