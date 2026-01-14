import Link from 'next/link'
import { Header } from './components/Header'
import { Footer } from './components/Footer'

const services = [
  {
    href: '/inf/uslugi/transport-morski',
    title: 'Transport morski',
    description: 'Miedzynarodowy transport morski kontenerowy i drobnicowy do ponad 100 krajow swiata.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/transport-lotniczy',
    title: 'Transport lotniczy',
    description: 'Szybki i bezpieczny transport lotniczy na wszystkie kontynenty z partnerskimi liniami lotniczymi.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/transport-drogowy',
    title: 'Transport drogowy',
    description: 'Spedycja miedzynarodowa w Polsce i w calej Europie. Pelne i czesciowe ladunki (FTL/LTL).',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/transport-kolejowy',
    title: 'Transport kolejowy',
    description: 'Polaczenia kolejowe miedzy Europa a Azja. Rownowaga miedzy szybkoscia a optymalizacja kosztow.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/logistyka-magazynowa',
    title: 'Logistyka magazynowa',
    description: 'Kompleksowe uslugi magazynowe z kontrola klimatu i obsluga towarow niebezpiecznych.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/agencja-celna',
    title: 'Agencja celna',
    description: 'Pelna obsluga celna i dokumentacja. Procedury standardowe, uproszczone i odroczone VAT.',
    icon: (
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

const benefits = [
  {
    title: 'Komfort i bezpieczenstwo',
    description: 'Pelny spokoj i bezpieczenstwo podczas transportu. Dbamy o kazdy szczegol Twojej przesylki.',
  },
  {
    title: 'Zaufanie i doswiadczenie',
    description: 'Dlugoterminowe partnerstwa budowane na przejrzystosci i niezawodnosci.',
  },
  {
    title: 'Nowoczesna technologia',
    description: 'Wdrazamy nowoczesne technologie monitorowania i zarzadzania, zapewniajace kontrole przesylki w czasie rzeczywistym.',
  },
  {
    title: 'Globalny zasieg',
    description: 'Docieramy do niemal wszystkich portow swiata, w tym do odleglych lokalizacji niedostepnych innymi srodkami transportu.',
  },
  {
    title: 'Zrownowazony rozwoj',
    description: 'Skupiamy sie na odpowiedzialnosci za srodowisko i redukcji sladu weglowego w naszych operacjach.',
  },
  {
    title: 'Indywidualne podejscie',
    description: 'Uslugi dostosowane do specyficznych potrzeb Twojego biznesu. Rozwiazania szyte na miare.',
  },
]

const testimonials = [
  {
    name: 'Beata Tymczewska',
    role: 'Dyrektor ds. Logistyki',
    content: 'INF Shipping Solutions to niezawodny partner w naszych operacjach logistycznych. Profesjonalna obsluga i terminowosc dostaw.',
  },
  {
    name: 'Paulina Kita',
    role: 'Kierownik Zakupow',
    content: 'Swietna komunikacja i elastycznosc. Zawsze mozemy liczyc na wsparcie zespolu INF w rozwiazywaniu nawet najtrudniejszych wyzwan.',
  },
  {
    name: 'Mei Yang',
    role: 'Import Manager',
    content: 'Profesjonalna obsluga importu z Chin. INF Shipping doskonale zna specyfike azjatyckich rynkow i procedur celnych.',
  },
]

export default function INFHome() {
  return (
    <main className="min-h-svh w-full bg-white">
      <Header />

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                Uslugi transportowe
              </h1>
              <p className="mt-2 text-2xl text-gray-700 sm:text-3xl">
                nieskonczone mozliwosci
              </p>
              <p className="mt-1 text-2xl sm:text-3xl">
                <span className="relative inline-block text-[#E8754B]">
                  w najnizszych cenach
                  <svg className="absolute -bottom-1 left-0 h-2 w-full" viewBox="0 0 200 8" fill="none">
                    <path d="M2 6C50 2 150 2 198 6" stroke="#E8754B" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                </span>
              </p>
              <p className="mt-6 text-lg leading-relaxed text-gray-600">
                Dostarczamy rozwiazania logistyczne wzmacniajace Twoj biznes. Ty rozwijasz swoj biznes - logistyka zajmiemy sie my. Nadawaj, sledz i zarzadzaj zleceniami w latwy i przystepny sposob!
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                <Link
                  href="/inf/uslugi"
                  className="inline-flex items-center rounded-full bg-[#1B4D5C] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#164250]"
                >
                  Sprawdz nasza oferte
                </Link>
                <Link
                  href="/inf/free-quote"
                  className="inline-flex items-center text-base font-semibold text-gray-900 hover:text-[#E8754B]"
                >
                  Odbierz darmowa wycene
                  <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
            <div className="relative hidden lg:block">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-gradient-to-br from-[#1B4D5C] to-[#2a6a7a]">
                <div className="flex h-full flex-col items-center justify-center p-8 text-white">
                  <p className="text-xl">Shipping and</p>
                  <p className="text-5xl font-bold">logistics</p>
                  <p className="text-2xl">professionals</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[#E8754B] sm:text-4xl">
              Kompleksowe uslugi transportowe & logistyczne
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Oferujemy pelny zakres uslug transportowych i logistycznych
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <Link
                key={service.href}
                href={service.href}
                className="group rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-[#1B4D5C]/30 hover:shadow-md"
              >
                <div className="mb-4 inline-flex rounded-lg bg-[#1B4D5C]/10 p-3 text-[#1B4D5C]">
                  {service.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#1B4D5C]">
                  {service.title}
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  {service.description}
                </p>
                <div className="mt-4 flex items-center text-sm font-medium text-[#E8754B]">
                  Dowiedz sie wiecej
                  <svg className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[#1B4D5C] sm:text-4xl">
              Dlaczego warto wybrac INF Shipping?
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Zapewniamy kompleksowa obsluge i wsparcie na kazdym etapie
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map((benefit, index) => (
              <div
                key={index}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#E8754B]/10 text-[#E8754B]">
                  <span className="text-lg font-bold">{index + 1}</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {benefit.title}
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  {benefit.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[#1B4D5C] sm:text-4xl">
              Co mowia nasi klienci
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Zaufali nam firmy z calego swiata
            </p>
          </div>

          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-4 flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} className="h-5 w-5 text-[#E8754B]" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-gray-700">
                  &ldquo;{testimonial.content}&rdquo;
                </p>
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <p className="font-semibold text-gray-900">{testimonial.name}</p>
                  <p className="text-sm text-gray-500">{testimonial.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-white py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-r from-[#1B4D5C] to-[#2a6a7a] px-8 py-16 text-center sm:px-16">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Dolacz do naszego zespolu
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Szukamy ambitnych osob, ktore chca rozwijac sie w branzy logistycznej. Sprawdz nasze aktualne oferty pracy.
            </p>
            <div className="mt-8">
              <Link
                href="/inf/kontakt"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Aplikuj teraz
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
