import Link from 'next/link'
import { Header } from '../../components/Header'
import { Footer } from '../../components/Footer'

const advantages = [
  {
    title: 'Szybkosc',
    description: 'Najszybsza dostepna metoda wysylki; ladunek moze dotrzec w ciagu 24-48 godzin dla pilnych dostaw.',
  },
  {
    title: 'Globalny zasieg',
    description: 'Polaczenie z miedzynarodowymi lotniskami na calym swiecie, umozliwiajace dystrybucje swiatowa z minimalnymi ograniczeniami geograficznymi.',
  },
  {
    title: 'Bezpieczenstwo',
    description: 'Wysokie standardy bezpieczenstwa na lotniskach zmniejszaja ryzyko uszkodzen i kradziezy, co czyni je idealnymi dla cennych lub wrazliwych towarow.',
  },
  {
    title: 'Minimalne ograniczenia geograficzne',
    description: 'Transport lotniczy dziala niezaleznie od infrastruktury drogowej, morskiej i kolejowej, docierajac do odleglych i trudno dostepnych lokalizacji.',
  },
]

const cargoTypes = [
  'Przesylki ekspresowe i kurierskie',
  'Towary latwo psujace sie (zywnosc, kwiaty, farmaceutyki)',
  'Materialy niebezpieczne (zgodnosc z IATA DGR)',
  'Ladunek ponadgabarytowy (wykorzystuje Antonov An-124, Boeing 747 Freighter)',
  'Przedmioty o wysokiej wartosci (bizuteria, elektronika, leki)',
  'Sprzet medyczny i ratunkowy',
]

const additionalServices = [
  'Konsolidacja ladunkow dla optymalizacji kosztow',
  'Transport door-to-door',
  'Magazynowanie w hubbach logistycznych',
  'Odprawa celna i dokumentacja',
  'Systemy sledzenia przesylek w czasie rzeczywistym',
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
    description: 'Bezpieczna obsluga i finalizacja transakcji.',
  },
]

export default function AirTransportPage() {
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
            <span className="text-[#1B4D5C]">Transport lotniczy</span>
          </div>
          <div className="mt-8 max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Transport lotniczy - szybko i skutecznie
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              INF Shipping wspolpracuje z glownymi liniami lotniczymi, aby zapewnic elastyczna, szybka i bezpieczna obsluge przesylek, w tym ladunkow o wysokiej wartosci. Oferujemy zarowno uslugi door-to-door, jak i airport-to-airport.
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
            Zalety transportu lotniczego
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
              <h3 className="text-xl font-bold text-gray-900">Kompleksowe uslugi wsparcia</h3>
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

      {/* Process Section */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
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
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-r from-[#1B4D5C] to-[#164250] px-8 py-16 text-center sm:px-16">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Potrzebujesz szybkiej dostawy?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Skontaktuj sie z nami i uzyskaj wycene transportu lotniczego juz dzis.
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
