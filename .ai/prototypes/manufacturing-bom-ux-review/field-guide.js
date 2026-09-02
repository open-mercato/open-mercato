/* Plain-language field guide rendered below every prototype screen.
   This is prototype documentation only: it does not define an API contract. */
(function () {
  'use strict';

  var guides = {
    s1: {
      title: 'Co oznacza lista BOM-ów?',
      intro: 'Lista służy do znalezienia definicji i wejścia do jej szczegółów. Tu niczego nie wpisujesz.',
      rows: [
        ['Produkt', 'Produkt końcowy, dla którego definiujemy strukturę materiałową.', 'Nie wpisujesz na liście; wyszukujesz jego kod lub nazwę.', 'Po otwarciu wyznacza cel oglądanego BOM-u.'],
        ['Wariant', 'Konkretny wariant produktu, np. rynek lub napięcie.', '— oznacza, że BOM dotyczy produktu bez wariantu.', 'Oddziela definicje dla różnych odmian tego samego produktu.'],
        ['Status i rewizja', 'Informacja, czy jest to edytowalny draft, czy wydana rewizja.', 'Nie edytujesz z listy.', 'Pozwala od razu rozpoznać, czy zapis można zmieniać.'],
        ['Pozycje / zmodyfikowano', 'Liczba bezpośrednich komponentów oraz autor i czas ostatniej zmiany.', '—', 'Pomaga ocenić wielkość i aktualność BOM-u.']
      ]
    },
    s2: {
      title: 'Jak zawęzić listę?',
      intro: 'To odpowiednik FilterBar w Sales: najpierw wpisujesz to, czego szukasz, potem zawężasz wynik filtrami.',
      rows: [
        ['Szukaj', 'Wspólne pole wyszukiwania po kodzie produktu, nazwie i rewizji.', 'Np. FG-100, „dozująca” albo D-004.', 'Szybko znajduje znaną definicję bez zmiany zakresu organizacji.'],
        ['Status', 'Filtr na drafty albo rewizje wydane.', 'Wybierz status, który chcesz przejrzeć.', 'Pozwala oddzielić pracę roboczą od zamrożonych definicji.'],
        ['Wariant', 'Filtr na konkretną odmianę produktu.', 'Np. EU / 230 V.', 'Nie miesza BOM-ów dla różnych wariantów.'],
        ['Pozycje / data', 'Filtry operacyjne na liczbę komponentów i datę modyfikacji.', 'Wybierz próg lub okres, nie wpisuj danych sprzedażowych.', 'Pomaga znaleźć większe lub ostatnio zmieniane definicje.']
      ]
    },
    s3: {
      title: 'Co ustawiam w widoku listy?',
      intro: 'To osobista perspektywa tabeli, podobna do ustawień kolumn DataTable. Nie zmienia danych BOM-u.',
      rows: [
        ['Nazwa widoku', 'Nazwa zapisanego układu tabeli.', 'Np. „Moje robocze BOM-y”.', 'Ułatwia ponowne użycie ustawień dla danej roli.'],
        ['Dostępne kolumny', 'Lista informacji, które mają być widoczne w tabeli.', 'Zaznacz tylko to, co potrzebne w codziennym przeglądzie.', 'Zmienia czytelność listy, nie zmienia BOM-ów.'],
        ['Tagi', 'Przyszła kolumna metadanych rozszerzeń.', 'Nie uzupełniasz ich tutaj.', 'Jest oznaczona P1.4h, więc nie należy jej traktować jako obecnej funkcji.']
      ]
    },
    s4: {
      title: 'Dlaczego lista jest pusta?',
      intro: 'To stan „brak dopasowań”, a nie brak BOM-ów. Jest zgodny z rozróżnieniem Search/Filtered empty state w Sales.',
      rows: [
        ['Aktywne wyszukiwanie', 'Tekst, który ogranicza wynik.', 'Zmień go lub usuń krzyżykiem.', 'Przywraca rekordy pasujące do innego zapytania.'],
        ['Aktywne filtry', 'Warunki dodatkowo zawężające wynik.', 'Usuń pojedynczy filtr albo użyj „Wyczyść wszystko”.', 'Nie usuwa żadnych danych; zmienia tylko widok.'],
        ['Utwórz BOM', 'Akcja dostępna tylko osobie z uprawnieniem autora.', 'Użyj tylko, gdy faktycznie brakuje definicji.', 'Prowadzi do formularza pierwszego draftu.']
      ]
    },
    s5: {
      title: 'Jak wypełnić nowy BOM?',
      intro: 'Tworzysz pustą, edytowalną wersję roboczą dla jednego celu. Komponenty dodaje się dopiero po tym kroku.',
      rows: [
        ['Produkt *', 'Wyrób, który ma zostać wyprodukowany według tej struktury.', 'Wybierz produkt końcowy z Katalogu, np. FG-100.', 'Jest kluczem rodziny BOM-u i polem obowiązkowym.'],
        ['Wariant', 'Opcjonalne doprecyzowanie odmiany produktu.', 'Wybierz tylko wariant należący do wybranego produktu.', 'Pozwala mieć niezależne struktury np. dla EU i US.'],
        ['Nazwa pomocnicza', 'Czytelny opis roboczy dla zespołu.', 'Np. „Standardowa konfiguracja EU”.', 'Pomaga rozpoznać intencję, nie zastępuje kodu produktu.'],
        ['Utwórz wersję roboczą', 'Zapisuje nagłówek i otwiera edytor komponentów.', 'Kliknij po poprawnym wyborze celu.', 'Powstaje draft; nie wydana definicja.']
      ]
    },
    s6: {
      title: 'Co oznacza walidacja?',
      intro: 'Formularz zatrzymuje zapis przed utworzeniem niejednoznacznej definicji.',
      rows: [
        ['Błąd celu', 'Dla tego samego produktu i wariantu istnieje już aktywny draft.', 'Nie wpisuj duplikatu; otwórz istniejący draft albo wybierz inny cel.', 'Chroni przed dwiema równoległymi wersjami roboczymi.'],
        ['Otwórz D-004', 'Bezpieczna droga do istniejącej wersji roboczej.', 'Nie wprowadzasz danych.', 'Kieruje do jednego źródła prawdy.']
      ]
    },
    s7: {
      title: 'Jak czytać edytor BOM-u?',
      intro: 'To najważniejszy ekran pracy. Każdy wiersz opisuje jedno bezpośrednie wystąpienie komponentu – nawet jeśli ten sam komponent pojawia się drugi raz.',
      rows: [
        ['Produkt / wariant / D-004', 'Cel BOM-u, jego wariant i identyfikator aktualnej wersji roboczej.', 'Edytuj nagłówek tylko, gdy zmienia się cel lub opis.', 'Ustala kontekst wszystkich komponentów poniżej.'],
        ['Poz.', 'Kolejność bezpośredniego komponentu.', 'Nie wpisujesz ręcznie w tabeli; zmieniasz akcją góra/dół.', 'Komunikuje kolejność autorską bez drag-and-drop.'],
        ['Komponent', 'Materiał lub podzespół pobrany z Katalogu.', 'Wybierz konkretny kod i, jeśli potrzebne, wariant.', 'Określa, co jest zużywane lub wytwarzane.'],
        ['Ilość / podstawa / wydajność', 'Ilość komponentu, sposób naliczania oraz oczekiwany uzysk.', 'Np. 2 szt., zmienna, 98%.', 'Definiuje zapotrzebowanie i informuje o stratach.'],
        ['Dostawa / stan', 'Czy komponent pobieramy z magazynu, czy produkujemy oraz czy ma rozwiązaną definicję dziecka.', 'Wybierz zgodnie z procesem; sprawdź ostrzeżenia.', '„Produkuj” tworzy zależność w strukturze.'],
        ['⋯ akcje wiersza', 'Wzorzec RowActions z Sales: edycja i usunięcie dotyczą dokładnie jednego wiersza.', 'W finalnym UI otworzy menu akcji.', 'Zapobiega przypadkowemu mieszaniu operacji z danymi tabeli.']
      ]
    },
    s8: {
      title: 'Co mogę zmienić w nagłówku?',
      intro: 'Formularz jest odpowiednikiem małego CrudForm: pola opisują definicję, nie pojedynczy komponent.',
      rows: [
        ['Produkt', 'Wyrób docelowy BOM-u.', 'Na tym przykładzie zablokowany; zmiana celu wymaga walidacji rodziny.', 'Chroni powiązanie draftu z produktem.'],
        ['Wariant', 'Odmiana celu.', 'Wybierz wariant prawidłowy dla produktu.', 'Może wymagać ponownego sprawdzenia komponentów.'],
        ['Nazwa pomocnicza', 'Opis dla ludzi.', 'Wpisz krótkie rozróżnienie konfiguracji.', 'Nie zmienia struktury ani ilości.']
      ]
    },
    s9: {
      title: 'Co zrobić z niezapisanymi zmianami?',
      intro: 'To ochrona przed przypadkowym opuszczeniem formularza.',
      rows: [
        ['Zostań i kontynuuj', 'Wraca do edytora bez utraty wpisanych wartości.', 'Wybierz, gdy chcesz jeszcze poprawić dane.', 'Nic nie zapisuje.'],
        ['Odrzuć zmiany', 'Porzuca lokalne zmiany formularza.', 'Użyj tylko świadomie.', 'Nie zmienia zapisanego BOM-u.'],
        ['Zapisz i wróć', 'Najpierw waliduje i zapisuje edycję.', 'Użyj, gdy formularz jest gotowy.', 'Odświeża wersję rekordu.']
      ]
    },
    s10: {
      title: 'Jak dodać komponent?',
      intro: 'Dialog naśladuje wzorzec Sales: modalny formularz jednej pozycji z wyraźnymi polami i akcjami zapisu.',
      rows: [
        ['Komponent *', 'Materiał lub podzespół z Katalogu.', 'Wybierz kod, nazwę i ewentualny wariant.', 'Tworzy nową bezpośrednią pozycję BOM-u.'],
        ['Ilość * / jednostka *', 'Ile komponentu jest potrzebne i w jakiej jednostce.', 'Np. 2 i szt.; zawsze podaj oba pola.', 'System normalizuje ilość zgodnie z Katalogiem.'],
        ['Podstawa', 'Czy ilość zmienia się wraz z produkcją, czy jest stała.', 'Zmienna dla zużycia proporcjonalnego, stała dla jednorazowego.', 'Wyjaśnia sposób interpretacji zapotrzebowania.'],
        ['Wydajność', 'Procent zakładanego uzysku komponentu.', 'Wpisz 100 dla braku strat, np. 98 przy stratach.', 'Pokazuje planowaną efektywność.'],
        ['Dostawa', 'Źródło komponentu.', 'Magazyn dla materiału; Produkuj dla podzespołu.', 'Przy „Produkuj” sprawdzana jest definicja dziecka i cykl.'],
        ['Pozycja', 'Miejsce nowego wystąpienia w kolejności BOM-u.', 'Zostaw domyślne „po końcu listy”, jeśli nie masz szczególnej potrzeby.', 'Określa kolejność autorską.']
      ]
    },
    s11: { title: 'Co usuwam?', intro: 'Potwierdzenie, podobne do confirm dialog używanego w Sales.', rows: [['Nazwa komponentu', 'Dokładna pozycja, która zostanie usunięta.', 'Przeczytaj przed potwierdzeniem.', 'Chroni przed usunięciem niewłaściwego duplikatu.'], ['Usuń komponent', 'Akcja destrukcyjna dla jednego wystąpienia.', 'Kliknij tylko po weryfikacji.', 'Usuwa wiersz i pokaże możliwość cofnięcia.']] },
    s12: { title: 'Co oznacza cofnięcie?', intro: 'Po udanym usunięciu system daje bezpieczną, krótką drogę do odwrócenia akcji.', rows: [['Cofnij', 'Próbuje semantycznie przywrócić usuniętą pozycję.', 'Użyj od razu, jeśli usunięcie było pomyłką.', 'Nie nadpisze późniejszej sprzecznej zmiany.'], ['Liczba pozycji', 'Aktualny wynik po usunięciu.', '—', 'Pozwala od razu zobaczyć skutek akcji.']] },
    s13: { title: 'Co znaczy „nierozwiązany”?', intro: 'To ostrzeżenie dla komponentu ustawionego jako „Produkuj”; draft nadal pozostaje czytelny i edytowalny.', rows: [['Komponent', 'Produkt, dla którego nie znaleziono aktywnego BOM-u dziecka.', 'Sprawdź produkt, wariant albo wybierz Magazyn.', 'Zostaje widoczny bez cichej zmiany danych.'], ['Dostawa: Produkuj', 'Oczekiwanie, że podzespół ma własną definicję.', 'Wybierz tylko, gdy komponent powinien być produkowany.', 'Prowadzi do zależności strukturalnej.']] },
    s14: { title: 'Dlaczego zapis został zablokowany?', intro: 'System chroni strukturę przed bezpośrednim lub pośrednim cyklem.', rows: [['Ścieżka cyklu', 'Pokazuje bezpiecznie skróconą zależność, która wraca do bieżącego BOM-u.', 'Nie wpisujesz tu niczego; wróć do formularza.', 'Zapobiega nieskończonemu rozwijaniu drzewa i błędnej strukturze.'], ['Wróć do formularza', 'Pozostawia wprowadzone dane do korekty.', 'Zmień komponent lub źródło dostawy.', 'Nie zapisuje nieprawidłowej pozycji.']] },
    s15: { title: 'Jak czytać drzewo?', intro: 'Drzewo jest wyłącznie do odczytu i pokazuje rozwinięte zależności „Produkuj”.', rows: [['Węzeł główny', 'Produkt, którego BOM oglądasz.', '—', 'Jest korzeniem całej prezentowanej struktury.'], ['Węzły potomne', 'Bezpośrednie i niższe komponenty.', '—', 'Pokazują, gdzie w strukturze występuje komponent.'], ['Odśwież podgląd', 'Ponownie pobiera drzewo po zmianach.', 'Kliknij po edycji komponentów.', 'Chroni przed wnioskami na podstawie starego podglądu.']] },
    s16: { title: 'Dlaczego nie mogę edytować?', intro: 'To wydana rewizja: dowód inżynierski, a nie roboczy formularz.', rows: [['Wydana / R-003', 'Status i identyfikator zamrożonej rewizji.', '—', 'Odróżnia ją od edytowalnego draftu.'], ['Edytuj', 'Nieaktywna akcja celowo pokazująca granicę stanu.', 'Nie używaj; do decyzji pozostaje P1.7.', 'Chroni wydaną definicję przed zmianą.'], ['Porównaj / kopiuj', 'Przyszłe, osobne drogi pracy z wydaną definicją.', 'Nie traktuj jako funkcji wdrożonej.', 'Są oznaczone odpowiednio P1.4f i P1.4g.']] },
    s17: { title: 'Jak czytać historię?', intro: 'To kandydat P1.4e; komentarze produktu są czym innym niż komentarze do tej makiety.', rows: [['Zmiany', 'Kto, co i kiedy zmienił w BOM-ie.', 'Nie wpisujesz danych w historię.', 'Ułatwia wyjaśnienie pochodzenia zmian.'], ['Komentarz', 'Wiadomość zespołowa dotycząca definicji.', 'Wpisz pytanie lub decyzję techniczną.', 'Nie jest zatwierdzeniem wydania.']] },
    s18: { title: 'Co porównuję?', intro: 'To kandydat P1.4f do oceny wpływu zmian.', rows: [['R-002 / R-003', 'Dwie rewizje tego samego produktu.', 'W docelowej funkcji wybierzesz rewizje do porównania.', 'Pokazuje dodane, usunięte i zmienione wystąpienia.'], ['Gdzie użyto', 'Lista struktur, które zależą od wybranego produktu.', 'Nie wpisujesz danych.', 'Pomaga ocenić wpływ zmiany.']] },
    s19: { title: 'Jak skopiować strukturę?', intro: 'To kandydat P1.4g: źródłem jest istniejąca rewizja, wynikiem zawsze nowy draft.', rows: [['Nowy produkt docelowy *', 'Produkt, dla którego powstanie kopia.', 'Wybierz inny, uprawniony produkt z Katalogu.', 'Nowa rodzina przechodzi pełną walidację.'], ['Wariant', 'Opcjonalny wariant nowego celu.', 'Wybierz tylko prawidłową odmianę.', 'Nie dziedziczy automatycznie wariantu wbrew Katalogowi.'], ['Nazwa pomocnicza', 'Opis pochodzenia kopii.', 'Np. „Skopiowano z FG-200 / R-003”.', 'Ułatwia audyt, ale nie zastępuje rewizji.']] },
    s20: { title: 'Czym są pola rozszerzeń?', intro: 'To kandydat P1.4h, oddzielony od rdzenia struktury i komponentów.', rows: [['Klasa ryzyka', 'Przykładowe pole niestandardowe organizacji.', 'Wybierz wartość z uzgodnionej listy.', 'Nie zmienia obliczenia struktury.'], ['Tagi', 'Etykiety ułatwiające klasyfikację i filtrowanie.', 'Dodaj wyłącznie ustalone tagi, np. CE.', 'Ułatwiają odnalezienie i raportowanie.'], ['Dokumenty', 'Kontrolowane odnośniki do dokumentacji inżynierskiej.', 'Dodaj właściwy dokument i jego typ.', 'Nie są automatycznie zatwierdzeniem wydania.']] },
    s21: { title: 'Co robię, gdy rekord się zmienił?', intro: 'Ten stan będzie używał wspólnego banera konfliktu z AppShell, tak jak Sales.', rows: [['Odśwież', 'Pobiera aktualny stan rekordu zapisany przez inną osobę.', 'Kliknij przed kolejną próbą zapisu.', 'Nie scala automatycznie lokalnych zmian.'], ['Zamknij / zostań', 'Pozwala odłożyć komunikat lub wrócić do edycji.', 'Użyj tylko, jeśli rozumiesz ryzyko starego formularza.', 'Nie usuwa konfliktu po stronie serwera.']] },
    s22: { title: 'Jak reagować na błąd?', intro: 'Każdy komunikat ma inną przyczynę i inną bezpieczną akcję.', rows: [['Brak dostępu', 'Twoja rola nie pozwala na daną akcję.', 'Nie próbuj obchodzić ograniczenia; poproś o rolę.', 'Nie ujawnia dodatkowych danych.'], ['Katalog niedostępny', 'Nie można teraz zweryfikować informacji o produkcie.', 'Spróbuj ponownie przed zmianą komponentu.', 'Istniejący zapis pozostaje czytelny.'], ['Błąd serwera', 'Zapis nie został potwierdzony.', 'Wróć do edytora, zachowaj dane i spróbuj później.', 'Nie udaje sukcesu mutacji.']] },
    s23: { title: 'Co robię, gdy nie ma żadnych BOM-ów?', intro: 'To stan początkowy nowej organizacji, inny niż brak wyników wyszukiwania.', rows: [['Utwórz pierwszy BOM', 'Pierwsza akcja autora BOM-u.', 'Przejdź do wyboru produktu i wariantu.', 'Inicjuje pierwszą wersję roboczą.'], ['Brak definicji', 'Informacja o zakresie, nie błąd systemu.', 'Nie wpisujesz danych na tym ekranie.', 'Wyjaśnia, dlaczego tabela jest pusta.']] }
  };

  function cell(text, className) {
    var node = document.createElement('td');
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function renderGuide(screen, guide) {
    var details = document.createElement('details');
    details.className = 'field-guide';
    var summary = document.createElement('summary');
    summary.textContent = 'Pola i działania na tym ekranie';
    details.appendChild(summary);
    var body = document.createElement('div');
    body.className = 'field-guide-body';
    var heading = document.createElement('h3');
    heading.textContent = guide.title;
    var intro = document.createElement('p');
    intro.className = 'muted';
    intro.textContent = guide.intro;
    var wrap = document.createElement('div');
    wrap.className = 'field-guide-table-wrap';
    var table = document.createElement('table');
    table.className = 'table field-guide-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Pole lub działanie', 'Co oznacza', 'Co robi użytkownik', 'Wpływ na BOM'].forEach(function (label) {
      var th = document.createElement('th'); th.textContent = label; headRow.appendChild(th);
    });
    thead.appendChild(headRow); table.appendChild(thead);
    var tbody = document.createElement('tbody');
    guide.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(row[0], 'field-guide-name'));
      tr.appendChild(cell(row[1])); tr.appendChild(cell(row[2])); tr.appendChild(cell(row[3]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table);
    body.appendChild(heading); body.appendChild(intro); body.appendChild(wrap); details.appendChild(body);
    var notes = screen.querySelector('.notes');
    if (notes) screen.insertBefore(details, notes); else screen.appendChild(details);
  }

  function button(label, className, target) {
    var node = document.createElement('button');
    node.type = 'button'; node.className = className; node.textContent = label;
    if (target) node.setAttribute('data-goto', target);
    return node;
  }

  function alignWithSales() {
    document.querySelectorAll('#s7 .line-table button[data-goto="s10"]').forEach(function (node) {
      node.className = 'btn btn-outline btn-xs row-actions-trigger';
      node.textContent = '•••';
      node.setAttribute('aria-label', 'Akcje pozycji komponentu');
      node.title = 'Akcje: edytuj lub usuń';
    });
    var dialog = document.querySelector('#s10 .modal-stage');
    if (dialog) dialog.classList.add('sales-dialog-stage');
    var conflict = document.querySelector('#s21 .modal-stage');
    if (conflict) {
      conflict.className = 'conflict-stage';
      conflict.replaceChildren();
      var shell = document.createElement('div'); shell.className = 'conflict-shell';
      var banner = document.createElement('div'); banner.className = 'sales-conflict-banner'; banner.setAttribute('role', 'alert');
      var copy = document.createElement('div');
      var strong = document.createElement('b'); strong.textContent = 'Rekord został zmieniony';
      var text = document.createElement('span'); text.textContent = ' Piotr Nowak zapisał nowszą wersję o 10:48. Twoje zmiany nie zostały zapisane.';
      copy.appendChild(strong); copy.appendChild(text);
      banner.appendChild(copy); banner.appendChild(button('Odśwież', 'btn btn-outline btn-sm', 's7'));
      var context = document.createElement('div'); context.className = 'conflict-context card card-pad';
      var title = document.createElement('h3'); title.textContent = 'Wersja robocza D-004';
      var paragraph = document.createElement('p'); paragraph.className = 'muted'; paragraph.textContent = 'Najpierw odśwież aktualne dane. Ponowne zastosowanie własnych zmian pozostaje świadomą decyzją użytkownika – bez automatycznego scalania.';
      context.appendChild(title); context.appendChild(paragraph); context.appendChild(button('Wróć do edytora', 'btn btn-outline', 's7'));
      shell.appendChild(banner); shell.appendChild(context); conflict.appendChild(shell);
    }
  }

  function adjustGuidesForP14a() {
    guides.s1.rows[3] = ['Nawigacja kursorem', 'Przeglądanie listy przez poprzednią/następną stronę kursorową.', 'Użyj poprzedniej lub następnej strony; liczba wszystkich wyników nie jest wymagana.', 'Nie opiera się na numerowanej paginacji ani sztucznym totalu.'];
    guides.s5.rows = [
      ['Produkt *', 'Wyrób, który ma zostać wyprodukowany według tej struktury.', 'Wybierz produkt końcowy z Katalogu, np. FG-100.', 'Jest kluczem rodziny BOM-u i polem obowiązkowym.'],
      ['Wariant', 'Opcjonalne doprecyzowanie odmiany produktu.', 'Wybierz tylko wariant należący do wybranego produktu.', 'Pozwala mieć niezależne struktury np. dla EU i US.'],
      ['Wielkość wyjściowa *', 'Ilość produktu, jaką opisuje BOM, wraz z jednostką.', 'Zostaw 1 i jednostkę bazową albo podaj poprawną ilość oraz UoM.', 'Resolver Katalogu zapisuje także wartość znormalizowaną.'],
      ['Etykieta rewizji', 'Opcjonalny, ludzki opis draftu; nie jest jego identyfikatorem.', 'Np. „EU-STD” albo zostaw puste.', 'Ułatwia rozróżnianie, systemowy numer rewizji pozostaje niezależny.']
    ];
    guides.s7.rows[2] = ['Komponent', 'Materiał lub podzespół pobrany z Katalogu, także z opcjonalnym wariantem.', 'Wybierz konkretny kod i właściwy wariant, jeżeli istnieje.', 'Określa, co jest zużywane lub wytwarzane.'];
    guides.s7.rows[3] = ['Ilość wpisana → bazowa', 'Ilość wpisana przez autora oraz wynik normalizacji w jednostce bazowej.', 'Podaj ilość i UoM w dialogu; wartość bazowa jest tylko do odczytu.', 'Zapewnia powtarzalne obliczenia bez samodzielnego przeliczania w UI.'];
    guides.s7.rows[4] = ['Podstawa / wydajność / dostawa', 'Sposób zużycia, oczekiwany uzysk i źródło komponentu.', 'Np. zmienna, 98%, produkuj.', 'Definiuje zapotrzebowanie i zależności BOM-u.'];
    guides.s7.rows[5] = ['↑ / ↓ / ⋯', 'Widoczne kontrolki kolejności oraz menu operacji jednego wystąpienia.', 'Przesuwaj wyłącznie strzałkami; w menu edytuj albo usuń wskazany wiersz.', 'Pozycja jest nadawana przez system i zachowuje tożsamość wystąpienia.'];
    guides.s8.rows = [
      ['Produkt *', 'Wyrób docelowy BOM-u.', 'Możesz go zmienić tylko jako kompletny cel wraz z poprawnym wariantem.', 'Zmiana wymaga ponownej walidacji i normalizacji base output.'],
      ['Wariant', 'Opcjonalna odmiana celu, zależna od produktu.', 'Wybierz wariant należący do bieżącego produktu albo wyczyść pole.', 'Doprecyzowuje rodzinę BOM-u.'],
      ['Wielkość wyjściowa *', 'Ilość wyrobu, którą opisuje draft, oraz jego jednostka.', 'Wpisz dodatnią wartość i wybierz prawidłową UoM.', 'Resolver aktualizuje wejściowe i znormalizowane dowody ilości.'],
      ['Etykieta rewizji', 'Opcjonalny opis dla ludzi.', 'Wpisz krótki kod albo zostaw puste.', 'Nie zmienia systemowego numeru rewizji.']
    ];
    guides.s10.rows = guides.s10.rows.slice(0, 6);
    guides.s10.rows[4] = ['Wydajność (0–1)', 'Współczynnik oczekiwanego uzysku komponentu.', 'Wpisz 1 dla braku strat albo np. 0,98 przy 2% straty.', 'Zapisuje dokładny yieldFactor wymagany przez kontrakt BOM-u.'];
    guides.s10.rows.push(['Wartość znormalizowana', 'Podgląd wyniku resolvera Katalogu po wpisaniu ilości i jednostki.', 'Nie wpisujesz jej ręcznie; sprawdzasz ją przed zapisem.', 'Jest dowodem konwersji przechowywanym z linią BOM-u.']);
    guides.s19.rows[2] = ['Etykieta roboczej rewizji', 'Opcjonalny opis nowego draftu po skopiowaniu.', 'Np. „Kopia z FG-200 / R-003” albo pozostaw pustą.', 'Nie zastępuje systemowego numeru rewizji.'];
  }

  function makeField(label, value, required) {
    var field = document.createElement('div'); field.className = 'field';
    var labelNode = document.createElement('label'); labelNode.textContent = label + (required ? ' *' : '');
    var input = document.createElement('input'); input.className = 'input'; input.value = value;
    field.appendChild(labelNode); field.appendChild(input); return field;
  }

  function makeSelectField(label, value) {
    var field = document.createElement('div'); field.className = 'field';
    var labelNode = document.createElement('label'); labelNode.textContent = label;
    var select = document.createElement('select'); select.className = 'select';
    var option = document.createElement('option'); option.textContent = value; select.appendChild(option);
    field.appendChild(labelNode); field.appendChild(select); return field;
  }

  function createBaseOutputFields() {
    var group = document.createElement('div'); group.className = 'base-output-group';
    var title = document.createElement('div'); title.className = 't-label'; title.textContent = 'Wielkość wyjściowa BOM-u';
    var grid = document.createElement('div'); grid.className = 'base-output-grid';
    grid.appendChild(makeField('Ilość', '1', true)); grid.appendChild(makeSelectField('Jednostka', 'szt.'));
    var hint = document.createElement('p'); hint.className = 't-hint'; hint.textContent = 'Po zapisie: znormalizowana wartość 1 szt. w jednostce bazowej Katalogu.';
    group.appendChild(title); group.appendChild(grid); group.appendChild(hint); return group;
  }

  function replaceTextNode(node, text) { if (node) node.textContent = text; }

  function alignWithP14a() {
    document.querySelectorAll('#s5 label, #s8 label, #s19 label').forEach(function (label) {
      if (label.textContent.trim() === 'Nazwa pomocnicza') label.textContent = 'Etykieta rewizji (opcjonalna)';
    });
    var createBody = document.querySelector('#s5 .card-body');
    if (createBody && !createBody.querySelector('.base-output-group')) {
      var createLabelField = Array.prototype.find.call(createBody.querySelectorAll('.field'), function (field) {
        return field.querySelector('label') && field.querySelector('label').textContent.indexOf('Etykieta rewizji') !== -1;
      });
      createBody.insertBefore(createBaseOutputFields(), createLabelField || null);
    }
    var editCard = document.querySelector('#s8 .card-pad');
    if (editCard && !editCard.querySelector('.base-output-group')) {
      var product = editCard.querySelector('.field input[disabled]');
      if (product) { product.removeAttribute('disabled'); var productLabel = product.parentElement.querySelector('label'); if (productLabel) productLabel.textContent = 'Produkt *'; }
      var revisionField = Array.prototype.find.call(editCard.querySelectorAll('.field'), function (field) {
        return field.querySelector('label') && field.querySelector('label').textContent.indexOf('Etykieta rewizji') !== -1;
      });
      editCard.insertBefore(createBaseOutputFields(), revisionField || null);
    }
    document.querySelectorAll('#s7 .line-table tbody tr').forEach(function (row, index) {
      var cells = row.querySelectorAll('td');
      if (!cells[2] || cells[2].querySelector('.normalized-quantity')) return;
      var entered = cells[2].textContent.trim();
      var normalized = index === 2 ? '2 szt. bazowe' : '1 szt. bazowa';
      cells[2].replaceChildren();
      var enteredNode = document.createElement('span'); enteredNode.textContent = entered;
      var normalizedNode = document.createElement('span'); normalizedNode.className = 'normalized-quantity muted'; normalizedNode.textContent = '→ ' + normalized;
      cells[2].appendChild(enteredNode); cells[2].appendChild(document.createElement('br')); cells[2].appendChild(normalizedNode);
      var actions = cells[cells.length - 1];
      if (actions && !actions.querySelector('.reorder-control')) {
        var up = button('↑', 'btn btn-outline btn-xs reorder-control', 's7');
        var down = button('↓', 'btn btn-outline btn-xs reorder-control', 's7');
        up.title = 'Przenieś pozycję w górę'; down.title = 'Przenieś pozycję w dół';
        up.setAttribute('aria-label', 'Przenieś pozycję w górę'); down.setAttribute('aria-label', 'Przenieś pozycję w dół');
        if (index === 0) up.disabled = true; if (index === 2) down.disabled = true;
        actions.prepend(down); actions.prepend(up);
      }
    });
    var lineHeader = document.querySelector('#s7 .line-table thead th:nth-child(3)'); replaceTextNode(lineHeader, 'Ilość → bazowa');
    var positionField = Array.prototype.find.call(document.querySelectorAll('#s10 .field'), function (field) {
      return field.querySelector('label') && field.querySelector('label').textContent.trim() === 'Pozycja';
    });
    if (positionField) positionField.remove();
    document.querySelectorAll('#s10 .field').forEach(function (field) {
      var label = field.querySelector('label'); var input = field.querySelector('input');
      if (label && label.textContent.trim() === 'Wydajność' && input) { label.textContent = 'Wydajność (0–1)'; input.value = '1'; }
    });
    var dialogGrid = document.querySelector('#s10 .form-grid');
    if (dialogGrid && !dialogGrid.querySelector('.normalized-preview')) {
      var preview = document.createElement('div'); preview.className = 'alert alert-info normalized-preview full';
      preview.textContent = 'Wartość znormalizowana po zapisie: 1 szt. w jednostce bazowej Katalogu. Jest wyliczana, nie wpisywana ręcznie.';
      dialogGrid.appendChild(preview);
    }
    var listFoot = document.querySelector('#s1 .table-foot');
    if (listFoot) { listFoot.replaceChildren(); listFoot.appendChild(document.createTextNode('Strona kursorowa · załadowano 4 BOM-y')); var nav = document.createElement('span'); nav.textContent = '‹ Poprzednia  ·  Następna ›'; listFoot.appendChild(nav); }
    var lineCard = document.querySelector('#s7 .line-table') && document.querySelector('#s7 .line-table').closest('.card');
    if (lineCard) {
      var headerText = lineCard.querySelector('.card-head .row span'); replaceTextNode(headerText, 'Strona linii · 3 wczytane');
      var footer = lineCard.querySelector('.table-foot > span'); replaceTextNode(footer, 'Następna strona kursora ›');
    }
  }

  adjustGuidesForP14a();
  document.querySelectorAll('section.screen').forEach(function (screen) {
    var guide = guides[screen.id];
    if (guide) renderGuide(screen, guide);
  });
  alignWithSales();
  alignWithP14a();
})();
