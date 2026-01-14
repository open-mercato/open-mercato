import Link from 'next/link'
import { Header } from '../../components/Header'
import { Footer } from '../../components/Footer'

const advantages = [
  {
    title: 'Efektywnosc i ekonomia',
    description: 'Transport kolejowy zapewnia szybszy tranzyt niz transport morski (srednio 11-18 dni), utrzymujac nizsze koszty niz fracht lotniczy, szczegolnie dla ciezkich ladunkow na dlugich dystansach.',
  },
  {
    title: 'Pojemnosc',
    description: 'Pociagi oferuja znacznie wieksza ladownosc niz ciezarowki, umozliwiajac ekonomiczny transport duzych wolumenow przesylek w pojedynczych operacjach.',
  },
  {
    title: 'Ekologia',
    description: 'Transport kolejowy generuje znacznie nizsze emisje CO2 na tone ladunku w porownaniu do alternatyw drogowych i lotniczych.',
  },
  {
    title: 'Bezpieczenstwo',
    description: 'Transport kolejowy jest uznawany za wysoko bezpieczny, co jest szczegolnie korzystne dla towarow o wysokiej wartosci lub materialow niebezpiecznych.',
  },
]

const cargoTypes = [
  'Ladunek masowy (wegiel, zboze, chemikalia, cement)',
  'Transport kontenerowy/multimodalny (elastycznosc door-to-door)',
  'Ladunek ponadgabarytowy (maszyny, komponenty infrastrukturalne)',
  'Materialy niebezpieczne (zgodnosc z regulacjami RID)',
]

const limitations = [
  'Wyzsze koszty niz fracht morski',
  'Wolniejszy niz transport lotniczy',
  'Mozliwe opoznienia na przejsciach granicznych',
  'Ograniczenia dla niektorych typow ladunku',
]

const processSteps = [
  {
    step: '1',
    title: 'Prosta wycena',
    description: 'Szybkie wyceny i szybkie skladanie zamowien.',
  },
  {
    step: '2',
    title: 'Zarzadzanie przesylka',
    description: 'Wygodne zarzadzanie przesylka.',
  },
  {
    step: '3',
    title: 'Komunikacja',
    description: 'Jasna komunikacja z doswiadczonym zespolem.',
  },
  {
    step: '4',
    title: 'Bezpieczna odprawa',
    description: 'Bezpieczna odprawa ladunku i finalizacja transakcji.',
  },
]

export default function RailTransportPage() {
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
            <span className="text-[#1B4D5C]">Transport kolejowy</span>
          </div>
          <div className="mt-8 max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
              Transport kolejowy miedzy Azja a Europa
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              INF Shipping oferuje transport kolejowy dla towarow miedzy Europa a Azja, obslugujac przesylki od pojedynczych pudelek do calych pociagow. Usluga rownowazy zalety szybkosci w stosunku do transportu morskiego z oszczednosciami kosztow w porownaniu z frachtem lotniczym.
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
            Kluczowe zalety
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

      {/* Cargo Types & Limitations */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-8 hover:border-[#1B4D5C]/30">
              <h3 className="text-xl font-bold text-gray-900">Typy uslug</h3>
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
              <h3 className="text-xl font-bold text-gray-900">Warto wiedziec</h3>
              <ul className="mt-6 space-y-4">
                {limitations.map((limitation, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-gray-600">{limitation}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Support Info */}
      <section className="border-t border-gray-200 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-2xl border border-[#1B4D5C]/30 bg-[#1B4D5C]/5 p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1B4D5C]/10 text-[#1B4D5C]">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Wsparcie 24/7</h3>
                <p className="mt-2 text-gray-600">
                  Firma podkresla wsparcie 24/7 i dedykowane zarzadzanie kontami przez cale operacje logistyczne.
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
            Etapy procesu
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
              Zainteresowany transportem kolejowym?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-white/80">
              Skontaktuj sie z nami, aby omowic optymalne rozwiazanie dla Twojej trasy Europa-Azja.
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
