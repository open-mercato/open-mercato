# Agent Orchestration Layer — analiza projektowa bezpieczeństwa

Dokument projektowy: jak zaprojektować każdy z filarów bezpieczeństwa, jakie mechanizmy rynkowe wykorzystać, jakie są kluczowe ryzyka.

---

## 1. Tożsamość i uprawnienia agenta (Agent as a Principal)

### 1.1 Jak zaprojektować

**Agent jako pełnoprawny principal, nie "użytkownik techniczny".**

- Osobny typ tożsamości w systemie: `AgentIdentity` obok `UserIdentity`, z własną tabelą, cyklem życia (provisioning → aktywacja → rotacja → dezaktywacja) i metadanymi: właściciel (human owner), wersja definicji agenta, dozwolone runtimey.
- Model uprawnień trzywarstwowy:
  1. **Uprawnienia statyczne agenta** — maksymalny zakres, jaki agent może kiedykolwiek mieć (definiowany przy rejestracji agenta, zatwierdzany przez admina).
  2. **Uprawnienia kontekstu wywołania** — przecięcie uprawnień agenta i uprawnień workflow/użytkownika, który go wywołał. Agent wywołany przez użytkownika bez prawa do modułu finansowego nie może modyfikować faktur, nawet jeśli statycznie ma taką zdolność. To jest wzorzec **on-behalf-of (OBO)** znany z OAuth 2.0 Token Exchange (RFC 8693).
  3. **Uprawnienia per-task** — dla konkretnego zadania wystawiany jest krótkożyjący token zawierający tylko toole i encje potrzebne w tym zadaniu.
- **Scoping per-tenant wymuszony na poziomie warstwy danych**, nie promptu: każde query wykonywane przez tool agenta przechodzi przez ten sam mechanizm tenant isolation co UI (w Open Mercato: filtry organizacyjne w MikroORM na poziomie repository, nie w warstwie aplikacyjnej agenta). Agent fizycznie nie może zbudować zapytania cross-tenant.
- **Katalog tooli per-workflow**: węzeł Invoke Agent deklaruje explicite listę tooli MCP dostępnych w tym wywołaniu (allowlist). Domyślnie pusta lista, nie "wszystko".

### 1.2 Mechanizmy rynkowe

- **OAuth 2.0 Token Exchange (RFC 8693)** — standard dla delegacji on-behalf-of; wspierany przez Azure Entra ID, Keycloak, Auth0.
- **SPIFFE/SPIRE** — workload identity dla agentów działających jako osobne procesy/kontenery (OpenCode w Dockerze); krótkożyjące certyfikaty SVID zamiast statycznych sekretów.
- **Azure Entra Agent ID** — Microsoft wprowadził dedykowane tożsamości agentowe w Entra; naturalne dopasowanie przy Azure AI Foundry jako runtime.
- **Cedar / OPA (Open Policy Agent)** — policy-as-code do ewaluacji uprawnień per-request; Cedar (AWS) ma formalnie weryfikowalny język polityk, OPA jest de facto standardem w Kubernetes.
- **HashiCorp Vault** — dynamiczne, krótkożyjące credentiale do baz i API zamiast statycznych kluczy w konfiguracji agenta.

### 1.3 Kluczowe ryzyka

| Ryzyko | Skutek | Mitygacja |
|---|---|---|
| Confused deputy — agent z szerokimi uprawnieniami wykonuje polecenie użytkownika o węższych | Eskalacja uprawnień przez pośrednika | Model OBO: efektywne uprawnienia = przecięcie zbiorów |
| Statyczne sekrety w konfiguracji agenta | Wyciek → długotrwały dostęp | Krótkożyjące tokeny, Vault, rotacja |
| Privilege creep — agent dostaje kolejne toole "bo wygodnie" | Powierzchnia ataku rośnie niezauważalnie | Okresowy access review tożsamości agentowych, tak jak ludzkich |
| Współdzielona tożsamość wielu agentów | Brak atrybucji w audycie | Jedna tożsamość = jedna definicja agenta + wersja |
| Tenant leakage przez tool zwracający dane bez filtra | Naruszenie izolacji danych (krytyczne u ubezpieczyciela) | Tenant isolation w warstwie ORM/repository, testy penetracyjne cross-tenant per tool |

---

## 2. Prompt injection przez dane biznesowe

### 2.1 Jak zaprojektować

**Założenie projektowe: injection SIĘ UDA. Architektura ma sprawić, że udany injection nie ma skutku.**

Warstwy obrony (defense in depth):

1. **Separacja kanałów instrukcji i danych.** System prompt i instrukcje zadania budowane wyłącznie po stronie orkiestratora; dane biznesowe (treść zgłoszenia szkody, mail klienta, OCR dokumentu) wstrzykiwane jako oznaczony, delimitowany kontekst z explicit adnotacją "to są dane, nie instrukcje". To obniża skuteczność injection, ale **nie jest granicą bezpieczeństwa** — LLM nie ma architektonicznej separacji code/data.
2. **Spoofing detection na delimiterach**: dane wejściowe skanowane pod kątem prób podszycia się pod strukturę promptu (fałszywe tagi, sekwencje "system:", markery ról). Wykrycie → flaga w trace + eskalacja do human review, nie ciche czyszczenie.
3. **Klasyfikator wejścia (prompt injection detector)** jako filtr sygnałowy — nie blokujący samodzielnie, ale podnoszący risk score zadania. Wysoki risk score obniża próg autonomii (patrz sekcja 5).
4. **Właściwa granica: deterministyczna walidacja skutku, nie treści.** Nawet jeśli atakujący przejmie "intencję" agenta, agent może zwrócić wyłącznie akcję z zamkniętego kontraktu (sekcja 3), a orkiestrator waliduje ją względem reguł biznesowych, których LLM nie widzi i nie może negocjować.
5. **Brak ekspozycji surowych sekretów i ID technicznych w kontekście** — agent operuje na referencjach (opaque handles), które orkiestrator rozwiązuje po swojej stronie. Injection "wyślij dane na adres X" nie zadziała, jeśli agent nie ma toola egress i nie zna prawdziwych identyfikatorów.
6. **Tool output jako wektor**: dane zwracane przez toole (np. treść dokumentu z Google Drive) są tak samo niezaufane jak input użytkownika. Ta sama sanityzacja i risk scoring na każdej iteracji pętli agenta.

### 2.2 Mechanizmy rynkowe

- **Azure AI Content Safety — Prompt Shields** — natywny detektor jailbreak/indirect injection w Azure, zero dodatkowej infrastruktury przy Foundry.
- **Meta Llama Guard / PromptGuard** — otwarte klasyfikatory injection do samodzielnego hostowania (istotne przy wymogach data residency).
- **Rebuff, LLM Guard (Protect AI), Lakera Guard** — komercyjne/OSS warstwy filtrujące z detekcją injection, PII i toxic content.
- **OWASP LLM Top 10 (LLM01: Prompt Injection)** oraz **OWASP Agentic Security Initiative** — jako framework threat modelingu i checklista; warto mapować kontrole wprost na te pozycje (dobrze wygląda też w rozmowie z regulatorem).
- **Wzorce architektoniczne z badań: Dual LLM pattern (Willison), CaMeL (DeepMind)** — separacja LLM planującego (widzi niezaufane dane, nie ma tooli) od LLM wykonującego (ma toole, nie widzi surowych danych). Warto znać, nawet jeśli wdrażamy uproszczoną wersję.

### 2.3 Kluczowe ryzyka

| Ryzyko | Skutek | Mitygacja |
|---|---|---|
| Indirect injection w dokumencie szkody / mailu | Agent proponuje zatwierdzenie oszukańczego roszczenia | Deterministyczne guardrails na skutek + human-in-the-loop przy wysokiej kwocie |
| Injection przez tool output (dokument z zewnętrznego systemu) | Przejęcie pętli agenta w środku zadania | Skanowanie każdego tool output, risk score kumulatywny |
| Exfiltracja danych przez treść odpowiedzi (np. markdown image z URL) | Wyciek PII do zewnętrznego serwera | Brak renderowania nieznanych URL, egress allowlist, opaque handles |
| Fałszywe poczucie bezpieczeństwa po sanityzacji | Osłabienie pozostałych kontroli | Kultura projektowa: sanityzacja = redukcja szumu, nie kontrola bezpieczeństwa |
| Nowe techniki injection omijające klasyfikatory | Detektor przestaje działać po cichu | Klasyfikator tylko jako sygnał; granica zawsze deterministyczna |

---

## 3. "LLM proposes, system disposes" — walidacja outputu i guardrails

### 3.1 Jak zaprojektować

1. **Zamknięty kontrakt akcji.** Agent nie zwraca "tekstu z decyzją", tylko strukturę zgodną z Zod schema: `{ action: enum, params: typed, confidence: number, justification: string }`. Enum akcji jest per-workflow — agent w procesie likwidacji szkód ma np. `PROPOSE_APPROVE | PROPOSE_REJECT | REQUEST_DOCUMENTS | ESCALATE`, nic więcej. Parsowanie fail-closed: niezgodność ze schemą = eskalacja, nigdy retry z poluzowaną walidacją.
2. **Walidacja semantyczna po walidacji strukturalnej.** Schema gwarantuje typ; osobna warstwa reguł biznesowych (business rules engine Open Mercato) waliduje treść: kwota w limicie, polisa aktywna, brak duplikatu roszczenia, zgodność z regułami produktu. Te reguły żyją poza kontekstem LLM — agent ich nie widzi, więc nie może ich "wynegocjować" ani obejść przez injection.
3. **Guardrails jako niezależny komponent orkiestratora**, nie fragment promptu:
   - limity kwotowe per typ decyzji i per agent,
   - allowlisty operacji i encji,
   - invarianty domenowe (np. agent nigdy nie modyfikuje danych polisy, tylko roszczenia),
   - rate limity per agent/per workflow (agent w pętli nie zatwierdzi 500 roszczeń w minutę),
   - kill switch: globalny i per-agent, dostępny dla AgentOps bez deployu.
4. **Idempotencja i dry-run.** Każda akcja agenta ma tryb propose (zapis propozycji) i osobny krok commit wykonywany przez orkiestrator. Propozycja jest artefaktem audytowalnym niezależnie od tego, czy została wykonana.
5. **Human-in-the-loop jako pełnoprawny stan workflow**, nie wyjątek: zadanie approval z pełnym kontekstem (propozycja + uzasadnienie + risk score + diff danych), SLA i ścieżką eskalacji przy braku reakcji.

### 3.2 Mechanizmy rynkowe

- **Zod / JSON Schema + structured outputs** — natywne structured output w API Anthropic/OpenAI/Azure gwarantuje zgodność składniową; walidacja Zod po stronie orkiestratora pozostaje jako druga linia (nie ufamy gwarancjom providera w 100%).
- **Guardrails AI, NVIDIA NeMo Guardrails** — frameworki walidacji output z programowalnymi regułami; NeMo pozwala definiować dozwolone przepływy dialogowe/akcje.
- **OPA / Cedar** — te same silniki polityk co przy uprawnieniach mogą walidować akcje ("czy agent X może wykonać akcję Y na encji Z przy kwocie K").
- **Temporal / silnik workflow Open Mercato** — durable execution z jawnym krokiem human approval; wzorzec saga dla akcji odwracalnych.
- **Feature flags (Unleash, LaunchDarkly, GrowthBook)** — jako mechanizm kill switch i stopniowego zwiększania autonomii agenta (canary: 5% decyzji autonomicznych → obserwacja → 50% → 100%).

### 3.3 Kluczowe ryzyka

| Ryzyko | Skutek | Mitygacja |
|---|---|---|
| Reguły biznesowe niekompletne — agent robi coś "zgodnego ze schemą", ale bezsensownego | Szkoda biznesowa mimo walidacji | Invarianty domenowe + dry-run + canary rollout autonomii |
| Rubber-stamping — ludzie klepią approvale bez czytania | Human-in-the-loop staje się teatrem | UX: pokazuj diff i uzasadnienie, mierz czas review, losowe podwójne review |
| Walidacja rozjeżdża się z logiką aplikacji (dwa źródła prawdy) | Agent może więcej niż UI albo mniej niż powinien | Reużycie tych samych services/rules co UI, nie osobna implementacja "dla agentów" |
| Retry loop po odrzuceniu propozycji — agent "szuka" akcji, która przejdzie | Obejście guardrails metodą prób | Limit propozycji per task, każde odrzucenie w trace, eskalacja po N odrzuceniach |
| Kill switch nieprzetestowany | W incydencie nie działa | Game day / chaos testing wyłącznika |

---

## 4. Audit trail i non-repudiation

### 4.1 Jak zaprojektować

1. **Dwuwarstwowy model atrybucji.** Każdy zapis audytowy zawiera: `agent_identity` (+ wersja definicji agenta, wersja promptu, model + wersja modelu) oraz `invoker` (użytkownik / workflow / scheduler). Wywołanie automatyczne → invoker = workflow run ID; wywołanie ręczne → invoker = user ID. Odpowiedź na pytanie "kto odpowiada" jest zawsze jednoznaczna i zawsze wskazuje człowieka lub proces zatwierdzony przez człowieka.
2. **Pełny zapis kontekstu decyzji**: system prompt (lub jego hash + wersja z rejestru promptów), wstrzyknięty kontekst danych, wszystkie tool calls z parametrami i wynikami, surowa odpowiedź LLM, wynik walidacji, decyzja guardrails, akcja finalna, risk score. Bez tego incident response i odpowiedź regulatorowi są niemożliwe.
3. **Append-only + integralność.** Log audytowy niemodyfikowalny: osobny store z hash chain (każdy wpis zawiera hash poprzedniego) lub WORM storage (Azure Immutable Blob Storage — naturalny wybór w stacku Ergo Hestia). Uprawnienia zapisu tylko dla orkiestratora, odczyt dla audytorów.
4. **Rozdzielenie trace operacyjnego od audit logu.** Trace (OpenTelemetry/LangSmith-style) służy debugowaniu i ma retencję krótką; audit log służy rozliczalności i ma retencję regulacyjną (w ubezpieczeniach: lata). Różne wymogi dostępu, różne PII handling.
5. **PII w logach**: kontekst decyzji zawiera dane osobowe → audit log podlega RODO. Projekt: pseudonimizacja referencjami (log trzyma ID encji, nie snapshot danych osobowych, chyba że snapshot jest niezbędny do odtworzenia decyzji — wtedy szyfrowanie per-tenant i polityka retencji zgodna z podstawą prawną).
6. **Mapowanie na wymogi**: EU AI Act art. 12 (record-keeping dla systemów wysokiego ryzyka — automatyczne logowanie zdarzeń przez cały cykl życia), art. 14 (human oversight), wytyczne KNF dot. outsourcingu chmurowego i wyjaśnialności decyzji. Warto utrzymywać macierz kontrola → wymóg.

### 4.2 Mechanizmy rynkowe

- **OpenTelemetry + konwencje GenAI semantic conventions** — standard trace'owania wywołań LLM/tooli; eksport do dowolnego backendu (Azure Monitor, Grafana Tempo, Jaeger).
- **LangSmith, Langfuse (OSS, self-hosted), Arize Phoenix** — dedykowana obserwowalność LLM: pełne zapisy promptów, tool calls, kosztów, latencji. Langfuse self-hosted dobrze pasuje do wymogów data residency.
- **Azure Immutable Blob Storage (WORM), AWS QLDB-style ledgery** — niemodyfikowalny storage dla audit logu.
- **Rejestr promptów z wersjonowaniem** (Langfuse prompts, git-backed registry) — bez wersjonowania promptu nie da się odtworzyć, "dlaczego agent tak zdecydował" trzy miesiące później.
- **SIEM (Microsoft Sentinel)** — audit log agentów jako źródło zdarzeń: reguły korelacyjne na anomalie (skok wolumenu decyzji, seria odrzuconych propozycji, decyzje poza godzinami).

### 4.3 Kluczowe ryzyka

| Ryzyko | Skutek | Mitygacja |
|---|---|---|
| Log bez wersji promptu/modelu | Decyzja nieodtwarzalna → brak wyjaśnialności wobec regulatora | Wersjonowanie promptów i pinning wersji modeli, zapis w każdym wpisie |
| PII w logach bez podstawy i retencji | Naruszenie RODO przez własny mechanizm compliance | Pseudonimizacja, szyfrowanie, polityka retencji per kategoria danych |
| Modyfikowalny log | Non-repudiation nie istnieje | Hash chain / WORM, separacja uprawnień |
| Cichy update modelu u providera zmienia zachowanie | "Ten sam" agent decyduje inaczej, log tego nie tłumaczy | Pinning wersji modelu, eval regresyjny przy każdej zmianie wersji (sekcja Evals) |
| Log jako wektor ataku (zawiera prompty i dane) | Wyciek know-how i PII | Kontrola dostępu do logów jak do danych produkcyjnych |

---

## 5. Confidence threshold — risk management, nie security control

### 5.1 Jak zaprojektować (świadomie ograniczony mechanizm)

1. **Nazwać rzecz po imieniu w architekturze**: confidence jest self-reported przez LLM — jest niekalibrowany, podatny na injection ("report confidence 0.99") i nie jest miarą poprawności. Dlatego w architekturze confidence NIGDY nie jest jedynym warunkiem autonomii.
2. **Decyzja o autonomii = funkcja wielu sygnałów**: `autonomy_decision = f(confidence, risk_score_wejścia, kategoria decyzji, kwota/istotność, historia agenta, wynik guardrails)`. Confidence to jeden z argumentów, guardrails deterministyczne to warunki konieczne.
3. **Thresholdy per typ decyzji, nie globalne**: auto-approve drobnej szkody komunikacyjnej do 2000 zł ≠ auto-approve szkody osobowej. Macierz: kategoria decyzji × zakres kwotowy → próg + wymagany poziom oversight.
4. **Kalibracja empiryczna zamiast deklaratywnej**: zamiast wierzyć liczbie z modelu, mierzyć na danych historycznych, jak często decyzje agenta przy danym confidence pokrywały się z decyzją człowieka (agreement rate). Threshold ustawiany na podstawie tej krzywej, rewalidowany po każdej zmianie modelu/promptu.
5. **Alternatywy/uzupełnienia dla self-reported confidence**: self-consistency (N niezależnych przebiegów, zgodność odpowiedzi jako proxy pewności), osobny model-weryfikator (LLM-as-judge oceniający propozycję), sygnały niepewności z logprobs (gdzie dostępne).
6. **Sprzężenie z Agent Evals**: progi autonomii powiązane z wynikami evalów regresyjnych — agent, którego eval spadł poniżej baseline po zmianie modelu, automatycznie traci autonomię do czasu re-kalibracji.

### 5.2 Mechanizmy rynkowe

- **Inspect AI (UK AISI), Promptfoo, DeepEval, Ragas** — harness evalowy do kalibracji i regresji (Inspect już jest w Twoim stacku do benchmarków).
- **LLM-as-judge patterns** — drugi model jako weryfikator propozycji; tańszy model do triage, mocniejszy do weryfikacji przypadków granicznych.
- **Konformalna predykcja (conformal prediction)** — statystyczna rama dająca gwarancje pokrycia dla progów decyzyjnych; dojrzała w ML klasycznym, rosnąca adopcja w LLM.
- **Feature flags / progressive delivery** — stopniowe podnoszenie autonomii jako proces operacyjny z metrykami, nie jednorazowa konfiguracja.

### 5.3 Kluczowe ryzyka

| Ryzyko | Skutek | Mitygacja |
|---|---|---|
| Confidence zmanipulowany przez injection | Auto-approve wrogiej propozycji | Confidence nigdy nie jest warunkiem wystarczającym; guardrails deterministyczne zawsze aktywne |
| Threshold ustawiony "na oko" | Zła kalibracja: albo teatr autonomii, albo fałszywe bezpieczeństwo | Kalibracja empiryczna na agreement rate, rewalidacja po zmianach |
| Drift po zmianie modelu | Stary próg, nowa dystrybucja confidence | Pinning modelu + eval regresyjny jako bramka wersji |
| Gaming przez wzorce w danych (agent "nauczony", że pewne frazy podnoszą approve rate) | Systematyczne błędy | Losowy sampling decyzji autonomicznych do human review (np. 5%) na stałe |
| Human oversight zanika, bo "agent ma wysokie confidence" | Utrata kompetencji zespołu, rubber-stamping | Stały odsetek losowych review + metryki jakości review |

---

## 6. Przekrojowe zasady projektowe (podsumowanie)

1. **Granice bezpieczeństwa są deterministyczne.** LLM i klasyfikatory to sygnały; egzekwują: schema, reguły biznesowe, uprawnienia, tenant isolation.
2. **Fail-closed wszędzie**: błąd parsowania, timeout, niedostępny klasyfikator → eskalacja do człowieka, nigdy auto-approve.
3. **Reużycie istniejących mechanizmów aplikacji** (uprawnienia, reguły, audit) zamiast równoległego "świata agentów" — dwa źródła prawdy to gwarantowany rozjazd.
4. **Autonomia jest zdobywana, nie przyznawana**: canary rollout, kalibracja, stały losowy human review.
5. **Wszystko wersjonowane**: prompt, model, definicja agenta, reguły — bo bez tego audyt nie wyjaśnia niczego.
6. **Threat modeling wg OWASP LLM Top 10 + OWASP Agentic threats** jako powtarzalny proces przy każdym nowym toolu/workflow, nie jednorazowy dokument.
