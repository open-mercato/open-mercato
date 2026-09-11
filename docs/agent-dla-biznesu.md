# Agent AI w Open Mercato — przewodnik dla osób biznesowych

Ten dokument tłumaczy **prostymi słowami**, czym jest agent AI i z czego się składa.
Nie musisz znać się na programowaniu, żeby go zrozumieć. Druga część pokazuje,
jak taki agent powstaje w Open Mercato — żebyś wiedział(a), o co poprosić zespół.

> **O jakim agencie mówimy?** O **agencie plikowym uruchamianym na silniku OpenCode**
> (moduł *Agent Orchestrator*). To zaawansowany agent, którego uruchamiasz z panelu
> („Playground”) i który ma wszystkie cztery klocki opisane niżej: **instrukcje,
> umiejętności, narzędzia i podagentów**.
>
> Open Mercato ma też prostsze asystenty „w aplikacji” (np. okno czatu na liście
> klientów) — te działają inaczej i nie korzystają z umiejętności ani podagentów.
> Ten przewodnik dotyczy **agenta OpenCode**.

---

## Część 1. Z czego składa się agent? (w prostych słowach)

Wyobraź sobie, że zatrudniasz **nowego pracownika**. Żeby dobrze wykonywał pracę,
musisz mu dać kilka rzeczy. Agent AI działa tak samo.

### 🧑‍💼 Agent — to „pracownik”

Agent to wirtualny asystent, który dostaje zadanie i je wykonuje. Na przykład:
agent „Ocena kondycji szansy sprzedaży”, który analizuje transakcję i podpowiada,
do jakiego etapu lejka ją przesunąć. Każdy agent ma **jeden, konkretny cel** —
tak jak pracownik ma swoje stanowisko.

> **Ważna zasada bezpieczeństwa:** w Open Mercato agent **niczego sam nie zmienia
> w systemie**. On tylko **proponuje** („proponuję przesunąć transakcję do etapu
> Negocjacje”). Człowiek tę propozycję zatwierdza lub odrzuca. To jak asystent,
> który przygotowuje decyzję, ale podpisuje ją zawsze przełożony.

### 📋 Instrukcje (instructions) — to „opis stanowiska”

Instrukcje mówią agentowi **kim jest, czym ma się zajmować i jak ma się zachowywać**.
To jak regulamin i opis obowiązków dla nowego pracownika.

> Przykład: *„Oceniasz kondycję jednej szansy sprzedaży i proponujesz najbardziej
> odpowiedni kolejny etap. Bądź konkretny, ale uczciwy co do niepewności.”*

### 🎯 Oczekiwany wynik (outcome) — to „format raportu, który ma oddać”

To z góry ustalony **kształt odpowiedzi**, jaką agent musi zwrócić — żeby wynik dało
się od razu wykorzystać, a nie był luźnym opowiadaniem. Tak jak wymóg, by pracownik
oddał raport na firmowym formularzu, a nie na luźnej kartce.

> Przykład: agent zawsze zwraca *propozycję działania* + *poziom pewności (0–1)* +
> *krótkie uzasadnienie dla menedżera*.

### 🛠️ Narzędzia (tools) — to „uprawnienia i dostępy”

Narzędzia to konkretne **czynności**, które agent potrafi wykonać — tak jak pracownik
dostaje login i dostęp do konkretnych programów.

> Przykłady: *„pobierz historię zgłoszeń klienta”, „wyszukaj dane transakcji”.*

Ważne: agent ma **tylko te narzędzia, które mu nadasz**, i — zgodnie z zasadą wyżej —
w tym trybie są to **wyłącznie narzędzia czytające** dane. Agent nie ma jak „po cichu”
czegoś zmienić; może to tylko **zaproponować** do zatwierdzenia.

### 🧩 Umiejętności (skills) — to „firmowe procedury / instruktaże”

Umiejętność to **gotowy poradnik krok-po-kroku** do powtarzalnego zadania, po który
agent sięga, gdy jest potrzebny. Tak jak firmowa instrukcja „jak ocenić etap transakcji”.

> Przykład: umiejętność *„Podręcznik etapów lejka”* — opisuje wszystkie etapy
> sprzedaży i reguły, kiedy przesunąć transakcję dalej, a kiedy się wstrzymać.
> Agent wczytuje ją dopiero wtedy, gdy faktycznie podejmuje tę decyzję.

Różnica w skrócie: **narzędzie** = jedna czynność w systemie. **Umiejętność** =
wiedza i procedura, jak coś dobrze zrobić.

### 👥 Podagenci (subagents) — to „specjaliści, do których agent deleguje”

Czasem część zadania lepiej zlecić wąsko wyspecjalizowanemu pomocnikowi. Główny agent
może **poprosić podagenta** o wykonanie fragmentu pracy i odebrać gotowy wynik —
tak jak pracownik przekazuje część zadania koledze z innego działu.

> Przykład: główny agent ocenia całą transakcję, a do przejrzenia ostatnich kontaktów
> z klientem wysyła podagenta *„Skan aktywności”*, który wraca z podsumowaniem:
> „rozmowy ucichły 3 tygodnie temu, tempo spada”.

### Podsumowanie jednym obrazkiem

| Pojęcie | Analogia z firmy | Po co to jest |
|---|---|---|
| **Agent** | Pracownik | Wykonuje zadanie i **proponuje** decyzję (nie wykonuje jej sam) |
| **Instrukcje** | Opis stanowiska / regulamin | Mówią, kim jest i jak ma działać |
| **Oczekiwany wynik** | Firmowy formularz raportu | Wymusza użyteczny, jednolity kształt odpowiedzi |
| **Narzędzia** | Loginy i dostępy | Pozwalają **czytać** dane potrzebne do decyzji |
| **Umiejętności** | Firmowe poradniki / procedury | Wiedza „jak zrobić to dobrze”, wczytywana w razie potrzeby |
| **Podagenci** | Specjaliści z innych działów | Przejmują wyspecjalizowane fragmenty pracy |

---

## Część 2. Jak powstaje taki agent w Open Mercato? (na OpenCode)

Tę część czyta zwykle zespół techniczny, ale opisujemy ją tak, żebyś **wiedział(a),
co się dzieje i o co zapytać**. Kluczowa rzecz: agent OpenCode to **zestaw zwykłych
plików tekstowych** w folderze. Nie trzeba pisać skomplikowanego programu — większość
to opis po ludzku, w plikach Markdown.

### Krok 0. Włączenie modułu (jednorazowo)

Agenci OpenCode to funkcja **enterprise**. Trzeba ją najpierw włączyć w konfiguracji
(`apps/mercato/.env`):

```
OM_ENABLE_ENTERPRISE_MODULES=true
OM_ENABLE_ENTERPRISE_MODULES_AGENTS=true
```

Działa też **silnik OpenCode** (uruchamiany jako osobny kontener Docker), który
faktycznie „myśli” za agenta, oraz **klucz do dostawcy AI** (np. Anthropic / OpenAI).

### Krok 1. Decyzja: po co nam agent?

Ustalamy **cel biznesowy**: jaką decyzję agent ma przygotowywać i w jakim obszarze.
Jeden agent = jedno zadanie. Odpowiadamy na trzy pytania:
1. **Jaką decyzję** ma proponować? (np. „następny etap dla transakcji”)
2. **Czego potrzebuje**, żeby ją podjąć? (jakie dane, jaka wiedza)
3. **Co dokładnie ma oddać** jako wynik? (propozycja + pewność + uzasadnienie)

### Krok 2. Folder agenta i jego pliki

Agent powstaje jako folder `agents/<nazwa_agenta>/` z kilkoma plikami. Tak wygląda
prawdziwy przykład z Open Mercato (agent „Ocena kondycji szansy sprzedaży”):

```
agents/deals_health_check/
├── AGENT.md            ← instrukcje + ustawienia (kim jest, jaki model AI)
├── OUTCOME.md          ← oczekiwany wynik (kształt odpowiedzi)
├── skills/
│   └── stage_playbook/
│       └── SKILL.md    ← umiejętność: podręcznik etapów lejka
├── sub-agents/
│   └── activity_scan/
│       └── AGENT.md    ← podagent: skan aktywności klienta
└── tools/              ← narzędzia (opcjonalnie)
```

**`AGENT.md` (instrukcje)** zaczyna się od krótkiej „metryczki”, a potem zawiera
polecenie napisane zwykłym językiem:

```markdown
---
id: deals.health_check_file
label: Ocena kondycji szansy sprzedaży
provider: anthropic            # dostawca AI
model: claude-sonnet-4-5       # model AI
skills: [stage_playbook]       # jakie umiejętności są dostępne
subAgents: [deals.activity_scan]  # jacy podagenci pomagają
---
Oceniasz kondycję jednej szansy sprzedaży i proponujesz najbardziej
odpowiedni kolejny etap. Bądź konkretny, ale uczciwy co do niepewności.
```

**`OUTCOME.md` (oczekiwany wynik)** opisuje, co agent musi zwrócić — np. listę
proponowanych działań, poziom pewności (0–1) i uzasadnienie dla menedżera.

### Krok 3. Dodajemy umiejętności i podagentów (opcjonalnie)

- **Umiejętność** to po prostu kolejny plik `SKILL.md` z poradnikiem (np. „reguły,
  kiedy przesunąć transakcję do następnego etapu”). Agent wczyta go, gdy będzie
  potrzebny.
- **Podagent** to mniejszy agent w podfolderze `sub-agents/` — ze swoim własnym
  `AGENT.md` — który robi wąski fragment pracy (np. tylko przegląda aktywność klienta)
  i oddaje wynik głównemu agentowi.

### Krok 4. Bezpieczeństwo jest wbudowane

To nie wymaga konfiguracji „ręcznej” — pilnuje tego sam system:
- agent OpenCode **może tylko czytać** dane i **proponować** — nie zmienia niczego
  bezpośrednio;
- każde użycie narzędzia jest **sprawdzane pod kątem uprawnień** przy każdym wywołaniu;
- agent widzi **wyłącznie dane swojej firmy/klienta** (brak podglądu cudzych danych).

### Krok 5. Uruchomienie i zatwierdzanie

1. Po dodaniu/zmianie plików zespół uruchamia `yarn generate` i odświeża silnik OpenCode.
2. Agent pojawia się w panelu w sekcji **Playground**, gdzie można go odpalić na
   przykładowych danych i zobaczyć wynik.
3. Gdy agent zaproponuje działanie, trafia ono na **listę propozycji do zatwierdzenia** —
   człowiek akceptuje (i wtedy zmiana się wykonuje) albo odrzuca.

### W skrócie dla decydenta

Agent OpenCode w Open Mercato to **zestaw czytelnych plików**, a nie „czarna skrzynka”.
Zawsze wiadomo:
- **co** agent potrafi (lista narzędzi i umiejętności w plikach),
- **jak** ma działać (instrukcje w `AGENT.md`),
- **co** ma oddać (oczekiwany wynik w `OUTCOME.md`),
- a **agent nigdy nie zmienia danych sam** — tylko proponuje, a decyzję podejmuje człowiek.

Dzięki temu agent realnie przyspiesza pracę i przygotowuje decyzje, a Ty zachowujesz
pełną kontrolę i bezpieczeństwo danych.
