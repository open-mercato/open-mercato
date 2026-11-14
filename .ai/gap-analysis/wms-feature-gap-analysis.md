# Inne systemy WMS ↔ WMS Open Mercato

Porównanie **55 funkcji** typowych dla innych systemów WMS z modułem `wms` Open Mercato.

| | |
|---|---|
| **Data** | 23 października 2026 |
| **Specyfikacje** | `.ai/specs/2026-04-15-wms-roadmap.md`, phase-1…phase-5 |
| **Kod** | `packages/core/src/modules/wms` |

---

## Uwagi ręczne (Marcin Kądziołka)

> Poniższa sekcja to **ręczny wpis Marcina Kądziołki** (priorytety i wnioski po analizie). Pełna analiza AI zaczyna się od [Podsumowania](#podsumowanie-analiza-ai).

### Co potrzebuje Marcin S

- Transfery międzymagazynowe.
- Transfery ze stanem pośrednim *in transit* — tego nie mamy, a warto by to było wprowadzić.
- Aplikacja mobilna na skanery — jest API, brak parsera różnego formatu kodów i samej aplikacji.
- Metadane przy produktach typu wielowymiarowe jednostki.
- Rozpiska procesów w systemie i odwzorowanie w aplikacji mobilnej.
- Przeliczanie jednostek (zakup w rolkach, sprzedaż na metry).
- Wyszukiwanie po kodzie (*Search by barcode*) — brakuje rozpoznawania ASN, zamówienia, rezerwacji i korekty. Są tylko lokalizacje i partia.

### Dobrze by też było mieć

- Silnik slottingu jest poza roadmapą, ale to duży temat — o tym rozmawialiśmy na spotkaniu. Żeby system sam wiedział, gdzie rozłożyć towar i jak to najlepiej zrobić.
- Podobnie silnik pickingu, żeby też to system optymalizował.

### Co jest warte uwagi i ważne z mojej perspektywy

- Brak konektorów do przewoźników — jest tylko kontrakt i mock.
- Ścieżka inbound od razu na outbound z pominięciem składowania + częściowe rozbicie przychodzącej paczki (*package splitting* — poza roadmapą).
- *Role-based TODO* — to mi się podoba w innych systemach WMS. Każda rola ma dashboard z priorytetami. U nas tylko operator i supervisor.
- Brak pełnych danych w Customer portal, np. statusu dostawy z WMS.
- QC bardziej gradualne, z krokami.
- *Cluster picking* — nie mamy w planach, a inne systemy WMS mają i to ma sens (batch, tylko od razu posortowane).
- *Drop-shipping* — nie planowaliśmy w ogóle.
- Planowanie i zakupy — całkowicie poza roadmapą, chociaż inne systemy WMS to mają.
- Wycena — całkowicie poza naszym WMS, chociaż inne systemy WMS to mają.

---

## Podsumowanie (analiza AI)

| Werdykt | Liczba | Znaczenie |
|---|---:|---|
| ✅ Pokryte teraz | **9** | Wynik operacyjny dostępny dziś |
| 🟡 Częściowo | **23** | Rdzeń jest, zostaje istotna luka |
| 🔵 Domknie faza 3 lub 5 | **4** | Specyfikacja jest, kodu jeszcze nie ma |
| 🔴 Poza roadmapą 1–5 | **19** | Nie planowane w początkowym WMS |
| ↳ z tego poza WMS z założenia | 14 | Zakupy, MRP albo księgowość |
| ↳ z tego luki operacyjne WMS | 5 | Magazyn bez fazy |

> **Faza 4** (plac, doki, awizacje, detention) nie zamyka żadnej pozycji z tej listy innych systemów WMS — to zakres, którego strona Inventory innych systemów WMS nie reklamuje.

### Jak czytać fazy

- **Faza 1–2** — w kodzie: topologia, ledger, rezerwacje, ASN, QC przyjęcia, putaway, skan API.
- **Faza 3** *(Draft)* — pick wave, short pick, pakowanie, handoff etykiety.
- **Faza 5** *(Draft)* — RMA, inspekcja, dyspozycja zwrotu.
- **Faza 4** *(Draft)* — yard; poza tą tabelą innych systemów WMS.

Werdykt **Pokryte** oznacza dostępny wynik operacyjny. Drobna reszta (osobny raport, push) jest w polu „Co zostaje” i nie obniża werdyktu.

### Spis obszarów

1. [Topologia magazynu](#topologia-magazynu) — 7 funkcji
2. [Przyjęcia](#przyjecia) — 3 funkcje
3. [Wydania](#wydania) — 7 funkcji
4. [Zapas i identyfikacja](#zapas-i-identyfikacja) — 15 funkcji
5. [Planowanie i zakupy](#planowanie-i-zakupy) — 11 funkcji
6. [Wysyłka i portal](#wysylka-i-portal) — 4 funkcje
7. [Zwroty](#zwroty) — 1 funkcja
8. [Wycena](#wycena) — 5 funkcji
9. [Rozszerzenia](#rozszerzenia) — 2 funkcje

---

## Topologia magazynu

| Funkcja | Werdykt |
|---|---|
| [Locations](#topologia-magazynu-locations) | ✅ Pokryte |
| [Operations](#topologia-magazynu-operations) | 🟡 Częściowo |
| [Multi-warehouse](#topologia-magazynu-multi-warehouse) | ✅ Pokryte |
| [Putaway rules](#topologia-magazynu-putaway-rules) | 🟡 Częściowo |
| [Push and pull rules](#topologia-magazynu-push-and-pull-rules) | 🔴 Poza roadmapą |
| [Cross-dock](#topologia-magazynu-cross-dock) | 🔴 Poza roadmapą |
| [By shipping method](#topologia-magazynu-by-shipping-method) | 🟡 Częściowo |

### Locations

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Lokalizacje: półki, alejki, chłodnie, regały paletowe. |
| **Teraz** | Jest. Magazyn, strefa i lokalizacja hierarchiczna: zone, aisle, rack, bin, slot, dock, staging. Pojemność w sztukach i wadze. |
| **Plan** | Wdrożone w fazie 1. |
| **Co zostaje** | Brak osobnej taksonomii storage category (klasa nośnika). Chłodnia to zwykła lokalizacja albo strefa, bez reguł temperatury. |

### Operations

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Osobne lokalizacje operacji: przyjęcie, sortowanie, pakowanie. |
| **Teraz** | Częściowo. Dock i staging są typami lokalizacji i nie wchodzą do rezerwacji sprzedaży. |
| **Plan** | Faza 3 dokłada kolejki pick/pack. Faza 5 dokłada staging zwrotów. Nowe typy lokalizacji nie są w specyfikacji. |
| **Co zostaje** | Pakowanie, jakość i złom nie mają własnego typu lokalizacji. Trasa operacji jest umowna, nie wymuszona grafem lokalizacji. |

### Multi-warehouse

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Wiele magazynów, stany i przesunięcia między nimi w jednym systemie. |
| **Teraz** | Jest. Wiele magazynów na organizację, jeden primary, ręczne move między lokalizacjami i magazynami, przypisanie magazynu do zamówienia. |
| **Plan** | Wdrożone w fazie 1. |
| **Co zostaje** | Automatyczne uzupełnianie między magazynami jest osobną funkcją (reguły push/pull) i nie jest zaplanowane. |

### Putaway rules

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Automatyczne skierowanie towaru na lokalizację wg pojemności, kategorii składowania i dostępności kompletacji. |
| **Teraz** | Częściowo. Faza 2 ma kolejkę PutawayTask: przypisanie, start, zakończenie. Cel wybiera operator. Staging i dock są zabronione jako cel. |
| **Plan** | Silnik slottingu jest wprost poza fazą 2 i nie wraca w fazach 3–5. |
| **Co zostaje** | Brak reguł putaway: pojemność, kategoria składowania, produkt, ścieżka pickera. Zadanie jest, decyzja o binie jest ręczna. |

### Push and pull rules

**🔴 Poza roadmapą**

| | |
|---|---|
| **Inne systemy WMS** | Własne trasy, które same planują przesunięcia między magazynami i lokalizacjami. |
| **Teraz** | Brak. Przesunięcie jest komendą moveInventory wywołaną przez operatora. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Nie ma silnika tras (route / rule) ani automatycznego transferu międzymagazynowego. |

### Cross-dock

**🔴 Poza roadmapą**

| | |
|---|---|
| **Inne systemy WMS** | Rozładunek i przekazanie od razu na bramę wyjściową, prawie bez składowania. |
| **Teraz** | Brak. Staging trzyma przyjęcie do czasu putaway na bin. Stock na dock/staging nie jest rezerwowalny. |
| **Plan** | Poza fazami 1–5. Faza 4 dotyczy placu i doków, nie przepływu cross-dock. |
| **Co zostaje** | Nie ma ścieżki inbound → outbound gate z pominięciem składowania. |

### By shipping method

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Trasa realizacji zależna od metody wysyłki: odbiór w sklepie, poczta, przewoźnik zewnętrzny. |
| **Teraz** | Częściowo, obok WMS. Sales ma metody wysyłki. Shipping carriers liczy stawki i kupuje etykietę. |
| **Plan** | Faza 3 przekazuje spakowaną przesyłkę do carriers. Trasa magazynowa per metoda nie jest w specyfikacji. |
| **Co zostaje** | Metoda wysyłki nie wybiera ścieżki magazynowej (pickup vs pack vs 3PL). |

---

## Przyjęcia

| Funkcja | Werdykt |
|---|---|
| [Receipts](#przyjecia-receipts) | 🟡 Częściowo |
| [Package splitting](#przyjecia-package-splitting) | 🔴 Poza roadmapą |
| [Quality checks](#przyjecia-quality-checks) | 🟡 Częściowo |

### Receipts

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Przyjęcia z datą od dostawcy i automatycznym przeliczeniem JM (np. zakup w tonach, sprzedaż w kg). |
| **Teraz** | Częściowo. ASN, linie, data oczekiwana, vendor UUID, przyjęcie ad-hoc i z ASN, rozbieżności ilości. Profil ma defaultUom jako etykietę. |
| **Plan** | Wdrożone w fazie 2. Konwersja JM przy przyjęciu nie jest w specyfikacji. |
| **Co zostaje** | Katalog ma przeliczniki jednostek, WMS ich nie stosuje przy receive. Ilość wchodzi w JM profilu, bez przeliczenia z JM zakupu. |

### Package splitting

**🔴 Poza roadmapą**

| | |
|---|---|
| **Inne systemy WMS** | Automatyczny rozbiór przesyłki zbiorczej na paczki składowania albo dystrybucji, zgodne ze standardową partią. |
| **Teraz** | Brak modelu opakowania zbiorczego i rozbicia na handling unit. |
| **Plan** | Poza fazami 1–5. Faza 3 ma carton_id na zadaniu pakowania wychodzącego, nie rozbiór przyjęcia. |
| **Co zostaje** | Nie ma inbound package split ani paczki jako nośnika stanu. |

### Quality checks

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Powtarzalne kontrole w dowolnym punkcie przepływu: przyjęcie, zwrot, podwykonawstwo. |
| **Teraz** | Częściowo. Przyjęcie ASN ma QC pass/fail. Fail nie zwiększa stanu dostępnego i nie tworzy putaway. |
| **Plan** | Faza 5 dokłada inspekcję i grading zwrotu. Konfigurowalne punkty kontroli na całym przepływie nie są w specyfikacji. |
| **Co zostaje** | QC to jeden status linii przyjęcia, nie plan kontroli z krokami, próbką i powtarzalnością. |

---

## Wydania

| Funkcja | Werdykt |
|---|---|
| [Smart removal](#wydania-smart-removal) | 🟡 Częściowo |
| [Pick](#wydania-pick) | 🔵 Faza 3 |
| [Pack](#wydania-pack) | 🔵 Faza 3 |
| [Stock allocation](#wydania-stock-allocation) | 🟡 Częściowo |
| [Reservation methods](#wydania-reservation-methods) | 🟡 Częściowo |
| [Drop-ship](#wydania-drop-ship) | 🔴 Poza roadmapą · poza WMS |
| [Quotation to shipment](#wydania-quotation-to-shipment) | 🟡 Częściowo |

### Smart removal

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Strategia zejścia: FIFO, FEFO, najbliższa strefa, LIFO. Metody pick: single, batch, cluster, wave. |
| **Teraz** | Częściowo. Profil wariantu: FIFO, LIFO, FEFO. Przy śledzeniu daty ważności FEFO jest wymuszone. Najbliższa strefa nie istnieje. |
| **Plan** | Faza 3: PickWave.strategy = single | batch | zone | wave. |
| **Co zostaje** | Po fazie 3 zostaje brak strategii nearest i metody cluster (jeden picker, wiele zamówień, sortowanie do kuwet). |

### Pick

**🔵 Faza 3**

| | |
|---|---|
| **Inne systemy WMS** | Automatyczne partie kompletacji wg przewoźnika, numerów seryjnych, ilości i wagi. Przy braku stanu — backorder. |
| **Teraz** | Brak kolejki kompletacji. Rezerwacja i alokacja są w fazie 1. Shortfall rezerwacji idzie jako powiadomienie. |
| **Plan** | Faza 3 (Draft, brak kodu): fala, zadanie pick, confirm, short pick, przypisanie operatora. |
| **Co zostaje** | Spec nie grupuje fali po przewoźniku, wadze ani serii. Backorder jako dokument oczekujący na dostawę nie jest nazwany — jest shortfall i ponowne rezerwowanie po przyjęciu. |

### Pack

**🔵 Faza 3**

| | |
|---|---|
| **Inne systemy WMS** | Kod kreskowy na zamkniętej paczce. Zmiana lokalizacji paczki przenosi też jej zawartość. |
| **Teraz** | Brak pakowania. Sales ma rekord wysyłki, carriers ma kreator przesyłki z edytorem paczek. |
| **Plan** | Faza 3: PackingTask, carton_id, packed snapshot, status etykiety, handoff do wysyłki. |
| **Co zostaje** | Paczka nie jest bytem magazynowym, którego ruch aktualizuje lokalizację zawartości. Karton w fazie 3 to snapshot zadania, nie handling unit. |

### Stock allocation

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Rezerwacja pod zamówienie i destynację, backorder wobec przyjęć, raport alokacji. |
| **Teraz** | Częściowo. Rezerwacja przy potwierdzeniu zamówienia i ręcznie. Alokacja osobnym stanem. Po przyjęciu i putaway rezerwacje są liczone ponownie. Na zamówieniu widać inboundSummary (otwarte ASN, najbliższa data). |
| **Plan** | Faza 3 zużywa alokację przy picku. Raport alokacji nie jest w specyfikacji. |
| **Co zostaje** | Rezerwacja jest pod zamówienie, nie pod dowolną destynację. Nie ma raportu alokacji ani dokumentu backorder powiązanego z konkretnym przyjęciem. |

### Reservation methods

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Trzy metody: przy potwierdzeniu, ręcznie, albo w zaplanowanej dacie. Z uwzględnieniem priorytetu klienta. |
| **Teraz** | Częściowo. Potwierdzenie zamówienia (toggle, domyślnie włączony) i ręczny reserve. Zwolnienie przy anulowaniu. |
| **Plan** | Rezerwacja na datę i priorytet klienta nie są w fazach 1–5. |
| **Co zostaje** | Jedna polityka na tenant (auto przy confirm albo API). Brak metody scheduled i kolejki priorytetu klienta. |

### Drop-ship

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Dostawca wysyła wybrany towar prosto do klienta, z pominięciem magazynu. |
| **Teraz** | Brak w WMS, sales i katalogu. |
| **Plan** | Poza fazami 1–5. Roadmap nie przewiduje modułu zakupów, który by to obsłużył. |
| **Co zostaje** | Cała ścieżka drop-ship: zamówienie zakupu, pominięcie stanu, dostawa od vendora do klienta. |

### Quotation to shipment

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Od oferty do klienta: po potwierdzeniu powstają zamówienia zakupu, transfery i wydania. |
| **Teraz** | Częściowo po stronie handlowej. Sales: oferta, zamówienie, wysyłka, płatność. WMS rezerwuje stan przy potwierdzeniu i pokazuje dostępność na zamówieniu. |
| **Plan** | Faza 3 domyka fizyczne wydanie: pick, pack, handoff. Automatyczne PO i transfery zostają poza planem. |
| **Co zostaje** | Łańcuch procure-to-deliver z innych systemów WMS jest szerszy niż realizacja magazynowa. Zakupy nie wystartują same z oferty. |

---

## Zapas i identyfikacja

| Funkcja | Werdykt |
|---|---|
| [Search products by location](#zapas-i-identyfikacja-search-products-by-location) | ✅ Pokryte |
| [Search by barcode](#zapas-i-identyfikacja-search-by-barcode) | 🟡 Częściowo |
| [Lots / serial numbers](#zapas-i-identyfikacja-lots-serial-numbers) | ✅ Pokryte |
| [Expiration dates](#zapas-i-identyfikacja-expiration-dates) | ✅ Pokryte |
| [Inventory adjustments](#zapas-i-identyfikacja-inventory-adjustments) | 🟡 Częściowo |
| [Scrap](#zapas-i-identyfikacja-scrap) | 🔵 Faza 5 |
| [Stock aging report](#zapas-i-identyfikacja-stock-aging-report) | 🟡 Częściowo |
| [Audit trail](#zapas-i-identyfikacja-audit-trail) | ✅ Pokryte |
| [Double-entry inventory](#zapas-i-identyfikacja-double-entry-inventory) | ✅ Pokryte |
| [Modify posted records](#zapas-i-identyfikacja-modify-posted-records) | 🟡 Częściowo |
| [Barcode](#zapas-i-identyfikacja-barcode) | 🟡 Częściowo |
| [Role-based to-do](#zapas-i-identyfikacja-role-based-to-do) | 🟡 Częściowo |
| [Product types](#zapas-i-identyfikacja-product-types) | 🟡 Częściowo |
| [Variants](#zapas-i-identyfikacja-variants) | ✅ Pokryte |
| [Custom fields](#zapas-i-identyfikacja-custom-fields) | ✅ Pokryte |

### Search products by location

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Jedna konsola: produkt, lokalizacja, ilość. |
| **Teraz** | Jest. Konsola zapasu, detal lokalizacji, detal SKU, lista partii, search index. |
| **Plan** | Wdrożone w fazie 1. |
| **Co zostaje** | Brak osobnego widoku „mapa magazynu”. Szukanie jest listą i detalem, nie planem regałów. |

### Search by barcode

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Skan kodu znajduje dowolny dokument magazynowy. |
| **Teraz** | Częściowo. API rozwiązuje kod lokalizacji i numer partii. Skan przy receive i putaway. |
| **Plan** | Faza 3 nie opisuje skanu fali ani dokumentu wysyłki. Rozszerzenie na „dowolny dokument” nie jest zaplanowane. |
| **Co zostaje** | Skan nie otwiera ASN, zamówienia, rezerwacji ani korekty. Rozpoznawane są lokalizacja i partia. |

### Lots / serial numbers

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Raport śledzenia od dostawcy do klienta i tożsamość produktu pod after-sales. |
| **Teraz** | Jest rdzeń. Profil: trackLot, trackSerial, trackExpiration. Partie z datami, statusem i stroną detalu. Ruch w ledgerze niesie lot. |
| **Plan** | Wdrożone w fazie 1. Osobny raport trace do serwisu posprzedażowego nie jest w fazach 1–5. |
| **Co zostaje** | Ślad jest księgą ruchów, nie jednym raportem „dostawca → klient → serwis”. Warranty claims to osobny moduł, niepodpięty pod partię WMS. |

### Expiration dates

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Przypomnienia i priorytet kompletacji wg daty ważności i strategii zejścia. |
| **Teraz** | Jest. FEFO wymuszone przy trackExpiration. Partia po dacie wypada z rezerwacji. Dashboard: expiring soon i past due. |
| **Plan** | Wdrożone w fazie 1. Pick w fazie 3 ma brać już zarezerwowane wiadro, więc FEFO działa wcześniej, przy alokacji. |
| **Co zostaje** | Przypomnienie to karta na dashboardzie, nie osobne powiadomienie (są tylko low stock i shortfall). |

### Inventory adjustments

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Cykliczne inwentaryzacje lokalizacji, produktów albo partii. |
| **Teraz** | Częściowo. Korekta z powodem i cycle count (counted quantity → uzgodnienie księgi). Oba są jednorazową akcją operatora. |
| **Plan** | Harmonogram powtarzalnych spisów nie jest w fazach 1–5. |
| **Co zostaje** | Da się policzyć lokalizację albo partię. Nie da się zaplanować „co tydzień ta alejka”. |

### Scrap

**🔵 Faza 5**

| | |
|---|---|
| **Inne systemy WMS** | Złom w kilku krokach i raport kosztów, powodów i wolumenu. |
| **Teraz** | Częściowo. Korekta in minus z powodem zdejmuje stan. Nie ma dokumentu złomu ani raportu kosztu. |
| **Plan** | Faza 5: dyspozycja scrap przy zwrocie, z ruchem magazynowym i logiem. |
| **Co zostaje** | Złom operacyjny poza zwrotem zostaje korektą. Koszt złomu wymaga wyceny zapasu, której roadmap nie obejmuje. |

### Stock aging report

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Jak długo towar leży. Ilości wg daty przyjęcia, w tym blisko terminu ważności. |
| **Teraz** | Częściowo. received_at jest na ruchu i służy FIFO/LIFO. Dashboard liczy starzejące się rezerwacje i daty ważności. Kolejka putaway ma aging zadania. |
| **Plan** | Raport aging stanu wg daty przyjęcia nie jest w fazach 1–5. |
| **Co zostaje** | Dane do raportu są w księdze. Brak zestawienia „ilość × wiek w magazynie”. |

### Audit trail

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Log ruchów, spisów, korekt, akceptacji korekt i zmian rekordów. |
| **Teraz** | Jest. InventoryMovement jest dopisywany, nie edytowany. Korekta i cycle count zapisują powód. Platforma ma audit_logs i undo komend konfiguracji. |
| **Plan** | Wdrożone w fazie 1. Archiwizacja księgi jest świadomie po fazach 1–5. |
| **Co zostaje** | Korekta nie ma osobnego kroku akceptacji. Ruchy stanu są nieodwracalne undo — cofa je ruch przeciwny. |

### Double-entry inventory

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Każdy ruch ma źródło i cel, da się przejść towar od dostawcy do klienta. |
| **Teraz** | Jest. Ruch ma typ, lokalizację źródłową i docelową, referencję procesu i ilość. To model podwójnego zapisu lokalizacji, nie księgi głównej. |
| **Plan** | Wdrożone w fazie 1. |
| **Co zostaje** | Zapis ilościowy jest. Zapis wartościowy (Wn/Ma w księgowości) jest osobną funkcją wyceny i nie jest zaplanowany. |

### Modify posted records

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Blokada i odblokowanie zaksięgowanego przyjęcia, picku albo zlecenia, żeby poprawić zużycie albo cenę. |
| **Teraz** | Częściowo. Konfiguracja (magazyn, lokalizacja, profil) ma undo. Ruchy stanu są append-only. Optimistic lock chroni równoległą edycję. |
| **Plan** | Lock/unlock zaksięgowanego dokumentu nie jest w fazach 1–5. |
| **Co zostaje** | Pomyłkę ilościową koryguje się nowym ruchem. Nie ma odblokowania posted receipt i poprawki w miejscu. |

### Barcode

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Skaner na przyjęciu, kompletacji i inwentaryzacji. GS1, EAN-13 i EAN-14 od razu. Praca z hali w czasie rzeczywistym. |
| **Teraz** | Częściowo. Endpointy skanu: lokalizacja, partia, receive ASN, putaway. Backend, bez powłoki mobilnej. |
| **Plan** | Faza 3 dokłada pick/pack, bez wymogu parsera GS1. UI skanera zostaje „później”. |
| **Co zostaje** | Brak parsera GS1/EAN-13/EAN-14, skanu inwentaryzacji i aplikacji hali. Skan jest API pod przyszły klient. |

### Role-based to-do

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Osobne pulpity: realizacja, zakupy, jakość, kompletacja, pakowanie, przyjęcia. Najwcześniejszy termin na górze. |
| **Teraz** | Częściowo. Dashboard operacyjny (niski stan, ważność, rezerwacje, ruchy). Kolejka putaway z aging. Role operator i supervisor. |
| **Plan** | Faza 3: kolejki pick i pack oraz wyjątki short. Faza 4: tablica placu. Faza 5: biurko RMA. Osobne pulpity zakupów i jakości nie powstają. |
| **Co zostaje** | Jedna konsola i kolejki zadań, nie sześć pulpitów zespołów z priorytetem deadline. |

### Product types

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Trzy typy: storable, consumable (bez stanu), service (bez stanu). |
| **Teraz** | Częściowo, w katalogu. Typy: simple, configurable, virtual, downloadable, bundle, grouped. WMS ma flagę manageInventory na profilu wariantu. |
| **Plan** | Mapowanie 1:1 na storable / consumable / service nie jest w fazach WMS. |
| **Co zostaje** | Virtual i downloadable pełnią rolę nielokalizowanego towaru. Consumable (zużycie bez śledzenia stanu) nie jest osobnym typem WMS. |

### Variants

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Warianty produktu i stan na żywo per wariant oraz per komponent. |
| **Teraz** | Jest po stronie katalogu i WMS. Stan, rezerwacja i profil są na catalogVariantId. Katalog ma warianty, bundle i grouped. |
| **Plan** | Wdrożone. Rozbicie bundla na dostępność komponentów nie jest w fazach WMS. |
| **Co zostaje** | Stan bundla nie jest liczony z komponentów. Każdy wariant ma własny stan. |

### Custom fields

**✅ Pokryte**

| | |
|---|---|
| **Inne systemy WMS** | Własne pola na transferze, produkcie i numerze seryjnym. |
| **Teraz** | Jest platformowo. Custom fields na encjach, w tym konfiguracji WMS. Partia i dokument WMS mogą dostać pola bez zmiany schematu stylu innych systemów WMS. |
| **Plan** | Wdrożone jako mechanizm platformy, nie jako osobna faza WMS. |
| **Co zostaje** | Pola trzeba zdefiniować w module entities. Nie ma gotowego zestawu pól „pod numer seryjny” włączonego domyślnie. |

---

## Planowanie i zakupy

| Funkcja | Werdykt |
|---|---|
| [Replenishment alerts](#planowanie-i-zakupy-replenishment-alerts) | 🟡 Częściowo |
| [Reordering rules](#planowanie-i-zakupy-reordering-rules) | 🟡 Częściowo |
| [Forecast](#planowanie-i-zakupy-forecast) | 🟡 Częściowo |
| [Smart scheduler](#planowanie-i-zakupy-smart-scheduler) | 🔴 Poza roadmapą |
| [Purchase orders](#planowanie-i-zakupy-purchase-orders) | 🔴 Poza roadmapą · poza WMS |
| [Lead times](#planowanie-i-zakupy-lead-times) | 🔴 Poza roadmapą · poza WMS |
| [Make-to-order](#planowanie-i-zakupy-make-to-order) | 🔴 Poza roadmapą · poza WMS |
| [Smart stock replenishment](#planowanie-i-zakupy-smart-stock-replenishment) | 🔴 Poza roadmapą · poza WMS |
| [Blanket orders](#planowanie-i-zakupy-blanket-orders) | 🔴 Poza roadmapą · poza WMS |
| [Vendor pricelist](#planowanie-i-zakupy-vendor-pricelist) | 🔴 Poza roadmapą · poza WMS |
| [Subcontracting](#planowanie-i-zakupy-subcontracting) | 🔴 Poza roadmapą · poza WMS |

### Replenishment alerts

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Alert niskiego stanu razem z lead time dostawcy, pod plan zamówień. |
| **Teraz** | Częściowo. Zdarzenie i powiadomienie wms.inventory.low_stock (in-app i e-mail), gdy dostępna ilość spadnie do reorder point. Safety stock jest na profilu. |
| **Plan** | Lead time vendora nie wchodzi do alertu w fazach 1–5. |
| **Co zostaje** | Alert mówi „mało”. Nie mówi „dostawca dowozi w X dni, zamów do daty”. |

### Reordering rules

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Min/max uruchamia zakup, transfer międzymagazynowy albo zlecenie produkcyjne. |
| **Teraz** | Częściowo. Reorder point i safety stock plus zdarzenie low stock. Dashboard ma reorder critical. |
| **Plan** | Reguła min/max → dokument zakupu, transfer albo MO nie jest w fazach 1–5. |
| **Co zostaje** | Próg jest. Skutek automatyczny (PO, MM, produkcja) nie powstaje. |

### Forecast

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Prognoza on hand, incoming i outgoing na żywo oraz data wyczerpania z zamówień, wysyłek i produkcji. |
| **Teraz** | Częściowo. On hand, reserved, allocated, available. Na zamówieniu: otwarte ASN i najbliższa data przyjęcia. |
| **Plan** | Silnik prognozy i data stockout nie są w fazach 1–5. |
| **Co zostaje** | Widać stan i oczekiwane przyjęcie. Nie widać projekcji „kiedy zejdzie do zera” z popytu i produkcji. |

### Smart scheduler

**🔴 Poza roadmapą**

| | |
|---|---|
| **Inne systemy WMS** | Scheduler sam odpala operacje na podstawie dostępności i prognozy zamówień. |
| **Teraz** | Brak schedulera operacji. Jedyny automat to rezerwacja po potwierdzeniu zamówienia i ponowne liczenie po wzroście stanu. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Operacje (pick, transfer, uzupełnienie) nie startują same z prognozy. |

### Purchase orders

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Automatyczne zapytanie ofertowe, gdy prognoza spadnie poniżej progu. |
| **Teraz** | Brak modułu zakupów. WMS ma uśpiony subscriber procurement.goods_receipt.created (toggle domyślnie off) — tworzy szkic ASN, gdy ktoś taki event wyemituje. |
| **Plan** | Poza fazami 1–5. Hook czeka na moduł, którego w core nie ma. |
| **Co zostaje** | Nie powstaje RFQ ani PO. Jest tylko furtka na przyjęcie z zewnętrznego procurement. |

### Lead times

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | JIT: lead time dostawcy, magazynu i klienta wliczany w każde zamówienie. |
| **Teraz** | Brak pól lead time na profilu zapasu, magazynie i vendora w WMS. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Daty obiecywane klientowi nie są liczone z łańcucha lead time. |

### Make-to-order

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Potwierdzenie sprzedaży odpala zakup albo produkcję. Trasy per magazyn, produkt i zamówienie. |
| **Teraz** | Potwierdzenie sprzedaży odpala rezerwację stanu, nie zakup i nie produkcję. |
| **Plan** | Poza fazami 1–5. Modułu MRP nie ma. |
| **Co zostaje** | MTO jako trasa procure-on-order. |

### Smart stock replenishment

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Wyliczenie min/max z historii sprzedaży i docelowych dni pokrycia, potem szkice PO. |
| **Teraz** | Reorder point jest ręczny. Historia sprzedaży nie przelicza progów. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Brak propozycji min/max i szkicu zamówienia zakupu. |

### Blanket orders

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Umowy ramowe: cykliczne zamówienia u zadanego dostawcy, ilości i daty dostaw. |
| **Teraz** | Brak w WMS i w core zakupów. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Cała funkcja zakupowa. |

### Vendor pricelist

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Cennik dostawcy: opis, cena, czas dostawy. Import listy. |
| **Teraz** | Katalog ma ceny sprzedaży (kanał, klient, promocja, próg ilości). To nie jest cennik zakupu. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Brak cennika vendora i lead time zakupu. |

### Subcontracting

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Po zamówieniu: wydanie surowca do podwykonawcy, jego rozliczenie, kontrola jakości i wysyłka wyrobu do klienta. |
| **Teraz** | Brak modułu produkcji i podwykonawstwa. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Cały przepływ surowiec → podwykonawca → wyrób. |

---

## Wysyłka i portal

| Funkcja | Werdykt |
|---|---|
| [Shipping labels](#wysylka-i-portal-shipping-labels) | 🟡 Częściowo |
| [Calculate shipping](#wysylka-i-portal-calculate-shipping) | 🟡 Częściowo |
| [Customer portal](#wysylka-i-portal-customer-portal) | 🟡 Częściowo |
| [Returns in the portal](#wysylka-i-portal-returns-in-the-portal) | 🔴 Poza roadmapą |

### Shipping labels

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Etykiety zintegrowanych przewoźników: FedEx, DHL, UPS, USPS, Bpost, Sendcloud, Easypost, Shiprocket. |
| **Teraz** | Częściowo. Moduł shipping_carriers: stawki, przesyłka, etykieta, tracking, webhook, kreator. Adapter jest wtyczką. W repozytorium jest kontrakt i mock, bez konektorów FedEx/DHL/UPS. |
| **Plan** | Faza 3 emituje wms.shipment.ready_for_label i prosi carriers o etykietę z pakowania. Lista przewoźników innych systemach WMS nie jest w specyfikacji. |
| **Co zostaje** | Hub jest. Brak gotowych konektorów z listy innych systemów WMS i brak podpięcia pod pakowanie, dopóki nie ma fazy 3. |

### Calculate shipping

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Koszt wysyłki u przewoźnika z wagi produktu i adresu klienta. |
| **Teraz** | Częściowo. POST stawek w shipping_carriers, kreator bierze paczki i adresy. Wynik zależy od adaptera. |
| **Plan** | Liczenie stawki zostaje w carriers. Faza 3 nie przenosi rate shoppingu do WMS — roadmap tego zabrania. |
| **Co zostaje** | Silnik stawek jest. Bez adaptera produkcyjnego stawka nie powstanie u prawdziwego przewoźnika. Waga z profilu WMS nie jest automatycznym wejściem do rate shop. |

### Customer portal

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | Klient widzi status zamówienia, płatności i dostawy, startuje zwrot i drukuje kod kreskowy z instrukcją. |
| **Teraz** | Częściowo. Portal klienta: zamówienia, oferty, faktury, katalog. To konto i RBAC portalu, nie śledzenie dostawy ani zwrot. |
| **Plan** | Faza 5 jest biurkiem pracownika (RMA), nie stroną klienta. |
| **Co zostaje** | Klient nie widzi statusu dostawy z WMS i nie zakłada zwrotu z kodem do skanowania na bramie. |

### Returns in the portal

**🔴 Poza roadmapą**

| | |
|---|---|
| **Inne systemy WMS** | Instrukcja zwrotu, kod kreskowy zamówienia, lokalizacja zwrotu i status ze znacznikami czasu na portalu. |
| **Teraz** | Sales ma zwrot handlowy (korekta linii, returned quantity). Portal tego nie wystawia jako przepływu z kodem. |
| **Plan** | Faza 5 nie opisuje portalu klienta ani drukowanego kodu zwrotu. |
| **Co zostaje** | Osobna od magazynowego RMA luka: self-service zwrotu z instrukcją i skanem na przyjęciu. |

---

## Zwroty

| Funkcja | Werdykt |
|---|---|
| [Returns](#zwroty-returns) | 🔵 Faza 5 |

### Returns

**🔵 Faza 5**

| | |
|---|---|
| **Inne systemy WMS** | Trasy zwrotu: ocena stanu, regeneracja, powrót na stan, utylizacja. Przy księgowości wycena wraca w księgi. |
| **Teraz** | Handlowo jest w sales (dokument zwrotu i korekta wartości zamówienia). Fizycznie WMS zwrotu nie przyjmuje. |
| **Plan** | Faza 5 (Draft, brak kodu): RMA, przyjęcie, inspekcja, grading, dyspozycja (restock, quarantine, scrap, zwrot do dostawcy), sygnał refund-ready. Księgowanie zostaje w sales / przyszłym finance. |
| **Co zostaje** | Regeneracja jako proces warsztatowy nie jest osobnym bytem — tylko typ dyspozycji, jeśli ktoś go skonfiguruje. Wycena zwrotu w księgach jest poza WMS z założenia. |

---

## Wycena

| Funkcja | Werdykt |
|---|---|
| [Costing methods](#wycena-costing-methods) | 🔴 Poza roadmapą · poza WMS |
| [Valuation methods](#wycena-valuation-methods) | 🔴 Poza roadmapą · poza WMS |
| [Perpetual inventory valuation](#wycena-perpetual-inventory-valuation) | 🔴 Poza roadmapą · poza WMS |
| [Landed costs](#wycena-landed-costs) | 🔴 Poza roadmapą · poza WMS |
| [Bill matching](#wycena-bill-matching) | 🔴 Poza roadmapą · poza WMS |

### Costing methods

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Koszt zapasu: FIFO, średni (AVCO), cena ewidencyjna. |
| **Teraz** | Brak kosztu magazynowego. FIFO/LIFO/FEFO w WMS dotyczą kolejności zejścia ilości, nie warstw kosztu. |
| **Plan** | Poza fazami 1–5. Roadmap oddaje księgowość poza WMS. |
| **Co zostaje** | Trzy metody wyceny i warstwy kosztu. |

### Valuation methods

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Wycena kontynentalna albo anglosaska (moment kosztu własnego sprzedaży). |
| **Teraz** | Brak modułu księgowego zapasu. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Wybór metody księgowej wyceny. |

### Perpetual inventory valuation

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Zapis księgowy na bieżąco przy zakupie, złomie i innych ruchach. |
| **Teraz** | Ruch ilościowy jest natychmiastowy. Zapis wartościowy w księgach nie powstaje. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Perpetual accounting. Ledger WMS nie jest dziennikiem księgowym. |

### Landed costs

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Koszt dodatkowy: faktura dostawcy, cło, fracht, opłata paliwowa. Korekta wartości na koniec okresu. |
| **Teraz** | Brak. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Rozliczenie kosztów dostarczenia na wartość zapasu. |

### Bill matching

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Powiązanie faktury dostawcy z PO i podświetlenie różnicy ilości albo ceny. |
| **Teraz** | Sales ma faktury sprzedaży. Trójstronne uzgodnienie faktury zakupu nie istnieje. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Matching bill–PO–receipt. |

---

## Rozszerzenia

| Funkcja | Werdykt |
|---|---|
| [Development](#rozszerzenia-development) | 🟡 Częściowo |
| [Rental](#rozszerzenia-rental) | 🔴 Poza roadmapą · poza WMS |

### Development

**🟡 Częściowo**

| | |
|---|---|
| **Inne systemy WMS** | API pod 3PL oraz sprzęt: wagi, skanery, RFID. |
| **Teraz** | Częściowo. Każdy route WMS ma OpenAPI. Jest moduł integrations, devices i API skanu. RFID, waga i konektor 3PL nie występują. |
| **Plan** | Fazy 1–5 zostawiają API pod skaner, bez kontraktu wagi, RFID i 3PL. |
| **Co zostaje** | Rozszerzalność HTTP jest. Sterowników sprzętu i profilu 3PL nie ma. |

### Rental

**🔴 Poza roadmapą · poza WMS z założenia**

| | |
|---|---|
| **Inne systemy WMS** | Wydanie, pakowanie, wysyłka i zwrot towaru wynajmowanego w tym samym magazynie. |
| **Teraz** | Brak modułu wynajmu. Warranty claims obsługuje reklamacje, nie cykl wypożyczenia. |
| **Plan** | Poza fazami 1–5. |
| **Co zostaje** | Cały obieg rental: pickup, pack, ship, return do puli wynajmu. |

---

## Luki operacyjne WMS (bez fazy w roadmapie 1–5)

- **Push and pull rules** *(Topologia magazynu)* — Nie ma silnika tras (route / rule) ani automatycznego transferu międzymagazynowego.
- **Cross-dock** *(Topologia magazynu)* — Nie ma ścieżki inbound → outbound gate z pominięciem składowania.
- **Package splitting** *(Przyjęcia)* — Nie ma inbound package split ani paczki jako nośnika stanu.
- **Smart scheduler** *(Planowanie i zakupy)* — Operacje (pick, transfer, uzupełnienie) nie startują same z prognozy.
- **Returns in the portal** *(Wysyłka i portal)* — Osobna od magazynowego RMA luka: self-service zwrotu z instrukcją i skanem na przyjęciu.

## Poza WMS z założenia (zakupy / MRP / księgowość)

- **Drop-ship** — Cała ścieżka drop-ship: zamówienie zakupu, pominięcie stanu, dostawa od vendora do klienta.
- **Purchase orders** — Nie powstaje RFQ ani PO. Jest tylko furtka na przyjęcie z zewnętrznego procurement.
- **Lead times** — Daty obiecywane klientowi nie są liczone z łańcucha lead time.
- **Make-to-order** — MTO jako trasa procure-on-order.
- **Smart stock replenishment** — Brak propozycji min/max i szkicu zamówienia zakupu.
- **Blanket orders** — Cała funkcja zakupowa.
- **Vendor pricelist** — Brak cennika vendora i lead time zakupu.
- **Subcontracting** — Cały przepływ surowiec → podwykonawca → wyrób.
- **Costing methods** — Trzy metody wyceny i warstwy kosztu.
- **Valuation methods** — Wybór metody księgowej wyceny.
- **Perpetual inventory valuation** — Perpetual accounting. Ledger WMS nie jest dziennikiem księgowym.
- **Landed costs** — Rozliczenie kosztów dostarczenia na wartość zapasu.
- **Bill matching** — Matching bill–PO–receipt.
- **Rental** — Cały obieg rental: pickup, pack, ship, return do puli wynajmu.

## Domknięcie w planie (jeszcze bez kodu)

- **Pick** → Faza 3 — Faza 3 (Draft, brak kodu): fala, zadanie pick, confirm, short pick, przypisanie operatora.
- **Pack** → Faza 3 — Faza 3: PackingTask, carton_id, packed snapshot, status etykiety, handoff do wysyłki.
- **Scrap** → Faza 5 — Faza 5: dyspozycja scrap przy zwrocie, z ruchem magazynowym i logiem.
- **Returns** → Faza 5 — Faza 5 (Draft, brak kodu): RMA, przyjęcie, inspekcja, grading, dyspozycja (restock, quarantine, scrap, zwrot do dostawcy), sygnał refund-ready. Księgowanie zostaje w sales / przyszłym finance.

---

*Wygenerowano z analizy gap innych systemów WMS vs WMS Open Mercato.*
