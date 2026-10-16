# Finanse — mapa pokrycia prototypu

Stan analizy: **15 października 2026**. Punkt wejścia: [prototyp](http://localhost:3002/backend/finance-preview#s1). W nagłówku przycisk **Scenariusze** otwiera instrukcję zadania, rozpoczęcie, wznowienie i reset. Menu **Wszystkie ekrany** pozwala wyszukać ekran po nazwie.

## Co rzeczywiście jest gotowe do sprawdzenia

Prototyp ma **57 widoków i 18 scenariuszy prowadzonych**: dotychczasowe 43 widoki i 6 scenariuszy rozszerzono o 14 widoków i 12 scenariuszy. Liczba ekranów nie oznacza procentu realizacji specyfikacji. Współdzielone procesy zachowują identyfikatory dokumentów, dane formularzy i wyniki w sesji przeglądarki. Wybrane działania mają blokady, wyliczenia, podgląd dekretów, ponowienie po błędzie i zabezpieczenie przed powtórnym księgowaniem.

To materiał do badania pracy księgowej. Nie zapisuje do prawdziwej księgi ani nie wysyła przelewów, KSeF lub deklaracji. Eksporty nowych raportów są oznaczonymi danymi przykładowymi CSV; nie są urzędowym XML, UPO ani sprawozdaniem do złożenia. Scenariusze używają ustalonych danych i dat, a nie aktualnych kursów czy rzeczywistego salda organizacji.

### Jak czytać mapę

- **Ścieżka do przejścia**: podany przykład ma początek, walidację, wynik i możliwość ponownego otwarcia. Nie oznacza wszystkich wariantów modułu.
- **Częściowe**: oprócz działającego przykładu pozostają wymienione pola, warianty lub połączenia.
- **Poza UI fazy 1**: szczegółowa specyfikacja nie wymaga osobnego ekranu na tym etapie.
- **Do uzgodnienia**: brakuje specyfikacji albo źródła są sprzeczne; nie podstawiono wymyślonej reguły.

## Mapa: wymaganie → luka → uzupełnienie → pozostały zakres

| Obszar / źródło | Luka przed zmianą | Dodane lub poprawione w prototypie | Pozostały zakres / poziom |
|---|---|---|---|
| Księga i okresy, #5663 | Statyczny skrót planu i lista kontrolna okresu | **s44**: import, edycja konta, 12 okresów, kontrola nakładania dat, blokada i odblokowanie; koszt bez przeksięgowania blokuje zamknięcie | Częściowe: pełna edycja/usuwanie typów i kont użytych w zapisach, równoczesna edycja. Dziennik w fazie 1 jest do odczytu; istniejący formularz ręcznego zapisu jest szerszą propozycją UX |
| Startowy plan kont, #6137 | Brak importu | **s44**: dokładne 40 typów i 44 konta z przypiętej wersji specyfikacji; ponowny import odrzucony | Cofnięcie importu, konflikt równoczesnego importu i brak grup wymagają dalszej obsługi |
| Wymiary, #5972 | Brak rozróżnienia wymiaru od reguły podziału | MPK widoczne w wynikowym zapisie **s45** | Faza 1 nie przewiduje osobnego UI ani HTTP. Własność tagów i idempotencja zapisów to testy backendu |
| Reguły księgowania, #6015 | s31 pokazywał procentowy podział, a nie reguły kont 4 → 5 | **s45**: konto rozliczeniowe, nieprzypisane koszty, MPK, reguła 402-1 → 550-1, dekret 1 230 zł, ponowienie bez duplikatu; **s47** pokazuje wynik | Częściowe: wieloźródłowa kolejka, pełne przypadki contra/storno, usuwanie MPK i pełny produkcyjny hak zamknięcia |
| Kontrahenci, #5955 | Tylko nazwy na fakturach | **s46**: NIP i IBAN, dwie role, oddzielny wynik rejestru i akceptacji, odmowa akceptacji własnego wniosku, rachunek główny, brak odpowiedzi/spoza listy, zachowany obraz danych | Częściowe: pobranie nazwy/adresu z GUS i wspólna kartoteka z AP nie są spięte. Wybór osoby sprawdzającej to demonstracja rozdziału ról, nie zabezpieczenie RBAC |
| ZSiO, #6013 | Brak wyliczanego raportu | **s47**: BO, obroty okresu i narastająco, saldo, kontrola bilansu, zapis na dzień, zapisy otwarcia i storna, wynik s45 | Działa na spójnym zestawie przykładowych zapisów. Hierarchia i data obliczeń sprzeczne ze świeższym GL — patrz niżej |
| Hurtowy odczyt księgi, #6038 | Dziennik audytu mylony z eksportem księgowym | Rozdzielono zakres w mapie | Brak własnego UI fazy 1. Eksport księgowy CSV/XML/XLSX/PDF jest fazą 2; s41 nie zastępuje tego eksportu |
| Faktura zakupu, #5962 | Kontrola PO/odbioru kończyła się przejściem do płatności bez księgowania | **s43 → s8/s9 → s10**: zachowanie faktury, kontrola/odmowa/korekta, jawne księgowanie z kontami kosztu/VAT/zobowiązań i kontrolą zamkniętego okresu; po księgowaniu formularz do odczytu | Częściowe: pełny wielopozycyjny dokument AP, wszystkie stany anulowania, wspólny rejestr kontrahentów, wielowalutowość i realny obieg uprawnień |
| Paczki AP, #5962 | Różni dostawcy w jednej paczce, checkbox zamiast sprawdzenia rachunku | **s10**: jeden dostawca, pełne kwoty, tylko zaksięgowane faktury, data sprawdzenia, wynik niedostępny/negatywny blokuje, zapis wysłania jednokrotny Wn202/Ma130, odczyt po wysłaniu | Symulacja weryfikacji, jedna waluta PLN, jedna bieżąca paczka. Pełna historia wielu paczek i anulowanie przed wysłaniem pozostają do uzupełnienia. Przycisk nie wykonuje przelewu |
| Sprzedaż do GL, #6046 | Brak rozróżnienia wystawienia i księgowania | Istniejące **s42 → s25** zachowują wystawienie i rozliczenie walutowe | Częściowe: wszystkie konta przychodów per pozycja i produkcyjne powiązanie SalesInvoice. Spec fazy 1 jest API-only; UI sprzedaży wskazano jako fazę 2 |
| Bank, #6055 | Wyłącznie import i korekta 42 zł | **s52**: kontrola salda wyciągu, częściowa wpłata EUR i różnica kursowa, nadpłata PLN jako zobowiązanie, opłata, przelew własny; **s10 → s52** przenosi tę samą wysłaną paczkę i nie księguje jej drugi raz | Częściowe: pełne ręczne dodawanie wszystkich pozycji, domknięcie obu nóg przelewu własnego i trzy różne waluty. Parser MT940 nie jest wymaganiem fazy 1 |
| Środki trwałe, #6014 | Statyczna karta i miesięczna suma | **s48**: nabycie, konta, dokument OT, wartość końcowa, próg jednorazowego odpisu, plan i naliczenie, blokada okresu, ponowienie, ponowne otwarcie przed odpisem; zmiana planu z zachowaniem rat, utrata wartości i limit jej odwrócenia, sprzedaż/likwidacja z podglądem wartości netto i wyniku | Częściowe: rzeczywista pozycja AP, walutowe nabycie i pełne ustawienia klas |
| Koszt w czasie | Brak osobnego przykładu | **s49**: harmonogram polisy, rozliczenie miesięczne i pozostała kwota | **Propozycja UX**, nie luka #6014: spec mówi, że nie ma oddzielnej encji RMK, a mechanizm RMK stanowi harmonogram amortyzacji |
| RMP, #6193 | Brak procesu | **s50**: faktura źródłowa, daty usługi, harmonogram miesięczny, przeksięgowanie, raty, anulowanie przed odpisem, zatrzymanie z potwierdzeniem polityki, blokada korekty/okresu | Częściowe: rzeczywista faktura i automatyczne rozwiązanie korekty. Polityka wcześniejszego zakończenia wymaga wskazanego właściciela biznesowego |
| Waluty, #6190 | Tabela kursów i pojedyncza różnica kursowa | **s51**: historyczny kurs i otwarte saldo, NBP A, zysk AR/strata AP, wycena i odwrócenie jako para, brak kursu/następnego okresu, kolejne uruchomienie zachowuje historię | Spójny przykład 30.09.2026. Pozostaje rekonstrukcja sald na dzień i prawdziwy dostawca kursów |
| Podatki, #6168 + official#55 | Stawki VAT mylone z zobowiązaniem za okres | **s53**: VAT/CIT/PIT, mapowanie ról kont, oblicz → sprawdź dekret → zaksięguj → potwierdź płatność, zastąpione wyliczenia, historia | Uproszczona podstawa obliczeń i przykładowe dane. Brak prawdziwej dyspozycji podatkowej i produkcyjnych reguł podatkowych |
| KSeF → AP, official#60 | Brak odebranych dokumentów i duplikatu | **s54**: dokument i NIP, konto kosztu, termin, szkic, jawne powiązanie duplikatu, ponowne otwarcie własnego dokumentu | Częściowe: szkic pozostaje w rodzinie KSeF; nie trafia do pełnego obiegu s43/s10. Brak prawdziwego XML i synchronizacji |
| Uzgodnienie VAT, official#61 | Brak porównania rejestru z GL | **s55**: miesiąc, konta VAT, rejestr/księga/różnica, walidacja kwartału. Różnica nie blokuje JPK | Przykładowe źródła, nie odczyt rzeczywistej księgi |
| JPK_KR_PD, official#54 | Brak rocznego procesu | **s56**: osiem pól RPD, mapowanie przykładowe, ostrzeżenie o zerach, CSV, odrzucenie/ponowienie, zapis wysłanego stanu i szkic korekty | **Propozycja UI** dla speca odkładającego projekt ekranów. Brak urzędowego XML/XSD, certyfikatów i UPO; słowniki nadal do potwierdzenia |
| Sprawozdanie roczne, #6188 | Trzy statyczne kwoty zamiast Bilansu/RZiS | **s57**: warunki zamknięcia, mapowanie/brak mapowania, Bilans i dwa warianty RZiS, poprzedni rok, wynik, uchwała o zysku/stracie i przykładowy eksport | Częściowe: pełny edytor mapowania wszystkich kont, wszystkie liście ustawowego formularza, PDF/XLSX i historia ponownego zamknięcia |
| WMS / przesunięcia między magazynami, #6061 | Brak specyfikacji | Jawna luka w mapie | **Do uzgodnienia**: brak PR-a opisującego własność, datę, wycenę i dekret. Nie dopisano fikcyjnych reguł księgowych |

## Zależności i decyzje do domknięcia

1. **GL kontra ZSiO:** aktualny #5663 usuwa `parentAccountId`, a #6013 nadal opisuje agregację hierarchii. #6013 używa `posted_at`, nowszy GL wskazuje `operationDate`. Prototyp stosuje płaskie konta i datę operacji. To jawny wybór przykładu, nie rozwiązanie konfliktu publicznego kontraktu.
2. **Wcześniejsze zakończenie RMP:** w #6193 pozostaje `NEEDS HUMAN CONFIRMATION` dla rozpoznania całej pozostałej kwoty bez zwrotu. Potwierdzenie w prototypie służy ocenie tej decyzji; nie zastępuje zatwierdzenia jej przez właściciela domeny.
3. **JPK_KR_PD:** słownik S12_1, źródła D2/D9/Z2 i weryfikacja surowego XSD pozostają niezamknięte w źródle. Poprawny podgląd nie stanowi walidacji urzędowej.
4. **Rzeczywiste salda SalesInvoice:** [issue 7202](https://github.com/open-mercato/open-mercato/issues/7202) jest zależnością produkcyjnej integracji rozliczeń. Potwierdzenie salda w lokalnej symulacji nie dowodzi naprawienia tej zależności.
5. **Połączenia rodzin scenariuszy:** księga/reguły/ZSiO mają wspólny stan; AP i dopasowanie wysłanej paczki współdzielą tożsamość. KSeF/AP, rejestr kontrahentów/AP oraz wszystkie źródła raportów nie tworzą jeszcze jednego produkcyjnego zbioru dokumentów. Te miejsca są oznaczone jako częściowe.

## Kontrakt wizualny

Sprawdzono [Figmę: faktury](https://www.figma.com/design/qCq9z6q1if0mpoRstV5OEA/DS-Open-Mercato?node-id=200618-12071), w tym nagłówek `200618:12298` i tabelę `200660:13282`; dla pulpitu zachowano `200524:1401`. Nowe ekrany korzystają z istniejących rodzin `CrudForm`, `DataTable`, `Button`, `Card` i `FinanceStatusBadge`. Statusy mają neutralne wypełnienie i semantyczną ikonę. Akcje główne pozostają fioletowe, drugorzędne mają pełne jasne tło i obrys. Pola i przyciski zachowują skalę DS; podsumowania, odstępy, linie tabel i wyrównanie kwot są sprawdzane w przeglądarce.

Dla nowych widoków s44–s57 nie ma odpowiadających im gotowych ramek Figmy. Są rozwinięciem istniejącego języka komponentów, nie deklaracją zgodności piksel w piksel z nieistniejącym projektem.

## Weryfikacja i przekazanie księgowym

W testach używa się fikcyjnych danych sesji oraz istniejącego konta testowego; nie tworzy się faktur ani płatności w produkcyjnych modułach. Wybrany runner: **lokalny**; nie działa kontener compose `app`.

| Zestaw | Co sprawdza |
|---|---|
| TC-FIN-PREVIEW-001–003 | Dotychczasowe zadania, wszystkie 57 widoków, polski interfejs, reset, identyfikatory, statusy Figmy, alokacja i pulpit |
| TC-FIN-PREVIEW-010 | Import/okresy/reguły/ZSiO oraz kontrahent/akceptacja/rachunek |
| TC-FIN-PREVIEW-011 | Nabycie, odpisy, zmiana planu, utrata wartości/odwrócenie/zbycie, polisa/RMK, RMP, para wyceny, częściowa wpłata EUR i nadpłata PLN |
| TC-FIN-PREVIEW-012 | Podatki, duplikat KSeF, informacyjne uzgodnienie VAT, JPK odrzucenie/ponowienie, Bilans/RZiS i uchwała |
| TC-FIN-PREVIEW-013 | Jeden dostawca, brak wyniku Białej Listy, wysłanie tylko raz, ta sama paczka na wyciągu bez ponownego dekretu; dołączenie paczki powstałej po pierwszym zatwierdzeniu wyciągu |
| TC-FIN-PREVIEW-014 | Układ s10 i nowych ekranów przy 1440 i 390 px, poziome przepełnienie, granice kontrolek i kolor przycisków formularzy |

**Wynik kontroli:** 33 unikalne przypadki Playwright przeszły: pełny zestaw 31 (3,1 min) oraz dwa dodane testy zamkniętego okresu polisy i dołączenia późniejszej paczki (10,7 s). Po buildzie ponownie przeszły przepływ faktury do płatności i kontrola wszystkich nowych widoków przy 1440/390 px (2 testy, 11,2 s). Kontrola układu obejmuje również rzeczywisty kolor przycisków formularzy. Obejrzano zrzuty ekranu tabel, formularzy oraz wyników podatków i sprawozdań.

- App typecheck: **PASS** (`node scripts/typecheck.mjs` w `apps/mercato`).
- Lint modułu: **PASS**, bez błędów (`eslint src/modules/finance_previews`).
- Build aplikacji: **PASS** (`next build`), kompilacja 10,6 s; 9 istniejących ostrzeżeń Turbopack o dynamicznym loaderze i śledzeniu plików poza modułem prototypu.
- Skan nowych komponentów: bez surowych kolorów statusów, rozmiarów tekstu poza skalą, surowych pól HTML, `fetch` i nowych SVG inline. Stan globalnego DS ma istniejące naruszenia w innych modułach; nie jest to deklaracja zgodności całego repozytorium.
- Uruchomiony lokalny build: `http://localhost:3002`; wymaga zwykłego logowania i istniejącego uprawnienia `finance_previews.view`.

Powtórzenie zestawu przez konfigurację repozytorium: `BASE_URL=http://localhost:3002 yarn test:integration finance_previews` (aplikacja musi działać). Testy wykonane w tym zadaniu używały tymczasowej konfiguracji lokalnej z jednym workerem; po kontroli została usunięta. Nie zmieniono metadanych auto-discovery, więc nie było potrzeby ponownego generowania rejestrów.

Nie należy na podstawie samej listy ekranów ogłaszać akceptacji całej funkcjonalności finansowej. Pozostałe luki są wyszczególnione w tabeli powyżej.

## Przypięte źródła

Analiza obejmuje pełne pliki Markdown z HEAD-ów PR-ów podanych w [indeksie 6061](https://github.com/open-mercato/open-mercato/issues/6061) i [komentarzu o WMS](https://github.com/open-mercato/open-mercato/issues/6061#issuecomment-6060412076). PR opisujący specyfikację nie jest dowodem wdrożenia funkcji. #6016 jest bazą wiedzy, nie dodatkową listą ekranów.

| Repozytorium / PR | Wersja przejrzanego źródła |
|---|---|
| [core #5663](https://github.com/open-mercato/open-mercato/pull/5663) | `6431274fe2da6df2bedab634b3092a0d32c8a830` |
| [core #6137](https://github.com/open-mercato/open-mercato/pull/6137) | `d0113d0bc0d5b8b7747f035cba8c0874c8d27564` |
| [core #5972](https://github.com/open-mercato/open-mercato/pull/5972) | `e4632c6b7be8898ad60644fd55189aba0ac99f86` |
| [core #6015](https://github.com/open-mercato/open-mercato/pull/6015) | `e9f11cc1e70e5fd328982b2880d3a4e719afc7b0` |
| [core #5955](https://github.com/open-mercato/open-mercato/pull/5955) | `8f3382153b29da883e7ea70136eb001ce01e86b4` |
| [core #6013](https://github.com/open-mercato/open-mercato/pull/6013) | `ac32aa0594fc3a7f2cb3ad421b81e7593b77ec5a` |
| [core #6038](https://github.com/open-mercato/open-mercato/pull/6038) | `c000a7f7f4e876e42a9514fa9bfa45554a5b8e3f` |
| [core #5962](https://github.com/open-mercato/open-mercato/pull/5962) | `8594d089765141121ba3964a2c3ecd422985bd8a` |
| [core #6046](https://github.com/open-mercato/open-mercato/pull/6046) | `f511d3aa8a4b1d82e4cdf27b49df6f4fa66a48c7` |
| [core #6014](https://github.com/open-mercato/open-mercato/pull/6014) | `e133791bac352f5451b5c93ebe6c30937d5197bc` |
| [core #6055](https://github.com/open-mercato/open-mercato/pull/6055) | `a4d66cd7b9dcde982b30d992f69814d9b6a82ad8` |
| [core #6190](https://github.com/open-mercato/open-mercato/pull/6190) | `19d19986b2bbbcab591280fd2e0162beab45a392` |
| [core #6193](https://github.com/open-mercato/open-mercato/pull/6193) | `e6b9514fcda47a7346eacd737972ad89fa9352ee` |
| [core #6168](https://github.com/open-mercato/open-mercato/pull/6168) | `e1411cd0775dbd13196b8e52fce9e887a105fef2` |
| [core #6188](https://github.com/open-mercato/open-mercato/pull/6188) | `71e9b7b8d168482f841516990cb399db4f7ef04f` |
| [core #6016](https://github.com/open-mercato/open-mercato/pull/6016) | `04f7ab3fbe15a0f38869646116b3b27ec5a13c50` |
| [official #54](https://github.com/open-mercato/official-modules/pull/54) | `6b5dfb9a67f66a35e791bce2e2ef998e305d8488` |
| [official #55](https://github.com/open-mercato/official-modules/pull/55) | `79aa0b9d3724affa35bdc54d4944c07defbeb716` |
| [official #60](https://github.com/open-mercato/official-modules/pull/60) | `17b02f7d1f9fb9b01776649c3d5786fc9cf931ab` |
| [official #61](https://github.com/open-mercato/official-modules/pull/61) | `11a07e7c8e958d7d4958efd114dc9d785b202aef` |
