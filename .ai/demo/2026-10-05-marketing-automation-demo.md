# Marketing automation — scenariusz demo (nagranie ekranu)

**Czas:** około 22 minuty. Sam przegląd wyników i profilu klienta to 9 minut — jeśli masz 10, zrób ekrany 1–5 i zakończ.

**Instalacja:** Acme Corp, `http://localhost:3000`, interfejs po angielsku. Nazwy ekranów i przycisków czytaj po angielsku, tak jak są na ekranie.

## Kolejność ekranów

1. Dashboard — kafel **Marketing this week** (opcjonalnie, 30 s)
2. **Campaigns** — lista kampanii (1 min)
3. **Results** kampanii „Welcome new customers" (4 min)
4. **Runs** tej samej kampanii (1,5 min)
5. **Customer profile** — Riley Nguyen (4 min)
6. Edytor kampanii „Welcome new customers" — kanwa, kroki, **Send rules**, **Preview** (4 min)
7. Edytor „Win back quiet buyers" — wyzwalacz cykliczny i **Audience** (2 min)
8. **Segments** (1 min)
9. **Score rules** (40 s)
10. **Content blocks** (30 s)
11. **Price watches** (40 s)
12. **Referrals** (30 s)
13. **Lead routing** (40 s)
14. **Inbound hooks** i **Inbound requests** (1 min)
15. **Marketing settings** (1 min)
16. **Getting started** (40 s)
17. **Background jobs** (40 s)

## Trzy zdania na otwarcie

> To moduł marketing automation wbudowany w Open Mercato — kampanie, które reagują na to, co klient naprawdę zrobił w sklepie, bez eksportu danych do zewnętrznego narzędzia. Zobaczycie działającą kampanię powitalną, jej wyniki, profil jednego klienta z pełną historią, a potem edytor, w którym to wszystko się składa. Zwróćcie uwagę nie na listę funkcji, a na to, czego ten moduł **nie** pokazuje — bo prawie każda taka decyzja wynika z tego, że pokazanie tego byłoby kłamstwem.

---

## 1. Dashboard — kafel „Marketing this week"

**Ścieżka:** `http://localhost:3000/backend` — kafel **Marketing this week**.

**Co pokazać:** sam kafel: **Messages sent** z dopiskiem ile wstrzymano i ile się nie udało, **Engagement** (opened / clicked), **Attributed revenue**, pod spodem licznik „X of Y campaigns live". Rozwiń selektor **Period** i pokaż, że okno da się zmienić.

**Co powiedzieć:** Zaczynamy od ekranu, który każdy otwiera jako pierwszy rano. Kafel odpowiada na jedno pytanie: co wyszło w tym tygodniu, kto zareagował i ile to przyniosło — dla całej organizacji, a nie dla jednej kampanii. Wstrzymane i nieudane wysyłki są policzone osobno, obok wysłanych, a nie wrzucone do jednej liczby. Dzięki temu „sent" zawsze znaczy dokładnie tyle, ile znaczy.

**Puenta:** Nigdzie na tym kaflu nie ma słowa „delivered" — bo platforma nie dostaje od dostawcy poczty potwierdzeń dostarczenia, a „delivered" byłoby wtedy tylko liczbą wysłanych w ładniejszym przebraniu.

---

## 2. Campaigns — lista kampanii

**Ścieżka:** `/backend/marketing/campaigns`

**Co pokazać:** pięć wierszy. Kolumny **Name**, **Triggers**, **Steps**, **Enabled**, **Updated**. Pokaż, że tylko „Welcome new customers" ma **Enabled** na tak. Najedź na ikonę znaku zapytania przy tytule i przeczytaj podpowiedź. Pokaż przycisk **New campaign** i **Start from a template…**.

**Co powiedzieć:** Pięć kampanii, z czego jedna chodzi. „Welcome new customers" ma cztery kroki i startuje na zdarzeniu **Customer registered**. „Win back quiet buyers" to kampania cykliczna, „Birthday treat" i „Ask for a review after delivery" to jednokrokowe automaty, a „Nowa kampania" jest puste — ktoś zaczął i nie skończył. Każda kampania to zawsze to samo: wyzwalacz, audytorium i lista kroków.

**Puenta:** Kampania wyłączona nie jest tu ukryta ani wrzucona do innej zakładki, bo to ta sama rzecz w innym stanie, a nie inny obiekt.

---

## 3. Results — „Welcome new customers"

**Ścieżka:** `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/results` (albo kliknij kampanię i w nagłówku **Results**)

**Co pokazać, po kolei:**

- Cztery kafle na górze: **Sent 84** z dopiskiem **3 held back by send rules**, **Opened 24**, **Clicked 9**, **Attributed revenue**. Rozwiń znak zapytania przy **Sent** i przy **Clicked**.
- Sekcja **Funnel**: 68 **Entered** → 42 **Received a message** → 24 **Opened** → 9 **Clicked** → 0 **Ordered afterwards**. Pokaż podpis **People, not messages**.
- Sekcja **Over time** — wykres dzienny.
- Sekcja **Step by step** — kolumny **Step**, **People**, **From previous**, **Of the first step**, **Skipped**, **Failed**. Pokaż wiersze oznaczone **in lane a** i **in lane b**.
- Sekcja **What they clicked** — i przeczytaj podpis pod tabelą.
- Sekcja **A/B results** — wariant a 26 osób, wariant b 42, i komunikat **Not enough data yet (50 recipients per variant needed)**.

**Co powiedzieć:** To ta sama kampania widziana od strony wyników. Na górze liczby wiadomości: 84 wysłane, trzy wstrzymane przez reguły wysyłki. Niżej lejek, który liczy już nie wiadomości, a ludzi: 68 osób weszło do kampanii, wiadomość dostało 42, otworzyły 24, kliknęło 9. Zauważcie rozjazd: 84 wiadomości dotarły do 42 osób, bo ta kampania wysyła do każdego dwa maile. Gdyby lejek liczył wiadomości, twierdziłby, że dotarł do dwa razy większej liczby ludzi niż naprawdę. Niżej **Step by step** w kolejności autorskiej, czyli w tej, w której klient tego doświadcza, a nie posortowane po wielkości. A na końcu test A/B, który nie ogłasza zwycięzcy.

**Puenta:** Tam gdzie konkurencja pokazałaby zielony badge „Variant B wins", tu jest zdanie „Not enough data yet (50 recipients per variant needed)" i nie ma przycisku do zatwierdzenia wyniku — próbka 26 kontra 42 nic nie znaczy, więc system nie udaje, że znaczy.

**Jeśli ktoś dopyta o 0 w „Ordered afterwards":** Przychód jest przypisywany liniowo w okienku atrybucji po kliknięciu i dzielony równo między kampanie, które w tym okienku zagrały — a na tych danych demo zamówień po kliknięciu nie ma. To nie pusty wykres, to uczciwe zero.

---

## 4. Runs — kto i gdzie utknął

**Ścieżka:** W nagłówku kampanii kliknij **Runs** (`/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/runs`)

**Co pokazać:** tabelę przebiegów. Kolumny **Customer**, **Trigger**, **Status**, **Progress**, **Started**, **Resumes**, **Attempts**, **Last error**. Pokaż filtr statusów (**All**, **Waiting**, **Completed**, **Failed**, **Given up**). Rozwiń **Steps** przy jednym wierszu. Pokaż akcję **Put back in the queue** na wierszu z błędem, ale jej nie klikaj.

**Co powiedzieć:** Jeden wiersz na jednego klienta, dla którego kampania wystartowała. **Waiting** znaczy, że człowiek stoi w kroku **Wait** i ma datę, kiedy ruszy dalej. **Given up** to przebieg, który wyczerpał próby. Rozwinięcie **Steps** pokazuje krok po kroku, co się wykonało, co zostało pominięte i co się wywaliło. Przy błędzie jest **Put back in the queue** i ostrzeżenie, że przebieg wznowi się od kroku, który nie poszedł — czyli może wysłać do tego człowieka maila.

**Puenta:** Ostrzeżenie przy ponowieniu mówi wprost, że to może wysłać wiadomość — bo „retry" w narzędziu marketingowym to nie odświeżenie widoku, tylko list do konkretnej osoby.

---

## 5. Customer profile — Riley Nguyen

**Ścieżka:** W **Runs** kliknij nazwę klienta → **Open the customer profile**. Bezpośrednio: `/backend/marketing/customers/b0494b70-f980-4317-b509-5611f6febe20`

**Co pokazać, po kolei:**

- Nagłówek: nazwisko, medal **Bronze**, przyciski **Recalculate score**, **Export data**, **Erase data**.
- Kafle: **Lead score 50**, **Orders 3**, **Lifetime spend 1.3K**, **Buys from**, **RFM 10/15**, **Projected value 5.4K**, **Latest NPS**, **Messages sent**. Rozwiń znak zapytania przy **RFM** i przy **Projected value** i przeczytaj je na głos.
- Sekcja **Why did they not get a campaign?** — wybierz z listy kampanię i kliknij **Explain**. Pokaż wynik i listę bramek: **Audience**, **Consent**, **Campaign frequency cap**, **Their own weekly limit**, **Quiet hours**, **Customer pause**.
- Dalej w dół: **Marketing consent**, **Waiting for a price drop**, **Referrals**, **What the next message would offer**, **What they asked for**, **Segments**, **Tags**, **Recent score changes**, **Recent campaign runs**.
- Na końcu **What happened** — oś czasu. Pokaż wpisy „Entered the campaign", „Message sent", „Opened the message", „Clicked a link", „+25 points" i przycisk **Show older**.

**Co powiedzieć:** To jeden człowiek, widziany tak, jak go widzi silnik kampanii. Lead score 50 i poziom Bronze — i to nie jest liczba zapisana w kolumnie, tylko suma księgi punktów, dzięki czemu krok dostarczony dwa razy nie przyznaje punktów dwa razy. RFM 10 na 15 liczy się na kwintylach kupujących tego konkretnego sklepu, a nie na sztywnych progach dniowych: „kupił w ostatnie 30 dni" jest doskonałe dla kawy i bez znaczenia dla materacy. Projekcja 5,4 tysiąca wymaga drugiego zamówienia, bo jedno kupno to nie tempo. A tu jest ekran, na który dzwoni obsługa klienta: **Why did they not get a campaign?** — wybieramy kampanię, klikamy **Explain** i system przechodzi wszystkie bramki w tej samej kolejności, w jakiej przechodzi je silnik, i nazywa tę, która zdecydowała.

**Puenta:** „Why did they not get a campaign?" odpowiada na pytanie, które w każdym innym narzędziu kończy się ticketem do działu IT — i rozróżnia „później, nie nigdy" od odmowy, bo zgoda odmawia na stałe, a cisza nocna tylko przesuwa.

**Dorzuć przy osi czasu:** Na dole jest **What happened** — wejście do kampanii, wysyłka, otwarcie, kliknięcie i przyznane punkty, w kolejności, z nazwą kampanii przy każdym wpisie. Kolorem wyróżnione są tylko rzeczy złe: wstrzymania, błędy i wypisy. Oś czasu, na której wszystko jest kolorowe, to oś czasu, na której kolor nic nie znaczy.

---

## 6. Edytor kampanii — jak to się składa

**Ścieżka:** `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030`

**Co pokazać, po kolei:**

- Kanwę: węzeł wyzwalacza **Customer registered**, węzeł **Audience** z napisem **Everyone the trigger produces**, potem **Step 1 Send email**, **Step 2 Wait**, **Step 3 A/B split** z wariantami a i b, **Step 4 Add score points**.
- Paletę po lewej z zakładkami **Triggers** i **Steps** oraz polem **Search**. Przewiń listę kroków: **Send email**, **Wait**, **A/B split**, **Add tag**, **Add score points**, **Assign to a sales rep**, **Issue a referral code**, **Ask for an NPS score**, **Tell a colleague**, **Signal an outside system**.
- Kliknij węzeł **A/B split** i pokaż warianty: „Ten percent on your first order" i „What people near you are buying", wagi 50/50, oraz podpowiedź **Each customer is assigned one variant and stays in it**.
- Najedź na strzałkę między krokami i pokaż napis **Steps run top to bottom. Reorder with the arrows, not by dragging.**
- Kliknij **Step 1** i w inspektorze pokaż pola **Subject**, **Body**, **Track opens and clicks**, **Recommended products**. Pokaż przyciski **Draft with AI** i **Send a test to me** — ale ich nie klikaj.
- Rozwiń sekcję **Send rules**. Pokaż **Limit how many messages one customer receives** ustawione na 3 na 168 godzin i przeczytaj podpowiedź pod nim. Pokaż **Do not send during quiet hours**, **Send at a fixed hour, in the recipient's local time** i **Send at the hour each customer usually opens email** z adnotacją **Ignored while a fixed hour is set above**.
- Kliknij **Preview**, wybierz klienta i pokaż rozpisaną ścieżkę z godzinami.
- Kliknij **Show saved versions** i pokaż historię zapisów. Nie klikaj **Restore**.

**Co powiedzieć:** Tak wygląda ta sama kampania od środka. Góra kanwy to wyzwalacz i audytorium, dalej cztery kroki, a trzeci to test A/B z dwoma wariantami po pięćdziesiąt procent. Klient dostaje jeden wariant i w nim zostaje — także wtedy, gdy przebieg zatrzyma się na oczekiwaniu i wróci do życia tydzień później, bo wariant wylicza się z identyfikatora kroku i identyfikatora klienta, a nie z losowania przy każdym wznowieniu. Zwróćcie uwagę na **Send rules**: limit trzech wiadomości na tydzień jest liczony **przez wszystkie kampanie naraz**, nie per kampania. Pięć kampanii, z których każda uprzejmie wysyła po jednej wiadomości, i tak zasypuje klienta. Niżej jest **Preview**, który rozpisuje całą ścieżkę z godzinami i nic nie wysyła.

**Puenta 1:** Na tej kanwie nie da się narysować strzałki, bo jedyne rozgałęzienie, jakie silnik ma, to test A/B — autor, który może narysować krawędź, dostał obietnicę topologii, której silnik nie umie wykonać.

**Puenta 2:** Optymalizacja godziny wysyłki jest wyłączona, gdy ustawisz godzinę ręcznie, i interfejs mówi to wprost — decyzja człowieka przebija zgadywanie o tym samym, a dwa pozornie dodające się ustawienia to pułapka.

**Dorzuć przy Preview:** Podgląd nie jest drugą implementacją silnika. Odpala ten sam `executeRun`, tylko z efektami zapisywanymi zamiast wykonywanymi — bo podglądowi wierzy się dokładnie tam, gdzie nikt go nie sprawdzi.

---

## 7. „Win back quiet buyers" — wyzwalacz cykliczny i Audience

**Ścieżka:** `/backend/marketing/campaigns/4377aaaa-abc3-49b4-8077-20ac0acd2694`

**Co pokazać:** węzeł wyzwalacza: **On a schedule**, źródło **All customers**, **every 1d**, pole **Re-enter the same customer after (days)** ustawione na 60. Potem kliknij **Edit audience** i pokaż dwa warunki: **Number of orders** — **at least** — 1, oraz **Days since last order** — **at least** — 90, połączone przez **Match all of these**. Najedź na znak zapytania przy **Days since last order** i przeczytaj podpowiedź. Rozwiń listę pól i pokaż grupy **Customer**, **Orders**, **Engagement**, **Loyalty**, **Value**, **Survey**, **Location**, **Lists they are on**. Pokaż **Advanced editor** i wróć przez **Back to the guided editor**.

**Co powiedzieć:** Ta kampania nie reaguje na zdarzenie, tylko przemiata bazę raz na dobę i szuka ludzi, którzy pasują do warunku. Audytorium mówi: ma co najmniej jedno zamówienie i od ostatniego minęło co najmniej 90 dni. Pole **Re-enter the same customer after** pilnuje, żeby ta sama osoba nie wpadała do kampanii w kółko. W budowniku pól jest wszystko, czym ten moduł opisuje klienta — zamówienia, zaangażowanie, lojalność, wartość, ankiety — a dla warunku, którego kreator nie obsługuje, jest **Advanced editor**.

**Puenta:** Podpowiedź przy „Days since last order" mówi: kto nigdy nie kupił, nie ma takiego dnia, więc ten warunek go nigdy nie złapie. To nie detal interfejsu — bez tej zasady win-back wysyłałby maile „wróć do nas" ludziom, którzy nigdy nic nie kupili, co jest najczęstszym błędem w tej kategorii narzędzi.

---

## 8. Segments

**Ścieżka:** `/backend/marketing/segments`

**Co pokazać:** dwa segmenty, kolumny **Name**, **Reference**, **Members**. Wejdź w jeden, pokaż **Who is in it**, **Members** i podpis pod listą (**Every candidate was checked** albo **A sample…**). Pokaż **Size over time**, sekcję **Compare and act** z **Overlap with**, **Award 10 points to members** i **Export CSV**. Niczego nie uruchamiaj.

**Co powiedzieć:** Segment to audytorium, które nazywasz raz i targetujesz z każdej kampanii warunkiem „segments contains". Pod listą członków zawsze jest kwalifikator: albo „sprawdzono wszystkich kandydatów", albo „to próbka". Przynależność liczy to samo wywołanie, którego używa dyspozytor przy wysyłce, więc ekran nie może się rozjechać z tym, co faktycznie wyszło. Akcje masowe nie zapisują listy osób — niosą segment i rozwiązują go dopiero przy wykonaniu.

**Puenta:** Nigdzie tu nie zobaczysz próbki podanej jako suma — każda odpowiedź o liczebność nosi informację, czy to całość, i to samo dotyczy przecięcia dwóch segmentów.

---

## 9. Score rules

**Ścieżka:** `/backend/marketing/score-rules`

**Co pokazać:** dwie reguły ze statusem **Active**, kolumny **Name**, **Points**, **Status**. Wejdź w edycję i pokaż **Who gets the points** oraz podpowiedź przy nazwie.

**Co powiedzieć:** Reguły punktowe przyznają punkty za to, **kim** klient jest — gdzie mieszka, jakie ma tagi, ile wydał — a nie za to, co zrobił w kampanii. Nazwa reguły trafia do historii punktów klienta jako powód, więc pisze się ją dla człowieka, który będzie czytał tamtą listę. Reguła nie może odwoływać się do samego score'u ani do segmentów, bo wyliczałaby się z czegoś, co właśnie jest wyliczane.

**Puenta:** Ostrzeżenie przy usuwaniu mówi, że wszyscy, którym ta reguła przyznała punkty, je stracą — bo punkty to księga, a nie kolumna, i usunięcie reguły faktycznie zmienia wynik.

---

## 10. Content blocks

**Ścieżka:** `/backend/marketing/content-blocks`

**Co pokazać:** trzy bloki, kolumny **Reference** i **Name**. Wejdź w edycję i pokaż, że **Reference** nie da się zmienić. Pokaż listę **Reusable blocks you can paste into the body**.

**Co powiedzieć:** Blok to kawałek HTML napisany raz i wciągany do wiadomości przez `{{block:key}}` — stopka, nagłówek, sezonowy banner. Referencja jest zamrożona po zapisie, bo wiadomości wskazują blok właśnie przez nią.

**Puenta:** Brakujący blok renderuje się jako nic, a nie jako własna nazwa — wydrukowanie `{{block:footer}}` w mailu do klienta jest gorsze niż wydrukowanie pustego miejsca.

---

## 11. Price watches

**Ścieżka:** `/backend/marketing/demand`

**Co pokazać:** osiem produktów, kolumny **Product**, **Waiting**, **Already told**. Przeczytaj podpis nad tabelą.

**Co powiedzieć:** To produkty, przy których klienci poprosili o informację o obniżce — najczystszy sygnał popytu, jaki sklep dostaje. Spadek o 5 procent albo więcej odpala kampanię z wyzwalaczem **Watched product price dropped**. Kolumna **Already told** pilnuje, żeby ten sam człowiek nie dostał tej samej informacji dwa razy.

**Puenta:** Porównywana jest cena katalogowa bez targetowania, a nie cena tego konkretnego kupującego — cena kontraktowa dla kogoś innego nie jest ceną tego klienta. I produkt wycofany ze sprzedaży nie jest traktowany jako obniżka, bo „już go nie ma" to nie wiadomość, o którą ktoś prosił.

---

## 12. Referrals

**Ścieżka:** `/backend/marketing/referrals`

**Co pokazać:** tabelę z kolumnami **Code**, **Referrer**, **Used the code**, **Bought**, **Issued**. Kliknij **Open profile** przy wierszu.

**Co powiedzieć:** Kody poleceń wydaje krok kampanii **Issue a referral code** i wstawia je do wiadomości jako `{{referral.code}}`. Kolumny rozdzielają dwie różne rzeczy: ile osób wpisało kod i ile z nich faktycznie kupiło.

**Puenta:** Nagroda leci dopiero na pierwszym zamówieniu poleconego, nie na samym wpisaniu kodu — wpisanie kodu to ktoś, kto coś wpisał, a zapłacić warto za drugie. I kod nigdy nie jest wydawany ponownie, bo jest już wydrukowany w każdej wiadomości, która go wspominała.

---

## 13. Lead routing

**Ścieżka:** `/backend/marketing/lead-routing`

**Co pokazać:** trzech handlowców z licznikami 5, 5 i 6 leadów, znacznik **Next lead goes here**, kolumnę **New this week**.

**Co powiedzieć:** Krok **Assign to a sales rep** oddaje nowego leada temu, kto w tej chwili ma ich najmniej. Przy remisie wybór jest deterministyczny, więc ekran pokazuje realnie następnego w kolejce. Pula handlowców ustawia się w **Marketing settings**.

**Puenta:** Nie ma tu żadnego kursora round-robin do zresetowania — „najmniej obciążony wygrywa" samo się koryguje, gdy ktoś idzie na urlop, a kursor dalej karmiłby nieobecnego. I lead, który już ma opiekuna, domyślnie nie zmienia rąk, bo odebranie klienta handlowcowi, który z nim rozmawia, to najgorsze, co routing może zrobić.

---

## 14. Inbound hooks i Inbound requests

**Ścieżka:** `/backend/marketing/inbound-hooks`, potem `/backend/marketing/inbound-requests` (albo **Show what arrived**)

**Co pokazać:** trzy hooki, dwa ze stanem **Live**, jeden **Revoked**, kolumna **Activity**. Pokaż **Copy URL** i **Copy curl command**. Rozwiń **How another system posts to a hook**. Przejdź na **Inbound requests**: osiem żądań, kolumny **Received**, **Customer**, **Outcome**, **Size**, ze statusami **Customer found**, **No matching customer** i **No customerId or email in the payload**. Rozwiń jeden wiersz i pokaż payload.

**Co powiedzieć:** Hook to podpisany URL, pod który obce systemy wrzucają JSON, żeby odpalić kampanię. Wystarczy `customerId` albo `email`; każde inne pole jest dostępne w kampanii jako `trigger.<pole>`. **Inbound requests** pokazuje, co faktycznie przyszło, razem z treścią — więc spór „czy wysłaliśmy" da się rozstrzygnąć, a nie obgadać. Żądania są trzymane kilka dni i usuwane, bo to pomoc przy podłączaniu, nie archiwum.

**Puenta:** Samo API nigdy nie odpowiada, czy adres dopasował się do klienta — wyciekły URL hooka byłby wtedy wyszukiwarką „czy ten człowiek jest waszym klientem" po całej bazie. Wynik dopasowania widzi tylko ktoś zalogowany, na tym ekranie.

---

## 15. Marketing settings

**Ścieżka:** `/backend/marketing/settings`

**Co pokazać:** sekcje **A/B tests** (**Decide a test on**: Clicks per recipient / Revenue per recipient, **Let a decisive test promote its own winner** wyłączone, **How much better the winner must be**), **Loyalty tiers**, **Customer value** z horyzontem projekcji, **Brand voice**, **Product links in messages**, **Referral links** i na końcu **Suppression list**. Przeczytaj podpowiedź pod **Suppression list**.

**Co powiedzieć:** Tu są ustawienia na całą organizację. Jedno ustawienie decyduje o metryce testu A/B — i dotyczy zarówno sugestii na ekranie wyników, jak i automatycznej promocji zwycięzcy, bo pokazywanie komuś zwycięzcy po klikach, kiedy w tle wdraża mu się zwycięzcę po przychodzie, jest gorsze niż jedno i drugie osobno. Automatyczna promocja jest domyślnie wyłączona, bo przepisuje czyjąś kampanię. **Brand voice** to dwa zdania o tym, jak ten sklep pisze, wkładane do promptu przy każdym szkicu AI. A na dole import listy wypisanych z poprzedniego narzędzia.

**Puenta:** Ten import potrafi tylko **wypisać** ludzi, w drugą stronę nie ma przycisku — plik CSV nie jest zgodą, a import, który mógłby kogoś zapisać, wyprodukowałby dokładnie ten dowód, którego sklep może kiedyś musieć przedstawić.

**Dorzuć:** Raport z importu mówi też, ile adresów nie dopasowało się do żadnego klienta, i pokazuje próbkę — bo adresy są szyfrowane, dopasowanie przeszukuje ograniczone okno, i operator, który tego nie widzi, nie ma skąd wiedzieć, że jego lista zadziałała tylko częściowo.

---

## 16. Getting started

**Ścieżka:** `/backend/marketing/setup`

**Co pokazać:** osiem pozycji, wszystkie na zielono, status **Ready to send**. Przeczytaj nazwy: **Configure an email channel**, **Set a signing secret and a public URL**, **Turn on the periodic jobs**, **Create a campaign**, **Publish it**, **Watch the first customer go through**, **Name an audience you will reuse**, **Write a reusable block**. Kliknij **Check again**.

**Co powiedzieć:** To ekran, na który trafiasz, gdy nic nie wychodzi. Osiem rzeczy, które muszą być prawdą, żeby cokolwiek poszło — i wszystkie są sprawdzane na żywo przy każdym wejściu. Pozycja o kluczu podpisującym i publicznym URL-u jest wymagana, bo bez nich nie da się zbudować linku do wypisania się, a wiadomość bez drogi wyjścia jest odrzucana, a nie wysyłana.

**Puenta:** Żadna z tych pozycji nie jest odczytana z flagi „setup completed" — flaga mówi, co ktoś kiedyś kliknął, a pytanie jest, co jest prawdą teraz. Instalacja, której tydzień temu usunięto kanał mailowy, nie jest skonfigurowana.

---

## 17. Background jobs

**Ścieżka:** `/backend/marketing/jobs`

**Co pokazać:** listę przebiegów, kolumny **Job**, **Campaign**, **Started**, **Status**, **Result**. Pokaż wiersz **Waiting journeys** z napisem **Nothing to do, 100 times in a row**. Pokaż rodzaje prac: **Scheduled campaign sweep**, **Waiting journeys**, **Score rules**, **Weekly lead digest**, **Event dispatch**. Przewiń do **Dispatches that never ran**.

**Co powiedzieć:** Każde przejście pracy w tle ma tu wiersz z tym, co zrobiło: ile osób wciągnęło, ile wiadomości wysłało, ile pominęło. Przebiegi, które nic nie znalazły, zwijają się w jedną linijkę „Nothing to do, 100 times in a row" — zamiast stu identycznych wierszy, przez które nie widać tego jednego, który coś zrobił. Wiersz powstaje **przed** pracą, nie po, więc praca zabita w połowie zostaje widoczna jako **Running**.

**Puenta:** Pod **Dispatches that never ran** celowo nie ma przycisku „powtórz" — wysyłka, która poległa z powodu, którego nikt nie przeczytał, nie powinna być ponawiana ani timerem, ani kliknięciem.

---

## Czego nie pokazywać i dlaczego

**Nie klikać pod żadnym pozorem:**

- **Enable** na wyłączonej kampanii („Win back quiet buyers", „Birthday treat", „Ask for a review after delivery"). Dialog **Publish this campaign?** wolno otworzyć i jest nawet dobry na demo — pokazuje, ile osób pasuje do audytorium i ile maili maksymalnie może dostać jedna osoba — ale **anuluj go**. Potwierdzenie uruchamia wysyłkę do prawdziwych adresów.
- **Erase data** na profilu Riley Nguyen. Nieodwracalne, i nie ma drugiego klienta z tak wypełnioną historią.
- **Restore** w **History** w edytorze. Przepisuje kampanię i tworzy nową wersję. Samą listę wersji pokaż, przywracania nie rób.
- **Delete** na jakiejkolwiek kampanii, segmencie, regule punktowej ani bloku treści.
- **Award 10 points to members** w **Segments** — zapisuje punkty wszystkim członkom i rozjedzie liczby, które właśnie pokazałeś na profilu.
- **Recalculate score** na profilu — nic nie psuje, ale dopisuje wpisy do historii punktów, którą pokazujesz chwilę później.

**Nie działa na tej instalacji:**

- **Draft with AI** w inspektorze kroku mailowego. Klucze API są puste, więc wyskoczy „No AI model is configured for this installation." Funkcję możesz wspomnieć słownie i pokazać **Brand voice** w ustawieniach, ale przycisku nie klikaj.
- **Send a test to me** — wysyła prawdziwego maila na adres zalogowanego konta. Jeśli nie sprawdziłeś przed nagraniem, że kanał mailowy faktycznie wysyła, nie klikaj: nieudana próba pokaże „The transport refused the test message."
- Centrum preferencji i strona wypisania się (portal klienta). Wymagają sesji klienta, nie administratora. Opowiedz o nich przy sekcji **What they asked for** na profilu, ale nie próbuj tam wejść.
- Kafel **Marketing this week** na dashboardzie — sprawdź przed nagraniem, czy jest włączony na tym dashboardzie. Jeśli nie ma, zacznij od ekranu 2, nic nie tracisz.

**Wygląda słabo, jeśli tego nie wyjaśnisz:**

- **Ordered afterwards: 0** w lejku i puste **Attributed revenue**. Na tych danych nie ma zamówień po kliknięciu. Nie przewijaj szybko — powiedz, jak liczy się atrybucja, i nazwij to zero uczciwym.
- Brak przycisku **End the test, keep this variant** przy teście A/B. To nie bug, to cała puenta tego ekranu. Jeśli tego nie powiesz, widz pomyśli, że funkcja nie działa.
- **Nowa kampania** — puste, bez wyzwalacza i bez kroków. Nie wchodź tam przypadkiem: zapis odbije się walidacją „Add at least one trigger" i „Add at least one step". Jeśli chcesz pokazać walidację, zrób to świadomie i nazwij po imieniu.
- **Jobs** z wierszem „Nothing to do, 100 times in a row". Bez komentarza wygląda jak martwy ekran. Z komentarzem o zwijaniu bezczynnych przebiegów jest decyzją projektową.
- Liczba kodów na **Referrals** zależy od zakresu organizacji — nie podawaj konkretnej liczby na głos, mów „wydane kody".

---

## Ściąga z URL-ami

Prefiks: `http://localhost:3000`

| Ekran | URL |
|---|---|
| Dashboard | `/backend` |
| Campaigns | `/backend/marketing/campaigns` |
| Welcome new customers — edytor | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030` |
| Welcome new customers — Results | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/results` |
| Welcome new customers — Runs | `/backend/marketing/campaigns/5cc6005e-c037-4a5d-928f-a2667aebd030/runs` |
| Win back quiet buyers — edytor | `/backend/marketing/campaigns/4377aaaa-abc3-49b4-8077-20ac0acd2694` |
| Ask for a review after delivery | `/backend/marketing/campaigns/43704edf-551c-4fd1-a336-c87d129d7ef1` |
| Birthday treat | `/backend/marketing/campaigns/c52b80b0-04e4-4b86-be2b-9e17f7807b25` |
| Customer profile — Riley Nguyen | `/backend/marketing/customers/b0494b70-f980-4317-b509-5611f6febe20` |
| Segments | `/backend/marketing/segments` |
| Score rules | `/backend/marketing/score-rules` |
| Content blocks | `/backend/marketing/content-blocks` |
| Price watches | `/backend/marketing/demand` |
| Referrals | `/backend/marketing/referrals` |
| Lead routing | `/backend/marketing/lead-routing` |
| Inbound hooks | `/backend/marketing/inbound-hooks` |
| Inbound requests | `/backend/marketing/inbound-requests` |
| Marketing settings | `/backend/marketing/settings` |
| Getting started | `/backend/marketing/setup` |
| Background jobs | `/backend/marketing/jobs` |
