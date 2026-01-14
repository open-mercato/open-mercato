import Link from 'next/link'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'

const services = [
  {
    href: '/inf/uslugi/transport-morski',
    title: 'Transport morski',
    description: 'Oferujemy transport kontenerowy i drobnicowy do wszystkich zakatow swiata. Obslugujemy zarowno pelne kontenery (FCL), jak i przesylki mniejsze niz kontenerowe (LCL). Koordynujemy odbiory do koncowego dostarczenia.',
    features: [
      'Ladunek masowy (suchy i plynny)',
      'Towary kontrolowane temperaturowo',
      'Sprzet ponadgabarytowy/ciezki',
      'Materialy niebezpieczne (zgodnosc z IMDG)',
      'Ladunek drobnicowy ogolny',
    ],
    icon: (
      <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/transport-lotniczy',
    title: 'Transport lotniczy',
    description: 'Miedzynarodowy transport lotniczy na wszystkie kontynenty. Wspolpracujemy z glownymi liniami lotniczymi. Obslugujemy towary o wysokiej wartosci, produkty medyczne, elektronike. Opcje door-to-door i airport-to-airport.',
    features: [
      'Przesylki ekspresowe i kurierskie',
      'Towary latwo psujace sie (zywnosc, kwiaty, farmaceutyki)',
      'Materialy niebezpieczne (zgodnosc z IATA DGR)',
      'Ladunek ponadgabarytowy',
      'Przedmioty o wysokiej wartosci',
    ],
    icon: (
      <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/transport-drogowy',
    title: 'Transport drogowy',
    description: 'Transport drogowy na terenie calej Europy. Uslugi pelnego i czesciowego zaladunku (FTL/LTL). Specjalistyczna obsluga ladunkow kontrolowanych temperaturowo i ponadgabarytowych.',
    features: [
      'Przesylki kontenerowe',
      'Towary kontrolowane temperaturowo',
      'Standardowe towary',
      'Sprzet ponadgabarytowy/ciezki',
      'Materialy niebezpieczne (ADR)',
    ],
    icon: (
      <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/transport-kolejowy',
    title: 'Transport kolejowy',
    description: 'Trasy Europa-Azja. Rownowaga miedzy szybkoscia a optymalizacja kosztow. Obslugujemy przesylki od pojedynczych pudelek do pelnych pociagow.',
    features: [
      'Ladunek masowy (wegiel, zboze, chemikalia, cement)',
      'Transport kontenerowy/multimodalny',
      'Ladunek ponadgabarytowy (maszyny, komponenty infrastrukturalne)',
      'Materialy niebezpieczne (zgodnosc z RID)',
    ],
    icon: (
      <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/logistyka-magazynowa',
    title: 'Uslugi magazynowe',
    description: 'Obiekty z kontrola klimatu i przechowywanie materialow niebezpiecznych. Dodatkowe uslugi: konsolidacja, etykietowanie, pakowanie.',
    features: [
      'Magazynowanie krotko- i dlugoterminowe',
      'Obiekty z kontrola klimatu',
      'Kontrola jakosci i ilosci przy odbiorze',
      'Kompletacja zamowien i konsolidacja',
      'Cross-docking',
    ],
    icon: (
      <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    href: '/inf/uslugi/agencja-celna',
    title: 'Agencja celna',
    description: 'Pelna dokumentacja celna i procedury odprawy. Wiele opcji procedur, w tym odroczony VAT. Monitorowanie zgodnosci z przepisami.',
    features: [
      'Przygotowywanie i skladanie deklaracji',
      'Obliczanie cel i VAT',
      'Reprezentacja klienta przed organami celnymi',
      'Uzyskiwanie pozwolen i certyfikatow',
      'Wsparcie dla certyfikacji AEO',
    ],
    icon: (
      <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

export default function ServicesPage() {
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
              Miedzynarodowe uslugi logistyczne INF Shipping Solutions
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Specjalizujemy sie w miedzynarodowych uslugach logistycznych, oferujac sprawny, bezpieczny i terminowy transport Twoich towarow na caly swiat, ze wsparciem magazynowania i odprawy celnej.
            </p>
          </div>
        </div>
      </section>

      {/* Services List */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="space-y-16">
            {services.map((service, index) => (
              <div
                key={service.href}
                className={`grid gap-8 lg:grid-cols-2 lg:gap-16 ${
                  index % 2 === 1 ? 'lg:flex-row-reverse' : ''
                }`}
              >
                <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                  <div className="mb-4 inline-flex rounded-xl bg-[#1B4D5C]/10 p-4 text-[#1B4D5C]">
                    {service.icon}
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 sm:text-3xl">
                    {service.title}
                  </h2>
                  <p className="mt-4 text-gray-600">
                    {service.description}
                  </p>
                  <Link
                    href={service.href}
                    className="mt-6 inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#d9664a]"
                  >
                    Dowiedz sie wiecej
                    <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>

                <div className={`rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30 ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
                  <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#1B4D5C]">
                    Obslugiwane ladunki
                  </h3>
                  <ul className="space-y-3">
                    {service.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-start gap-3">
                        <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-gray-600">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-r from-[#1B4D5C] to-[#164250] px-8 py-16 text-center sm:px-16">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Potrzebujesz indywidualnej wyceny?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Skontaktuj sie z nami, a przygotujemy oferte dopasowana do Twoich potrzeb.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/inf/free-quote"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Odbierz darmowa wycene
              </Link>
              <Link
                href="/inf/kontakt"
                className="inline-flex items-center rounded-full border-2 border-white px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white hover:text-[#1B4D5C]"
              >
                Skontaktuj sie
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
