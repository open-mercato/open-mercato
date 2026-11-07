/**
 * BIR1.1 response fixtures.
 *
 * `SEARCH_FOUND_INNER` / `SEARCH_NOT_FOUND_INNER` are verbatim payloads captured
 * from the GUS test endpoint (wyszukiwarkaregontest.stat.gov.pl) on 2026-09-30
 * (synthetic test-registry data). The multipart framing mirrors what BIR1 returns.
 */

export function escapeForXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function mtomEnvelope(method: string, result: string): string {
  return [
    '--uuid:5c1c2d1e-0000-4000-8000-000000000001+id=1',
    'Content-ID: <http://tempuri.org/0>',
    'Content-Transfer-Encoding: 8bit',
    'Content-Type: application/xop+xml;charset=utf-8;type="application/soap+xml;charset=utf-8"',
    '',
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing"><s:Header><a:Action s:mustUnderstand="1">http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/${method}Response</a:Action></s:Header><s:Body><${method}Response xmlns="http://CIS/BIR/PUBL/2014/07"><${method}Result>${result}</${method}Result></${method}Response></s:Body></s:Envelope>`,
    '--uuid:5c1c2d1e-0000-4000-8000-000000000001+id=1--',
    '',
  ].join('\r\n')
}

export const LOGIN_OK = mtomEnvelope('Zaloguj', 'p0o9i8u7y6t5r4e3w2q1')
export const LOGIN_EMPTY = mtomEnvelope('Zaloguj', '')
export const LOGOUT_OK = mtomEnvelope('Wyloguj', 'true')

export const SEARCH_FOUND_INNER = `<root>
  <dane>
    <Regon>140182840</Regon>
    <Nip>5252344078</Nip>
    <StatusNip />
    <Nazwa>GOOGLE POLAND SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ</Nazwa>
    <Wojewodztwo>MAZOWIECKIE</Wojewodztwo>
    <Powiat>m. st. Warszawa</Powiat>
    <Gmina>Śródmieście</Gmina>
    <Miejscowosc>Warszawa</Miejscowosc>
    <KodPocztowy>00-113</KodPocztowy>
    <Ulica>ul. Test-Krucza</Ulica>
    <NrNieruchomosci>53</NrNieruchomosci>
    <NrLokalu />
    <Typ>P</Typ>
    <SilosID>6</SilosID>
    <DataZakonczeniaDzialalnosci />
    <MiejscowoscPoczty>Warszawa</MiejscowoscPoczty>
  </dane>
</root>`

export const SEARCH_NOT_FOUND_INNER = `<root>
  <dane>
    <ErrorCode>4</ErrorCode>
    <ErrorMessagePl>Nie znaleziono podmiotu dla podanych kryteriów wyszukiwania.</ErrorMessagePl>
    <ErrorMessageEn>No data found for the specified search criteria.</ErrorMessageEn>
    <Nip>7261012312</Nip>
  </dane>
</root>`

/** Synthetic: legal entity plus one local unit, entity listed second. */
export const SEARCH_MULTIPLE_INNER = `<root>
  <dane>
    <Regon>14018284000031</Regon>
    <Nip>5252344078</Nip>
    <Nazwa>GOOGLE POLAND SP. Z O.O. ODDZIAŁ</Nazwa>
    <Miejscowosc>Kraków</Miejscowosc>
    <KodPocztowy>30-001</KodPocztowy>
    <Ulica>ul. Przykładowa</Ulica>
    <NrNieruchomosci>1</NrNieruchomosci>
    <Typ>LP</Typ>
    <DataZakonczeniaDzialalnosci />
  </dane>
  <dane>
    <Regon>140182840</Regon>
    <Nip>5252344078</Nip>
    <Nazwa>GOOGLE POLAND SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ</Nazwa>
    <Miejscowosc>Warszawa</Miejscowosc>
    <KodPocztowy>00-113</KodPocztowy>
    <Ulica>ul. Test-Krucza</Ulica>
    <NrNieruchomosci>53</NrNieruchomosci>
    <Typ>P</Typ>
    <DataZakonczeniaDzialalnosci />
  </dane>
</root>`

export const SEARCH_SESSION_ERROR_INNER = `<root>
  <dane>
    <ErrorCode>7</ErrorCode>
    <ErrorMessagePl>Brak sesji. Sesja wygasła lub przekazano nieprawidłową wartość identyfikatora sesji.</ErrorMessagePl>
    <ErrorMessageEn>No session. Session has expired or an invalid session identifier was passed.</ErrorMessageEn>
  </dane>
</root>`

export const searchResponse = (inner: string) => mtomEnvelope('DaneSzukajPodmioty', escapeForXml(inner))

export const SOAP_FAULT = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value></s:Code><s:Reason><s:Text xml:lang="en-US">The message could not be processed.</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>`
