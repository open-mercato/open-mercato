import Link from 'next/link'
import { Header } from '../../components/Header'
import { Footer } from '../../components/Footer'

const services = [
  'Transport drogowy dla kazdego typu ladunku w calej Europie',
  'Pelne zaladunki kontenerowe (FTL) i mniejsze niz truckload (LTL)',
  'Transport krajowy w Polsce',
  'Miedzynarodowa wysylka w calej UE',
  'Rozwiazania transportu multimodalnego',
  'Uslugi dostawy door-to-door',
]

const cargoTypes = [
  'Przesylki kontenerowe',
  'Towary kontrolowane temperaturowo',
  'Standardowe towary',
  'Sprzet ponadgabarytowy/ciezki',
  'Materialy niebezpieczne (ADR)',
  'Mniejsze przesylki jednostkowe',
]

const fleetOptions = [
  'Samochody skrzyniowe',
  'Naczepy plandekowe',
  'Jednostki chlodnicze',
  'Furgonetki dostawcze',
  'Cysterny',
  'Naczepy niskopodwoziowe do ladunkow specjalistycznych',
]

const additionalServices = [
  'Koordynacja spedycji',
  'Sledzenie GPS w czasie rzeczywistym',
  'Opcje ubezpieczenia ladunku',
  'Obsluga dokumentacji celnej',
  'Kompleksowe zarzadzanie logistyka',
]

const processSteps = [
  {
    step: '1',
    title: 'Wycena',
    description: 'Szybkie i przejrzyste wyceny dopasowane do Twoich potrzeb.',
  },
  {
    step: '2',
    title: 'Zarzadzanie przesylka',
    description: 'Wygodne zarzadzanie na kazdym etapie realizacji.',
  },
  {
    step: '3',
    title: 'Komunikacja',
    description: 'Jasna komunikacja z doswiadczonym zespolem.',
  },
  {
    step: '4',
    title: 'Odprawa i dostawa',
    description: 'Odprawa ladunku i finalizacja transakcji.',
  },
]

export default function RoadTransportPage() {
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
            <span className="text-[#1B4D5C]">Transport drogowy</span>
          </div>
          <div className="mt-8 max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Transport drogowy - spedycja miedzynarodowa w Polsce i w calej Europie
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Oferujemy kompleksowe uslugi transportu drogowego na terenie calej Europy. Pelne i czesciowe zaladunki, transport specjalistyczny oraz rozwiazania door-to-door dla kazdego rodzaju ladunku.
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

      {/* Services Section */}
      <section className="bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Glowne uslugi transportowe
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service, index) => (
              <div key={index} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:border-[#1B4D5C]/30">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-gray-600">{service}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cargo Types & Fleet */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <h3 className="text-xl font-bold text-gray-900">Specjalizacje ladunkowe</h3>
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
              <h3 className="text-xl font-bold text-gray-900">Opcje floty</h3>
              <ul className="mt-6 space-y-4">
                {fleetOptions.map((option, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-600">{option}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Additional Services */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Dodatkowe uslugi
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {additionalServices.map((service, index) => (
              <div key={index} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 hover:border-[#1B4D5C]/30">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#1B4D5C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-gray-600">{service}</span>
              </div>
            ))}
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
              Potrzebujesz transportu drogowego?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Skontaktuj sie z nami i uzyskaj konkurencyjna wycene juz dzis.
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
