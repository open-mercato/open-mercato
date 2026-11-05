/* Zatwierdzone wątki komentarzy — plik commitowany do repo.
 *
 * Nie edytuj ręcznie. Recenzenci dodają komentarze w prototypie (tryb "Komentarze"),
 * klikają "Eksportuj do repo", podmieniają ten plik i commitują. Wtedy wątki widzi
 * cały zespół. Ładowany zwykłym <script>, więc działa też przez file:// — bez serwera.
 *
 * Schemat wątku:
 *   id        — stabilny identyfikator (nie zmieniaj przy edycji)
 *   screen    — id sekcji ekranu, np. "s5"
 *   anchor    — ścieżka do elementu wewnątrz sekcji; null = uwaga do całego ekranu
 *   label     — czytelny opis zakotwiczonego elementu (do listy osieroconych)
 *   resolved  — czy wątek zamknięty
 *   messages  — [{ author, text, at }]
 */
window.__OM_MOCKUP_COMMENTS__ = [];
