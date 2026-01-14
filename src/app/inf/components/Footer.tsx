'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useLocale, useT } from '@/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

const menuLinks = [
  { href: '/inf/uslugi', labelKey: 'nav.services', fallback: 'Usługi' },
  { href: '/inf/o-nas', labelKey: 'nav.aboutUs', fallback: 'O nas' },
  { href: 'https://infsourcing.com', labelKey: 'nav.sourcing', fallback: 'Sourcing', external: true },
  { href: '/inf/kontakt', labelKey: 'nav.contact', fallback: 'Kontakt' },
  { href: '/inf/free-quote', labelKey: 'nav.getFreeQuote', fallback: 'Odbierz darmową wycenę' },
]

const languages = [
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
]

export function Footer() {
  const t = useT()
  const locale = useLocale()
  const translate = (key: string, fallback: string) => translateWithFallback(t, key, fallback)

  const handleLanguageChange = (langCode: string) => {
    // Set the locale cookie and reload the page
    document.cookie = `locale=${langCode};path=/;max-age=31536000`
    window.location.reload()
  }

  return (
    <footer className="bg-[#14363C] py-16">
      <div className="mx-auto max-w-[1440px] px-6">
        <div className="grid gap-12 lg:grid-cols-4">
          {/* Column 1: Logo & Social */}
          <div>
            <Link href="/inf" className="inline-block">
              <Image
                src="/fms/inf-logo.svg"
                alt="INF Shipping Solutions"
                width={180}
                height={60}
                className="h-auto w-[180px] brightness-0 invert"
              />
            </Link>
            <div className="mt-8 flex gap-4">
              <a
                href="https://www.facebook.com/infshipping/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/60 transition-colors hover:text-[#EB5C2E]"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              </a>
              <a
                href="https://www.instagram.com/infshipping/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/60 transition-colors hover:text-[#EB5C2E]"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" />
                </svg>
              </a>
              <a
                href="https://www.youtube.com/@INFShippingSolutions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/60 transition-colors hover:text-[#EB5C2E]"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                </svg>
              </a>
              <a
                href="https://www.linkedin.com/company/inf-shipping-solutions/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/60 transition-colors hover:text-[#EB5C2E]"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Column 2: Company Info */}
          <div>
            <h3 className="font-sans text-[18px] font-semibold text-white">
              {translate('footer.companyInfo', 'Dane firmowe')}
            </h3>
            <div className="mt-6 flex items-start gap-3">
              <svg className="mt-1 h-5 w-5 shrink-0 text-[#EB5C2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <div className="font-sans text-[14px] text-white/80">
                <p>ul Węglowa 22/122</p>
                <p>81-341 Gdynia Polska</p>
                <p className="mt-2">NIP: 6152069288</p>
              </div>
            </div>
          </div>

          {/* Column 3: Quick Contact */}
          <div>
            <h3 className="font-sans text-[18px] font-semibold text-white">
              {translate('footer.quickContact', 'Szybki kontakt')}
            </h3>
            <div className="mt-6 space-y-4">
              <div className="flex items-start gap-3">
                <svg className="mt-1 h-5 w-5 shrink-0 text-[#EB5C2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <div>
                  <p className="font-sans text-[14px] text-white/60">
                    {translate('footer.hotline', 'Infolinia')}
                  </p>
                  <a
                    href="tel:+48786660935"
                    className="font-sans text-[14px] text-white transition-colors hover:text-[#EB5C2E]"
                  >
                    +48 786 660 935
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <svg className="mt-1 h-5 w-5 shrink-0 text-[#EB5C2E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className="font-sans text-[14px] text-white/60">Email</p>
                  <a
                    href="mailto:info@infshipping.com"
                    className="block font-sans text-[14px] text-white transition-colors hover:text-[#EB5C2E]"
                  >
                    info@infshipping.com
                  </a>
                  <a
                    href="mailto:sales@infshipping.com"
                    className="block font-sans text-[14px] text-white transition-colors hover:text-[#EB5C2E]"
                  >
                    sales@infshipping.com
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Column 4: Menu */}
          <div>
            <h3 className="font-sans text-[18px] font-semibold text-white">
              {translate('footer.menu', 'Menu')}
            </h3>
            <ul className="mt-6 space-y-3">
              {menuLinks.map((link) =>
                link.external ? (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-sans text-[14px] text-white/80 transition-colors hover:text-[#EB5C2E]"
                    >
                      {translate(link.labelKey, link.fallback)}
                    </a>
                  </li>
                ) : (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="font-sans text-[14px] text-white/80 transition-colors hover:text-[#EB5C2E]"
                    >
                      {translate(link.labelKey, link.fallback)}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="font-sans text-[12px] text-white/60">
            Copyright &copy; {new Date().getFullYear()} INF Shipping Solutions. {translate('footer.copyright', 'Wszelkie prawa zastrzeżone.')}
          </p>
          <div className="flex items-center gap-6">
            {/* Language Switcher */}
            <div className="flex items-center gap-2">
              <span className="font-sans text-[12px] text-white/60">
                {translate('footer.language', 'Język')}:
              </span>
              <div className="flex gap-1">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageChange(lang.code)}
                    className={`flex items-center gap-1 rounded px-2 py-1 font-sans text-[12px] transition-colors ${
                      locale === lang.code
                        ? 'bg-[#EB5C2E] text-white'
                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                    }`}
                    title={lang.label}
                  >
                    <span>{lang.flag}</span>
                    <span className="hidden sm:inline">{lang.code.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            </div>
            <Link
              href="/inf/polityka-prywatnosci"
              className="font-sans text-[12px] text-white/60 transition-colors hover:text-[#EB5C2E]"
            >
              {translate('footer.privacyPolicy', 'Polityka prywatności')}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
