# CLAUDE.md — zadání hry „Karban“ (dříve pracovní název „Žolíkárna“)

## 0. Co stavíš

Od nuly stavíš **kompletní, dlouhou, komplexní roguelike karetní hru v prohlížeči**, inspirovanou mechanikami hry Balatro: pokerové kombinace × žolíci s pasivními efekty × exponenciálně rostoucí cíle skóre × obchod mezi koly. Hra je **celá v češtině**, **vtipná** (český humor — hospoda, panelák, úřady, chataření, historie, internet; namíchej podle citu) a je to **vlastní dílo**: žádné převzaté názvy, texty, obrázky, čísla ani data z Balatra ani jiné komerční hry. Inspirace mechanikami je v pořádku, kopie ne. V README smíš napsat „inspirováno hrou Balatro“.

Cíl: hráč u toho vydrží desítky hodin. 8 pater hlavní hry + nekonečný režim, 100+ žolíků, 12+ balíčků, 8 obtížností, 20 výzev, odemykání, sbírka, 60+ achievementů, denní run.

## 1. Jak pracuješ (pravidla pro Claude Code)

- Pracuj **autonomně**. Neptej se uživatele na detaily — rozhodni sám a rozhodnutí zapiš do `docs/DECISIONS.md` (datum, co, proč). Uživatel chce, abys všechno vymyslel a postavil ty.
- **Na začátku každé session** si přečti `ROADMAP.md` a `docs/DECISIONS.md` a pokračuj tam, kde to skončilo. **Před koncem session** (nebo když ti dochází kontext) zapiš do `ROADMAP.md` přesný stav: co je hotovo, co rozpracováno, ve kterých souborech, co je další krok.
- Postupuj po **fázích** (kap. 9). Fáze je hotová, až když `npm run typecheck && npm run lint && npm test && npm run build` projde, hra se dá spustit a zahrát, existuje commit a `ROADMAP.md` má fázi odškrtnutou. Pak napiš shrnutí (max 10 řádků) a plynule pokračuj další fází. Nezastavuj se kvůli potvrzení.
- Git: commituj často, Conventional Commits (`feat:`, `fix:`, `content:`, `test:`, `docs:`, `chore:`). Jazyk commitů konzistentní (angličtina).
- Nerozbíjej hotové věci: engine má testy; změna pravidel = nejdřív upravit/přidat test.
- Kód, soubory a identifikátory **anglicky**; veškerý text pro hráče **česky** (kap. 6). Komentáře klidně česky.
- Když nejde něco stáhnout (síť, 404), nezastavuj se: vygeneruj náhradu (SVG / procedurálně), poznač do `ASSETS.md` a jeď dál.
- **Nikdy** nestahuj ani nevkládej assety, texty, jména ani čísla z Balatra nebo jiných komerčních her (kap. 7).

## 2. Technologie

- **Vite + TypeScript (strict)**, ESM, Node 20+, npm.
- **Rendering: HTML DOM + CSS** (transformy, keyframe animace, CSS proměnné pro témata) + jeden `<canvas>` overlay pro částice a efekty. **Žádný React/Vue/Svelte** — vlastní lehká vrstva (`h()` helper nebo šablony) stačí. Důvod: text s diakritikou, snadný debug, rychlá iterace, přístupnost.
- **Engine hry je čistý TypeScript bez DOM** (`src/engine/**`): deterministický, testovatelný, řízený událostmi (event bus). UI (`src/ui/**`) jen poslouchá události a renderuje; nikdy nesahá do stavu enginu přímo.
- **RNG se seedem** (mulberry32 / xoshiro128**); veškerá náhoda jde přes něj → seedované a denní runy, reprodukovatelné bugy, deterministická simulace.
- Testy: **Vitest** (detekce kombinací, skórování, pořadí efektů, každý žolík, RNG determinismus, save/load roundtrip, migrace uložení). Min. 80 % pokrytí enginu. **Playwright** smoke test (spustit, zahrát ruku, otevřít obchod, uložit/načíst, screenshot).
- Lint/format: ESLint + Prettier. Skripty: `dev`, `build`, `preview`, `test`, `test:e2e`, `typecheck`, `lint`, `fetch-assets`, `simulate`, `deploy`.
- CI: GitHub Actions (typecheck, lint, test, build, e2e) + deploy na GitHub Pages (`base` ve `vite.config.ts`).
- Audio: Web Audio API. SFX syntetizuj v kódu (generátor ve stylu jsfxr), hudba procedurální chiptune smyčka nebo CC0 skladby (kap. 7).
- Ukládání: `localStorage` (autosave po každé akci) + export/import JSON (profil i rozehraný run). Formát verzuj, piš migrace, nikdy neztrať profil hráče.
- Výkon: 60 fps na průměrném notebooku; animuj jen `transform`/`opacity`; žádné layout thrashing. Primárně desktop (min. 1024 px), tablet s dotykem plně funkční, telefon „best effort“.

Struktura projektu:

```
src/
  engine/        # pravidla, stav, skórování, RNG, save — BEZ DOM
    cards/ hands/ scoring/ run/ shop/ effects/ rng/ save/ sim/
  content/       # DATA: jokers.ts, bosses.ts, pranostiky.ts, rady.ts, razitka.ts,
                 # vouchers.ts, tags.ts, decks.ts, stakes.ts, challenges.ts, achievements.ts
  ui/            # DOM renderer, obrazovky, animace, částice, zvuk
  i18n/          # cs.ts (všechny texty), format.ts (čísla, skloňování)
  assets/        # stažené / vygenerované obrázky, fonty, hudba
scripts/         # fetch-assets.ts, simulate.ts
tests/           # unit (vitest) + e2e (playwright)
docs/            # ARCHITECTURE.md, DESIGN.md, DECISIONS.md, CONTENT-GUIDE.md, IDEAS.md
ROADMAP.md       # odškrtávací plán + aktuální stav
ASSETS.md        # původ a licence každého assetu
```

## 3. Jádro hry (musí fungovat přesně)

### Karty a balíček
- 52 karet, 4 barvy (♠ ♥ ♦ ♣), hodnoty 2–A. Čipy karty: 2–10 = číslo, J/Q/K = 10, A = 11.
- Karta může mít: **vylepšení** (jedno), **pečeť** (jedna), **edici** (jedna). Všechno datově, serializovatelné.
- Balíček se během runu mění (přidané, odebrané i upravené karty zůstávají až do konce runu).

### Kombinace — české názvy
Vysoká karta, Dvojice, Dvě dvojice, Trojice, Postupka, Barva, Full house, Čtveřice, Postupka v barvě, Královská postupka, + **tajné** kombinace odemykané objevem: Pětice, Barevný full house, Barevná pětice. Každá má základní čipy, mult a **úroveň** (zvyšují ji pranostiky). Hráč hraje 1–5 karet; skóruje nejvyšší nalezená kombinace; karty mimo kombinaci se nepočítají (pokud žolík neurčí jinak). Hraniční případy: postupka A-2-3-4-5 i 10-J-Q-K-A; „kolem dokola“ ne (pokud to nepovolí žolík).

### Skórování
`skóre = čipy × mult`. Pořadí vyhodnocení (musí být deterministické a otestované):
1. základ kombinace (čipy + mult podle úrovně),
2. každá skórující karta zleva doprava: čipy karty → vylepšení → edice → pečeť → žolíci reagující „na skórovanou kartu“,
3. karty v ruce (nezahrané) s efekty „v ruce“ (např. ocelová),
4. žolíci zleva doprava s efekty „po zahrání ruky“ (+čipy, +mult, ×mult).
Pořadí žolíků je herně důležité, hráč je přesouvá. Čísla rostou do miliard i víc: počítej v `number`, nad 1e15 přepni na vědecký zápis, formátuj česky (`1 340 000`, `×1,5`).

### Run (jedna hra)
- 8 **pater**. Každé patro: **Malá útrata** (1× cíl), **Velká útrata** (1,5× cíl), **Šéf** (2× cíl + speciální pravidlo). Malou a velkou útratu lze **přeskočit** za **štítek** s bonusem.
- Kolo: 4 ruce, 3 zahození, 8 karet v ruce (vše upravitelné kupóny/žolíky). Nedosažení cíle = konec runu s vtipnou „pitvou“.
- Peníze: **koruny** (`Kč`). Odměna za kolo 3/4/5 Kč + 1 Kč za každou nevyužitou ruku + úrok 1 Kč za každých 5 Kč (strop 5 Kč, upravitelný).
- Po 8. patře **výhra** (titulky, statistika runu) a nabídka **Nekonečný režim** (cíle rostou exponenciálně, dokud hráč nepadne).
- Cíle rostou tak, aby patro 8 vyžadovalo řádově statisíce až miliony bodů. Konkrétní čísla nalaď simulací (kap. 8) a zapiš do `docs/DESIGN.md`.

### Večerka (obchod)
2 sloty karet (žolík / spotřebka / hrací karta), 2 **balíčky** (boostery, hráč vybírá 1 z N), 1 **kupón** (trvalé vylepšení na run), tlačítko **Přehodit** za rostoucí cenu. Prodej žolíků a spotřebek za polovinu ceny. Prázdný stav: „Večerka zavřená — inventura“.

### Žolíci
- Slot limit 5 (upravitelný). Vzácnosti: Běžný / Vzácný / Epický / Legendární. Edice: Lesklá (+50 čipů), Holografická (+10 mult), Duhová (×1,5 mult), Negativní (+1 slot). Každý má cenu, prodejní cenu, podmínku odemčení, mechaniku (jedna přesná věta) a flavor (jedna hláška).
- Efekty = **data + hooky**: `onCardScored`, `onHandPlayed`, `onCardHeld`, `onDiscard`, `onRoundStart`, `onRoundEnd`, `onBlindSelect`, `onShopEnter`, `onSell`, `onCardAdded`, `passive`. Žolík s vnitřním stavem (počítadlo, nabíjení) ho drží v `state`. Vše serializovatelné. Přidání nového žolíka = jeden objekt v `content/jokers.ts` + test.

### Spotřební karty (2 sloty, upravitelné) — tři vlastní typy
1. **Pranostiky** — zvyšují úroveň kombinace (např. „Medardova kápě“ → Barva +1 úroveň; „Svatá Anna, chladna zrána“ → Postupka).
2. **Babské rady** — mění hrací karty: přidat vylepšení, změnit barvu/hodnotu, zničit, zkopírovat, dát peníze, proměnit žolíka…
3. **Úřední razítka** — vzácná, silná, s cenou: přidat pečeť, vytvořit legendárního žolíka, zničit polovinu ruky za peníze, zdvojit žolíka, zmenšit limit rukou za ×mult…
Pokud dává smysl, přidej čtvrtý vlastní typ (zapiš do DECISIONS).

### Úpravy hracích karet
Min. 8 vylepšení (bonusová, multiplikační, skleněná ×2 s rizikem prasknutí, ocelová ×1,5 v ruce, kamenná +50 čipů bez hodnoty, zlatá +3 Kč v ruce na konci kola, šťastná (šance na mult/peníze), divoká (všechny barvy)); 4 pečetě (zlatá: peníze při zahrání, červená: skóruje 2×, modrá: vytvoří pranostiku, fialová: vytvoří babskou radu); 3+ edice. Názvy a flavor počešti po svém.

### Šéfové
Min. 25 šéfů s jedním jasným pravidlem (část ruky zakrytá, jedna barva debuffnutá, jen 1 ruka, zákaz opakování kombinace, karty lícem dolů, ztráta peněz za ruku, zmenšená ruka, …) + 5 **finálových** šéfů jen pro patro 8 (těžší). Každý má vtipný český název, pravidlo a hlášku při příchodu i při porážce.

### Další obsah (minimální počty)
- **Štítky** za přeskočení: 20.
- **Kupóny**: 24 (12 párů základ → vylepšení).
- **Startovní balíčky**: 12, každý mění pravidla (např. +1 slot žolíka; start s 2 kupóny; dvojnásobné peníze ale ½ rukou; „Mariášový“ balíček s 32 kartami; balíček jen z figur; balíček s náhodnými pečetěmi; balíček „Dlužník“ se záporným startovním zůstatkem a 2× úrokem…).
- **Obtížnosti „Síla piva“**: 8 — Desítka, Jedenáctka, Dvanáctka, Speciál, Ležák, Bock, Doppelbock, Imperial; každá přidává trvalé ztížení navíc k předchozím; výhra na vyšší odemyká další.
- **Výzvy**: 20 předpřipravených runů se zvláštními pravidly a vlastním vtipným názvem.
- **Odemykání** (žolíci, balíčky, kupóny, kombinace), **Sbírka** (codex všeho s podmínkami odemčení), **Statistiky** (nejlepší ruka, nejvyšší skóre, nejčastěji používaný žolík…), **Achievementy**: 60+ s vtipnými názvy, **Denní run** (seed z data, stejný pro všechny), **seedované runy** (zadání/kopírování seedu), **historie runů**.

## 4. Obrazovky a ovládání

- **Hlavní menu**: Nová hra (balíček + obtížnost + seed) / Pokračovat / Výzvy / Denní run / Sbírka / Statistiky / Nastavení / Titulky.
- **Herní obrazovka** (rozvržení jako u klasiky žánru): vlevo panel — název útraty/šéfa + jeho pravidlo, cíl „Dosáhni aspoň …“, skóre kola, aktuální kombinace s **živě přepočítávanými čipy × mult** při výběru karet, Ruce, Zahození, peníze, Patro x/8, Kolo, tlačítka „Info o runu“ a „Nastavení“. Nahoře řada žolíků (x/5, drag & drop přesun, klik = prodej/detail) a spotřebek (x/2). Uprostřed stůl se zahranými kartami a animací skórování, dole ruka hráče (výběr klikem, max 5), tlačítka **Zahrát** / **Zahodit**, třídění podle hodnoty/barvy. Vpravo dole balíček (zbývá/celkem) s náhledem zbylých karet.
- **Výběr útraty**: tři karty (malá / velká / šéf) s cílem, odměnou a tlačítkem Přeskočit (ukáže štítek).
- **Večerka**, **výběr z boosteru**, **konec kola** (rozpis odměn s animací), **konec runu** („pitva“ — statistiky + hláška podle příčiny), **výhra** (titulky), **Nekonečný režim**.
- **Nastavení**: hlasitost SFX/hudba, rychlost hry 1×–4×, animace zap/vyp, screen shake, celá obrazovka, barvoslepý režim (4barevný balíček), velikost UI, klávesové zkratky, export/import uložení, reset profilu (s potvrzením).
- **Klávesy**: 1–8 výběr karty, Enter zahrát, X zahodit, S/B třídění, Esc menu, mezerník přeskočit animaci.
- **Tutoriál**: první run provází „Štamgast“ krátkými bublinami; jde přeskočit a kdykoli znovu zapnout.

## 5. Humor a obsah (český, původní)

- Tón: laskavá, suchá satira všedního Česka + historie + internet. Pointa, ne vulgarita (občasné „sakra“ je v pořádku). **Žádná jména žijících reálných osob ani skutečných značek** — používej archetypy: „Pan starosta“, „Influencerka Nikča“, „Zahrádkář Venca“, „Teta z poradny“, „Večerka“, „Diskont“.
- Každý žolík / šéf / kupón / pranostika / štítek má: **název** (max 3 slova), **mechaniku** (jedna věta, přesná, s čísly), **flavor** (jedna hláška, vtipná). Pracuj s reáliemi: pranostiky, lidová moudra, úřední čeština, hospodské fráze, panelák, chataření, Pendolino, kontrola z finančáku, zabijačka, Silvestr, pouť, výluka, inventura, soused s vrtačkou, Hradec vs. Brno, Žižka, Švejk, Golem, Bílá hora, normalizace, memy.
- Příklady tónu (jen inspirace, vymysli vlastní):
  - **Hospodský** — +3 mult za každou zahranou ♥. *„Srdce má na pravém místě, ale na sekeru nenaleje.“*
  - **Zahrádkář Venca** — Na konci kola +1 Kč za každou nezahranou kartu v ruce. *„Nic se nevyhazuje, všechno se kompostuje.“*
  - **Pendolino** — ×1,5 mult, ale 1 z 6 efekt „nabere zpoždění“ a nenastane. *„Omlouváme se za komplikace.“*
  - **Golem** — Kamenné karty dávají +40 čipů navíc. *„Šém mu vložil rabín, ne IT oddělení.“*
  - **Švejk** — Po ruce pod 10 % cíle získáš +1 zahození. *„Poslušně hlásím, že to bylo úplně náhodou.“*
  - Šéf **Kontrola z finančáku** — každá zahraná ruka stojí 1 Kč. Šéf **Výluka na trati** — polovina ruky je zakrytá. Šéf **Inventura** — figury jsou debuffnuté. Šéf **Soused s vrtačkou** — nejde opakovat kombinaci.
  - Pranostika **Medardova kápě** — Barva +1 úroveň. *„Čtyřicet dní kape, čtyřicet čipů kape.“*
  - Achievement **Pět piv a jdu domů** — vyhraj run na Ležáku. Achievement **Na sekeru** — dokonči kolo se záporným zůstatkem.
- Konec runu = „pitva“ s hláškou podle příčiny (prohra na „Kontrole z finančáku“: *„Doklady k tomu nemáte, že?“*).
- Vtip všude, kde se dá: loading tipy, názvy tlačítek, prázdné stavy, titulky, chybové hlášky („Něco se pokazilo. Jako u Vaňků o Vánocích.“).

## 6. Čeština (technicky)

- Všechny texty v `src/i18n/cs.ts` pod klíči; nikde natvrdo v UI ani v enginu. Diakritika správně všude. Typografie: „české uvozovky“, nezlomitelné mezery u jednopísmenných předložek a v číslech (`1 340 000`, `5 Kč`), desetinná čárka (`×1,5`).
- Skloňování: helper `plural(n, 'karta', 'karty', 'karet')` (1 / 2–4 / 0 a 5+) a používej ho všude, kde se číslo pojí se slovem (ruce, zahození, koruny, kola, žolíci).
- Fonty: zvolený font **musí obsahovat české znaky** (ěščřžýáíéúůďťňó + velké) — pixelové fonty je často nemají. Např. „Pixelify Sans“ (Google Fonts, OFL) nebo nepixelový fallback. Otestuj vykreslení věty „Příliš žluťoučký kůň úpěl ďábelské ódy“ a dej ji do e2e testu.
- Figury pojmenuj konzistentně (rozhodni: Kluk/Dáma/Král nebo Spodek/Svršek/Král — zapiš do DECISIONS).

## 7. Obrázky, fonty, zvuk — jen volně licencované, nikdy z Balatra

- Napiš `scripts/fetch-assets.ts` (`npm run fetch-assets`): stáhne assety z ověřených zdrojů do `src/assets/` a vygeneruje `ASSETS.md` (soubor, URL zdroje, autor, licence, úprava). Stažené soubory **commituj**, build nesmí záviset na síti.
- **Povolené zdroje**: Kenney.nl (CC0: Playing Cards Pack, Boardgame Pack, UI packs, částice), OpenGameArt.org (jen CC0 / CC-BY, atribuce do ASSETS.md i do Titulků), game-icons.net (CC BY 3.0, atribuce povinná), Wikimedia Commons (jen Public Domain / CC0 — např. ilustrace Mikoláše Alše nebo Alfonse Muchy; **ne Josef Lada**, jeho díla jsou chráněná do konce roku 2027), Google Fonts (OFL), freesound.org (jen CC0).
- **Zakázané**: obrázky z vyhledávačů, Pinterest, ArtStation, fanouškovské wiki, Steam, cokoli bez jasné licence, cokoli z Balatra.
- Obrázky žolíků (100+): skládej je **procedurálně** z CC0 částí (tělo / klobouk / rekvizita / pozadí / paleta) nebo generuj vlastní SVG s jednotným stylem; každý žolík musí být na první pohled rozpoznatelný. Když zdroj nejde stáhnout, SVG placeholder s názvem a ikonou — hra musí jít hrát i offline a bez stažených assetů.
- Hrací karty: vlastní SVG tváře ve dvou stylech (klasický, 4barevný pro barvoslepé); figury stylizuj česky.
- SFX: syntetizuj (klik, výběr karty, zamíchání, bodové „tik tik tik“ při načítání skóre, velké skóre, zaplacení, prodej, zahození, příchod šéfa, výhra, prohra, odemčení). Hudba: procedurální chiptune smyčka nebo CC0 skladby (atribuce). Hudba se v menu a ve hře liší; při šéfovi tempo nahoru.

## 8. Kvalita, balanc, testy

- `scripts/simulate.ts` (`npm run simulate -- --runs 500 --stake 1`): bezhlavý bot odehraje N runů s několika jednoduchými strategiemi (max. kombinace, honba za barvou, dvojice + žolíci na dvojice). Výstup: % výher podle patra, průměrné skóre, nejčastější příčina prohry, nejsilnější žolíci. Používej ho k ladění cílů, cen a čísel žolíků. Cíl: na Desítce vyhraje rozumná strategie ~25–35 % runů, na Imperialu < 3 %.
- Žádný žolík nesmí být zjevně bezcenný ani „auto-win“ — každá vzácnost má cílovou průměrnou hodnotu v tabulce v `docs/DESIGN.md`.
- Testy: každá kombinace včetně hraničních případů (A-2-3-4-5, dvě dvojice v 5 kartách, barevný full house, pětice s divokými kartami), pořadí vyhodnocení, každý žolík aspoň 1 test, save/load roundtrip, migrace, RNG determinismus (stejný seed = identický run), simulace jako smoke test.
- Konzole bez chyb a varování. Lighthouse: výkon a přístupnost > 90 na herní obrazovce.

## 9. Fáze (v tomto pořadí; každou ukonči commitem + zápisem do ROADMAP.md)

0. **Založení**: Vite/TS/ESLint/Prettier/Vitest/Playwright/CI, struktura, `docs/ARCHITECTURE.md`, `docs/DESIGN.md` (kompletní herní design včetně tabulek čísel: cíle, ceny, čipy/mult kombinací), `ROADMAP.md` se seznamem všech fází a podúkolů, **název hry** (navrhni 5 vtipných českých, vyber 1, zdůvodni, nahraď pracovní název), skelet `fetch-assets`.
1. **Engine jádra**: karty, balíček, míchání se seedem, detekce všech kombinací, skórování, úrovně kombinací, testy.
2. **Run loop v enginu**: patra, útraty, ruce/zahození, peníze, konec/výhra, event bus, save/load. Textový headless režim (`npm run simulate`) hratelný bez UI.
3. **Herní UI v1**: rozvržení dle kap. 4, výběr karet (myš/klávesy/dotyk), Zahrát/Zahodit, živé čipy × mult, animace skórování, levý panel, výběr útraty, konec kola a runu. Hratelné bez žolíků. **Tady napiš uživateli, jak hru spustí.**
4. **Žolíci v1 + Večerka**: systém efektů/hooků, 30 žolíků, obchod, peníze, úrok, prodej, přehození, drag & drop žolíků, Info o runu.
5. **Spotřebky, boostery, kupóny, úpravy karet**: 3 typy spotřebek (min. 13 pranostik = jedna na každou kombinaci, 22 babských rad, 16 razítek), vylepšení/pečetě/edice, 5 druhů boosterů, 24 kupónů.
6. **Šéfové a štítky**: 25 + 5 šéfů, přeskakování, 20 štítků, finální šéfové, hlášky.
7. **Obsah naplno**: žolíci na 100+ (včetně 6+ legendárních), 12 balíčků, 8 obtížností, tajné kombinace, nekonečný režim.
8. **Meta**: profil, odemykání, sbírka, 60+ achievementů, statistiky, 20 výzev, denní run, seed, historie, export/import, tutoriál.
9. **Šťáva a zvuk**: částice, screen shake, tilt a hover karet, počítadlo skóre, přechody obrazovek, SFX, hudba, nastavení, barvoslepý režim, rychlost hry.
10. **Dokončení 1.0**: balanc simulací, bugfix, výkon, README (česky, se screenshoty a GIFem), deploy na GitHub Pages, tag `v1.0.0`. Poté pokračuj **obsahovými patchi** (nové žolíky, šéfy, výzvy, balíčky) a nápady sepisuj do `docs/IDEAS.md`.

## 10. Definice hotovo (v1.0)

Hra jde dohrát od menu po výhru na všech balíčcích; obsahuje minimální počty obsahu z kap. 3; vše česky, bez pravopisných chyb a bez natvrdo zapsaných textů; běží z GitHub Pages i offline; bez chyb v konzoli; testy a e2e zelené; `ASSETS.md` kompletní s licencemi; žádný převzatý chráněný obsah; `ROADMAP.md` a `docs/` odpovídají skutečnosti.
