import Link from 'next/link'
import { Header } from '../../components/Header'
import { Footer } from '../../components/Footer'

const advantages = [
  {
    title: 'Efektywnosc kosztowa',
    description: 'Transport morski to najbardziej ekonomiczna metoda transportu duzych ilosci towarow na dlugie dystanse, szczegolnie w porownaniu z frachtemi lotniczym.',
  },
  {
    title: 'Wysoka pojemnosc',
    description: 'Statki transportuja ogromne ilosci ladunku bez ograniczen wymiarowych, co czyni je idealnymi do przesylek masowych, skonsolidowanych i ponadgabarytowych.',
  },
  {
    title: 'Globalny zasieg',
    description: 'Uslugi obejmuja niemal wszystkie porty swiata, w tym odlegle lokalizacje niedostepne innymi srodkami transportu.',
  },
  {
    title: 'Odpowiedzialnosc ekologiczna',
    description: 'Na tone transportowana na kilometr, transport morski generuje nizsze emisje niz alternatywy drogowe lub lotnicze.',
  },
]

const cargoTypes = [
  'Ladunek masowy (suchy i plynny)',
  'Towary kontrolowane temperaturowo',
  'Sprzet ponadgabarytowy/ciezki',
  'Materialy niebezpieczne (zgodnosc z IMDG)',
  'Ladunek drobnicowy ogolny',
]

const additionalServices = [
  'Operacje zaladunku/rozladunku w porcie',
  'Magazynowanie w terminalach',
  'Odprawa celna i dokumentacja',
  'Opcje ubezpieczenia ladunku',
  'Integracja transportu multimodalnego (rozwiazania door-to-door)',
]

const processSteps = [
  {
    step: '1',
    title: 'Prosta wycena',
    description: 'Szybkie i przejrzyste wyceny dopasowane do Twoich potrzeb transportowych.',
  },
  {
    step: '2',
    title: 'Zarzadzanie przesylka',
    description: 'Wygodne zarzadzanie przesylka na kazdym etapie realizacji.',
  },
  {
    step: '3',
    title: 'Komunikacja z klientem',
    description: 'Jasna komunikacja z doswiadczonym zespolem przez caly proces.',
  },
  {
    step: '4',
    title: 'Bezpieczna dostawa',
    description: 'Bezpieczna odprawa ladunku i finalizacja transakcji.',
  },
]

export default function SeaTransportPage() {
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
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/inf/uslugi" className="hover:text-gray-900">Uslugi</Link>
            <span>/</span>
            <span className="text-[#1B4D5C]">Transport morski</span>
          </div>
          <div className="mt-8 max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Transport morski
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              INF Shipping zapewnia miedzynarodowy transport morski - zarowno kontenerowy, jak i drobnicowy - do ponad 100 krajow na calym swiecie. Koordynujemy kompleksowe rozwiazania transportowe od poczatkowego zaladunku w porcie do koncowego rozladunku w miejscu przeznaczenia.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/inf/free-quote"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Odbierz darmowa wycene
              </Link>
              <Link
                href="/inf/kontakt"
                className="inline-flex items-center rounded-full border-2 border-[#1B4D5C] px-6 py-3 text-base font-semibold text-[#1B4D5C] transition-colors hover:bg-[#1B4D5C] hover:text-white"
              >
                Skontaktuj sie
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Advantages Section */}
      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Zalety transportu morskiego
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2">
            {advantages.map((advantage, index) => (
              <div key={index} className="rounded-2xl border border-gray-200 bg-white p-6 hover:border-[#1B4D5C]/30">
                <h3 className="text-lg font-semibold text-gray-900">{advantage.title}</h3>
                <p className="mt-2 text-gray-600">{advantage.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cargo Types & Services */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <h3 className="text-xl font-bold text-gray-900">Obslugiwane typy ladunkow</h3>
              <ul className="mt-6 space-y-4">
                {cargoTypes.map((type, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600">{type}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <h3 className="text-xl font-bold text-gray-900">Dodatkowe uslugi</h3>
              <ul className="mt-6 space-y-4">
                {additionalServices.map((service, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600">{service}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Timeline Info */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-2xl border border-[#1B4D5C]/30 bg-[#1B4D5C]/5 p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Czas realizacji</h3>
                <p className="mt-2 text-gray-600">
                  Typowy transport z Azji do Polski zajmuje 4-6 tygodni, w zaleznosci od portow wyjazdu/przyjazdu i warunkow tranzytowych.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Process Section */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Jak dzialamy
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {processSteps.map((step, index) => (
              <div key={index} className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-2xl font-bold text-[#1B4D5C]">
                  {step.step}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{step.description}</p>
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
              Gotowy na rozpoczecie?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Skontaktuj sie z nami juz dzis i uzyskaj bezplatna wycene transportu morskiego.
            </p>
            <div className="mt-8">
              <Link
                href="/inf/free-quote"
                className="inline-flex items-center rounded-full bg-[#E8754B] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9664a]"
              >
                Odbierz darmowa wycene
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
