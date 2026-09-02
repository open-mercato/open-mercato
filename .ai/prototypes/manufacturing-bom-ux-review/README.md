# BOM – przegląd UX

Interaktywny, statyczny prototyp przygotowany na podstawie [specyfikacji P1.4a](../../specs/2026-08-19-manufacturing-bom-drafts.md). Zastępuje wcześniejszą, niekomentowaną makietę `manufacturing-bom-drafts`.

## Otwieranie

Uruchom z katalogu tego prototypu:

```powershell
python -m http.server 8899 --bind 127.0.0.1
```

Następnie otwórz `http://127.0.0.1:8899/`.

W górnym pasku są skróty do kluczowych ekranów. Przyciski obwiedzione po najechaniu kursorem prowadzą do następnych stanów. Panel komentarzy dostępny z kontroli „Review” jest lokalny dla przeglądarki i służy do uwag do makiety; nie jest propozycją funkcji komentarzy w produkcie.

## Zakres ekranu po ekranie

1. Lista, status, nawigacja po wierszach i powrót do kontekstu.
2. Wyszukiwanie, filtry, sortowanie i brak wyników.
3. Perspektywa listy i kolumny.
4. Tworzenie BOM-u oraz walidacja duplikatu celu.
5. Edytor roboczej rewizji: nagłówek, komponenty, kolejność i bezpośrednie wystąpienia.
6. Dodanie / edycja komponentu, anulowanie zmian, usunięcie oraz cofnięcie.
7. Nierozwiązana definicja typu „Produkuj”, blokada cyklu i podgląd drzewa.
8. Wydana, tylko do odczytu rewizja, historia, porównanie, kopiowanie oraz rozszerzenia.
9. Konflikt optymistyczny i rozróżnione stany odzyskiwania.

Znaczniki na ekranach odróżniają obowiązujący zakres **P1.4a** od propozycji rozwoju: **P1.4c–h**, **P1.4b** i **P1.7**. Wszystkie nazwy, osoby i rekordy są fikcyjne.

## Rewizja względem Sales

Makieta została porównana z rzeczywistymi powierzchniami Sales: `SalesDocumentsTable`, `ItemsSection`, `LineItemDialog`, `ListEmptyState` i globalnym `RecordConflictBanner`.

- Lista zachowuje model `DataTable`: wyszukiwanie, filtry, trzy różne stany puste i akcje wiersza.
- Edycja komponentu jest modelowana jako dialog pojedynczej pozycji, podobnie jak dialog linii Sales.
- Konflikt zapisu jest banerem z akcją odświeżenia, a nie modalu z automatycznym scalaniem.
- Pod każdym ekranem znajduje się rozwijana sekcja **„Pola i działania na tym ekranie”**. Opisuje znaczenie danych, oczekiwaną wartość lub działanie użytkownika oraz wpływ na BOM.

Następnie makietę skorygowano względem ścisłego kontraktu P1.4a: formularze zawierają bazową wielkość wyjściową (ilość, UoM i znormalizowany podgląd), etykietę rewizji zamiast ogólnej „nazwy”, tabela pokazuje ilość wpisaną i znormalizowaną, kolejność jest sterowana strzałkami góra/dół, a listy przedstawiają strony kursorowe bez deklarowania całkowitej liczby wyników.

Elementy charakterystyczne dla Sales – klient, ceny, podatki, płatności, dostawy i numery dokumentów – celowo nie są przenoszone do BOM-u.

## Pliki

- `index.html` – ekrany i połączenia pomiędzy stanami.
- `tokens.css` – wygenerowane tokeny Design Systemu; nie edytować ręcznie.
- `components.css`, `screens.css`, `prototype.css` – prymitywy i kompozycje wizualne.
- `prototype.js`, `comments.js` – tryb prezentacji, nawigacja i komentarze przeglądu.
- `field-guide.js` – objaśnienia pól i działań pod każdym ekranem oraz drobne dopasowania do wzorców Sales.
