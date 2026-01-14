import Link from 'next/link'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-svh w-full bg-white">
      <Header />

      {/* Hero Section */}
      <section className="border-b border-gray-200">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            Polityka prywatnosci
          </h1>
          <p className="mt-4 text-gray-600">
            Ostatnia aktualizacja: 4 listopada 2025
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="prose prose-gray max-w-none">
            {/* Administrator */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Administrator danych</h2>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6">
                <p className="text-gray-600">
                  <strong className="text-gray-900">INF SHIPPING Solutions Sp. z o.o.</strong><br />
                  ul. Weglowa 22/122<br />
                  81-341 Gdynia, Poland
                </p>
                <p className="mt-4 text-gray-600">
                  <strong className="text-gray-900">Kontakt:</strong>{' '}
                  <a href="mailto:info@infshipping.com" className="text-[#E8754B] hover:underline">
                    info@infshipping.com
                  </a>
                </p>
              </div>
            </div>

            {/* Legal Framework */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Podstawa prawna</h2>
              <p className="mt-4 text-gray-600">
                Niniejsza polityka dziala zgodnie z RODO (Rozporzadzenie UE 2016/679) oraz polskim prawem o ochronie danych osobowych.
              </p>
            </div>

            {/* Data Processing Purposes */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Cele przetwarzania danych</h2>
              <p className="mt-4 text-gray-600">
                Firma przetwarza dane osobowe w nastepujacych celach:
              </p>
              <ul className="mt-4 space-y-2 text-gray-600">
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Komunikacja biznesowa i wspolpraca komercyjna
                </li>
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Rekrutacja pracownikow na wolne stanowiska
                </li>
              </ul>
            </div>

            {/* Personal Data Collected */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Zbierane dane osobowe</h2>
              <p className="mt-4 text-gray-600">
                Organizacja zbiera trzy kategorie informacji:
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-center hover:border-[#1B4D5C]/30">
                  <div className="mb-2 text-[#1B4D5C]">
                    <svg className="mx-auto h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <p className="text-gray-600">Imiona i nazwiska</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-center hover:border-[#1B4D5C]/30">
                  <div className="mb-2 text-[#1B4D5C]">
                    <svg className="mx-auto h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-gray-600">Adresy e-mail</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-center hover:border-[#1B4D5C]/30">
                  <div className="mb-2 text-[#1B4D5C]">
                    <svg className="mx-auto h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <p className="text-gray-600">Numery telefonow</p>
                </div>
              </div>
            </div>

            {/* Data Retention */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Okres przechowywania danych</h2>
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 hover:border-[#1B4D5C]/30">
                  <h3 className="font-semibold text-gray-900">Dane zwiazane z umowami biznesowymi</h3>
                  <p className="mt-2 text-gray-600">
                    Przechowywane przez czas trwania umowy plus do 10 lat pozniej, zgodnie z obowiazujacymi przepisami.
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 hover:border-[#1B4D5C]/30">
                  <h3 className="font-semibold text-gray-900">Dane zebrane do innych celow</h3>
                  <p className="mt-2 text-gray-600">
                    Przechowywane tylko do momentu wycofania zgody lub zakonczenia rekrutacji (np. aplikacje o prace).
                  </p>
                </div>
              </div>
            </div>

            {/* Data Sharing */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Udostepnianie danych</h2>
              <p className="mt-4 text-gray-600">
                Dane osobowe sa ujawniane w minimalnym zakresie i wylacznie gdy jest to konieczne do swiadczenia uslug. Polityka zaznacza, ze dane zazwyczaj pozostaja w Europejskim Obszarze Gospodarczym, z wyjatkiem sytuacji gdy miedzynarodowe operacje transportowe wymagaja inaczej.
              </p>
            </div>

            {/* Rights */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Twoje prawa</h2>
              <p className="mt-4 text-gray-600">
                Zgodnie z RODO masz prawo do:
              </p>
              <ul className="mt-4 space-y-2 text-gray-600">
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Dostepu do swoich danych osobowych
                </li>
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Sprostowania nieprawidlowych danych
                </li>
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Usuniecia danych (&quot;prawo do bycia zapomnianym&quot;)
                </li>
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Ograniczenia przetwarzania
                </li>
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Przenoszenia danych
                </li>
                <li className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Sprzeciwu wobec przetwarzania
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900">Kontakt</h2>
              <p className="mt-4 text-gray-600">
                W przypadku pytan dotyczacych przetwarzania danych osobowych prosimy o kontakt:
              </p>
              <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30">
                <p className="text-gray-600">
                  <strong className="text-gray-900">Email:</strong>{' '}
                  <a href="mailto:info@infshipping.com" className="text-[#E8754B] hover:underline">
                    info@infshipping.com
                  </a>
                </p>
                <p className="mt-2 text-gray-600">
                  <strong className="text-gray-900">Telefon:</strong>{' '}
                  <a href="tel:+48786660935" className="text-[#E8754B] hover:underline">
                    +48 786 660 935
                  </a>
                </p>
                <p className="mt-2 text-gray-600">
                  <strong className="text-gray-900">Adres:</strong><br />
                  ul. Weglowa 22/122, 81-341 Gdynia, Poland
                </p>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-8">
              <Link href="/inf" className="text-[#E8754B] hover:underline">
                &larr; Powrot do strony glownej
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
