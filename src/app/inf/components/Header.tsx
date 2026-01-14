'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

const services = [
  { href: '/inf/uslugi/transport-morski', label: 'Transport morski' },
  { href: '/inf/uslugi/transport-drogowy', label: 'Transport drogowy' },
  { href: '/inf/uslugi/agencja-celna', label: 'Agencja celna' },
  { href: '/inf/uslugi/transport-kolejowy', label: 'Transport kolejowy' },
  { href: '/inf/uslugi/transport-lotniczy', label: 'Transport lotniczy' },
  { href: '/inf/uslugi/logistyka-magazynowa', label: 'Logistyka magazynowa' },
]

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)

  return (
    <header className="relative z-50">
      {/* Top bar with contact info */}
      <div className="hidden border-b border-gray-200 bg-[#1a1a1a] py-2 lg:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 lg:px-8">
          <div className="flex items-center gap-6 text-sm text-gray-300">
            <a href="tel:+48786660935" className="flex items-center gap-2 hover:text-white">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              +48 786 660 935
            </a>
            <a href="mailto:info@infshipping.com" className="flex items-center gap-2 hover:text-white">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              info@infshipping.com
            </a>
            <a href="mailto:sales@infshipping.com" className="flex items-center gap-2 hover:text-white">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              sales@infshipping.com
            </a>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"/></svg>
            </a>
            <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </a>
            <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            </a>
          </div>
        </div>
      </div>

      {/* Main navigation - dark teal background */}
      <nav className="bg-white py-4 lg:bg-transparent">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 lg:px-8">
          <Link href="/inf" className="shrink-0">
            <Image
              src="/fms/inf-logo.svg"
              alt="INF Shipping Solutions"
              width={140}
              height={50}
              className="h-12 w-auto"
            />
          </Link>

          {/* Desktop navigation - teal rounded bar */}
          <div className="hidden items-center gap-1 rounded-full bg-[#1B4D5C] px-2 py-2 lg:flex">
            <div className="relative" onMouseEnter={() => setServicesOpen(true)} onMouseLeave={() => setServicesOpen(false)}>
              <Link href="/inf/uslugi" className="flex items-center gap-1 rounded-full px-5 py-2 text-sm font-medium text-white hover:bg-white/10">
                Uslugi
                <svg className={`h-4 w-4 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </Link>
              {servicesOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-56 rounded-lg bg-[#1B4D5C] py-2 shadow-xl">
                  {services.map((service) => (
                    <Link
                      key={service.href}
                      href={service.href}
                      className="block px-4 py-2 text-sm text-white hover:bg-white/10"
                    >
                      {service.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <Link href="/inf/o-nas" className="rounded-full px-5 py-2 text-sm font-medium text-white hover:bg-white/10">
              O nas
            </Link>
            <Link href="/inf/kontakt" className="rounded-full px-5 py-2 text-sm font-medium text-white hover:bg-white/10">
              Kontakt
            </Link>
            <Link
              href="/inf/free-quote"
              className="ml-2 rounded-full bg-[#E8754B] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#d9664a]"
            >
              Odbierz darmowa wycene
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            type="button"
            className="rounded-lg bg-[#1B4D5C] p-2 lg:hidden"
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
          <div className="border-t border-gray-200 bg-white lg:hidden">
            <div className="space-y-1 px-6 pb-4 pt-4">
              <Link href="/inf/uslugi" className="block py-2 text-base font-medium text-[#1B4D5C] hover:text-[#E8754B]">
                Uslugi
              </Link>
              {services.map((service) => (
                <Link
                  key={service.href}
                  href={service.href}
                  className="block py-2 pl-4 text-sm text-gray-600 hover:text-[#E8754B]"
                >
                  {service.label}
                </Link>
              ))}
              <Link href="/inf/o-nas" className="block py-2 text-base font-medium text-[#1B4D5C] hover:text-[#E8754B]">
                O nas
              </Link>
              <Link href="/inf/kontakt" className="block py-2 text-base font-medium text-[#1B4D5C] hover:text-[#E8754B]">
                Kontakt
              </Link>
              <div className="flex flex-col gap-3 pt-4">
                <Link
                  href="/inf/free-quote"
                  className="rounded-full bg-[#E8754B] px-5 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-[#d9664a]"
                >
                  Odbierz darmowa wycene
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}
