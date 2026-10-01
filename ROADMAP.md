# ROADMAP — Karban

> Odškrtávací plán celé hry podle `CLAUDE.md` kap. 9. Každá fáze končí zelenými kontrolami, commitem a
> odškrtnutím zde. Rozhodnutí se zapisují do `docs/DECISIONS.md`, nápady do `docs/IDEAS.md`.

## Aktuální stav

_Aktualizováno: 2026-10-01_

**Fáze 0 (Založení) a Fáze 1 (Engine jádra) jsou hotové** (commity `chore: …` a `feat(engine): complete phase 1 …`).

**Fáze 2 (Run loop v enginu) je hotová** — 13 ze 14 podúkolů odškrtnuto; zbývá jen „První kalibrace křivky cílů“,
která je vědomě odložená (bez žolíků a pranostik by ladění posunulo křivku špatným směrem; viz `docs/DECISIONS.md`).

- Kontroly zelené: `typecheck`, `lint` (ESLint + Prettier), `npm test` (26 souborů, 916 testů), `build`,
  `test:e2e` (1 smoke test), `test:coverage` (prahy splněné).
- Pokrytí `src/engine`: 98,2 % řádků, 95,8 % příkazů, 89,6 % větví, 98,4 % funkcí. Po modulech (řádky / větve):
  `cards` 100/100, `hands` 99/100, `effects` 100/91, `scoring` 100/97, `shop` 99/92, `rng` 99/92, `run` 100/95
  (`game.ts` 100/96), `save` 100/100, `sim` 95/81 (`bots.ts` 90/73).
- Hotové ve fázi 2: `src/engine/run/game.ts` (stavový automat `RunPhase`, validace akcí, rozpis odměn a úrok,
  přeskočení útrat se štítky, Večerka a obálky, konec runu s příčinou, výhra a nekonečný režim; dotazy pro UI
  `blindTarget`, `blindReward`, `preview`, `sellValue`, `canUseConsumable`, `modifiers`), `src/engine/save/save.ts`
  (obálka, kontrola tvaru, migrace, kódy `SaveError`), `src/engine/sim/` (`bots`, `hand-eval`, `runner`, `commands`;
  6 botů bez stavu mimo `RunState`), `scripts/simulate.ts` (volby `--runs`, `--stake`, `--deck`, `--bot`/`--strategy`,
  `--seed-prefix`, `--json [soubor|-]`, `--max-actions`; textový režim `--play` a `--script`), obsah
  `src/content/{stakes,decks}.ts` (8 obtížností „Síla piva“, 8 balíčků), texty `src/i18n/cs/{cli,decks,stakes}.ts`.
  Nové testy v `tests/unit/`: `game`, `save`, `run-determinism`, `hook-context`, `sim`, `stakes`, `decks`,
  `review2-rules`, `review2-sim-save`.
- Engine vyžaduje seed od volajícího (UI generuje `generateSeed(Math.random)`); `Math.random`, `Date.now`
  a `localeCompare` jsou v `src/engine/**` zakázané ESLintem. Stav runu je JSON-serializovatelný (fuzz test).
- Simulace (100 runů, Desítka, obsah bez žolíků/šéfů/spotřebek): všichni boti 0 % výher, průměrné patro `max` 1,9,
  `nojoker` 2, `random` 1 (100 % proher v patře 1); 0 neplatných akcí; ~5,5 s pro 6 botů.
- Revize pravidel runu a simulace/ukládání/determinismu proběhly (záznamy v `docs/DECISIONS.md`).

**Známé otevřené body (řešit v uvedené fázi):**

- fáze 3: názvy útrat a hlášky pitvy pro Malou/Velkou útratu jsou zatím jen v textech CLI (`cli.blind.*`,
  `cli.play.gameOver.death.*` v `src/i18n/cs/cli.ts`) — pro UI je přesunout do sdíleného podmodulu;
  `formatNumber(Number.MAX_VALUE)` má ukázat „nekonečno“ (DESIGN 1.3);
- fáze 4–5: první kalibrace křivky cílů a čísel kombinací (DESIGN 12.4 krok 1) až s žolíky a pranostikami — dnes
  `nojoker` končí s mediánem v patře 2 (cíl 3–4);
- fáze 6: `TagHooks` nemá obdobu `roundEndMoney` (peníze ze štítků v rozpisu odměn, DESIGN 2.4.2 krok 5); poziční
  pravidlo typu Jednooký hejtman nejde přes `setJokerDebuffed` spolehlivě vyjádřit po přeřazení žolíků;
- fáze 7: balíčky Úřednický, Babiččin, Vetešnický a Kalendářový (potřebují kupóny, spotřebky a žolíky).

**Další krok:** Fáze 3 — herní UI v1. Základy UI už existují v `src/ui`: `app.ts` (router obrazovek), `controller.ts`
(`GameController`: most k `Game.dispatch`, autosave, přehrání událostí), `settings.ts`, `storage.ts`, `anim/queue.ts`
(fronta animací), `dom.ts` (helper `h()`), `styles/base.css`. Navázat herní obrazovkou (levý panel, ruka, Zahrát /
Zahodit), výběrem útraty, rozpisem odměn a pitvou nad dotazy `Game` (`blindTarget`, `blindReward`, `preview`).

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
- [ ] První kalibrace křivky cílů simulací, čísla zapsaná do `docs/DESIGN.md` — _odloženo do fáze 4–5 (až budou žolíci a pranostiky), viz DECISIONS „Fáze 2: simulace a boti“_
- [x] Testy: stejný seed + stejné akce = identický stav, odměny a úrok, výhra/prohra, save/load roundtrip, migrace, simulace jako smoke test

**Hotovo, když:** run jde odehrát od prvního patra do výhry/prohry v textovém režimu i botem,
`npm run simulate -- --runs 50` doběhne; kontroly zelené; commit `feat(engine): run loop…`; fáze odškrtnutá.

## Fáze 3 — Herní UI v1

- [ ] `index.html`, `src/main.ts`, `src/ui/dom.ts` (helper `h()`), `src/ui/app.ts` (router obrazovek), `src/ui/controller.ts` (instance `Game`, fronta animací, autosave)
- [ ] CSS: proměnné a témata na `:root`, font Pixelify Sans (`@fontsource`, latin-ext), rozvržení pro ≥ 1024 px, tablet s dotykem
- [ ] Vlastní SVG hrací karty (klasický styl, figury stylizované česky, indexy J/Q/K/A, barvy ♠ ♥ ♦ ♣)
- [ ] Herní obrazovka — levý panel: název útraty/šéfa + pravidlo, „Dosáhni aspoň …“, skóre kola, aktuální kombinace s živými čipy × mult, Ruce, Zahození, peníze, Patro x/8, Kolo, tlačítka „Info o runu“ a „Nastavení“
- [ ] Horní řada: sloty žolíků (x/5) a spotřebek (x/2) — zatím prázdné
- [ ] Stůl se zahranými kartami, ruka dole, tlačítka **Zahrát** / **Zahodit**, třídění podle hodnoty/barvy, balíček vpravo dole (zbývá/celkem + náhled zbylých karet)
- [ ] Výběr karet myší, dotykem a klávesami (1–8, Enter, X, S/B, Esc, mezerník přeskočí animaci)
- [ ] Animace skórování: přehrávání `ScoreStep`, počítadlo čipů × mult, výsledek
- [ ] Obrazovka výběru útraty (3 karty: cíl, odměna, Přeskočit)
- [ ] Konec kola (rozpis odměn s animací), konec runu („pitva“ s hláškou podle příčiny), výhra (zatím jednoduché titulky)
- [ ] Hlavní menu: Nová hra, Pokračovat (ostatní položky jako „Už brzy“), autosave do `localStorage` po každé akci
- [ ] Všechny texty v `src/i18n/cs*` (žádné natvrdo), tykání
- [ ] e2e: spustit, vybrat útratu, zahrát ruku, screenshot, vykreslení „Příliš žluťoučký kůň úpěl ďábelské ódy“
- [ ] **Napsat uživateli, jak hru spustí** (`npm install` → `npm run dev` → adresa z konzole)

**Hotovo, když:** run jde v prohlížeči dohrát (bez žolíků) od menu po výhru/pitvu myší, klávesnicí i
dotykem, konzole bez chyb; e2e zelené; commit `feat(ui): …`; fáze odškrtnutá; uživatel dostal návod ke spuštění.

## Fáze 4 — Žolíci v1 + Večerka

- [ ] `engine/effects`: volání všech `JokerHooks` ve správných okamžicích a pořadí, implementace `EngineApi`
- [ ] Edice žolíků: lesklá a holografická **před** efektem, duhová **po** něm, negativní = +1 slot
- [ ] Kopírující žolíci (`copyTarget`, `isCopy` — bez dvojího navyšování stavu), retriggery, debuff žolíka
- [ ] `src/content/index.ts`: sestavení `ContentRegistry` + validace (unikátní id, existence textů, platné odkazy)
- [ ] `src/content/jokers.ts`: **30 žolíků** (rozložení vzácností dle `docs/DESIGN.md`), texty `jokers.<id>.name|desc|flavor`, `ArtSpec`, test ke každému
- [ ] `tests/unit/content.test.ts`: každá položka má název, popis a flavor; typografie textů (uvozovky, NBSP, desetinná čárka)
- [ ] `engine/shop`: generování Večerky (2 sloty karet, 2 sloty balíčků, 1 kupón — zatím zástupné), ceny, nákup, prodej za polovinu, Přehodit za rostoucí cenu
- [ ] Úrok a peníze napojené na obchod; prázdný stav „Večerka zavřená — inventura“
- [ ] UI: obrazovka Večerky, řada žolíků s drag & drop (myš i dotyk), detail žolíka (mechanika + flavor), prodej
- [ ] `src/ui/art/joker.ts`: procedurální SVG žolíka z `ArtSpec` (ikona z game-icons + paleta + vzor)
- [ ] „Info o runu“: úrovně kombinací, žolíci, složení balíčku
- [ ] Simulace: bot nakupuje žolíky (jednoduchá heuristika)
- [ ] e2e: otevřít Večerku, koupit žolíka, prodat ho

**Hotovo, když:** jde koupit, přesouvat a prodávat 30 žolíků a jejich efekty se projeví ve skóre
podle pořadí; každý žolík má test; kontroly zelené; commit `feat: jokers v1 and shop`; fáze odškrtnutá.

## Fáze 5 — Spotřebky, boostery, kupóny, úpravy karet

- [ ] `src/content/modifiers.ts`: **min. 8 vylepšení** (bonusová, multiplikační, skleněná s rizikem prasknutí, ocelová v ruce, kamenná, zlatá, šťastná, divoká) — čísla dle `docs/DESIGN.md`
- [ ] **4 pečetě** (zlatá: peníze při zahrání, červená: skóruje 2×, modrá: vytvoří pranostiku, fialová: vytvoří babskou radu)
- [ ] **Edice** pro karty a žolíky: lesklá, holografická, duhová (+ negativní jen pro žolíky)
- [ ] Engine spotřebek: sloty (2, upravitelné), použití s výběrem cílů, `canUse`, prodej
- [ ] **13 pranostik** (jedna na každou kombinaci, vč. tajných) — `src/content/pranostiky.ts` (`consumables.ts` spojí všechny tři typy)
- [ ] **22 babských rad** — `src/content/rady.ts`
- [ ] **16 úředních razítek** — `src/content/razitka.ts`
- [ ] Rozhodnout o případném 4. typu spotřebky (zapsat do DECISIONS)
- [ ] **5 druhů boosterů** (pranostiky, babské rady, razítka, žolíci, hrací karty) ve velikostech normal/jumbo/mega + obrazovka výběru z boosteru
- [ ] **24 kupónů** (12 párů základ → vylepšení), slot ve Večerce, tier 2 vyžaduje tier 1
- [ ] UI: vylepšení, pečetě a edice viditelné na kartách (SVG vrstvy), lišta spotřebek x/2, použití s výběrem cílů
- [ ] Testy: každá spotřebka, vylepšení, pečeť, edice a kupón; pořadí v pipeline; prasknutí skla (RNG); retrigger červené pečeti
- [ ] e2e: otevřít booster, vybrat kartu, použít spotřebku

**Hotovo, když:** všechny tři typy spotřebek, boostery a kupóny jdou v UI koupit/použít a správně
mění skóre i balíček; kontroly zelené; commit `feat: consumables, boosters, vouchers, card modifiers`; fáze odškrtnutá.

## Fáze 6 — Šéfové a štítky

- [ ] Engine šéfů: všechny `BossHooks` (debuff, lícem dolů, `validateHand`, `modifyBase`, `afterHandPlayed`, `onDiscard`, `onDraw`, `passive`), losování (stream `boss`, `minAnte`, bez opakování), `disableBoss`
- [ ] **25 šéfů** s jedním jasným pravidlem — `src/content/bosses.ts`
- [ ] **5 finálových šéfů** jen pro patro 8 (a každé 8. patro nekonečného režimu)
- [ ] Texty šéfů: `bosses.<id>.name|rule|intro|defeat|death` (hláška při příchodu, porážce a v pitvě)
- [ ] Přeskakování útrat napojené na **20 štítků** (`src/content/tags.ts`, `TagHooks`, `minAnte`), fronta štítků v UI
- [ ] UI: karta šéfa ve výběru útraty, pravidlo v levém panelu, vizuál debuffu a zakrytých karet, bublina s hláškou
- [ ] Pitva podle šéfa, na kterém run skončil
- [ ] Testy: každý šéf a štítek aspoň 1 test
- [ ] Simulace: žádný šéf není téměř neporazitelný ani bezzubý; úpravy zapsat do DESIGN

**Hotovo, když:** v každém patře se objeví šéf s funkčním pravidlem, ve finále jen finálový šéf,
přeskočení útraty dá štítek s funkčním bonusem; kontroly zelené; commit `feat: bosses and tags`; fáze odškrtnutá.

## Fáze 7 — Obsah naplno

- [ ] Žolíci na **100+**, z toho **6+ legendárních**; rozložení vzácností a cen dle `docs/DESIGN.md`; každý s testem a rozpoznatelným artem
- [ ] **12 startovních balíčků** (`src/content/decks.ts`), každý mění pravidla (např. Mariášový s 32 kartami, jen figury, náhodné pečetě, Dlužník se záporným zůstatkem a 2× úrokem)
- [ ] **8 obtížností „Síla piva“** (Desítka, Jedenáctka, Dvanáctka, Speciál, Ležák, Bock, Doppelbock, Imperial) — kumulativní ztížení, nálepky žolíků (přibitý, zvětrávající, zapůjčený)
- [ ] Odemykání vyšší obtížnosti výhrou na nižší
- [ ] Tajné kombinace v UI skryté do prvního zahrání (pranostiky pro ně jen po objevu)
- [ ] Nekonečný režim: exponenciální cíle, finálový šéf každé 8. patro, statistika nejvyššího patra
- [ ] Výběr balíčku a obtížnosti v „Nová hra“ (+ zadání seedu)
- [ ] Simulace: tabulka síly žolíků vs. cílové hodnoty vzácností, ladění čísel, zápis do DESIGN a DECISIONS
- [ ] Testy: každý balíček a obtížnost, nekonečný režim, tajné kombinace

**Hotovo, když:** obsah splňuje minimální počty z `CLAUDE.md` kap. 3 (bez meta), run jde dohrát na
všech balíčcích; kontroly zelené; commit `content: full content set`; fáze odškrtnutá.

## Fáze 8 — Meta

- [ ] `engine/meta`: profil hráče (verzovaný formát, migrace, záloha poškozených dat `karban.profile.backup.<timestamp>`)
- [ ] Odemykání podle `UnlockCondition` (žolíci, balíčky, kupóny, kombinace) + oznámení v UI
- [ ] **Sbírka** (codex): žolíci, spotřebky, kupóny, balíčky, šéfové, štítky, kombinace, úpravy — s podmínkami odemčení, neobjevené jako siluety
- [ ] **60+ achievementů** s vtipnými názvy (`src/content/achievements.ts`), toast při získání
- [ ] **Statistiky**: nejlepší ruka, nejvyšší skóre, nejčastější žolík, výhry/prohry podle balíčku a obtížnosti
- [ ] **20 výzev** (`src/content/challenges.ts`) s vlastními pravidly a obrazovkou výzev
- [ ] **Denní run** (seed `DEN-YYYYMMDD` v UTC, stejný pro všechny) a **seedované runy** (zadání/kopírování seedu)
- [ ] **Historie runů** (posledních N runů se seedem, balíčkem, výsledkem)
- [ ] Export/import JSON (profil i rozehraný run), reset profilu s potvrzením
- [ ] **Tutoriál** se „Štamgastem“ (bubliny, přeskočit, znovu zapnout v nastavení)
- [ ] Testy: migrace profilu, odemykání, achievementy, denní seed, export/import roundtrip
- [ ] e2e: uložit/načíst, otevřít sbírku

**Hotovo, když:** profil přežije reload i export/import, odemykání a achievementy fungují, denní run
dává stejný seed; kontroly zelené; commit `feat(meta): …`; fáze odškrtnutá.

## Fáze 9 — Šťáva a zvuk

- [ ] Částice na jednom `<canvas>` overlay, screen shake, tilt a hover karet, počítadlo skóre, efekt „velkého skóre“
- [ ] Přechody obrazovek (jen `transform`/`opacity`), respektovat `prefers-reduced-motion`
- [ ] SFX syntetizované ve Web Audio (jsfxr-like): klik, výběr karty, míchání, „tik tik tik“ skóre, velké skóre, zaplacení, prodej, zahození, příchod šéfa, výhra, prohra, odemčení
- [ ] Procedurální chiptune hudba: jiná v menu a ve hře, u šéfa rychlejší tempo
- [ ] Nastavení: hlasitost SFX/hudba, rychlost hry 1×–4×, animace zap/vyp, screen shake, celá obrazovka, velikost UI, přehled klávesových zkratek
- [ ] Barvoslepý režim: 4barevný balíček (druhý styl SVG karet)
- [ ] Vtip všude: loading tipy, prázdné stavy, chybové hlášky, titulky
- [ ] Výkon: 60 fps, žádný layout thrashing, profilování animací

**Hotovo, když:** hra „šťavnatě“ reaguje, zvuk i hudba jdou ztlumit, nastavení se ukládá, 60 fps na
průměrném notebooku; kontroly zelené; commit `feat(ui): juice and audio`; fáze odškrtnutá.

## Fáze 10 — Dokončení 1.0

- [ ] Balanc simulací: na Desítce rozumná strategie vyhraje ~25–35 % runů, na Imperialu < 3 %; tabulky v `docs/DESIGN.md` aktuální
- [ ] Žádný žolík zjevně bezcenný ani „auto-win“ (porovnání s cílovými hodnotami vzácností)
- [ ] Bugfix, konzole bez chyb a varování
- [ ] Lighthouse: výkon a přístupnost > 90 na herní obrazovce
- [ ] Jazyková korektura všech textů (pravopis, typografie, `plural()`, tykání)
- [ ] `ASSETS.md` kompletní s licencemi, atribuce (game-icons.net, Pixelify Sans) i v Titulcích
- [ ] README česky: popis, screenshoty, GIF, jak spustit, „inspirováno hrou Balatro“, licence
- [ ] Deploy na GitHub Pages (`base`), hra funguje i offline (bez síťových závislostí)
- [ ] Testy a e2e zelené, pokrytí enginu ≥ 80 %
- [ ] Kontrola definice hotovo v1.0 (`CLAUDE.md` kap. 10)
- [ ] Tag `v1.0.0`

**Hotovo, když:** splněna definice hotovo v1.0, hra běží z GitHub Pages, tag `v1.0.0` existuje; fáze odškrtnutá.

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
