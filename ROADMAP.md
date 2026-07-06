# Portfolio Copilot - roadmapa projektu


## Aktualizacja 2026-07-03

Najbliższy etap z `plans/` został zaimplementowany jako lokalny, read-only cockpit:

- UI ma zakładki: Overview, Transactions, Reports, Imports, Strategy, Memory, Chat i Settings.
- Pierwszym realnym strumieniem danych jest mBank przez domyslny adapter Gmail REST API w trybie read-only; lokalny i oficjalny Gmail MCP pozostaja obslugiwanymi wariantami adaptera.
- Aplikacja nie przechowuje raw maili ani raw plików importu; zapisuje tylko znormalizowane batch metadata i transakcje.
- Lokalny LLM może dostać pełny lokalny kontekst użytkownika, ale aplikacja nadal nie używa zewnętrznych providerów LLM.
- Profil finansowy użytkownika zastępuje procentową strategię jako źródło prawdy; legacy allocation guardrails pozostają jako reguły pomocnicze.
- Chat, pamięć, trace spans i retencja danych działają lokalnie.
- iPhone/local mobile model zostaje przyszłym kierunkiem, nie częścią tego etapu.
- Web search i internetowe dane rynkowe pozostają poza zakresem tej iteracji.

## Cel

Portfolio Copilot ma być lokalną aplikacją read-only do analizy finansów osobistych i inwestycji. System ma agregować dane z Binance, XTB oraz banku, prezentować prosty dashboard majątku i alokacji, a po ręcznym uruchomieniu generować raport inwestycyjny z sygnałami ryzyka, rankingiem okazji, rekomendacjami, planem rebalancingu i oceną zgodności z prostą strategią użytkownika.

System nie wykonuje i nigdy nie powinien wykonywać samodzielnych akcji na giełdzie, w banku ani u brokera. Wszystkie integracje finansowe mają działać wyłącznie w trybie odczytu.

## Założenia

- Aplikacja działa lokalnie na komputerze użytkownika.
- MVP ma ręczne akcje oraz lokalny in-app scheduler działający tylko wtedy, gdy aplikacja jest uruchomiona.
- Dane mogą trafić do lokalnego LLM w pełnym lokalnym kontekście, ale nie do zewnętrznych providerów LLM.
- Integracje finansowe są read-only i powinny wymuszać read-only również na poziomie konfiguracji API.
- Agenci AI i generowanie raportów mają działać lokalnie. Nie używamy zewnętrznych providerów LLM typu OpenAI, Gemini API, Anthropic, hosted Ollama Cloud ani podobnych usług.
- Preferowana rodzina modeli lokalnych: Google Gemma, uruchamiana przez lokalny runtime, na MVP przez Ollama.
- MCP jest używane tam, gdzie daje realną wartość produkcyjną: stabilny kontrakt narzędzi, możliwość podłączenia zewnętrznych hostów, izolacja integracji lub wielokrotne użycie narzędzi.
- Proste operacje wewnętrzne mogą być zwykłymi tools/services bez MCP.
- Obserwowalność LLM i workflow opiera się o Langfuse.
- Architektura kontekstu i pamięci wzoruje się na Mastra: workflow, agents, working memory, semantic/context recall oraz Observer/Reflector.

## Status implementacji

Ostatnia aktualizacja: 2026-07-06.

Zaimplementowane w aktualnym lokalnym MVP:

- Next.js + React + TypeScript jako zakladkowy dashboard: Overview, Transactions, Reports, Imports, Strategy, Memory, Chat i Settings.
- PostgreSQL/pgvector przez Docker Compose, Prisma schema, migracje i seed sample data.
- Manualny analysis run uruchamiany z UI oraz przez `POST /api/runs`.
- Lokalny workflow agentowy:
  - `Context Assembler`,
  - `Spending Analyst`,
  - `Analyst`,
  - `Risk Reviewer`,
  - `Strategy Planner`,
  - `Reporter`,
  - opcjonalny `local-gemma` reporter,
  - `Report Critic`.
- Lokalny Ollama/Gemma runtime z deterministycznym fallbackiem i diagnostyka zrodla raportu.
- Read-only import mBank przez domyslny Gmail REST API provider `gmail-api`; adapter obsluguje tez `local` i `google-official` MCP providers.
- Import flow: `Sync now`, preview, korekta kategorii w preview, retry parse, reject, confirm, dedupe i korekta kategorii po imporcie.
- Parser mBank dla zanonimizowanego formatu key-value oraz zaobserwowanego HTML notification attachment.
- In-app scheduler dzialajacy tylko gdy lokalna aplikacja i Gmail access sa dostepne.
- Retencja czyszczaca stare runy, raporty, eventy i trace spans bez usuwania importow ani transakcji.
- Globalny lokalny chat, pamiec obserwacyjna, trace spans w DB i opcjonalny lokalny Langfuse.
- Dokumentacja postepu jest w `docs/implementation-progress.md`.

Zweryfikowane lokalnie:

- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:seed`
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- zintegrowane smoke checks UI opisane w `docs/implementation-progress.md`.

Niezaimplementowane jeszcze:

- realne connectory Binance/XTB,
- historical Gmail backfill,
- import wielu formatow mBank poza zaobserwowanymi fixture,
- systemowy scheduler poza procesem Next.js,
- wypelniony no-raw manual evidence record dla prawdziwego maila uzytkownika.

## Granice odpowiedzialności

Portfolio Copilot może:

- analizować portfel i historię transakcji,
- wykrywać ryzyka, koncentrację i niespójności ze strategią,
- wskazywać potencjalne okazje na podstawie danych i źródeł,
- proponować plan rebalancingu,
- tworzyć raporty i checklisty decyzyjne,
- wyjaśniać założenia oraz pokazywać źródła.

Portfolio Copilot nie może:

- składać zleceń kupna lub sprzedaży,
- wykonywać przelewów,
- obchodzić ograniczeń API,
- ukrywać niepewności lub braków danych,
- udawać licencjonowanego doradcy inwestycyjnego,
- podejmować decyzji finansowych za użytkownika.

## Proponowany stack

- Frontend: Next.js + React + TypeScript.
- Backend aplikacyjny: TypeScript.
- Agent/workflow layer: Mastra albo architektura inspirowana Mastra, jeśli pełne użycie frameworka okaże się zbyt ciężkie dla MVP.
- Database: PostgreSQL lokalnie przez Docker Compose.
- Vector/context search: pgvector.
- Queue/jobs: na MVP brak albo prosta tabela `runs`; później Redis/BullMQ.
- Observability: Langfuse.
- Local AI runtime: Ollama z modelami Gemma jako pierwszy adapter.
- Secrets: lokalny `.env` na MVP, później szyfrowany vault w bazie lub systemowy keychain.
- Integracje: serwisy domenowe + wybrane MCP servers.
- UI: zakładkowy lokalny cockpit z globalnym lokalnym chatem.

## Architektura logiczna

```text
UI Dashboard
  |
  |-- Manual Run Controls
  |-- Portfolio Views
  |-- Reports
  |-- Settings
  |
Backend API
  |
  |-- Data Ingestion
  |     |-- Binance read-only connector
  |     |-- XTB read-only connector
  |     |-- bank CSV/email import
  |     |-- Market data connector
  |     |-- Web research connector
  |
  |-- Data Store
  |     |-- raw financial records
  |     |-- normalized transactions
  |     |-- portfolio snapshots
  |     |-- market snapshots
  |     |-- research artifacts
  |     |-- agent runs and traces
  |
  |-- Agent Workflow
        |-- Context Assembler
        |-- Analyst
        |-- Risk Reviewer
        |-- Reporter
  |
  |-- Observational Memory
        |-- Observer
        |-- Reflector
```

## Flow analizy finansowej

Ten flow odpowiada za jeden ręcznie uruchomiony run analityczny. Observer i Reflector nie są tutaj klasycznymi krokami raportu, tylko osobnym mechanizmem pamięci opisanym w następnej sekcji.

### 1. Context Assembler

Zbiera aktualny stan świata dla jednego runu:

- snapshot portfela Binance,
- snapshot portfela XTB,
- ostatni import banku,
- aktualne ceny aktywów,
- podstawowe źródła internetowe,
- poprzednie wnioski i strategię użytkownika.

Context Assembler nie rekomenduje decyzji. Jego zadaniem jest kompletność danych, oznaczenie braków i przygotowanie faktów dla agenta analitycznego.

### 2. Analyst

Analizuje dane przygotowane przez Context Assemblera:

- struktura majątku,
- alokacja per klasa aktywów,
- ekspozycja walutowa,
- PnL tam, gdzie dane na to pozwalają,
- koncentracja ryzyka,
- korelacja pozycji,
- potencjalne okazje,
- potencjalne problemy.

Analyst może formułować rekomendacje, ale muszą być powiązane z danymi, strategią i poziomem niepewności.

### 3. Risk Reviewer

Sprawdza analizę pod kątem ryzyka:

- nadmierna koncentracja,
- ryzyko walutowe,
- ryzyko płynności,
- ekspozycja na jeden sektor/narrację,
- sprzeczność z prostą strategią,
- brak danych wejściowych,
- źródła niskiej jakości.

### 4. Report Critic

Ocenia jakość pracy poprzednich kroków:

- czy raport opiera się na danych z bieżącego runu,
- czy rekomendacje są uzasadnione,
- czy zostały oznaczone braki danych,
- czy nie ma halucynowanych faktów,
- czy nie pominięto istotnych ryzyk,
- czy wynik jest zgodny z ograniczeniem read-only,
- czy wynik spełnia format raportu.

Report Critic może wymusić korektę raportu albo oznaczyć go jako wymagający ręcznej weryfikacji. To nie jest ten sam komponent co Reflector z Observational Memory.

### 5. Reporter

Tworzy finalny raport:

- krótkie streszczenie,
- aktualna alokacja,
- najważniejsze zmiany,
- sygnały ryzyka,
- ranking potencjalnych okazji,
- rekomendacje,
- plan rebalancingu,
- zgodność ze strategią,
- sekcja "czego nie wiemy",
- lista źródeł i danych użytych w raporcie.

## Observational Memory według Mastry

W Mastrze Observer/Reflector to mechanizm zarządzania kontekstem, a nie pipeline domenowy. Główny agent pracuje na bieżących wiadomościach/runach, a procesor pamięci w tle zamienia długą historię w trzy warstwy:

1. Recent messages: świeży, dokładny kontekst bieżącego zadania.
2. Observations: skompresowany dziennik istotnych zdarzeń, decyzji, preferencji, braków danych i wyników narzędzi.
3. Reflections: dalsza kompresja obserwacji, gdy ich log robi się zbyt długi.

W Portfolio Copilot ten wzorzec powinien działać na historii runów, raportów i interakcji użytkownika:

- Observer obserwuje zakończony run, użyte dane, braki, decyzje, wygenerowany raport, odpowiedź użytkownika i ewentualne korekty.
- Observer zapisuje krótkie obserwacje z priorytetami, datą, statusem ukończenia i aktualnym zadaniem.
- Reflector konsoliduje starsze obserwacje w bardziej zwartą pamięć, zachowując decyzje, strategię, ważne daty, błędy i wnioski.
- Główny flow analizy nie dostaje całej historii raw runów, tylko aktualny snapshot, strategię, świeże wiadomości oraz skompresowane obserwacje/refleksje.
- Jeśli potrzebne są dokładne dane źródłowe, system odwołuje się do raw records, a nie do pamięci obserwacyjnej.

Praktyczna adaptacja z Mastry:

- `thread` = pojedynczy wątek lub seria runów dla jednego celu, np. "monthly-review-2026-05".
- `resource` = użytkownik/portfel, czyli pamięć przekrojowa między runami.
- `messageTokens` = próg obserwacji historii runu/interakcji.
- `observationTokens` = próg refleksji dla logu obserwacji.
- `current-task` = bieżący cel analityczny, np. "przygotować majowy raport portfela".
- `suggested-response` = wskazówka dla następnego kroku UI lub agenta, np. "pokaż braki danych przed raportem".

Na MVP warto zacząć od synchronicznej wersji bez async buffering:

- po zakończeniu manualnego runu tworzymy observation record,
- po przekroczeniu progu obserwacji uruchamiamy Observera,
- po przekroczeniu progu obserwacji skompresowanych uruchamiamy Reflectora,
- w Langfuse zapisujemy osobne spany dla main analysis, observer i reflector.

## Warstwy pamięci i kontekstu

### Raw data

Dane źródłowe, możliwie bliskie oryginałowi:

- transakcje,
- salda,
- importy CSV,
- snapshoty cen,
- dokumenty źródłowe,
- odpowiedzi API,
- pobrane artykuły lub streszczenia źródeł.

### Normalized data

Ujednolicony model domenowy:

- account,
- asset,
- transaction,
- position,
- cashflow,
- portfolio_snapshot,
- market_snapshot,
- spending_category.

### Working memory

Krótka, jawna pamięć operacyjna:

- strategia użytkownika,
- preferencje ryzyka,
- docelowa alokacja,
- aktywa na watchliście,
- ograniczenia typu "nie wysyłaj danych osobowych do LLM",
- preferowany format raportu.

### Reflection memory

Wnioski z poprzednich runów:

- co agent zauważył wcześniej,
- jakie rekomendacje były nietrafione lub zbyt słabe,
- jakie źródła były użyteczne,
- jakie dane często są brakujące,
- jakie reguły powinny zostać doprecyzowane.

## Local AI Runtime

Cel: wszystkie role agentowe i generowanie raportów mają działać lokalnie, bez zewnętrznych providerów LLM.

Decyzja MVP:

- Runtime: Ollama jako lokalny proces z HTTP API na `http://localhost:11434`.
- Model domyślny: `gemma3:4b`, bo jest rozsądnym punktem startowym dla laptopa i ma gotowy wariant w Ollama.
- Model powinien być konfigurowalny przez `.env`, np. `OLLAMA_MODEL=gemma3:4b`.
- Aplikacja nie może mieć zależności od OpenAI, Gemini API, Anthropic, hosted Ollama Cloud ani innych zewnętrznych providerów LLM.
- Pierwsza integracja LLM powinna objąć tylko `Reporter`, z fallbackiem do obecnego deterministycznego raportu.
- `Context Assembler`, obliczenia portfelowe i `Risk Reviewer` zostają deterministyczne.
- Model dostaje ograniczony lokalny kontekst z limitem liczby rekordow i diagnostyka `contextLimits`; raw body maila, sekrety i prywatne artefakty nie trafiaja do promptu.

Proponowane zmienne środowiskowe:

- `LLM_PROVIDER=ollama`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OLLAMA_MODEL=gemma3:4b`
- `LLM_TIMEOUT_MS=60000`
- `LLM_REPORTER_ENABLED=false`

Minimalne komendy lokalne:

```bash
ollama pull gemma3:4b
ollama run gemma3:4b
```

Zakres implementacji:

- `src/lib/llm/local-llm-client.ts` jako mały adapter do lokalnego Ollama API.
- Walidacja, że `OLLAMA_BASE_URL` jest lokalnym adresem (`localhost`, `127.0.0.1`, `::1`) chyba że użytkownik jawnie zmieni politykę.
- Health check lokalnego modelu.
- Timeout i czytelny fallback, gdy model nie działa.
- Opcjonalny LLM Reporter, który generuje markdown/JSON z agregatów i jest sprawdzany przez `Report Critic`.
- Log w `run_events`, czy raport powstał deterministycznie czy z lokalnym LLM.
- Testy adaptera na mockowanym `fetch`.

Kryterium ukończenia:

- aplikacja wykrywa lokalny model Gemma przez Ollama,
- `Run analysis` działa bez internetu i bez kluczy API do providerów LLM,
- jeśli Ollama/Gemma jest niedostępna, workflow kończy się deterministycznym raportem,
- raport LLM nie dostaje raw danych osobowych,
- UI pokazuje status lokalnego modelu i źródło raportu: deterministic albo local Gemma.

## Integracje

### Binance

Zakres docelowy:

- salda,
- aktualne pozycje,
- historia transakcji,
- depozyty i wypłaty,
- earn/staking, jeśli dostępne przez bezpieczne API,
- ceny i metadane aktywów.

Decyzja techniczna:

- na MVP zwykły connector/service,
- MCP dopiero jeśli narzędzie ma być używane poza aplikacją lub przez inne hosty.

### XTB

Zakres docelowy:

- aktualne pozycje,
- historia transakcji,
- PnL,
- dywidendy, jeśli dostępne,
- ekspozycja walutowa,
- instrumenty i ceny.

Decyzja techniczna:

- najpierw zweryfikować aktualne możliwości oficjalnego API i model autoryzacji,
- connector/service na MVP,
- MCP opcjonalnie po ustabilizowaniu kontraktu.

### bank

Zakres aktualnego MVP:

- read-only import wybranego maila mBank przez Gmail REST API,
- single-message gate przez `GMAIL_MBANK_QUERY` i `GMAIL_MBANK_MAX_MESSAGES=1`,
- parser dla zaobserwowanego formatu key-value oraz HTML notification attachment,
- kategoryzacja wydatkow i reczna korekta kategorii w preview oraz po imporcie,
- agregaty miesieczne per kategoria.

Zakres pozniejszy:

- historyczny backfill Gmail po udowodnieniu bezpiecznego single-message gate,
- dodatkowe formaty maili mBank,
- import CSV/Excel, jesli bedzie potrzebny jako osobny strumien danych.

### Internet i źródła publiczne

Zakres MVP:

- publiczne źródła cenowe i metadane aktywów,
- podstawowy web research dla aktywów z portfela i watchlisty,
- cache wyników, żeby ograniczać koszty i zmienność.

Zakres późniejszy:

- X/Twitter, jeśli dostęp i koszt API mają sens,
- Reddit/YouTube/blogi jako źródła narracji, ale z niskim zaufaniem domyślnym,
- scoring źródeł i wykrywanie powielonych narracji.

## MCP vs tools

MCP stosujemy dla:

- filesystem/context repo,
- web research, jeśli korzystamy z gotowego serwera i chcemy łatwej wymiany,
- Gmail/IMAP, jeśli zdecydujemy się na import raportów banku z maila,
- zewnętrznych integracji, które mają być dostępne także dla innych agentów lub hostów.

Zwykłe tools/services stosujemy dla:

- normalizacji transakcji,
- obliczeń portfelowych,
- kategoryzacji wydatków,
- walidacji read-only,
- generowania snapshotów,
- lokalnych queries do bazy.

## UI MVP

Pierwszy ekran powinien być roboczym dashboardem, nie landing page'em.

Widoki MVP:

- Overview: wartosc majatku, miesieczny cashflow, kategorie wydatkow, ostatni raport i ryzyka.
- Transactions: filtrowanie transakcji i reczna korekta kategorii.
- Reports: historia raportow, zrodlo reportera, model i diagnostyka realnych transakcji.
- Imports: Gmail status, `Sync now`, preview, retry/reject/confirm, scheduler.
- Strategy: profil finansowy i ustawienia strategii.
- Memory: obserwacje i refleksje.
- Chat: lokalny chat oparty o lokalny LLM.
- Settings: lokalne uslugi, retencja i trace spans.

## Roadmapa

### Faza 0 - Discovery i kontrakty

Status: częściowo wykonana.

Cel: zamknąć decyzje, zanim powstanie kod produkcyjny.

Deliverables:

- `docs/product-brief.md` z opisem celu i ograniczeń.
- `docs/security-model.md` z zasadami read-only, anonimizacji i obsługi sekretów.
- `docs/data-model.md` z pierwszym modelem danych.
- `docs/agent-flow.md` z opisem flow analizy finansowej.
- `docs/observational-memory.md` z adaptacją Mastra Observer/Reflector. Status: wykonane.
- `docs/implementation-progress.md` z bieżącym stanem kodu dla kolejnych agentów. Status: wykonane.
- Lista API do weryfikacji: Binance, XTB, bank CSV/email, market data.

Kryterium ukończenia:

- wiadomo, jakie dane wchodzą do MVP,
- wiadomo, które dane mogą iść do LLM,
- wiadomo, które integracje są w MVP, a które później.

### Faza 1 - Fundament aplikacji lokalnej

Status: częściowo wykonana.

Cel: uruchamialny szkielet aplikacji.

Deliverables:

- Next.js dashboard. Status: wykonane.
- Backend API. Status: częściowo wykonane przez `POST /api/runs`.
- Docker Compose z Postgres. Status: wykonane, host port `5433`.
- Podstawowy schema migration. Status: wykonane.
- Lokalna konfiguracja `.env.example`. Status: wykonane.
- Lokalny trace zapisany w DB i opcjonalny lokalny Langfuse. Status: wykonane jako `TraceSpan` fallback plus opcjonalny serwis.

Kryterium ukończenia:

- aplikacja startuje lokalnie. Status: wykonane.
- można uruchomić pusty lub sample analysis run. Status: wykonane.
- run zapisuje status, eventy i trace spans. Status: wykonane lokalnie; Langfuse jest opcjonalny.

### Faza 1.5 - Local Gemma Runtime

Status: wykonane dla reportera i lokalnego chatu.

Cel: przygotować lokalną warstwę AI opartą o modele Gemma, bez zewnętrznych providerów LLM.

Deliverables:

- konfiguracja `.env.example` dla Ollama/Gemma,
- adapter `LocalLlmClient` dla Ollama `/api/chat`,
- walidacja lokalnego adresu modelu,
- health check lokalnego modelu,
- fallback do deterministycznego raportu,
- opcjonalny LLM Reporter działający wyłącznie na agregatach,
- zapis w `run_events`, czy użyto local Gemma,
- dokumentacja uruchomienia `ollama pull gemma3:4b`.

Kryterium ukończenia:

- aplikacja działa bez OpenAI/Gemini API/Anthropic i bez innych hosted LLM,
- można uruchomić analysis run z lokalną Gemmą,
- brak lokalnego modelu nie psuje runu,
- raw transakcje i dane osobowe nie trafiają do modelu.

### Faza 2 - Model danych i import banku

Status: czesciowo wykonane przez Gmail/mBank single-message gate.

Cel: pierwszy realny strumien danych finansowych bez uprawnien zapisu.

Deliverables:

- read-only Gmail API provider z OAuth helperem,
- parser i normalizacja transakcji mBank,
- dedupe i import preview,
- retry/reject/confirm,
- reczna korekta kategorii,
- widok wydatkow miesiecznych.

Kryterium ukonczenia:

- mozna zaimportowac wybrany mail mBank,
- dashboard pokazuje wydatki per kategoria,
- LLM nie dostaje raw body maila, sekretow ani prywatnych artefaktow,
- manualny no-raw checklist zostaje wypelniony po realnym runie uzytkownika.

### Faza 3 - Binance read-only

Cel: aktualne dane krypto.

Deliverables:

- konfiguracja klucza Binance read-only,
- connector sald i historii,
- normalizacja aktywów,
- snapshot portfela krypto,
- widok alokacji krypto.

Kryterium ukończenia:

- system pobiera dane Binance bez uprawnień trade/withdraw,
- snapshot jest zapisany w bazie,
- dashboard pokazuje wartość i strukturę krypto.

### Faza 4 - XTB read-only

Cel: aktualne dane brokera.

Deliverables:

- weryfikacja aktualnego API i sposobu logowania,
- connector XTB,
- normalizacja pozycji i transakcji,
- snapshot portfela XTB,
- widok alokacji tradycyjnych inwestycji.

Kryterium ukończenia:

- system pobiera dane XTB w trybie read-only,
- dashboard pokazuje XTB obok Binance i banku,
- dane walutowe są znormalizowane do bazowej waluty użytkownika.

### Faza 5 - Portfolio engine

Status: częściowo wykonana na sample data.

Cel: spójny obraz majątku.

Deliverables:

- model aktywów. Status: podstawowy model wykonany.
- wycena pozycji. Status: wykonana dla sample data, bez zewnętrznych cen.
- PnL tam, gdzie dane są dostępne,
- alokacja per platforma, klasa aktywów i waluta. Status: częściowo wykonane, UI pokazuje klasy aktywów.
- docelowa alokacja ze strategii. Status: wykonane jako `StrategySettings` w bazie z fallbackiem `defaultStrategy`.
- wykrywanie odchyleń od strategii. Status: podstawowe reguły wykonane.

Kryterium ukończenia:

- dashboard odpowiada na pytanie "ile mam, gdzie i w czym",
- system pokazuje odchylenie od docelowej alokacji,
- dane są rozdzielone na raw, normalized i derived.

### Faza 6 - Observational Memory MVP

Status: częściowo wykonana.

Cel: wdrożyć zarządzanie kontekstem w stylu Mastry dla historii runów i raportów.

Deliverables:

- Observation record tworzony po każdym manualnym runie. Status: wykonane.
- Observer kompresujący historię runu do obserwacji: dane użyte, braki, decyzje, wnioski, rekomendacje, odpowiedź użytkownika. Status: częściowo wykonane deterministycznie, bez user feedback.
- Format obserwacji z priorytetami, datą, completion markerem, `current-task` i `suggested-response`. Status: priorytety i completion marker wykonane, `current-task` i `suggested-response` do doprecyzowania.
- Reflector konsolidujący starsze obserwacje w długoterminową pamięć portfela. Status: prosta konsolidacja wykonana po progu obserwacji.
- Wstrzykiwanie skompresowanych obserwacji/refleksji do następnego runu zamiast pełnej historii.
- Linkowanie observation groups do raw run records, żeby dało się wrócić do źródła. Status: podstawowe `sourceLinks` wykonane.
- Langfuse trace dla main analysis, observer i reflector.

Kryterium ukończenia:

- ręczne uruchomienie tworzy raport i observation record,
- kolejny run korzysta z obserwacji/refleksji zamiast pełnej historii poprzednich raportów,
- Reflector redukuje starsze obserwacje bez utraty strategii, decyzji, ryzyk i braków danych,
- UI pokazuje aktualne observations/reflections oraz link do raw runu,
- Langfuse pozwala prześledzić osobno analizę finansową, obserwację i refleksję.

### Faza 7 - Web research

Cel: dołączenie publicznego kontekstu rynkowego.

Deliverables:

- lista źródeł publicznych,
- cache research artifacts,
- scoring wiarygodności źródeł,
- cytowania w raporcie,
- oddzielenie faktów od narracji.

Kryterium ukończenia:

- raport pokazuje, które źródła wpłynęły na wnioski,
- system potrafi powiedzieć "brak wystarczających danych",
- research nie nadpisuje twardych danych portfelowych.

### Faza 8 - Produkcyjne utwardzenie lokalne

Cel: prywatny projekt, ale z produkcyjną dyscypliną.

Deliverables:

- testy connectorów na fixture'ach,
- testy anonimizacji,
- testy portfolio engine,
- evale raportów,
- limity kosztów LLM,
- audyt tool calls,
- backup bazy,
- obsługa błędów i retry.

Kryterium ukończenia:

- awaria API nie psuje runu,
- raport jasno pokazuje niepełne dane,
- każdy tool call jest zapisany i możliwy do przejrzenia.

## MVP właściwy

Minimalna wersja, którą warto zbudować jako pierwszą:

1. Lokalny Next.js dashboard. Status: wykonane.
2. Postgres przez Docker Compose. Status: wykonane.
3. Import banku przez Gmail API/mBank. Status: czesciowo wykonane dla single-message gate.
4. Binance read-only connector. Status: do zrobienia.
5. Ręcznie wpisana prosta strategia inwestycyjna. Status: wykonane w bazie jako `StrategySettings` z formularzem w UI.
6. Portfolio overview i allocation view. Status: częściowo wykonane.
7. Manualny analysis run. Status: wykonane.
8. Analyst/Risk Reviewer/Reporter dla raportu finansowego. Status: wykonane deterministycznie i opcjonalnie przez local Gemma.
9. Local Gemma runtime przez Ollama. Status: wykonane.
10. Langfuse tracing. Status: opcjonalny lokalny Langfuse plus DB `TraceSpan` fallback wykonane.
11. Observational Memory: Observer/Reflector dla kompresji kontekstu runów. Status: częściowo wykonane deterministycznie.
12. Raport zapisany w bazie i widoczny w UI. Status: wykonane.

XTB można dodać po bank + Binance, ponieważ wymaga osobnej weryfikacji aktualnego API i sposobu dostępu.

Następny sensowny milestone MVP:

1. Wypelnic `docs/manual-real-e2e-checklist.md` po jednym prawdziwym no-raw runie.
2. Utwardzic kolejne formaty maili mBank dopiero po dodaniu zanonimizowanych fixture.
3. Dodac realne read-only connectory Binance/XTB.
4. Rozwazyc CSV/Excel banku jako osobny strumien importu, jesli Gmail gate nie wystarcza.
5. Dopiero potem rozszerzac research internetowy i zewnetrzne zrodla rynkowe.

## Proponowana struktura katalogów

```text
apps/
  web/
    app/
    components/
    lib/

packages/
  core/
    domain/
    portfolio/
    privacy/
    strategy/
  db/
    schema/
    migrations/
  agents/
    definitions/
    workflows/
    tools/
    memory/
  prompts/
    agents/
    tools/
    reports/
    security/
    versions/
  connectors/
    binance/
    xtb/
    bank/
    market-data/
    web-research/
  mcp/
    servers/
    clients/
  security/
    input/
    content/
    output/
    policies/
    red-team/
  evaluation/
    golden/
    offline/
    online/
    datasets/
    history/
  observability/
    langfuse/
    traces/
    feedback/
    costs/
  codex/
    rules/
    memory/
    context/

docs/
  product-brief.md
  security-model.md
  data-model.md
  agent-flow.md
  observational-memory.md
  prompt-system.md
  evaluation-plan.md
  observability-plan.md
  codex-rules.md
  api-verification.md

data/
  imports/
  exports/
  fixtures/
```

## Odpowiedzialność katalogów systemowych

### `packages/prompts`

Prompty powinny być osobną, wersjonowaną warstwą, a nie tekstem zaszytym w kodzie agentów. Każdy prompt powinien mieć typ, wersję, ownera i opis kontraktu wejścia/wyjścia.

Założenia:

- versioned: każda zmiana promptu dostaje wersję i changelog,
- type-specific: osobne prompty dla agentów, tools, raportów i security,
- hot-swappable: backend może wskazać aktywną wersję bez przepisywania logiki agenta,
- testable: prompt da się uruchomić na golden datasetach,
- observable: wersja promptu trafia do Langfuse i historii runu.

### `packages/agents`

`agents` trzyma definicje agentów, workflow i narzędzia dostępne dla agentów. `tools` jest wewnątrz `agents`, bo agent powinien mieć jawny zestaw narzędzi, a nie nieograniczony dostęp do całej aplikacji.

Minimalny podział:

- `definitions`: konfiguracje ról agentów,
- `workflows`: sekwencje typu analysis run,
- `tools`: narzędzia udostępniane modelom,
- `memory`: adaptery working memory, observations i reflections.

### `packages/security`

Security powinno mieć trzy warstwy guardów:

- input guards: walidacja żądania użytkownika, plików, importów, konfiguracji API,
- content guards: ochrona podczas pracy agenta, np. prompt injection, source trust, PII filtering, tool permission checks,
- output guards: walidacja raportu, brak danych osobowych, brak deklaracji nieuprawnionego doradztwa, jawne źródła i niepewność.

Na MVP te guardy mogą być prostymi funkcjami i testami. Docelowo powinny być częścią każdego runu i mieć własne logi.

### `packages/evaluation`

Ewaluacja powinna istnieć od początku, bo raporty finansowe będą trudne do oceny wyłącznie ręcznie.

Zakres:

- golden test set: stały zestaw snapshotów, importów, strategii i oczekiwanych cech raportu,
- offline pipeline: lokalne uruchomienie evali po zmianie promptów, agentów albo parserów,
- online pipeline: ocena realnych runów po fakcie, z feedbackiem użytkownika,
- tracked history: historia wyników per wersja promptu, modelu, connectora i strategii.

### `packages/observability`

Obserwowalność ma obejmować nie tylko trace LLM, ale cały run.

Zakres:

- per-stage tracing: osobny trace/span dla importu, normalizacji, context assembly, analysis, risk review, report critic, reporter, observer i reflector,
- feedback capture: ocena raportu przez użytkownika i notatki korekcyjne,
- cost breakdown: koszt per model, prompt, etap, tool i run,
- failure taxonomy: jednolite klasy błędów dla API, danych, modeli i walidacji.

### `packages/codex`

Ten katalog jest dla pracy z agentem kodującym. Ma utrzymywać kontekst projektu tak, żeby kolejne sesje nie traciły decyzji architektonicznych.

Zakres:

- `rules`: reguły dla AI coding agent, np. read-only finance, privacy-first, no trading actions,
- `memory`: trwałe decyzje projektowe, konwencje, skróty architektury,
- `context`: mapy modułów, ważne pliki, lokalne instrukcje pracy.

To nie zastępuje dokumentacji produktu. To jest warstwa operacyjna dla agentów pracujących nad kodem.

## Decyzje projektowe

Domknięte na tym etapie:

1. Bazowa waluta dashboardu: PLN.
2. Pierwszy uruchamialny MVP działa na sample data.
3. Mastra nie jest zależnością runtime w pierwszym MVP; bierzemy z niej wzorzec zarządzania pamięcią.
4. ORM: Prisma.
5. Lokalna baza: PostgreSQL/pgvector przez Docker Compose.
6. XTB odkładamy po Gmail/mBank i Binance, bo wymaga osobnej weryfikacji API.
7. Lokalne sekrety na MVP: `.env`.
8. Strategia użytkownika jest trwała w bazie jako `StrategySettings`, edytowana w dashboardzie.
9. Agenci AI mają działać lokalnie na modelach Gemma, bez zewnętrznych providerów LLM.

Do domknięcia przed kolejnym etapem:

1. Manualny no-raw dowod realnego Gmail -> import -> report gate.
2. Czy strategia użytkownika ma być dodatkowo eksportowana/importowana przez plik konfiguracyjny.
3. Ktory kolejny format mBank albo CSV/Excel bierzemy jako fixture.
4. Czy kategoryzacja wydatkow pozostaje deterministyczna, czy dostaje lokalne LLM hints po anonimizacji.

## Ryzyka

- API finansowe mogą zmieniać zakres danych, autoryzację lub limity.
- X/Twitter i część źródeł społecznościowych może być kosztowna albo niestabilna.
- Dane z banku mogą zawierać informacje osobowe, które trzeba anonimizować przed użyciem LLM.
- Rekomendacje inwestycyjne są obszarem wysokiego ryzyka; system musi pokazywać źródła, niepewność i braki danych.
- Prompt injection ze źródeł internetowych wymaga izolowania researchu od instrukcji systemowych.
- Zbyt wczesne budowanie wielu connectorów może opóźnić pierwszy działający MVP.

## Najbliższy krok

Najlepszy następny krok to udokumentowany manualny real-data gate bez raw danych, a potem rozszerzanie importerow na podstawie zanonimizowanych fixture.

Proponowana kolejność:

1. Skonfigurowac Gmail API i Gemma lokalnie wedlug `docs/real-import-runbook.md`.
2. Uruchomic `npm run gate:real`.
3. Przejsc `Sync now -> preview -> confirm -> Transactions -> Run analysis`.
4. Wypelnic `docs/manual-real-e2e-checklist.md` bez raw maila, sekretow i pelnych danych osobowych.
5. Dodawac kolejne formaty mBank tylko jako zanonimizowane fixture i testy regresji.
6. Nastepnie przejsc do read-only Binance/XTB albo CSV/Excel banku, zależnie od potrzeb.
