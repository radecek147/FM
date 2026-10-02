# ROADMAP — Karban

> Odškrtávací plán celé hry podle `CLAUDE.md` kap. 9. Každá fáze končí zelenými kontrolami, commitem a
> odškrtnutím zde. Rozhodnutí se zapisují do `docs/DECISIONS.md`, nápady do `docs/IDEAS.md`.

## Aktuální stav

_Aktualizováno: 2026-10-02 (fáze 10: vydání 1.0)_

**Shrnutí:** fáze 0–10 jsou hotové, **verze 1.0.0** je hotová (tag `v1.0.0` zatím jen lokálně). Fáze 10 (DECISIONS „Fáze 10 (výkon,
offline, přístupnost, bugfix)“, „Fáze 10: README, snímky a GIF, licence MIT“, „Fáze 10: balanc (silnější boti, cíle
patra 8, žolíci, balíčky)“ a „Fáze 10: korektura textů, předložka z/ze, vydání 1.0“): code splitting a offline
(service worker), Lighthouse > 90, README se snímky a GIFem, balanc (Desítka 31,2 %, Imperial 2,0 %, všech
8 sil piva i 12 balíčků v pásmu), jazyková korektura (35 oprav, filtr `{n|z}` pro „z / ze“ před číslem), pokrytí
enginu 97,6 % příkazů / 93 % větví, test minimálních počtů obsahu, `ASSETS.md` i s odvozeným písmem.
**Zbývá deploy na GitHub Pages a tag na GitHubu:** workflow „Deploy to GitHub Pages“ (2026-10-02, ručně) prošel testy i buildem a spadl na `configure-pages`, protože Pages nejsou zapnuté — vlastník repozitáře musí jednorázově zapnout Pages (Settings → Pages →
Source = GitHub Actions), pak stačí znovu spustit workflow „Deploy to GitHub Pages“ (ručně nebo pushem tagu);
adresa bude https://radecek147.github.io/FM/.
**Další krok:** po zapnutí Pages ověřit nasazení a odškrtnout ho; pak obsahové patche (sekce „Obsahové patche
(po 1.0)“ níže, nápady v `docs/IDEAS.md`).
Pozn.: e2e spouštět vždy jen z jednoho procesu (sdílený port 4173). Simulace: `npm run simulate -- --runs 300
--stake 1 --bot all --seed-prefix A` trvá ~25 min (run ~1 s na bota).

**Fáze 0–2 jsou hotové** (commity `chore: …`, `feat(engine): complete phase 1 …`, `feat(engine): complete phase 2 …`).
Z fáze 2 zůstal jen podúkol „První kalibrace křivky cílů“ — předběžná kalibrace proběhla ve fázi 5
(`docs/DECISIONS.md`, 2026-10-01 „Fáze 5: boti se spotřebkami a předběžná kalibrace cílů“), konečná až po fázi 6–7.

**Fáze 3 (Herní UI v1) je hotová** a commitnutá (`81d813f feat(ui): complete phase 3 game UI v1`; revize
v `docs/DECISIONS.md`, 2026-10-02 „Revize a uzavření fáze 3“). Run jde v prohlížeči dohrát od menu po pitvu i výhru
→ Nekonečný režim myší, klávesnicí i dotykem; autosave po každé akci. QA nástroj:
`npx tsx scripts/ui-walkthrough.ts --seed S --bot flush [--anim] [--deck D --stake N | --challenge ID | --daily]` (proti `vite preview` na portu 4173; seed 8 znaků bez I, O, 0, 1).

**Fáze 4 (Žolíci v1 + Večerka) je hotová** — všechny podúkoly odškrtnuté, audit a finální ověření proběhly
(`docs/DECISIONS.md`, 2026-10-02 „Uzavření fáze 4“). Commitnutá (`e85c464 feat: complete phase 4 jokers v1 and shop`).

- Engine: hooky žolíků a `EngineApi` (`src/engine/effects/*`), edice (lesklá/holo před efektem, duhová po něm,
  negativní +1 slot), kopírování (`copyTarget`, `isCopy`), retriggery, debuff; registr s validací (`src/content/index.ts`);
  Večerka (`src/engine/shop/*`: zboží, obálky, kupón, ceny, prodej za polovinu, Přehodit, úrok, prázdný stav).
- Obsah: 30 žolíků 15/10/5 v `src/content/jokers/{common,rare,epic}.ts`, texty
  `src/i18n/cs/jokers/*.ts`, obrázky z `ArtSpec` (`src/ui/art/art.ts`), test ke každému; naladěno měřením
  `scripts/joker-value.ts`.
- UI: Večerka (tooltip s cenou i prodejní cenou, Koupit / Koupit a použít, obálky, kupón, Přehodit, „Večerka zavřená –
  inventura“), řada žolíků x/N s drag & drop myší i prstem (dlouhý stisk = tooltip, tap = detail), přesun klávesnicí
  v detailu, prodej, Napodobitel (odznak se šipkou ke kopírovanému žolíkovi, zvýrazněný cíl, „Teď kopíruje: …“),
  nálepky (přibitý, zvětrávající se zbývajícími koly, zapůjčený), Info o runu se žolíky v pořadí vyhodnocení a se stavem
  počítadel.
- Simulace: boti nakupují žolíky, `npm run simulate -- --runs 50 --stake 1` vypisuje „Nejsilnější žolíci“.
- Kontroly zelené (2026-10-02, celý pracovní strom včetně rozpracovaných fází 5–6): `typecheck`, `lint`, `npm test`
  (46 souborů, 1 999 testů), `build` (hlavní chunk 357 kB / 118 kB gzip, ikony 344 kB / 155 kB gzip), `test:e2e`
  (29 testů: `smoke`, `menu`, `game`, `a11y`, `jokers`; 60 snímků `visual.spec.ts` jen s `KARBAN_VISUAL=1`).

**Fáze 5 (spotřebky, obálky, kupóny, úpravy karet) je hotová** a commitnutá (`9ffd384 feat: complete phase 5
consumables, boosters, vouchers and card modifiers in UI`). Obsah a engine: pranostiky (13), babské rady (22), razítka (16), obálky
(15 = 5 druhů × 3 velikosti), kupóny (24, 12 párů), 9 vylepšení, 4 pečetě, 4 edice
(`src/content/{modifiers,pranostiky,rady,razitka,boosters,vouchers}.ts`, testy
`tests/unit/{pranostiky,rady,razitka,boosters,vouchers,modifiers,phase5-review}*.test.ts`). UI: Večerka (Koupit /
Koupit a použít — u spotřebek s cíli neaktivní s vysvětlením), obálky s dobranou rukou pro cíle, sloty spotřebek,
úpravy karet na kartách, **přesun karet v ruce** tažením myší i prstem a Shift + ← / → (`src/ui/components/dragSort.ts`,
`handArea.ts`, sdílené s řadou žolíků), náhled balíčku bez prozrazení karet lícem dolů, fronta hlášek (nejvýš 3, „×2“,
u panelů pod panelem nebo pod záhlavím). e2e `tests/e2e/{consumables,hand}.spec.ts` (+ `helpers.ts`), unit
`tests/unit/ui-hand.test.ts`. Vizuální kontrola snímky na 1366 × 768 a tabletu 820 × 1180 opravila mega obálku
(6 možností zajelo pod ruku na 1024 × 768 a tabletu), zarovnání tlačítek obálky, hlášky přes zboží a čísla kláves při
tažení (DECISIONS 2026-10-02 „Fáze 5 (UI): vizuální kontrola snímky“).

**Fáze 6 (šéfové a štítky) je hotová** a commitnutá (`06c6d2f feat: complete phase 6 bosses and tags`; revize
v `docs/DECISIONS.md`, 2026-10-02 „Revize fáze 6“): 25 běžných + 5 finálových šéfů
(`src/content/bosses/{a,b,final}.ts`, texty `src/i18n/cs/bosses/*.ts`), 20 štítků (`src/content/tags.ts`,
`src/i18n/cs/tags.ts`), engine (`BossHooks`, `TagHooks`), UI (`bossBanner.ts`, výběr útraty, levý panel, pitva,
`tests/e2e/bosses.spec.ts`), ladění simulací (DESIGN 8.2/8.3, DECISIONS „Fáze 6: ladění se šéfy“), testy
`tests/unit/{bosses-a,bosses-b,bosses-final,tags,sim-bosses,ui-bosses,phase6-review}.test.ts`.

**Fáze 7 (obsah naplno) je hotová** a commitnutá (`b6a0e52 content: complete phase 7 jokers to 101, 12 decks`,
`9ba4597 content: close phase 7 with renames and stake balance`). Odemykání vyšší síly piva výhrou na nižší se
dodělalo ve fázi 8. Uzavření (DECISIONS 2026-10-02 „Balanc po fázi 7“):

- **Převzaté názvy přejmenované:** kupóny Žlutá cenovka / Přelepená cenovka (dřív Věrnostní karta / Zlatá
  věrnostní), Sběratelská burza (Kartářka), štítky Rentgen od zubaře (Fotonegativ) a Leták ve schránce (Úřední
  poukaz), finální šéf Fronta na banány (Protihluková stěna); audit ostatních názvů bez nálezu.
- **Síly piva v pásmech** (souhrn sad `SIM-A`–`SIM-D`): Desítka 34 %, Jedenáctka 22 %, Dvanáctka 14 %, Speciál 16 %,
  Ležák 9 %, Bock 6,5 %, Doppelbock 3,5 %, Imperial 2,0 %. Změny: křivka 3 od patra 4 ×~1,12, Doppelbock 25 % přibitých
  a 25 % zapůjčených, Imperial cíle šéfů ×1,2 (`src/engine/run/targets.ts`, `src/content/stakes.ts`); Jedenáctka a
  Ležák až od 2. / 3. patra (ověřeno).
- **Balíčky:** Úřednický 34,5 % (dřív 66,5 %; Trhací kalendář + Kamarád za pultem), Mariášový cíle ×1,2 → 40 %
  (dřív 60,5 %); ostatní 30,5–50,5 % (DESIGN 9).
- **Patro 8:** vítězové na Desítce mají v patře 8 medián nejlepší ruky 70 000 (p90 231 000); základ patra 8 50 000
  srazil Desítku na 12 %, 100 000 na 3 % — křivky 1–2 zůstávají, plán na „statisíce“ (silnější boti, pak křivky po
  krocích) je v DECISIONS a ve fázi 10.

**Fáze 8 (meta): všechny podúkoly hotové, revidované a ověřené, čeká na commit** `feat(meta): …` (orchestrátor;
rozpracovaný stav je ve `wip: phase 8 …` commitech, dokončení v pracovním stromu). Shrnutí (DECISIONS 2026-10-02
„Fáze 8 (M1)“ až „(M5)“, „Fáze 8: vizuální kontrola meta obrazovek“, „Revize a uzavření fáze 8“):

- **Engine** `src/engine/meta/*` (bez DOM a hodin): profil `karban.profile` (verze 1, migrace, `normalizeProfile`
  opraví poškozená pole, poškozená obálka → záloha `karban.profile.backup.<ms>`), odemykání podle `UnlockCondition`
  (70 / 101 žolíků, 2 / 12 balíčků, 12 / 24 kupónů od začátku; síla piva per balíček výhrou na nižší), objevy
  (startovní výbava až po první vyhrané útratě), statistiky, historie (50), denní run `DEN-YYYYMMDD` (UTC, jeden
  oficiální pokus; import ho nevrátí), seedované runy jen do historie, 78 achievementů, tutoriál.
- **Obsah:** 20 výzev (`src/content/challenges.ts`, 4 várky po 1 / 3 / 6 / 10 výhrách), 78 achievementů
  (`src/content/achievements.ts`), texty `src/i18n/cs/{challenges,achievements,meta}.ts`.
- **UI:** Nová hra (zámky s podmínkou a průběhem, tácky), Sbírka (14 záložek včetně Obálek), Statistiky (přehled,
  balíčky, síla piva, šéfové, historie, denní runy), Výzvy, Denní run (sdílení), oznámení s frontou a štítkem
  „Nové“, pitva / výhra s novinkami runu, tutoriál Štamgast (`src/ui/tutorial.ts`), Nastavení s exportem / importem
  / resetem (záloha profilu, bez zálohy se nic nepřepíše).
- **Testy:** unit `tests/unit/meta-*.test.ts`, `achievements`, `unlocks-content`, `challenges`, `challenge-rules`,
  `ui-meta-*` a `phase8-review`; e2e `tests/e2e/meta.spec.ts` (8 scénářů), snímky `visual-meta.spec.ts`
  (`KARBAN_VISUAL=1`).

Kontroly (2026-10-02, celý pracovní strom): `typecheck`, `lint` (eslint + prettier), `npm test` (71 souborů,
3 669 testů), `build` (jen staré varování o chunku nad 500 kB) a `test:e2e` (63 prošlo, 170 snímků vizuálních sad
přeskočeno bez `KARBAN_VISUAL=1`) zelené.

**Známé otevřené body (řešit v uvedené fázi):**

- fáze 9: na 1366 × 768 se pod Večerku vejdou jen 1–2 hlášky — tři vyšší jdou pod záhlaví a na chvíli zakryjí obrázek
  zboží (ne tlačítka); pořadí hlášek po pranostice („… je teď na úrovni 2“ před „Použito: …“) podle pořadí událostí;
  zvuky a hudba (hlasitosti už jsou v profilu, `settings.volumeHint` odkazuje na fázi 9 — po dokončení text upravit);
  na telefonu se tabulka balíčků ve Statistikách posouvá vodorovně (jen stín u okraje);
- fáze 10: patro 8 „řádově statisíce“ (plán v DECISIONS „Balanc po fázi 7“, bod 5); Speciál boty nebrzdí
  (zvětrávání 0 / 25 / 50 % → stejné výhry); Obrázkový, Notářský, Babiččin a Kalendářový nad ±7 p. b. od
  Hospodského; Δ výher žolíků v `simulate` normalizovat na patro koupě; normovaná letalita šéfů (Pan starosta 18 %);
  jazyková korektura zbytku textů (texty fáze 8 revidované, test rodové neutrality hlídá všechny).

**Další krok:** commit fáze 8 (`feat(meta): …`, celý pracovní strom), pak **Fáze 9 — Šťáva a zvuk** (první podúkol:
částice na `<canvas>` overlay, screen shake, tilt a hover karet, počítadlo skóre).

## Jak pokračovat v nové session

1. Přečti `CLAUDE.md` (zadání), tento `ROADMAP.md` (stav a plán) a `docs/DECISIONS.md` (co už je
   rozhodnuto — neměň to bez nového záznamu). Pro obsah si přečti `docs/CONTENT-GUIDE.md`, pro
   technické detaily `docs/ARCHITECTURE.md`, pro čísla `docs/DESIGN.md`.
2. Ověř, že projekt je zelený: `npm run typecheck && npm run lint && npm test`. Pokud ne, oprav to
   **jako první**, ještě než začneš cokoli nového.
3. Najdi v sekci „Aktuální stav“ další krok a první neodškrtnutý podúkol aktuální fáze a pokračuj.
4. Commituj často (Conventional Commits, anglicky). Před koncem session (nebo když dochází kontext)
   přepiš „Aktuální stav“: co je hotovo, co rozpracováno, ve kterých souborech a co je další krok.

## Definice hotovo pro každou fázi

Fáze se smí odškrtnout, až když platí **všechno**:

- `npm run typecheck && npm run lint && npm test && npm run build` projde bez chyb,
- hra jde spustit (`npm run dev`) a to, co fáze přidala, jde v ní vyzkoušet (od fáze 3 i zahrát),
- existuje commit (Conventional Commits) a pracovní strom je čistý,
- podúkoly fáze jsou odškrtnuté zde, „Aktuální stav“ je aktualizovaný a je napsané shrnutí (max. 10 řádků).

---

## Fáze 0 — Založení

- [x] Vite + TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), ESM, Node 20+
- [x] ESLint (typescript-eslint, `consistent-type-imports`, zákaz DOM a importu UI v `src/engine/**`) + Prettier
- [x] Vitest (`tests/unit/**`) s pokrytím (`npm run test:coverage`)
- [x] Playwright (`tests/e2e/**`, build + preview na portu 4173, Chromium) + první smoke test
- [x] CI: GitHub Actions (typecheck, lint, test, build, e2e) + workflow pro deploy na GitHub Pages (`base` ve `vite.config.ts`)
- [x] Struktura složek dle `CLAUDE.md` kap. 2 (`src/engine/{cards,hands,scoring,run,shop,effects,rng,save,sim,meta}`, `src/content`, `src/ui`, `src/i18n`, `src/assets`, `scripts`, `tests/{unit,e2e}`, `docs`)
- [x] Závazné typy (`types.ts`, `content-types.ts`), seedovaný RNG (xoshiro128\*\* + cyrb128, streamy), `EventBus`
- [x] `docs/ARCHITECTURE.md` (vrstvy, engine, pořadí skórování, modifikátory, hooky, ukládání, testy)
- [x] `docs/DESIGN.md` — kompletní herní design včetně tabulek čísel: čipy/mult a přírůstky úrovní kombinací, křivka cílů pater, odměny, ceny ve Večerce, cílové hodnoty vzácností žolíků
- [x] `ROADMAP.md` se všemi fázemi a podúkoly
- [x] `docs/DECISIONS.md`, `docs/CONTENT-GUIDE.md`, `docs/IDEAS.md`
- [x] Název hry: 5 návrhů → vybrán „Karban“, zdůvodnění v DECISIONS, pracovní název nahrazen (`CLAUDE.md`, `package.json`, dokumentace)
- [x] Skelet `scripts/fetch-assets.ts` (font z `@fontsource/pixelify-sans`, ikony z `@iconify-json/game-icons`) + generovaný `ASSETS.md`
- [x] `src/i18n/format.ts` — vlastní formátování čísel (NBSP tisíce, desetinná čárka, `×1,5`, `5 Kč`, vědecký zápis nad 1e15) + `plural()` + testy
- [x] `src/i18n/cs.ts` — vstupní bod textů (`cs` + `t(key, params)`), podmoduly `src/i18n/cs/*.ts`
- [x] Skelety `scripts/simulate.ts` a `scripts/deploy.ts` (npm skripty nesmí padat na chybějícím souboru)
- [x] Minimální `index.html` + `src/main.ts`: úvodní obrazovka s názvem hry ve fontu Pixelify Sans (ověřit české znaky)
- [x] Testy: RNG determinismus, formátování čísel, `plural()`; e2e: stránka se načte a vykreslí „Příliš žluťoučký kůň úpěl ďábelské ódy“

**Hotovo, když:** projde `typecheck` + `lint` + `test` + `build`; `npm run dev` ukáže úvodní obrazovku
„Karban“ s diakritikou; CI workflow existuje; commit `chore: project scaffold…`; fáze odškrtnutá.

## Fáze 1 — Engine jádra

- [x] `engine/cards`: tvorba karty, standardní balíček 52 karet, unikátní `id` (`nextUid`)
- [x] Čipy karty: 2–10 = číslo, J/Q/K = 10, A = 11, kamenná bez hodnoty, + `bonusChips`
- [x] Barvy a figury: `hasSuit` (divoká = všechny barvy, kamenná = žádná, `mergedSuits`), `isFace` (`allFaces`)
- [x] Míchání a lízání se seedem (stream `deck`), lízání do velikosti ruky
- [x] `engine/effects/modifiers.ts`: `BASE_MODIFIERS` + skládání delt (čísla se sčítají, `*Mult` násobí, booleany OR)
- [x] `engine/hands`: detekce všech 13 kombinací (vč. tajných: Pětice, Barevný full house, Barevná pětice), `scoringIds` v pořadí zahrání, `contains[]`
- [x] Hraniční případy: A-2-3-4-5 i 10-J-Q-K-A, žádné „kolem dokola“ (pokud není `straightWrap`), dvě dvojice v 5 kartách, divoké karty v barvě i pětici, kamenné karty vždy skórují
- [x] Modifikátory detekce: `fourCardStraightFlush`, `straightGaps`, `straightWrap`, `mergedSuits`, `allCardsScore`
- [x] Úrovně kombinací (`HandLevelState`, `levelUpHand`, čipy/mult podle úrovně z `src/content/hands.ts`)
- [x] `engine/scoring`: pipeline v závazném pořadí (`docs/ARCHITECTURE.md` 2.5) → `ScoreResult` s kroky `ScoreStep` pro animaci
- [x] Opakované aktivace karet (retriggery), debuffnuté karty (počítají se do kombinace, neskórují)
- [x] `HandPreview` — živý náhled kombinace a čipů × mult pro vybrané karty (pro UI)
- [x] Minimální testovací `ContentRegistry` v `tests/unit/fixtures/` (pár testovacích žolíků, vylepšení, pečetí)
- [x] Texty kombinací `hands.<type>.name|desc` v `src/i18n/cs/hands.ts`
- [x] Testy: každá kombinace + hraniční případy, pořadí vyhodnocení (karta → vylepšení → edice → pečeť → žolíci), úrovně, modifikátory, determinismus míchání; pokrytí enginu ≥ 80 %
- [x] CI: po dosažení 80 % pokrytí odstranit `continue-on-error` u kroku „Coverage“ v `.github/workflows/ci.yml` (a samostatný krok `npm test`)
- [x] `src/engine/constants.ts` podle `docs/DESIGN.md` kap. 2.10 (sjednotit `STARTING_MONEY`, `BLIND_REWARDS`, `RARITY_WEIGHTS`, nálepky, `BASE_CARD_PRICE`…) a dorovnat zbylé rozdíly enginu vůči DESIGN (vzorec ceny s `round` + `shopPriceAdd`, úrok ze zůstatku před výplatou, šance edic u hracích karet, vylepšení Ohmataná, rozšíření z přílohy B)

**Hotovo, když:** všechny testy kombinací a skórování zelené, pokrytí `src/engine` ≥ 80 %, build
projde, hra se pořád spustí; commit `feat(engine): …`; fáze odškrtnutá.

## Fáze 2 — Run loop v enginu

- [x] `engine/run/Game`: `Game.newRun(options, registry)`, `dispatch(action)` s validací fáze a vstupů, `bus`
- [x] Stavový automat `RunPhase`: výběr útraty → kolo → rozpis odměn → Večerka → další útrata → … → konec / výhra
- [x] `engine/run/targets.ts`: křivka cílů 8 pater (Malá útrata 1×, Velká 1,5×, Šéf 2×), `targetMult`, nekonečný režim (exponenciální růst)
- [x] Kolo: 4 ruce, 3 zahození, 8 karet v ruce, výběr max. 5 karet, dobírání po zahrání a zahození, konec kola po dosažení cíle
- [x] Přeskočení Malé a Velké útraty (zatím s jedním testovacím štítkem)
- [x] Peníze (Kč): odměna 3/4/5 Kč, +1 Kč za nevyužitou ruku, úrok 1 Kč za každých 5 Kč (strop 5 Kč), rozpis odměn jako událost
- [x] Konec runu: `GameOverInfo` s příčinou (pro „pitvu“), výhra po patře 8, nabídka Nekonečného režimu
- [x] Večerka jako zástupná fáze („Večerka zavřená — inventura“ → pokračovat)
- [x] Všechny `GameEvent` emitované na `bus` i vrácené v `ActionResult.events`; neplatná akce stav nemění
- [x] `engine/save`: serializace `RunState`, obálka `{ format: 'karban-save', kind, version, data }`, rámec migrací + test
- [x] `engine/sim`: bot „max. kombinace“ + `scripts/simulate.ts` (`--runs`, `--stake`, `--deck`, `--strategy`, `--seed-prefix`, `--json`); výstup: % výher podle patra, průměrné skóre, příčiny prohry
- [x] Textový headless režim hratelný bez UI (`npm run simulate -- --play`): výpis ruky, zadávání akcí v terminálu
- [x] První kalibrace křivky cílů simulací, čísla zapsaná do `docs/DESIGN.md` — _předběžně ve fázi 5, se šéfy ve fázi 6, s plným obsahem po fázi 7 (DESIGN 2.3.1, DECISIONS „Balanc po fázi 7“)_
- [x] Testy: stejný seed + stejné akce = identický stav, odměny a úrok, výhra/prohra, save/load roundtrip, migrace, simulace jako smoke test

**Hotovo, když:** run jde odehrát od prvního patra do výhry/prohry v textovém režimu i botem,
`npm run simulate -- --runs 50` doběhne; kontroly zelené; commit `feat(engine): run loop…`; fáze odškrtnutá.

## Fáze 3 — Herní UI v1

- [x] `index.html`, `src/main.ts`, `src/ui/dom.ts` (helper `h()`), `src/ui/app.ts` (router obrazovek), `src/ui/controller.ts` (instance `Game`, fronta animací, autosave)
- [x] CSS: proměnné a témata na `:root`, font Pixelify Sans (`@fontsource`, latin-ext), rozvržení pro ≥ 1024 px, tablet s dotykem
- [x] Vlastní SVG hrací karty (klasický styl, figury stylizované česky, indexy J/Q/K/A, barvy ♠ ♥ ♦ ♣)
- [x] Herní obrazovka — levý panel: název útraty/šéfa + pravidlo, „Dosáhni aspoň …“, skóre kola, aktuální kombinace s živými čipy × mult, Ruce, Zahození, peníze, Patro x/8, Kolo, tlačítka „Info o runu“ a „Nastavení“
- [x] Horní řada: sloty žolíků (x/5) a spotřebek (x/2) — obecně přes registr (funguje i s obsahem fází 4–5)
- [x] Stůl se zahranými kartami, ruka dole, tlačítka **Zahrát** / **Zahodit**, třídění podle hodnoty/barvy, balíček vpravo dole (zbývá/celkem + náhled zbylých karet)
- [x] Výběr karet myší, dotykem a klávesami (1–8, Enter, X, S/B, Esc, mezerník přeskočí animaci)
- [x] Animace skórování: přehrávání `ScoreStep`, počítadlo čipů × mult, výsledek
- [x] Obrazovka výběru útraty (3 karty: cíl, odměna, Přeskočit)
- [x] Konec kola (rozpis odměn s animací), konec runu („pitva“ s hláškou podle příčiny), výhra (zatím jednoduché titulky)
- [x] Hlavní menu: Nová hra, Pokračovat (ostatní položky jako „Už brzy“), autosave do `localStorage` po každé akci
- [x] Všechny texty v `src/i18n/cs*` (žádné natvrdo), tykání
- [x] e2e: spustit, vybrat útratu, zahrát ruku, screenshot, vykreslení „Příliš žluťoučký kůň úpěl ďábelské ódy“
- [x] Revize: přístupnost (`tests/e2e/a11y.spec.ts`), průchod celým runem přes UI (`scripts/ui-walkthrough.ts`), výkon, texty
- [x] **Napsat uživateli, jak hru spustí** (`npm install` → `npm run dev` → adresa z konzole; text ve shrnutí fáze)

**Hotovo, když:** run jde v prohlížeči dohrát (bez žolíků) od menu po výhru/pitvu myší, klávesnicí i
dotykem, konzole bez chyb; e2e zelené; commit `feat(ui): …`; fáze odškrtnutá; uživatel dostal návod ke spuštění.

## Fáze 4 — Žolíci v1 + Večerka

- [x] `engine/effects`: volání všech `JokerHooks` ve správných okamžicích a pořadí, implementace `EngineApi`
- [x] Edice žolíků: lesklá a holografická **před** efektem, duhová **po** něm, negativní = +1 slot
- [x] Kopírující žolíci (`copyTarget`, `isCopy` — bez dvojího navyšování stavu), retriggery, debuff žolíka (v UI: odznak Napodobitele se šipkou k cíli, zvýrazněný cíl, „Teď kopíruje: …“, poznámka u nekopírovatelných)
- [x] `src/content/index.ts`: sestavení `ContentRegistry` + validace (unikátní id, existence textů, platné odkazy)
- [x] `src/content/jokers.ts`: **30 žolíků** (rozložení vzácností dle `docs/DESIGN.md`), texty `jokers.<id>.name|desc|flavor`, `ArtSpec`, test ke každému (rozděleno do `src/content/jokers/{common,rare,epic}.ts`, texty `src/i18n/cs/jokers/*.ts`)
- [x] `tests/unit/content.test.ts`: každá položka má název, popis a flavor; typografie textů (uvozovky, NBSP, desetinná čárka)
- [x] `engine/shop`: generování Večerky (2 sloty karet, 2 sloty balíčků, 1 kupón — zatím zástupné), ceny, nákup, prodej za polovinu, Přehodit za rostoucí cenu
- [x] Úrok a peníze napojené na obchod; prázdný stav „Večerka zavřená — inventura“
- [x] UI: obrazovka Večerky, řada žolíků s drag & drop (myš i dotyk), detail žolíka (mechanika + flavor), prodej (tooltip zboží s cenou i prodejní cenou, tlačítka polic v jedné linii)
- [x] `src/ui/art/joker.ts`: procedurální SVG žolíka z `ArtSpec` (ikona z game-icons + paleta + vzor) — hotové v `src/ui/art/art.ts`
- [x] „Info o runu“: úrovně kombinací, žolíci, složení balíčku (žolíci v pořadí vyhodnocení se stavem počítadel, kopírováním, edicí a nálepkami)
- [x] Simulace: bot nakupuje žolíky (jednoduchá heuristika)
- [x] e2e: otevřít Večerku, koupit žolíka, prodat ho (`tests/e2e/jokers.spec.ts` — myš, dotyk, Napodobitel; `tests/e2e/game.spec.ts`)

**Hotovo, když:** jde koupit, přesouvat a prodávat 30 žolíků a jejich efekty se projeví ve skóre
podle pořadí; každý žolík má test; kontroly zelené; commit `feat: jokers v1 and shop`; fáze odškrtnutá.

## Fáze 5 — Spotřebky, boostery, kupóny, úpravy karet

- [x] `src/content/modifiers.ts`: **min. 8 vylepšení** (bonusová, multiplikační, skleněná s rizikem prasknutí, ocelová v ruce, kamenná, zlatá, šťastná, divoká) — čísla dle `docs/DESIGN.md`
- [x] **4 pečetě** (zlatá: peníze při zahrání, červená: skóruje 2×, modrá: vytvoří pranostiku, fialová: vytvoří babskou radu)
- [x] **Edice** pro karty a žolíky: lesklá, holografická, duhová (+ negativní jen pro žolíky)
- [x] Engine spotřebek: sloty (2, upravitelné), použití s výběrem cílů, `canUse`, prodej
- [x] **13 pranostik** (jedna na každou kombinaci, vč. tajných) — `src/content/pranostiky.ts` (`consumables.ts` spojí všechny tři typy)
- [x] **22 babských rad** — `src/content/rady.ts`
- [x] **16 úředních razítek** — `src/content/razitka.ts`
- [x] Rozhodnout o případném 4. typu spotřebky (zapsat do DECISIONS) — ne v 1.0 (DECISIONS 2026-10-01)
- [x] **5 druhů boosterů** (pranostiky, babské rady, razítka, žolíci, hrací karty) ve velikostech normal/jumbo/mega + obrazovka výběru z boosteru
- [x] **24 kupónů** (12 párů základ → vylepšení), slot ve Večerce, tier 2 vyžaduje tier 1
- [x] UI: vylepšení, pečetě a edice viditelné na kartách (SVG vrstvy), lišta spotřebek x/2, použití s výběrem cílů (v kole i v dobrané ruce obálky)
- [x] Přesun karet v ruce tažením myší i prstem + Shift + ← / → (`src/ui/components/dragSort.ts`, `handArea.ts`; v kole i v ruce obálky), náhled balíčku bez prozrazení karet lícem dolů, fronta hlášek (nejvýš 3, „×2“, mimo ruku a tlačítka)
- [x] Testy: každá spotřebka, vylepšení, pečeť, edice a kupón; pořadí v pipeline; prasknutí skla (RNG); retrigger červené pečeti
- [x] e2e: otevřít booster, vybrat kartu, použít spotřebku (`tests/e2e/consumables.spec.ts`: Večerka, kupóny, obálky rad / pranostik / karet, spotřebky v kole, rozložení mega obálky na 1024 × 768 a tabletu; `tests/e2e/hand.spec.ts`: přesun karet, náhled balíčku, hlášky)
- [x] Vizuální kontrola snímky (1366 × 768, tablet 820 × 1180; obálky i na 1024 × 768, 1280 × 720, 1920 × 1080, telefonu) a opravy (DECISIONS „Fáze 5 (UI): vizuální kontrola snímky“)

**Hotovo, když:** všechny tři typy spotřebek, boostery a kupóny jdou v UI koupit/použít a správně
mění skóre i balíček; kontroly zelené; commit `feat: consumables, boosters, vouchers, card modifiers`; fáze odškrtnutá.

## Fáze 6 — Šéfové a štítky

- [x] Engine šéfů: všechny `BossHooks` (debuff, lícem dolů, `validateHand`, `modifyBase`, `afterHandPlayed`, `onDiscard`, `onDraw`, `passive`), losování (stream `boss`, `minAnte`, bez opakování), `disableBoss`
- [x] **25 šéfů** s jedním jasným pravidlem — `src/content/bosses/{a,b}.ts`
- [x] **5 finálových šéfů** jen pro patro 8 (a každé 8. patro nekonečného režimu)
- [x] Texty šéfů: `bosses.<id>.name|rule|intro|defeat|death` (hláška při příchodu, porážce a v pitvě)
- [x] Přeskakování útrat napojené na **20 štítků** (`src/content/tags.ts`, `TagHooks`, `minAnte`), fronta štítků v UI
- [x] UI: karta šéfa ve výběru útraty, pravidlo v levém panelu, vizuál debuffu a zakrytých karet, bublina s hláškou (plakát příchodu, tooltipy „proč“, štítky v levém panelu, velikost ruky; `tests/e2e/bosses.spec.ts`)
- [x] Pitva podle šéfa, na kterém run skončil
- [x] Testy: každý šéf a štítek aspoň 1 test (+ revize `tests/unit/phase6-review.test.ts`: uložení/načtení, Odvolání, kopírování, patro 16, fuzz)
- [x] Simulace: žádný šéf není téměř neporazitelný ani bezzubý; úpravy zapsat do DESIGN (DESIGN 8.2/8.3, DECISIONS „Fáze 6: ladění se šéfy“)

**Hotovo, když:** v každém patře se objeví šéf s funkčním pravidlem, ve finále jen finálový šéf,
přeskočení útraty dá štítek s funkčním bonusem; kontroly zelené; commit `feat: bosses and tags`; fáze odškrtnutá.

## Fáze 7 — Obsah naplno

- [x] Žolíci na **100+**, z toho **6+ legendárních**; rozložení vzácností a cen dle `docs/DESIGN.md`; každý s testem a rozpoznatelným artem
- [x] **12 startovních balíčků** (`src/content/decks.ts`), každý mění pravidla (např. Mariášový s 32 kartami, jen figury, náhodné pečetě, Dlužník se záporným zůstatkem a 2× úrokem)
- [x] **8 obtížností „Síla piva“** (Desítka, Jedenáctka, Dvanáctka, Speciál, Ležák, Bock, Doppelbock, Imperial) — kumulativní ztížení, nálepky žolíků (přibitý, zvětrávající, zapůjčený)
- [x] Odemykání vyšší obtížnosti výhrou na nižší — _přesunuto do fáze 8 a tam hotové (`unlockNextStake` v `src/engine/meta/runs.ts`, per balíček)_
- [x] Tajné kombinace v UI skryté do prvního zahrání (pranostiky pro ně jen po objevu) — v rámci runu (Info o runu „???“, `secret-hands.test.ts`); objev přes runy v profilu a ve Sbírce patří fázi 8
- [x] Nekonečný režim: exponenciální cíle, finálový šéf každé 8. patro, statistika nejvyššího patra — patro runu v pitvě; nejvyšší patro v profilových statistikách patří fázi 8
- [x] Výběr balíčku a obtížnosti v „Nová hra“ (+ zadání seedu)
- [x] Simulace: tabulka síly žolíků vs. cílové hodnoty vzácností, ladění čísel, zápis do DESIGN a DECISIONS (hodnoty 4.3 po skupinách; balanc sil piva a balíčků v DECISIONS „Balanc po fázi 7“)
- [x] Testy: každý balíček a obtížnost, nekonečný režim, tajné kombinace (`decks`, `stakes`, `endless`, `secret-hands`)

**Hotovo, když:** obsah splňuje minimální počty z `CLAUDE.md` kap. 3 (bez meta), run jde dohrát na
všech balíčcích; kontroly zelené; commit `content: full content set`; fáze odškrtnutá.

## Fáze 8 — Meta

- [x] `engine/meta`: profil hráče (verzovaný formát, migrace, záloha poškozených dat `karban.profile.backup.<timestamp>`)
- [x] Odemykání podle `UnlockCondition` (žolíci, balíčky, kupóny, kombinace) + oznámení v UI
- [x] Odemykání vyšší síly piva výhrou na nižší (pro každý balíček zvlášť, DESIGN 10) — _přesunuto z fáze 7_
- [x] **Sbírka** (codex): žolíci, spotřebky, kupóny, obálky, balíčky, šéfové, štítky, síly piva, kombinace, úpravy, výzvy, achievementy — s podmínkami odemčení, neobjevené jako siluety
- [x] **60+ achievementů** (78) s vtipnými názvy (`src/content/achievements.ts`), toast při získání
- [x] **Statistiky**: nejlepší ruka, nejvyšší skóre, nejčastější žolík, výhry/prohry podle balíčku a obtížnosti
- [x] **20 výzev** (`src/content/challenges.ts`) s vlastními pravidly a obrazovkou výzev
- [x] **Denní run** (seed `DEN-YYYYMMDD` v UTC, stejný pro všechny) a **seedované runy** (zadání/kopírování seedu)
- [x] **Historie runů** (posledních N runů se seedem, balíčkem, výsledkem)
- [x] Export/import JSON (profil i rozehraný run), reset profilu s potvrzením
- [x] **Tutoriál** se „Štamgastem“ (bubliny, přeskočit, znovu zapnout v nastavení)
- [x] Testy: migrace profilu, odemykání, achievementy, denní seed, export/import roundtrip
- [x] e2e: uložit/načíst, otevřít sbírku (`tests/e2e/meta.spec.ts`, 8 scénářů; snímky `visual-meta.spec.ts` s `KARBAN_VISUAL=1`)
- [x] Revize fáze 8: texty, profil se nikdy neztratí, ochrana proti farmení, počty (DECISIONS „Revize a uzavření fáze 8“)

**Hotovo, když:** profil přežije reload i export/import, odemykání a achievementy fungují, denní run
dává stejný seed; kontroly zelené; commit `feat(meta): …`; fáze odškrtnutá.

## Fáze 9 — Šťáva a zvuk

- [x] Částice na jednom `<canvas>` overlay, screen shake, tilt a hover karet, počítadlo skóre, efekt „velkého skóre“ (`src/ui/fx/*`, `src/ui/styles/fx.css`; DESIGN 13.6, DECISIONS „Fáze 9 (šťáva)“)
- [x] Přechody obrazovek (jen `transform`/`opacity`), respektovat `prefers-reduced-motion` (`src/ui/fx/transitions.ts`)
- [x] SFX syntetizované ve Web Audio (jsfxr-like): klik, výběr karty, míchání, „tik tik tik“ skóre, velké skóre, zaplacení, prodej, zahození, příchod šéfa, výhra, prohra, odemčení
- [x] Procedurální chiptune hudba: jiná v menu a ve hře, u šéfa rychlejší tempo
- [x] Nastavení: hlasitost SFX/hudba, rychlost hry 1×–4×, animace zap/vyp, screen shake, celá obrazovka, velikost UI, přehled klávesových zkratek (ověřeno: ovládání v `src/ui/screens/settings.ts`, ukládá se v profilu; animace / rychlost / shake respektuje i šťáva — `src/ui/fx/motion.ts`)
- [x] Barvoslepý režim: 4barevný balíček (druhý styl SVG karet) (ověřeno: `.colorblind` v `styles/cards.css`, přepínač v Nastavení, e2e `menu.spec.ts` a `game.spec.ts`)
- [x] Vtip všude: loading tipy, prázdné stavy, chybové hlášky, titulky (prošlo se; doplněné pointy v DECISIONS)
- [x] Výkon: 60 fps, žádný layout thrashing, profilování animací (`KARBAN_JUICE=1 npx playwright test juice`: medián snímku 16,7 ms, p95 16,8 ms na volném stroji / 33 ms pod cizí zátěží, ~0,27 přepočtu layoutu na snímek během skórování)

**Hotovo, když:** hra „šťavnatě“ reaguje, zvuk i hudba jdou ztlumit, nastavení se ukládá, 60 fps na
průměrném notebooku; kontroly zelené; commit `feat(ui): juice and audio`; fáze odškrtnutá.

## Fáze 10 — Dokončení 1.0

- [x] Balanc simulací: na Desítce rozumná strategie vyhraje ~25–35 % runů, na Imperialu < 3 %; tabulky v `docs/DESIGN.md` aktuální (Desítka 31,2 %, Imperial 2,0 %, všech 8 sil piva v pásmu v souhrnu sad A–C; DESIGN 2.3.1, 9, 10; DECISIONS „Fáze 10: balanc (silnější boti, cíle patra 8, žolíci, balíčky)“)
- [x] Žádný žolík zjevně bezcenný ani „auto-win“ (porovnání s cílovými hodnotami vzácností; přeměření tabulky 4.3 se silnějšími boty, 6 žolíků upraveno — DESIGN 4.10)
- [x] Patro 8 řádově statisíce: metrika síly bota v `simulate`, silnější boti (laboratoř buildu), přírůstky úrovní ×2, křivka 1 v patře 8 23 000 → 95 000; vítězové mají v patře 8 medián nejlepší ruky 205 000–255 000
- [x] Ztížení Speciálu, které boty i hráče opravdu stojí (zvětrávajících 40 %); balíčky v pásmu DESIGN 12.1 (průměr botů −5,8 až +6,3 p. b., nejlepší bot −3,3 až +8,9 p. b. od Hospodského); Δ výher žolíků normalizovaná na patro koupě
- [x] Bugfix, konzole bez chyb a varování (45 průchodů `ui-walkthrough` přes balíčky, síly piva, výzvy a denní run, s animacemi i bez; e2e `sweep.spec.ts` přes všechny obrazovky mimo hru; opraveno třesení prvků při hoveru, Štamgast bez ikon, Enter po zavření detailu žolíka a pořadí debuffů žolíků závislé na cestě — DECISIONS „Fáze 10 (výkon, offline, přístupnost, bugfix)“)
- [x] Výkon: code splitting — hlavní chunk 93 kB / 33 kB gzip (dřív 630 / 202 kB), obrazovky mimo menu jako líné chunky s přednačtením, ikony až po vykreslení menu (ARCHITECTURE 8.1)
- [x] Lighthouse: výkon a přístupnost > 90 na herní obrazovce (desktop: menu výkon 99–100 / přístupnost 100, přechod do hry 100, herní obrazovka přístupnost 100; mobil: menu 97–98; přístupnost 100 na všech obrazovkách a fázích hry)
- [x] Jazyková korektura všech textů (pravopis, typografie, `plural()`, tykání) — ~2 600 textů, hunspell + regexy, 35 oprav ve 14 souborech, filtr `{n|z}` (ze 2 / z 5), všech ~300 popisků obsahu porovnáno s kódem (DECISIONS „Fáze 10: korektura textů, předložka z/ze, vydání 1.0“)
- [x] `ASSETS.md` kompletní s licencemi, atribuce (game-icons.net, Pixelify Sans) i v Titulcích (`src/ui/screens/credits.ts`; doplněno odvozené písmo Karban Digits, OFL 1.1)
- [x] README česky: popis, screenshoty, GIF, jak spustit, „inspirováno hrou Balatro“, licence (`README.md`, `LICENSE` = MIT, snímky a GIF v `docs/media/` ze skriptu `scripts/readme-media.ts`; DECISIONS „Fáze 10: README, snímky a GIF, licence MIT“)
- [x] Hra funguje offline po prvním načtení: ručně psaný service worker s precache buildu (`src/sw/sw.ts`, plugin `scripts/sw-plugin.ts`), bezpečná aktualizace; e2e `offline.spec.ts` i pod `BASE_PATH=/FM/` (ARCHITECTURE 8.2)
- [ ] Deploy na GitHub Pages (`base`)
- [x] Testy a e2e zelené, pokrytí enginu ≥ 80 % (příkazy 97,6 %, větve 93,0 %, funkce 99,1 %, řádky 99,2 %; 79 souborů a 3 803 unit testů, 71 e2e zelených)
- [x] Kontrola definice hotovo v1.0 (`CLAUDE.md` kap. 10): dohratelnost na všech balíčcích (simulace + `ui-walkthrough`), minimální počty obsahu hlídá `tests/unit/content-minimums.test.ts`, texty jen v `src/i18n` (test `index.html` a `t()`), offline (`offline.spec.ts`), konzole bez chyb (e2e), `ASSETS.md`, žádný převzatý obsah (audity názvů ve fázích 7 a 10)
- [ ] Tag `v1.0.0` na GitHubu — verze 1.0.0 je v `package.json`, tag je vytvořený lokálně na commitu vydání, ale push tagů z vývojového prostředí je zakázaný (HTTP 403); vytvoří ho vlastník (GitHub → Releases → Draft a new release → tag `v1.0.0`)

**Hotovo, když:** splněna definice hotovo v1.0, hra běží z GitHub Pages, tag `v1.0.0` existuje; fáze odškrtnutá.

---

## Opravy po testu 1.0 (1.0.1)

Komplexní test 2026-10-02: hráčský průchod (UX), lov chyb v okrajových případech, revize designu a obsahu se
simulacemi. Seřazeno podle priority.

**Chyby a čitelnost**

- [ ] Číslice „3“ v písmu Karban Digits vypadá jako „8“ („Patro 3/8“ se čte „8/8“); „C“ jako „O“, „č“ jako „ċ“
      (`src/ui/art/digitFont.ts`, malé velikosti v levém panelu)
- [ ] Toasty (achievementy, odemčení) se zobrazují uprostřed plochy a zakrývají obálku, zboží, skórování i výhru
      a jsou i nad modály — přesunout do rohu, pod modaly, během skórování pozdržet
- [ ] „Koupit a použít“ ve Večerce počítá použitelnost se vším zbožím naráz (`src/ui/screens/game/shop.ts`
      `prospective()`) — Výjimka z vyhlášky zamčená, Zaklepat na dřevo hlásí chybu
- [ ] Pan starosta: náhled nevaruje, že ruka nepřekoná předchozí; ukázat „Překonej: X“
- [ ] Denní run jde natrénovat ručním seedem `DEN-dnešek` a zadat i budoucí den (`src/engine/meta/daily.ts`)
- [ ] Dvě karty prohlížeče si přepisují profil i run (chybí posluchač `storage` / zámek)
- [ ] Návrat do hry po odchodu do menu během animace: hra až několik sekund nereaguje
      (`src/ui/controller.ts`, presenter se neruší)
- [ ] Import runu: hlubší validace (karty v ruce, `round`, neznámí žolíci) — dnes import projde a hra pak padá
- [ ] Obálka: „Použít“ nekontroluje `canUse`; Minimalista + Babiččina barva: UI pustí 3 cíle, rada chce až 4
- [ ] Velká čísla v levém panelu se lámou uprostřed skupiny číslic; focus po výběru útraty padá na `<body>`
- [ ] Nová hra: zamčené balíčky zaberou obrazovku, chyba seedu je mimo viewport pod plovoucím tlačítkem;
      achievement „Semínko zaseto“ odporuje nápovědě o seedovaných runech
- [ ] Tutoriál: rady 7 a 9 se vracejí každé kolo, číslování skáče, bublina zakrývá Skóre kola
- [ ] Dotyk: popisy zboží jen na hover / dlouhý stisk; telefon: ruka a tlačítka pod přehybem

**Balanc a design**

- [ ] Dechovka + skleněné karty = auto-win (Trojice 3× sklo ≈ 96 milionů, Čtveřice ≈ 2,3e12); omezit opakování
      ×mult z karet
- [ ] Patro 8 je zeď (42–59 % runů, které tam dojdou, padne) a patra 1–5 jsou bez napětí (14 z 23 kol vyhráno
      první rukou); přeladit růst cílů a finální šéfy (Fronta na banány 3,5×)
- [ ] Garsonka 1+kk zabíjí Barvu (37,5 % pro bota flush); Nová vyhláška; Bílá paní bez zamíchání
- [ ] Ruce jsou levné (−1 ruka nic nestojí), žolíci „na první ruku“ platí skoro vždy
- [ ] Přeskakování za štítky se nevyplácí; legendární žolíci se skoro neobjeví
- [ ] Systémový obsah blízko Balatru (kupóny, štítky, nálepky, tabulka kombinací, váhy obchodu ±10 %) —
      nahradit část vlastními mechanikami a čísly
- [ ] Nekonečný režim končí na patře 10–11; achievement „Tepelná smrt vesmíru“ (1,8e308) je nesplnitelný
- [ ] Texty: kolize názvů Zabijačka (žolík i šéf), opakované motivy, anglické slovní hříčky (piky, káry),
      „Hrací automat“ → „Hudební automat“, pitva Malé a Velké útraty potřebuje víc hlášek

---

## Obsahové patche (po 1.0)

Po vydání 1.0 pokračuj patchi. Každý patch: obsah podle `docs/CONTENT-GUIDE.md`, testy, simulace,
zápis do sbírky, aktualizace README, záznam v DECISIONS (pokud se mění pravidla), tag `v1.x.0`.
Nápady ber z `docs/IDEAS.md` a hotové tam odškrtávej.

- [ ] **1.1** — 2 nové startovní balíčky, 5 nových šéfů, 5 nových výzev, 10 achievementů
- [ ] **1.2** — 15 nových žolíků (tematická sada „Chataři a chalupáři“), 3 nové babské rady
- [ ] **1.3** — nový herní režim z `docs/IDEAS.md` (např. týdenní hospodská liga nad denním runem)
- [ ] **1.4** — sváteční události (Vánoce, Velikonoce, Silvestr) s vlastními šéfy a štítky
- [ ] Průběžně: ladění balancu podle simulací, nové hlášky, loading tipy a achievementy
