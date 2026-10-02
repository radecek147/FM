# Rozhodnutí — Karban

> Deník rozhodnutí. Každý záznam: datum, co, proč. Rozhodnutí se nepřepisují — když se něco změní,
> přidej nový záznam, který na starý odkáže („Nahrazuje záznam z …“). Nejnovější záznamy na konec.

## 2026-10-01 — Název hry: „Karban“

**Co:** Hra se jmenuje **Karban**, podtitul **„Hospodský roguelike s žolíky“**. Nahrazuje pracovní
název „Žolíkárna“ (v `CLAUDE.md`, `package.json`, dokumentaci, klíčích ukládání `karban.*` a v UI).

Zvažovaných pět kandidátů:

1. **Karban** — staré české slovo pro hraní karet o peníze (karbanit, karbaník).
2. **Na sekeru** — hospodský idiom pro pití na dluh; vtipné, ale hodí se spíš na achievement nebo
   balíček „Dlužník“ a mimo Česko nic neříká ani v překladu.
3. **Štamgast** — pravidelný host hospody; v zadání už je to jméno průvodce tutoriálem, kolidovalo by to.
4. **Full house na Žižkově** — nejvtipnější, ale dlouhé, míchá angličtinu a váže hru na jedno místo.
5. **Poslední štych** — karetní termín z mariáše; pěkný, ale ve hře se štychy vůbec nehrají, takže by
   sliboval jinou hru.

**Proč:** „Karban“ je autentické české slovo přesně pro to, o čem hra je — hraní karet o peníze. Je
krátké (6 písmen, bez diakritiky → bezproblémové v URL, souborech, `localStorage` klíčích i v logu),
dobře se pamatuje, nese hospodský humor i téma roguelike o penězích a neodkazuje na žádnou značku ani
jinou hru. Podtitul doplňuje žánr a tón pro hráče, kteří slovo neznají.

## 2026-10-01 — Figury, indexy a barvy karet

**Co:** Figury jsou **Kluk, Dáma, Král, Eso**; v rohových indexech karet **J, Q, K, A**. Barvy:
**piky ♠, srdce ♥, káry ♦, kříže ♣**. V běžném textu se figury i barvy píšou malými písmeny
(„za každého krále“, „srdcová karta“).

**Proč:** Hrajeme s francouzskými kartami (52 listů, pokerové kombinace), ke kterým patří Kluk/Dáma/Král.
Mariášové Spodek/Svršek patří k německým kartám (srdce, kule, zelené, žaludy) a mátly by v kombinaci
s ♠ ♥ ♦ ♣. Indexy J/Q/K/A jsou mezinárodně čitelné, odpovídají tomu, co hráči znají z pokeru,
a nekolidují (české K/D/K by mělo dvakrát „K“).

## 2026-10-01 — Oslovení hráče: tykání

**Co:** Hra hráči **tyká** ve všech textech: „Zahraj“, „Zahoď“, „Dosáhni aspoň …“, „Nemáš dost peněz.“

**Proč:** Hravý hospodský tón — u karbanu v hospodě si nikdo nevyká. Vykání si necháváme jako vtipný
kontrast pro postavy, které ho přirozeně používají (úřednice, revizor, šéf „Kontrola z finančáku“).

## 2026-10-01 — Technologie

**Co:** Vite + TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` → `import type`),
ESM, Node 20+, npm. Rendering **HTML DOM + CSS** (transformy, keyframes, CSS proměnné) + jeden
`<canvas>` overlay na částice. **Bez frameworku** — vlastní helper `h()`. Testy Vitest (unit) +
Playwright (e2e, Chromium), ESLint 9 + typescript-eslint + Prettier, CI v GitHub Actions, hosting na
GitHub Pages. Ukládání do `localStorage` (`karban.profile`, `karban.run`) s verzovaným formátem a migracemi.

**Proč:** Text s diakritikou se v DOM vykresluje správně a přístupně, ladí se v devtools a iteruje se
rychle. Hra nepotřebuje virtuální DOM — stav drží engine a UI jen překresluje podle událostí. Vite a
Vitest sdílejí konfiguraci, Playwright pokryje smoke test celé hry.

## 2026-10-01 — Architektura vrstev: UI / engine / obsah (DI)

**Co:** Tři vrstvy (detail v `docs/ARCHITECTURE.md`):

- `src/engine/**` — čistý TypeScript **bez DOM**, deterministický, řízený akcemi (`dispatch`) a
  událostmi (`EventBus`). Stav `RunState` je čistě JSON-serializovatelný.
- `src/content/**` — **data** (žolíci, šéfové, spotřebky…) jako objekty typů z
  `src/engine/content-types.ts` s hooky. Engine je dostává přes `ContentRegistry`
  (**dependency injection**), nikdy je neimportuje přímo.
- `src/ui/**` — DOM renderer; čte jen snapshot stavu, mění ho jen akcemi.
- Texty jsou výhradně v `src/i18n`; engine emituje jen klíče a čísla.

Hranice hlídá ESLint (`no-restricted-globals`, `no-restricted-imports` pro `src/engine/**`).

**Proč:** Engine jde testovat s malým testovacím obsahem, simulace běží headless v Node, UI nemůže
omylem rozbít pravidla a přidání obsahu je „jeden objekt + texty + test“ bez zásahu do enginu.

## 2026-10-01 — RNG: xoshiro128\*\* + cyrb128, oddělené streamy

**Co:** Veškerá náhoda jde přes seedovaný **xoshiro128\*\***, seedovaný hashem **cyrb128**
(`src/engine/rng/rng.ts`). Každý účel má vlastní stream (`deck`, `shop`, `booster`, `boss`, `tag`,
`joker`, `card`, `consumable`, `misc`) seedovaný `seed + ':' + stream`. Stav streamů je součástí
`RunState` (ukládá se). Obsah smí náhodu brát jen z `ctx.rng` / `ctx.chance()`. Denní run má seed
`DEN-YYYYMMDD` (UTC). `Math.random()` je v enginu zakázaný.

**Proč:** Stejný seed + stejné akce = identický run (seedované a denní runy, reprodukovatelné bugy,
deterministická simulace). Oddělené streamy zajistí, že např. přehození Večerky nezmění pořadí karet
v balíčku — seed tak zůstává „férový“ i při jiném chování hráče v obchodě.

## 2026-10-01 — Assety a síťová omezení

**Co:** Ze sandboxu jsou **zablokované** (proxy 403) kenney.nl, opengameart.org, game-icons.net,
wikimedia, freesound a fonts.google.com. Funguje `registry.npmjs.org` a `raw.githubusercontent.com`.
Proto:

- **Font:** Pixelify Sans z npm balíčku `@fontsource/pixelify-sans` (SIL OFL 1.1, podmnožina
  latin-ext obsahuje české znaky).
- **Ikony:** z npm balíčku `@iconify-json/game-icons` (game-icons.net, **CC BY 3.0** — atribuce
  autorů z metadat je povinná v `ASSETS.md` i v Titulcích).
- **Hrací karty, obrázky žolíků a ostatní grafika:** vlastní **procedurální SVG** (`ArtSpec`: ikona +
  paleta + vzor).
- **Zvuk:** SFX i hudba **syntetizované ve Web Audio** (žádné soubory).
- Vše zaznamenává `ASSETS.md` (soubor, zdroj, autor, licence, úprava), který generuje
  `npm run fetch-assets`. Stažené/extrahované soubory se commitují — build nesmí záviset na síti.

**Proč:** Zadání vyžaduje jen volně licencované assety a hru hratelnou offline. npm balíčky jsou
dostupné, verzované a mají jasnou licenci; procedurální grafika a syntéza zvuku odstraňují závislost
na nedostupných zdrojích a dávají jednotný styl.

## 2026-10-01 — Formátování čísel: vlastní implementace

**Co:** Čísla formátuje vlastní kód v `src/i18n/format.ts`, **ne `Intl`**. Pravidla:

- oddělovač tisíců = **NBSP** (U+00A0): `1 340 000`,
- **desetinná čárka**: `1,5`,
- násobek: `×1,5` (znak `×` U+00D7),
- peníze: `5 Kč` (NBSP mezi číslem a „Kč“),
- nad **1e15** vědecký zápis s desetinnou čárkou: `1,23e16`.
- Skloňování přes `plural(n, 'karta', 'karty', 'karet')` (1 / 2–4 / 0 a 5+).

**Proč:** `Intl.NumberFormat` se liší mezi prohlížeči, verzemi Node a ICU daty (např. úzká vs. běžná
nezlomitelná mezera), což by rozbíjelo testy, snapshoty a determinismus simulace. Vlastní implementace
dává všude stejný výstup.

## 2026-10-01 — Struktura textů (i18n)

**Co:** Vstupní bod je `src/i18n/cs.ts` — exportuje objekt `cs` a funkci `t(key, params)`. Smí skládat
podmoduly `src/i18n/cs/*.ts` (např. `jokers.ts`, `bosses.ts`, `ui.ts`). Klíče odvozené z id obsahu:
`jokers.<id>.name|desc|flavor`, `bosses.<id>.name|rule|intro|defeat|death`, `consumables.<id>.…`,
`vouchers.<id>.…`, `tags.<id>.…`, `decks.<id>.…`, `stakes.<id>.…`, `challenges.<id>.…`,
`hands.<type>.name|desc` (viz hlavička `src/engine/content-types.ts`). Popisky smí obsahovat
`{param}`. **Nikde natvrdo** text v UI ani v enginu.

**Proč:** Jedno místo pro korekturu a konzistenci, test může ověřit, že každá položka obsahu má texty
a dodržuje typografii. Podmoduly drží soubory čitelné i při stovkách položek.

## 2026-10-01 — Časování edic žolíků

**Co:** Edice žolíka se aplikují v kroku „žolíci po zahrání ruky“ takto: **lesklá (+čipy)** a
**holografická (+mult)** **před** vlastním efektem žolíka, **duhová (×mult)** **po** něm.
Negativní edice dává +1 slot a do skóre nevstupuje. V datech je to `EditionDef.jokerTiming:
'before' | 'after'`.

**Proč:** Sčítací bonusy mají smysl přičíst dřív a násobicí až nakonec — hráč pak duhovou edici vnímá
jako „násobení celého žolíka“, což je intuitivní a předvídatelné. Pořadí je pevné a otestované.

## 2026-10-01 — Jazyk commitů a kódu

**Co:** Commity **anglicky** podle **Conventional Commits** (`feat:`, `fix:`, `content:`, `test:`,
`docs:`, `chore:`, `refactor:`). Kód, soubory a identifikátory anglicky; komentáře mohou být česky;
veškerý text pro hráče česky.

**Proč:** Konzistentní historie, kterou zvládnou běžné nástroje (changelog, semver), a oddělení
„kód = angličtina, hra = čeština“ je jednoduché pravidlo, které se nedá splést.

## 2026-10-01 — Vlastní čísla, laděná simulací

**Co:** Všechna herní čísla (čipy a mult kombinací, přírůstky úrovní, křivka cílů, odměny, ceny,
síla žolíků, šance) jsou **vlastní**. Nepřebíráme žádné názvy, texty, čísla ani obrázky z Balatra ani
jiné komerční hry. Výchozí hodnoty jsou v `src/content/*` a tabulkách `docs/DESIGN.md`; ladí se
**simulací** (`npm run simulate`) s cílem ~25–35 % výher rozumné strategie na Desítce a < 3 % na
Imperialu. Každá změna čísel se zapíše do `docs/DESIGN.md`, větší změny i sem.

**Proč:** Hra má být vlastní dílo — inspirace mechanikami je v pořádku, kopie ne. Simulace dává
měřitelný a opakovatelný základ pro balanc místo pocitu.

## 2026-10-01 — Herní design v1 a odstranění shod s Balatrem

**Co:** `docs/DESIGN.md` je závazný herní design (pravidla, tabulky čísel, veškerý obsah s minimálními počty,
meta, balanc, UX v kap. 13). Čísla, která se ve výchozím návrhu přesně shodovala s Balatrem, jsou nahrazena
vlastními (seznam v příloze A). Při revizi fáze 0 přibyly: **obálky** (boostery) mají vlastní počty možností
(3/4/6, u razítek a žolíků 2/3/5) i váhy v obchodě, váha razítka „Výjimka z vyhlášky“ v obálce je 0,25. Zůstávají
jen hodnoty, které výslovně určuje `CLAUDE.md` (4 ruce, 3 zahození, 8 karet, odměny 3/4/5 Kč, úrok, edice…).
Nálepky obtížností se jmenují **přibitý / zvětrávající / zapůjčený**, boostery ve hře **obálky**
(„Obálka“, „Tlustá obálka“, „Krabice od bot“).

**Proč:** Zadání zakazuje převzatá čísla; vlastní tabulky se stejnou křivkou síly dávají stejnou hratelnost.
Česká jména nálepek a obálek sedí na hospodsko-úřední tón hry a nepřekládají cizí termíny.

## 2026-10-01 — Čtvrtý typ spotřebky: ne (v 1.0)

**Co:** Ve verzi 1.0 jsou jen tři typy spotřebek (pranostiky, babské rady, úřední razítka). Nápad na čtvrtý typ
(„Stírací losy“) je v `docs/IDEAS.md`. Detail a důvody: `docs/DESIGN.md` kap. 5.5.

**Proč:** Tři typy pokrývají tři osy hry (kombinace, hrací karty, riziko/pravidla); čtvrtý by ředil nabídku
Večerky a překrýval se s existujícími.

## 2026-10-01 — Identifikátory obsahu anglicky, spotřebky ve třech souborech

**Co:** `id` položek obsahu jsou anglické `snake_case` (`beer_mat`, `tax_audit`), vlastní jména a česká slova bez
překladu v ASCII přepisu (`svejk`, `desitka`, `marias`). Spotřebky se definují v `src/content/pranostiky.ts`,
`rady.ts` a `razitka.ts` (struktura z `CLAUDE.md` kap. 2); `src/content/consumables.ts` je jen spojí pro registr.

**Proč:** `CLAUDE.md` kap. 1 chce identifikátory anglicky a `docs/DESIGN.md` už anglická id používá; jeden styl
zabrání duplicitám typu `kronikar` × `chronicler`. Tři soubory drží přehlednost při 51 spotřebkách.

## 2026-10-01 — Typografie a oslovení: krátká pomlčka, rodově neutrální tykání, „se žolíky“

**Co:**

- Ve hře se jako větná pomlčka používá **krátká pomlčka `–`** s nezlomitelnou mezerou před ní (doplní `typo()`);
  dlouhá `—` se v textech hry nepoužívá (hlídá test). Dokumentace ji používat smí.
- Tykání je **rodově neutrální** — žádné „jsi zahrál“, „kdybys dupal“, „jsi hrdý“; rozkazovací způsob,
  přítomný/budoucí čas nebo neosobní tvar. (Doplňuje záznam „Oslovení hráče: tykání“.)
- Pravopisná oprava podtitulu: **„Hospodský roguelike se žolíky“** (předložka se před „ž“ vokalizuje). Doplňuje
  záznam „Název hry: Karban“ — význam podtitulu se nemění.

**Proč:** Česká sazba používá krátkou pomlčku; hráč může být kdokoli; „s žolíky“ je pravopisná chyba.

## 2026-10-01 — Texty v `index.html` z i18n

**Co:** `index.html` neobsahuje texty natvrdo — titulek, meta popis a `<noscript>` jsou zástupné symboly
`{{t:klíč}}`, které při buildu i v dev serveru dosadí plugin `karban-i18n-html` ve `vite.config.ts` z
`src/i18n/cs.ts` (načítá ho přes `runnerImport`, neznámý klíč shodí build). Test hlídá, že klíče existují.

**Proč:** Pravidlo „žádné texty natvrdo“ platí i pro statické HTML, které se zobrazí dřív, než naběhne JavaScript
(a `<noscript>` jindy ani zobrazit nejde).

## 2026-10-01 — Detekce kombinací: varianty, nejvýš 5 karet, upřesnění hraničních případů

**Co:** Detekce (`src/engine/hands/detect.ts`) projde všechny podmnožiny zahraných karet s hodnotou o 1–5
kartách, u každé určí, kterými kombinacemi „přesně je“, a vybere nejlepší variantu podle `docs/DESIGN.md`
2.2.2 (typ → počet skórujících karet → součet čipů → víc vlevo). Upřesnění míst, která DESIGN neřeší výslovně:

- **Kombinace má nejvýš 5 karet** i při `maxSelect` > 5. Další karty jsou kopy (šestá karta Barvy, šestá
  stejné hodnoty, třetí dvojice…). Kamenné karty skórují vždy navíc.
- **Součet čipů** pro výběr varianty = `cardChips` bez modifikátorů (hodnota + `bonusChips`). Debuff ani
  Normalizace (`fixedCardChips`) výběr nemění. U Vysoké karty rozhoduje hodnota (K > Q, i když mají stejně čipů).
- **Postupka s duplicitní hodnotou** (např. 5-6-7-8-8 s `fourCardStraightFlush`): skóruje jen jedna karta
  každé hodnoty, podle čipů, pak ta víc vlevo. Dřív skórovaly obě osmičky.
- **Postupka v barvě** = Postupka, jejíž karty mají všechny jednu barvu. Postupka a Barva složené z různých
  karet nestačí. Dřív se Postupka v barvě uznala, kdykoli byla v ruce zvlášť Postupka a zvlášť Barva
  (se 4 kartami např. 5♥ 6♥ 7♥ 2♥ 8♠). Skórují jen karty postupky. Pátá karta stejné barvy mimo postupku
  (5♥ 6♥ 7♥ 8♥ + 2♥) je kop.
- **Královská postupka** = Postupka v barvě bez přetočení „kolem dokola“, jejíž nejvyšší karta je vysoké Eso.
  Se `straightGaps` je proto Královská i 9-J-Q-K-A v jedné barvě (doslovné znění DESIGN 2.2.2). Dřív musely být
  všechny karty 10–A.
- **`contains`** = vyhodnocená kombinace + každá kombinace, kterou tvoří některá podmnožina zahraných karet.
  U běžných 5 karet to přesně odpovídá tabulce DESIGN 2.2.3. Navíc se objeví jen to, co v kartách opravdu je
  (např. Dvojice v Postupce 5-6-7-8-8 se 4 kartami, Barva vedle Full housu ze 7 karet). **Vysoká karta** je
  v `contains` jen tehdy, když je vyhodnocenou kombinací. Dřív tam byla vždy, což odporovalo DESIGN 2.2.3.

**Proč:** Jedno obecné pravidlo místo zvláštních větví pro každý případ. Detekce je deterministická,
odpovídá textu DESIGN 2.2.2 („skórující karta = součást vyhodnocené kombinace“, „5 karet“) a stačí na libovolný
`maxSelect` (12 karet ≈ 0,7 ms). Pokrývají ji testy `tests/unit/detect.test.ts`.

## 2026-10-01 — Konstanty enginu v `src/engine/constants.ts`

**Co:** Čísla z `docs/DESIGN.md` kap. 2.10 (a další pevná čísla pravidel z kap. 2.4–2.9 a 4.6) žijí v jediném
souboru `src/engine/constants.ts`: `STARTING_MONEY`, `BLIND_REWARDS`, `BLIND_TARGET_MULT`, `FINAL_ANTE`,
`RARITY_WEIGHTS`, `PERISH_ROUNDS`, `RENTAL_BUY_PRICE`, `RENTAL_FEE`, `RENTAL_SELL_PRICE`, `MAX_ACTIVATIONS_PER_CARD`,
`SEED_ALPHABET`/`SEED_LENGTH`, ceny hracích karet, šance karetní obálky, `FALLBACK_JOKER_ID` a i18n klíče hlášek
`MSG`. `BASE_MODIFIERS` zůstává v `effects/modifiers.ts`. Staré exporty (`BLIND_REWARDS`/`FINAL_ANTE` z `run/game.ts`,
`STARTING_MONEY` z `run/init.ts`, `RARITY_WEIGHTS` ze `shop/pool.ts`, `BLIND_TARGET_MULT` z `run/targets.ts`) jsou
re-exporty. Výchozí cena přelosování šéfa (`BOSS_REROLL_COST`) je 0 — v 1.0 ho povoluje jen Známý na úřadě zdarma.

**Proč:** Jedno místo pro čísla pravidel = žádné rozjeté kopie; test `modifiers.test.ts` hlídá shodu s tabulkou.

## 2026-10-01 — Ceny ve Večerce a prodej (`src/engine/shop/prices.ts`)

**Co:** Přesně podle DESIGN 2.5.2: `max(1, round((základ + příplatky) × (100 − sleva) / 100)) + shopPriceAdd`,
round = polovina nahoru (počítá se v celých číslech, bez chyb doublu). Upřesnění:

- **Zdarma** je položka s příznakem `free` (štítky, efekty) nebo se základem ≤ 0 — cena 0 i při `shopPriceAdd`.
- **Zapůjčený žolík**: `RENTAL_BUY_PRICE` (2 Kč) nahrazuje základ, sleva a `shopPriceAdd` se pak uplatní jako
  u čehokoli jiného („ve Večerce stojí všechno o 1 Kč víc“).
- **Přehození** = `rerollBaseCost + rerollCostStep × placená přehození + shopPriceAdd`; bezplatné přehození cenu
  nezvedá a `ShopState.rerollCost` ukazuje 0, dokud nějaké zbývá.
- Ceny všech neprodaných položek se **přepočítají po každé úspěšné akci** ve Večerce (koupě kupónu se slevou platí
  hned, i na už vystavené zboží).
- **Prodej**: žolík `max(1, floor((cena + edice) / 2)) + sellBonus`, zapůjčený 1 Kč, přibitý nejde; spotřebka
  `max(1, floor((cena + edice) / 2))`.

**Proč:** DESIGN dává vzorec; zbylé body jsou okraje, které musí být deterministické a stejné pro UI i simulaci.

## 2026-10-01 — Edice: šance pro žolíky a karty, negativní zvlášť

**Co:** `EditionDef.weight` = šance v % u žolíka, nové `weightCard` = šance v % u hrací karty (0 = nikdy),
`separateRoll` = samostatný hod před ostatními, jen u žolíků, bez `editionRateMult` (negativní). Zbylé edice
jedním hodem `r` proti kumulativním šancím **od nejvzácnější** (duhová → holografická → lesklá; řazeno podle šance).
Pole `forCards` zaniklo (nahradil ho `weightCard`).

**Proč:** DESIGN 2.6 má pro karty jiné šance a negativní edici vyjímá z násobiče; řazení podle šance odpovídá
pořadí v DESIGN a funguje i pro další edice bez zvláštního kódu.

## 2026-10-01 — Krok 5 skórování: `afterScored` až po šéfovi, Ohmataná karta

**Co:** `EnhancementDef.afterScored` se volá až po `BossHooks.afterHandPlayed` (funkce `afterScoredCards` ve
`scoring/score.ts`, volá ji run loop), **jednou za ruku** pro každou skórující nedebuffnutou kartu, a smí vrátit jen
zprávu, peníze a `destroyCard` (skóre už je dané). Ohmataná (`worn`) v něm přes `api.modifyCard` trvale přičte
+3 `bonusChips`. Nové `BossHooks.adjustHandScore` upraví skóre hned po `floor(čipy × mult)` (před `afterHandScored`),
výsledek se ořízne na konečné číslo ≥ 0. Strop opakování `MAX_ACTIVATIONS_PER_CARD` = 10 platí pro skórující
i držené karty.

**Proč:** Pořadí z DESIGN 3.1 krok 5. Dřív běžel `afterScored` uprostřed kroku 2, takže by Ohmataná ovlivnila
žolíky v kroku 4 téže ruky.

## 2026-10-01 — Bílá hora a Normalizace v enginu

**Co:** `Modifiers.disableEnhancements` → `GameCore.enhancements()` vrací prázdný registr a karta se chová, jako by
vylepšení neměla: žádné efekty (ani zlatá karta na konci kola), **kamenná má zase hodnotu a barvu**, divoká jen svou
barvu (detekce, čipy, barvy, figury, řazení). `Modifiers.fixedCardChips > 0` nahradí čipy hodnoty **i** `bonusChips`
každé karty, včetně kamenné (ta pak dá pevné čipy + svých +50 z vylepšení).

**Proč:** „Vylepšení nefungují“ nejčistěji znamená „karta bez vylepšení“; „každá skórující karta dává právě 5 čipů
(vylepšení a edice fungují)“ znamená, že pevné jsou jen vlastní čipy karty.

## 2026-10-01 — Klíče hlášek enginu v jednotném čísle

**Co:** Obecné hlášky mají jmenné prostory v jednotném čísle — `joker.saved`, `joker.perished`,
`joker.rentalReturned`, `boss.disabled`, `tag.saved` — a bubliny skórování `score.*`. Množné `jokers.<id>`,
`bosses.<id>`, `tags.<id>` patří obsahu podle id. Engine dřív emitoval `jokers.saved`; přejmenováno. Všechny klíče
jsou v `MSG` (`engine/constants.ts`), texty v `src/i18n/cs/messages.ts`, test hlídá úplnost.

**Proč:** `jokers.saved` by kolidoval se žolíkem s id `saved` a s budoucím `src/i18n/cs/jokers.ts`.

## 2026-10-01 — Nálepky, zapůjčení a zvětrávající žolíci

**Co:** Žolík má nejvýš jednu nálepku; hody v pořadí přibitý → zapůjčený → zvětrávající, každý vlastním hodem
(DESIGN 4.6), nálepku zakázanou v definici (`noEternal`/`noRental`/`noPerishable`) engine přeskočí bez hodu.
Poplatky za zapůjčené žolíky se v rozpisu odměn počítají **až nakonec** (krok 6), i za debuffnuté; poplatek, který by
zůstatek po výplatě dostal pod `−debtLimit`, se nestrhne (`rentalReturned:<id>`, 0 Kč) a žolík se při `cashOut` zničí.
Zvětralý žolík pošle `jokerTriggered` s `joker.perished`.

**Proč:** Dřív se losovalo přibitý/zvětrávající jedním hodem a zapůjčený nezávisle (mohl mít dvě nálepky)
a vracení do půjčovny chybělo.

## 2026-10-01 — Peníze: srážky jen do dluhového limitu, `setMoney` přesně

**Co:** `api.addMoney` se zápornou částkou strhne nejvýš do `−debtLimit` (pod limitem už nic). `api.setMoney(n)`
nastaví přesně `n` bez ořezu (Daňové přiznání si samo hlídá, že dluh zůstane). Nákupy se dál ověřují předem.

**Proč:** DESIGN 2.4.3 — „srážka od šéfa se provede jen do výše dluhového limitu“.

## 2026-10-01 — Záchrana prohraného kola a prohra z nedostatku karet

**Co:** Když kolo skončí pod cílem, ptají se nejdřív **štítky** (`TagHooks.onRoundLost`; záchrana = kolo vyhrané
**bez odměny za útratu**, štítek se spotřebuje), pak žolíci (`preventGameOver`, plná odměna). Prázdná ruka i prázdný
dobírací balíček po zahrání nebo zahození = prohra (DESIGN 1.2), se stejnou šancí na záchranu.

**Proč:** Štítek je jednorázový a hráč si ho pořídil právě na příští kolo — nemá zbytečně spálit žolíka. Odměnu
ruší jen štítek, protože to výslovně říká Lékařské potvrzení.

## 2026-10-01 — Imperial: šéf ve Velké útratě

**Co:** `StakeDef.bigBlindBoss` → při vstupu do patra se Velké útratě vylosuje `BlindSlot.bossId` (stream `boss`):
běžný šéf, `minAnte ≤ patro`, jiný než šéf patra a jen šéf, který má aspoň jeden hook (šéfové jen s vyšším cílem,
např. Šanon na šanonu, se tím vyloučí bez zvláštního příznaku). Do `bossesSeen` se nezapisuje. Cíl se počítá jako
u Velké (1,5×), odměna 4 Kč; prohra má jako příčinu id šéfa.

**Proč:** DESIGN kap. 10; odvození z hooků nevyžaduje další pole v `BossDef`.

## 2026-10-01 — Dočasné stavy kola: debuffy žolíků a velikost ruky

**Co:** `RoundState.jokerDebuffs` (uid) drží dočasné debuffy z `api.setJokerDebuffed` — platí do konce kola
**včetně výpočtu odměn**, ruší je `disableBoss` a konec kola; zvětralého žolíka zrušení neoživí.
`RoundState.handSizeDelta` drží `api.addRoundHandSize` (skládá se do `Modifiers.handSize`), zaniká s kolem.

**Proč:** Typovaná pole místo volných `flags` — engine je čte při skládání modifikátorů a úklidu kola.

## 2026-10-01 — Změna patra a přelosování šéfa

**Co:** `api.changeAnte(delta)` nejníž na patro 1 (DESIGN 6: „−1 patro (min. 1)“); rozehrané útraty patra pokračují
a šéf se přelosuje, jen když pro nové patro neplatí (finálový × běžný, `minAnte`). Větev `anteBase` pro patro < 1
zůstává jen jako pojistka. `api.rerollBoss()` přelosuje šéfa zdarma, jen dokud jeho kolo nezačalo.

**Proč:** Úřední škrt i Amnestie mají jen posunout číslo patra, ne zahodit nabídku patra.

## 2026-10-01 — Večerka a obálky: zaručená Žolíková obálka, Pivní tácek, hrací karty, váhy spotřebek

**Co:**

- První Večerka runu (`RunStats.shopsEntered === 0`) má v prvním slotu obálek normální Žolíkovou obálku (první
  podle id), pokud v registru je.
- Žolík v nabídce: jen nevlastněný a ne už nabízený; vyčerpaný pool → `beer_mat` (Pivní tácek), který se smí
  opakovat vždy (i vlastněný). Bez něj v registru zůstane slot prázdný.
- Hrací karty v obchodě a karetní obálce: hodnota a barva rovnoměrně z **výchozího složení** startovního balíčku —
  počítá se znovu stejným seedem streamu `deck` jako při založení runu, takže vyjde totéž složení i u náhodných
  balíčků. Šance vylepšení/pečeti: obchod z `Modifiers.playingCardEnhanceChance`/`SealChance` (20 % / 0 %),
  obálka konstanty 40 % / 15 %. Kartářka (`0,5` / `0,2` v DESIGN) se zapíše jako delta `+0,3` / `+0,2`.
- `ConsumableDef.weight` (výchozí 1) váží každé losování spotřebky (obchod, obálka, `createConsumable`) — Výjimka
  z vyhlášky 0,25.
- `pickBooster` má `keep?: boolean`: vybraná spotřebka se uloží do volného slotu místo použití.

**Proč:** DESIGN 2.5.1, 2.5.3 a 2.9.

## 2026-10-01 — Drobnosti z DESIGN kap. 2.1 a 2.2.4

**Co:** Karta lícem dolů se při zahrání otočí; náhled s takovou kartou vrací `hidden: true`. Debuffnutá karta
nespouští ani fialovou pečeť při zahození. `RunState.discoveredHands` zapisuje každou kombinaci při prvním zahrání
v runu (`handDiscovered` jen u tajných); pranostiky tajných kombinací se nabízejí až po objevu. `onAcquire` se volá
při koupi, výběru z obálky a `createJoker`, ne u startovních žolíků výzvy (Kamenolom má 64 karet i s Golemem).
Názvy pečetí obsahují slovo „pečeť“ (Zlatá pečeť × vylepšení Zlatá).

**Proč:** Přímo z textu DESIGN; názvy pečetí kvůli jednoznačnosti v UI.

## 2026-10-01 — Skórování: krok = jedna změna, pracovní příklad, kopírování, přetečení

**Co:**

- `ScoreStep` nese vždy **jednu** změnu (čipy, mult, ×mult nebo peníze, v tomto pořadí). Efekt `{ chips, mult }`
  dá dva kroky; zpráva efektu patří k jeho prvnímu kroku, efekt jen se zprávou dá krok bez změny. Dřív jeden efekt
  = jeden krok se všemi poli a průběžné hodnoty jen po celém efektu.
- DESIGN 3.2: pracovní příklad počítal Full house se základním multem 4, tabulka 2.2.1 (a `src/content/hands.ts`)
  má 5. Na úrovni 2 je tedy mult 7, výsledek `floor(218 × 236,25) = 51 502` (se „zpožděním“ 34 335) místo
  48 559 / 32 373. Opraven dokument, přesné pořadí kroků hlídá test.
- Kopírující žolík: při `isCopy` dostane hook cíle **kopii** instance (změny `self.state` a `sellBonus` se zahodí),
  takže počítadla cíle nenaroste dvakrát ani u hooku, který `isCopy` nekontroluje. V řetězu kopírujících žolíků
  dostane každý článek do `copyTarget` svou vlastní pozici (dřív pozici prvního, takže „kopíruj souseda vpravo“
  v řetězu nefungoval a v cyklu kopíroval špatného žolíka).
- Přetečení: skóre kola se ořízne na `Number.MAX_VALUE` (nekonečno by se v JSON uložení změnilo na `null`),
  NaN ve výsledku efektu se ignoruje (dřív vynuloval mult), nekonečné peníze také.
- `BossHooks.modifyBase` se ptá na aktivního šéfa až po `beforeScoring` — žolík, který šéfa vypne, už základ
  nezmenší. Žolík zničený během kroku 4 (efektem jiného žolíka) už neskóruje.
- Peníze z efektu ve skórování se do `ScoreStep.money` a `moneyEarned` zapíšou ve **skutečně připsané** výši
  (srážku ořízne dluhový limit).
- `api.disableBoss` (Odvolání) vrátí i ruce a zahození, které pravidlo šéfa ubralo (rozdíl modifikátorů; ruce
  nejníž 1, aby kolo neuvázlo). Dřív Odvolání na Polední pauze ruce nevrátilo.
- `JokerHooks.onSell`: prodávaný žolík dostane `isSelf = true` (dřív vždy `false`); `GameCore.eachJoker` umí
  `extra` jako funkci vlastníka slotu.
- `api.modifyCard` mění jen `suit`, `rank`, `enhancement`, `seal`, `edition`, `bonusChips` a ignoruje `undefined`.
  `TagHooks.passive` dostává `tagCtx` (stream `tag`) místo rozbaleného kontextu.
- Testovací obsah pro skórování a API je v `tests/unit/fixtures/registry.ts` (žolík/šéf/štítek na každý hook).

**Proč:** DESIGN 3.1 („každé jako samostatný ScoreStep s průběžnými hodnotami“) a 1.3 (přetečení), ARCHITECTURE 2.7
(kopírující žolíci); nalezeno testy fáze 1.

## 2026-10-01 — Revize správnosti enginu (fáze 1): debuffy z `round.flags`, pozice žolíka, `destroyCard`

**Co:** (testy v `tests/unit/review-correctness.test.ts`)

- **Debuffy karet od šéfa se přepočítávají průběžně.** Příloha B DESIGN ukládá dočasné debuffy (Černá kočka) do
  `round.flags` a `isCardDebuffed` je čte. Engine ale počítal `Card.debuffed` jen při líznutí, změně karty a vypnutí
  šéfa, takže prokletí karet, které už byly v ruce, nikdy neplatilo. Nově `refreshBossDebuffs` (`run/draw.ts`)
  přepočítá debuffy celého balíčku po `onRoundStart`, `onDiscard` a `onDraw` šéfa a po **každé** zahrané ruce (po
  `afterHandPlayed` a `afterScored`, aby zahrané karty dohrály ruku ve stavu, v jakém skórovaly) — jen když šéf má
  `isCardDebuffed`. Jiný zdroj debuffu hracích karet než šéf není.
- **`JokerCtx.index` je aktuální pozice.** `eachJoker` i krok 4 skórování předávaly pozici ze snímku na začátku
  průchodu; když hook zničil jiného žolíka (Sněhulák roztaje v `onRoundEnd`), kopírující „souseda“ za ním (Archivář)
  dostal starou pozici a kopíroval sám sebe nebo špatného žolíka.
- **`EffectResult.destroyCard` jen u skórující karty**, jak říká rozhraní: efekt držené karty (`onHeld`, `onCardHeld`)
  kartu v ruce nezničí (dřív zničil).
- `exactHandTypes` vrací pro podmnožinu s kamennou kartou prázdný seznam (kamenná karta nemá hodnotu, dřív ji
  počítalo podle `rank`).

Zvážené a ponechané: negativní edice dává slot i debuffnutému/zvětralému žolíkovi („nefunguje on ani jeho edice“
v DESIGN 4.6 se týká efektů ve skórování — bez slotu by žolíci přetekli sloty). Engine sleduje řetěz kopírujících
žolíků (ARCHITECTURE 2.7); DESIGN 4.4/7 („kopie kopie max. 1 úroveň“) zajistí obsah tím, že kopírující žolíci mají
`copyable: false`.

**Proč:** DESIGN příloha B, ARCHITECTURE 2.7 (pozice v řadě), rozhraní `EffectResult` a DESIGN 2.2.2 (kamenná karta).
Detekce i skórování (vylepšení, edice, pečetě, debuffy, ocelové karty v ruce, úrovně) byly navíc porovnány
s nezávislým referenčním výpočtem na 300 000 náhodných rukou, resp. 3 000 náhodných kolech — bez rozdílu.

## 2026-10-01 — Revize robustnosti enginu (fáze 1): determinismus, cache modifikátorů, okrajové stavy

**Co:** (testy v `tests/unit/review-robustness.test.ts`, každý před opravou selhal)

- **Řazení nezávislé na jazyce prostředí.** Losování spotřebek, edic a obálek řadilo id přes `localeCompare` bez
  locale — v prohlížeči s češtinou se „ch“ řadí až za „h“, takže stejný seed (i denní run) dal jiný obchod než jinde.
  Nově `compareIds` (kódové jednotky, jako `.sort()`) v `shop/pool.ts`; ESLint v enginu `localeCompare` zakazuje.
- **Dotazy nemění stav.** `passive` (skládání modifikátorů), náhled ruky (`modifyBase` šéfa) a `canUse` spotřebky běží
  v `GameCore.readOnly`: RNG v jejich kontextech pracuje na kopii streamu. Dřív `ctx.chance` v `passive` posunulo stav
  RNG při každém přepočtu cache — výsledek runu pak závisel na tom, jak často se UI ptá na náhled či modifikátory.
- **Cache modifikátorů.** `mods()` vrací zmrazený objekt (dřív šlo `api.modifiers().hands = 99` a pravidla se změnila
  do další invalidace; `EngineApi.modifiers()` je nově `Readonly`). Cache se zneplatní po **každém** hooku v
  `eachJoker`/`eachTag`/kroku 4 skórování, po `onAdded` štítku a po hookách šéfa `onRoundStart`, `afterHandPlayed`,
  `onDiscard`, `onDraw` a pečetích `onDiscarded` — dřív se po hooku, který změnil stav čtený `passive` (např.
  `round.flags` šéfa), dobírala ruka podle staré velikosti.
- **Výjimka z obsahu uprostřed akce** vrátí stav jako neplatná akce (rollback ze snímku) a letí dál; dřív zůstal stav
  napůl změněný (a autosave by ho uložil). Události se doručují až po dokončení akce.
- **Neplatná čísla z obsahu** (NaN, ±∞) se ignorují v deltách modifikátorů (`applyDelta`/`mergeDelta`, i přetečení
  výsledku), v `addHands`/`addDiscards`/`addRoundHandSize`/`changeAnte`/`levelUpHand` (desetinná čísla se useknou),
  v rozpisu odměn (`roundEndMoney`, `roundEndHeldMoney`, balíček) a v `modifyBase` šéfa (NaN = původní základ);
  peníze nepřetečou přes `Number.MAX_VALUE`. Dřív se dostaly do stavu (JSON je uloží jako `null`) — např. `hands: NaN`
  z `passive` dalo `handsLeft = NaN` a kolo nešlo prohrát.
- **Kolo neuvázne s prázdnou rukou.** Po každé akci (`dispatch`) se prázdná ruka dobere, a když ani pak nejsou karty,
  je to prohra z nedostatku karet (dřív se to kontrolovalo jen po zahrání a zahození): kolo s prázdným balíčkem nebo
  po spotřebce, která zničila celou ruku, dřív uvázlo bez jediné platné akce.
- **Starší uložení s odebraným obsahem:** žolík s neznámým id se chová jako prázdný (dřív `Unknown joker` při každé
  ruce), štítek za přeskočení s neznámým id se přeskočí, chybějící záznam `handLevels` se doplní při zahrání.
- **Rekurze hooků:** vnoření téhož hooku žolíků je omezené na `MAX_NESTED_HOOK_DEPTH` (3) — žolík „při přidání karty
  přidej kartu“ dřív přetekl zásobník.
- **Sdílené objekty:** `unlockedPool` se při založení runu kopíruje (změna profilu neměnila rozehraný run), výsledek
  `initState` se klonuje (stejný vrácený objekt dřív spojil stav všech instancí), události `roundRewards` a `gameOver`
  nesdílí objekty se stavem.
- Drobnosti: karta zničená během skórování nezůstane v hromádkách kola; `toResults` přeskočí prázdné položky pole
  (JS obsah); `Game.newRun` odmítne seed z mezer, nečíselná obtížnost = 1; `rewards.total` je konečné číslo.

Ověřené a ponechané: v enginu není `Math.random`/`Date.now` (ESLint); každé losování řadí id (pořadí registru výsledek
neovlivní); `RunState` neobsahuje funkce, `Set`/`Map` ani cykly (typy `JsonValue`); `BASE_MODIFIERS` je zmrazený
a skládání ho kopíruje; `extend()` gettery zachovává (průběžné čipy/mult); cyklus kopírujících žolíků končí
(`visited`); `passive` volající `mods()` dostane výchozí hodnoty (ochrana proti rekurzi, záměr). Kopírující žolík volá
hook cíle s `ctx.self` = kopie cíle — hook, který „zničí sám sebe“ (`destroyJoker(ctx.self.uid)`), musí kontrolovat
`isCopy`, jinak zničí originál (CONTENT-GUIDE).

**Proč:** CLAUDE.md (determinismus: stejný seed + stejné akce = stejný run, stav JSON-serializovatelný), DESIGN 1.2
(prohra z nedostatku karet), ARCHITECTURE 2.6–2.7.

## 2026-10-01 — Uzavření fáze 1: pokrytí blokuje CI, texty kombinací v podmodulu

**Co:**

- CI (`.github/workflows/ci.yml`) spouští unit testy jen jednou, přes `npm run test:coverage`, a krok je
  **blokující** (bez `continue-on-error`): prahy ve `vite.config.ts` (řádky/příkazy/funkce `src/engine` ≥ 80 %,
  větve ≥ 70 %) pod hranicí shodí build. Na konci fáze 1 je pokrytí `src/engine` 91 % řádků, 88 % příkazů,
  83 % větví, 94 % funkcí; jediný netestovaný modul je `save/save.ts` (testy save/load a migrací jsou ve fázi 2).
- Texty kombinací `hands.<type>.name|desc` se přesunuly z `src/i18n/cs.ts` do podmodulu `src/i18n/cs/hands.ts`
  (podle záznamu „Struktura textů (i18n)“ a ROADMAP); klíče se nemění.
- Explicitní testy unikátních id karet (`RunState.nextUid`, i po uložení přes JSON) a lízání do velikosti ruky
  (vršek balíčku = konec `drawPile`, doplnění po zahrání i zahození, dochází-li karty) v `tests/unit/draw.test.ts`.

**Proč:** ROADMAP fáze 1 („po dosažení 80 % pokrytí odstranit `continue-on-error`“), aby pokrytí enginu
nemohlo nepozorovaně klesnout.

## 2026-10-01 — Fáze 2: run loop a ukládání — opravy z testů, výkon kontextů hooků

**Co:** (testy `tests/unit/game.test.ts`, `save.test.ts`, `run-determinism.test.ts`, `hook-context.test.ts`; každý
bod před opravou selhal)

- **Zahození: karty opustí ruku před hooky** (otevřený bod z ROADMAP). Šéf `onDiscard` dřív viděl zahazované karty
  ještě v `round.hand` — nucené zahození (Tchyně na návštěvě, `api.discardFromHand`) mohlo vzít právě zahazovanou
  kartu a její id pak bylo na odhazovací hromádce dvakrát. Nově se karty přesunou na hromádku, zahození se započte
  (`discardsLeft`, statistiky) a pošle se `cardsDiscarded` ještě **před** hooky žolíků, pečetí a šéfa; obsah vidí
  v ruce jen zbylé karty a UI dostane hráčovo zahození před reakcemi (peníze žolíka, nucené zahození).
- **Malá a Velká mají různé štítky** (DESIGN 7). Dřív se losovaly nezávisle a mohly vyjít stejně; stejný štítek
  dostanou jen tehdy, když je v poolu jediný.
- **Úrok ze zůstatku v okamžiku výhry kola** (DESIGN 2.4.2) — zůstatek se zapamatuje před hooky `onRoundEnd`
  (štítky, žolíci); peníze, které tyto hooky připíšou, se do úroku dřív započítaly.
- **Rozpis odměn v celých korunách a v pořadí DESIGN:** nevyužité ruce/zahození i bonusy z obsahu se zaokrouhlují
  dolů (dřív jen odměna za útratu a úrok), bonusy jdou v pořadí zlaté karty → žolíci (`roundEndMoney`) → balíček →
  zapůjčení žolíci (dřív balíček před žolíky).
- **`shopRerolled.cost` = zaplacená cena** (0 u bezplatného přehození); dřív nesla cenu _dalšího_ přehození (ta je
  v `shop.rerollCost`), takže výpis „přehozeno za…“ i útrata za přehození v simulaci byly špatně.
- **Validace akcí:** neznámý typ akce vracel `ok: true` bez změny, vstup, který není pole (`cardIds`, `uids`,
  `targetIds`), shodil `dispatch` výjimkou — obojí je teď odmítnutá akce. `reorderHand`/`sortHand` jdou jen v kole
  a v obálce (dřív i po výhře kola), `sortHand` s neznámým řazením je chyba, `reorderJokers` nejde po konci runu.
- **Spotřebky:** `canUse` a `use` dostanou skutečnou instanci (dřív `canUse` vždy `edition: null`); `canUse` pracuje
  na kopii, takže ji nezmění.
- **Pool šéfů se obnovuje** (DESIGN 8.1 „když dojdou, pool se obnoví“): když jsou všichni šéfové poolu vidění,
  vyškrtnou se z `bossesSeen` a losuje se znovu bez opakování. Dřív se po vyčerpání losovalo z celého poolu pořád
  (šéf se mohl opakovat hned po sobě).
- **Ukládání:** verze v obálce musí být kladné celé číslo (dřív prošlo `NaN` a migrace se tiše přeskočily), po
  migracích se kontroluje tvar stavu (fáze, všech 9 RNG streamů po 4 číslech, pole, čísla) → `invalidFormat` místo
  pádu uprostřed hry; migrace, která nevrátí objekt, je `migrationFailed`; `deserializeRun` nemění vstupní objekt,
  doplní `version` na aktuální a umí vlastní tabulku migrací (`{ migrations, currentVersion }`) pro testy.
  `SaveError.name = 'SaveError'`.
- **Výkon skórování** (otevřený bod z ROADMAP): `extend()` kopíroval `ScoringInfo` (deskriptory, gettery) do kontextu
  každého hooku dvakrát — ~45 % času. Nově je `ScoringInfo` ruky **sdílená vrstva** (`GameCore.ctxLayer`, prototyp),
  kterou kontexty dědí; `state`/`mods`/`api` jsou gettery na společném prototypu, `extra` hooků se přiřadí hodnotami
  (`Object.assign`), `ctx.rng` vzniká líně (obal mutuje pole stavu na místě, takže posloupnost je stejná; v `readOnly`
  nad kopií) a `resolveCopy` u běžného žolíka nealokuje. Ruka s 8 žolíky: **0,72 → 0,14 ms** (5×), výsledky
  i všechny testy beze změny.

**Zvážené a ponechané:** `extend` zůstává pro jednorázové kontexty (gettery zachová). Kontext hooku už nemá všechna
pole jako vlastní — obsah ho nesmí kopírovat spreadem (`{ ...ctx }`); přístup přes `ctx.x` i destrukturování
(`const { chance, hand } = ctx`) funguje. Události z `Game.newRun` (`runStarted`) se dál nedoručují — UI se k busu
přihlásí až po založení. Chyba posluchače busu propadne z `dispatch`, ale stav nevrací (akce proběhla).

**Pokrytí po fázi 2 (řádky / větve):** `src/engine/run` 100 % / 94 % (`game.ts` 100 % / 95 %),
`src/engine/save` 100 % / 100 %.

**Proč:** DESIGN 2.4.2, 7, 8.1; ARCHITECTURE 2.2 (neplatná akce stav nemění), ROADMAP (otevřené body fáze 2).

## 2026-10-01 — Fáze 2: simulace a boti, textový režim, obtížnosti „Síla piva“, první balíčky

**Co:**

- **`src/engine/sim/`** (čistý TS, bez DOM): rozhraní `Bot { name; decide(game): Action }`, runner `simulateRun` /
  `simulateMany` (run `i` má seed `SIM-<prefix>-<i>`, pojistka `DEFAULT_MAX_ACTIONS` = 5 000, po 3 neplatných akcích
  za sebou runner provede bezpečnou akci fáze a počítá je) a `summarizeRuns` (metriky DESIGN 12.3: výhry, dosažená
  patra, prohry podle patra, příčiny, skóre, peníze při vstupu do Večerky, délka runu, síla žolíků „s ním / bez něj“).
  Boti podle DESIGN 12.2: `max`, `flush`, `pairs`, `econ`, `random`, `nojoker` (aliasy `maxHand`, `flushChaser`,
  `pairsJokers`, `economy`). Náhoda bota jde jen z vlastního RNG a bot nemá stav mimo `RunState` (viz revize
  simulace níže) → stejné parametry = stejný výsledek.
- **Hodnocení tahu bez 218 podmnožin:** `analyzeCards` staví nejlepší sadu karet pro každou kombinaci přímo (skupiny
  hodnot, barvy, okna postupek; se `straightGaps`/`straightWrap` přes `straightKind` enginu). Kandidát se ověří náhledem
  enginu (`Game.preview`: detekce, úroveň, `modifyBase` šéfa) a k základu se přičtou příspěvky skórujících karet
  z `params` vylepšení, z `EditionDef.effect()` a z `SealDef.retriggers` (ocelové karty v ruce ×). Se žolíky nebo se
  šéfem s `validateHand`/`adjustHandScore` se nejlepší kandidáti přepočítají přesně — tahem na kopii hry
  s **přeseedovaným RNG** (bot nesmí znát skutečné budoucí hody, dostane jen vzorek). Testy: nejsilnější kombinace
  z analýzy = detekce enginu na 1 500 náhodných rukou (i s modifikátory, divokými a kamennými kartami); odhad tahu
  bez žolíků a náhody = skóre enginu.
- **Zahazování:** když nejlepší ruka nestačí na zbytek cíle kola, bot porovná „honičky“ podle stylu (držet jádro
  kombinace, barvu, postupku, páry) Monte Carlo odhadem po dobrání. Vzorky jsou ze **složení** dobíracího balíčku
  (veřejné — UI ho ukazuje), pořadí bot nezná (míchá vlastním RNG); všechny možnosti dostanou **stejné vzorky**
  (common random numbers) — s nezávislými 10 vzorky šum vedl k rozbití Dvou dvojic kvůli postupce na jednu kartu.
  Užitek je oříznutý na zbývající cíl (u poslední ruky rozhoduje šance na výhru, ne průměr). Tah se doplní kartami
  „na vyhození“, aby se protočil balíček.
- **Večerka a obálky:** kupóny; žolíci podle `JokerDef.tags`, vzácnosti, edice, nálepek a stylu (`params` s kombinací
  bota = synergie), při plných slotech prodej nejslabšího; pranostiky na vlastní kombinace (koupit a použít);
  obálky; přehození jen s penězi ≥ 2× cena nad rezervou na úrok (DESIGN 12.2); `econ` drží rezervu na plný úrok;
  žolíci se řadí +čipy/+mult vlevo, ×mult vpravo. Nejisté akce (spotřebka s `canUse`) bot ověří na kopii hry —
  v testech mají všichni boti 0 neplatných akcí (obsah hry i testovací obsah se žolíky, šéfy, obálkami).
- **`npm run simulate`** (`scripts/simulate.ts`): `--runs --stake --deck --bot|--strategy --seed-prefix --json [soubor]
--max-actions`; výstup česky přes `src/i18n/cs/cli.ts` (`t()`, `plural`, formátování čísel), `--json` bez doby běhu
  (deterministický). **`--play`** = textový hratelný režim (`node:readline`, příkazy `h`/`z`/`n`/`s`/`b`/`v`/`p`/`k`/
  `ku`/`o`/`ul`/`r`/`d`/`u`/`pz`/`ps`/`m`/`l`/`?`/`q`; převod řádku na akci je v `sim/commands.ts`, texty ve skriptu),
  `--script "…;…"` neinteraktivně. Test dohraje celý run textovými příkazy až do pitvy.
- **Obsah:** 8 obtížností přesně podle DESIGN 10 (`src/content/stakes.ts`; čísla pro popisek nesou v `params` —
  pole `StakeDef.params` přidala revize pravidel níže, dřív pomocný typ `StakeContent`). Balíčky Hospodský, Štamgastův,
  Turistický, Mariášový, Obrázkový, Notářský, Zbohatlík a Dlužník (stačí modifikátory, startovní peníze a složení
  karet). Úřednický, Babiččin, Vetešnický a Kalendářový potřebují kupóny, spotřebky a žolíky → fáze 7.

**Kalibrace odložená:** obsah zatím nemá žolíky, takže žádný bot nevyhrává. 500 runů na Desítce: `nojoker` dosáhne
patra 2 v 95 % a patra 3 v 5 % runů (medián prohry v patře 2; DESIGN 12.1 chce 3–4), nejlepší ruka v průměru ~560;
`random` prohraje v patře 1 ve 100 % runů. Křivka cílů a čísla kombinací se ladí až se žolíky (fáze 4+, cílová pásma
% výher ve fázi 10) — ladění bez žolíků by křivku posunulo špatným směrem. 500 runů jednoho bota trvá ~6 s.

**Proč:** CLAUDE.md kap. 3 a 8, DESIGN 10 a 12 (boti, výstup simulace, determinismus), ROADMAP fáze 2.

## 2026-10-01 — Revize pravidel runu (fáze 2): odměna na výběru útrat, Doppelbock, textový režim

**Co:** (testy `tests/unit/review2-rules.test.ts`; každý před opravou selhal, `params` u obtížností typecheck)

- **Odměna za útratu má jeden zdroj:** nový dotaz `Game.blindReward(kind, bossId)` (Malá 3 / Velká 4 / šéf
  `BossDef.reward`, Malá 0 při `noSmallBlindReward`, × `blindRewardMult`, dolů na koruny) používá rozpis odměn
  i výběr útrat. Textový režim dřív ukazoval jen základ — na Zbohatlíkovi „odměna 3 Kč“, ale vyplatilo se 6 Kč.
- **Doppelbock: popisek ceny zapůjčeného žolíka** říkal 2 Kč, ve Večerce ale stojí 3 Kč — `RENTAL_BUY_PRICE`
  nahrazuje jen základ a příplatek Jedenáctky (platí na Doppelbocku vždy) se přičte jako ke všemu (rozhodnutí
  „Ceny ve Večerce“ výše). `params.price` se teď počítá vzorcem obchodu (`shopPrice`), ne z konstanty.
- **`StakeDef.params`** (doporučení z minulého záznamu): obtížnosti nesou čísla pro popisek stejně jako balíčky;
  pomocný typ `StakeContent` zmizel, registr je předá UI bez přetypování.
- **Textový režim:** prázdná Večerka („Večerka zavřená – inventura“) i tehdy, když je všechno koupené (DESIGN 2.5.1
  „vše koupeno“; dřív jen bez nabídky); pitva má hlášku podle příčiny (šéf `bosses.<id>.death`, jinak Malá/Velká
  z DESIGN přílohy C, `cli.play.gameOver.death.*`); výhra ukáže statistiku runu; v nekonečném režimu záhlaví
  „Patro 9 (nekonečný režim)“ místo „Patro 9/8“; nasbírané štítky jsou vidět (`Štítky: …`) na výběru útrat, v kole
  i ve Večerce.

**Zamítnuté / ponechané:** Ležák + Zbohatlík dá 1 Kč za nevyužitou ruku — implementace je podle DESIGN 10
(`moneyPerUnusedHand −1`) a popisek Ležáku to říká („o 1 Kč méně, takže běžně nic“). Podíly nálepek na Doppelbocku
(20 / 12 / 17 %) se liší od popisku „20 % / 15 %“ — popisek je text DESIGN 10, skutečné podíly DESIGN uvádí pod
tabulkou. **Otevřené pro fázi 6:** DESIGN 2.4.2 krok 5 počítá v rozpisu odměn i s penězi ze štítků, `TagHooks`
ale nemá obdobu `roundEndMoney` — štítek (Termínovaný vklad) by dnes peníze připsal v `onRoundEnd` mimo rozpis.
Řešit spolu s obsahem štítků (pořadí vůči spotřebování štítku v `onRoundEnd`).

**Proč:** CLAUDE.md kap. 3 (Run, Večerka, pitva), DESIGN 1.2, 2.4.2, 2.5.1, 4.6, 7, 10.

## 2026-10-01 — Revize simulace, ukládání a determinismu (fáze 2): boti bez stavu mimo `RunState`

**Co:** (testy `tests/unit/review2-sim-save.test.ts`; před opravou selhaly)

- **Boti si drželi stav mimo `RunState`** — paměť svázanou s instancí `Game` (RNG `cyrb128('<seed>:bot:<jméno>')`
  posouvaný každým rozhodnutím, poslední odhady skóre pro přeskočení útraty, počítadla kroků a přehození ve Večerce).
  Dva runy prokládané jednou instancí bota (paměť se přepínala) i uložení a načtení uprostřed simulace (nová `Game`
  = nová paměť) vedly k jinému runu: z 6 seedů se rozešlo 2–6 podle bota. **Oprava:** rozhodnutí je čistá funkce
  stavu. RNG se pro každé rozhodnutí seeduje `cyrb128('<seed>:bot:<jméno>:<otisk stavu>')` (`decisionRng`; otisk =
  fáze, patro, peníze, `nextUid`, statistiky, kolo, Večerka, obálka, žolíci), přehození se počítají
  `ShopState.rerollsThisShop` (strop 3, náhodný bot 10), pojistky kroků zmizely (nákupy jsou omezené nabídkou, obálky
  `picksLeft`, zacyklení chytí `DEFAULT_MAX_ACTIONS` runneru). Přeskočení útraty místo paměti odhadne **sílu buildu**:
  4 ruce rozdané na kopii hry s přeseedovaným RNG, nejlepší tah vč. žolíků; přeskočí se při ≥ 4 zahraných rukách
  a průměru × ruce ≥ 3× cíl Velké útraty (odhad jen tehdy, když na to stačí aspoň nejlepší ruka runu). Testy: nová
  instance i opakované volání dají v každém kroku runu stejnou akci (všichni boti, obsah hry i testovací obsah),
  uložení a načtení každých 5 akcí / po každé akci nezmění akce ani konečný stav, prokládané runy = runy zvlášť,
  akce bota přehrané bez bota dají stejný stav (dotazy bota hru nemění).
- **Výkon:** přesné přepočty tahů serializují stav jednou na rozhodnutí (`cloneGame(…, snapshot)`). 500 runů
  jednoho bota na obsahu hry ~6 s (beze změny); na testovacím obsahu se žolíky ~0,7 ms na akci.
- **Náhodné akce (fuzz, regresní test):** polovina akcí od bota, polovina náhodných (cizí id, neexistující sloty,
  duplicity): neplatná akce nemění stav a na bus nedoručí nic, platná doručí přesně `res.events`, hra načtená
  z uložení před akcí dá stejný výsledek i stav. Na 25 000 akcích chyba nenalezena.
- **`npm run simulate`:** `--json -` (stdout) dřív skončilo chybou „Unexpected argument '-'“ a `--json=soubor`
  „Unknown option“; obojí funguje. JSON výstup už neobsahuje cílovou cestu (`options.json`) — stejné parametry dají
  stejné bajty, ať jde výstup do souboru, nebo na stdout.

**Zkontrolováno bez nálezu:** stav runu je v každém kroku JSON-bezpečný (žádné `undefined`, `NaN`, nekonečno, `-0`
ani třídy — procházka stavu v runech všech botů), uložení a načtení v každé fázi, migrace (`SaveError` kódy),
determinismus CLI mezi procesy (stejný `--json`). `max` je výrazně lepší než hladový bot bez zahazování (průměrné
patro 1,97 proti 1,35 na 200 runech) — rozhodování v kole je rozumné; že na obsahu bez žolíků a pranostik nikdo
nevyhrává a `nojoker` končí v patře 2 (DESIGN 12.1 chce 3–4), je očekávané: kalibrace až s obsahem (záznam výše).

**Proč:** CLAUDE.md kap. 2 a 8 (determinismus, stav jen v `RunState`), DESIGN 12.2 (simulace deterministická).

## 2026-10-01 — Uzavření fáze 2: kalibrace křivky přesunutá, ověření

**Co:**

- Fáze 2 je uzavřená s 13 ze 14 podúkolů. Podúkol „První kalibrace křivky cílů simulací“ zůstává v ROADMAP
  neodškrtnutý s poznámkou a přesouvá se do fáze 4–5: bot `nojoker` sice žolíky nekupuje, ale ladění podle DESIGN
  12.4 (krok 1) počítá s pranostikami a vylepšeními ve Večerce, které obsah zatím nemá. Křivka cílů a čísla
  kombinací v DESIGN 2.2–2.3 se do té doby nemění. Výchozí stav (100 runů, Desítka, obsah bez žolíků, šéfů
  a spotřebek): všichni boti 0 % výher, průměrné patro `max` 1,9 a `nojoker` 2, `random` prohraje v patře 1 ve
  100 % runů, 0 neplatných akcí.
- Závěrečné ověření: `typecheck`, `lint`, `npm test` (26 souborů, 916 testů), `test:coverage`, `build`,
  `test:e2e`, `npm run simulate -- --runs 100 --stake 1` a `--play --script` prošly. Pokrytí `src/engine`:
  98 % řádků, 96 % příkazů, 90 % větví, 98 % funkcí (nejslabší `sim/bots.ts`: 90 % řádků, 73 % větví).
- `docs/ARCHITECTURE.md` kap. 2.4 a 7 popisují soubory `engine/sim` a volby `npm run simulate` včetně `--play`
  a `--script`.

**Proč:** ROADMAP (definice hotovo, odškrtávat jen hotové), DESIGN 12.4 (pořadí ladění), CLAUDE.md kap. 8.

## 2026-10-01 — Běžní žolíci fáze 4 (č. 1–15): výklad mechanik

**Co:** `src/content/jokers/common.ts`, texty `src/i18n/cs/jokers/common.ts`, testy `tests/unit/jokers-common.test.ts`.
Čísla beze změny proti DESIGN 4.7. Výklad míst, která tabulka nechává otevřená:

- **Pokladnička:** `onRoundEnd` počítá dokončená kola (běží před rozpisem odměn), `roundEndMoney` vyplácí +2 Kč;
  po 8. kole vrátí 2 + 8 Kč (v rozpisu jedna položka „+10 Kč“) a rovnou se zničí (`destroyJoker`, důvod `broken`,
  hláška `jokers.piggy_bank.broken`). Zničení hned v rozpisu, ne až ve Večerce — rozbitou pokladničku tak nejde
  ještě prodat. Debuffnuté kolo se nepočítá (debuffnutý žolík hooky nevolá). Popisek ukazuje zbývající kola.
- **Ekonomičtí žolíci** (Zahrádkář, Pokladnička, Bazarník) mají `copyable: false`: engine kopírujícím žolíkům
  `roundEndMoney` nepočítá, kopie by nedala nic (DESIGN 4.4/7 — efekt mimo skórování). Plus `noRental` (4.4/12),
  Pokladnička i `noEternal`.
- **Švejk:** slabá ruka = `skóre × 100 < cíl × 10` (přesně 10 % nestačí; bez desetinných čísel). Počítadlo `used`
  se nuluje v `onRoundStart` i `onRoundEnd` (popisek ve Večerce ukazuje plný počet). Kopie (`isCopy`) stav nemění
  a přidá zahození právě tehdy, když ho v téže ruce dá i originál (`firedAt` = index ruky) — kopie vlevo i vpravo
  tak efekt zdvojí stejně (nejvýš 2× za kolo každý). Ruka zakázaná šéfem (`validateHand`) `afterHandScored` nevolá,
  a tedy se nepočítá.
- **Křižák:** počítají se jen nedebuffnuté skórující ♣ (debuffnutá karta „nedává nic“); divoká je i ♣.
- **Klenotník:** +3 čipy se zapíšou do karty (`bonusChips`) hned v `onCardScored` — v téže aktivaci už se čipy
  karty započítaly, opakovaná aktivace (červená pečeť) ale vyleštěnou kartu vidí. Bublina `jokers.jeweler.polished`.
- **Golem:** 2 kamenné karty s náhodnou hodnotou a barvou (stream `joker`; projeví se jen při vypnutých
  vylepšeních). +20 čipů jen za kamennou kartu, když vylepšení platí (Bílá hora → obyčejná karta).
- **Zahrádkář:** počítá karty, které po vítězné ruce zůstaly v ruce (engine po výhře nedobírá) — při 8 kartách
  a 5 zahraných 1 Kč, při 1–2 zahraných 2 Kč. Pod pásmem 2–3 Kč/kolo z DESIGN 4.3; ladit simulací (`cards`).
- **Párty pro dva:** „obsahuje Dvojici“ = `hand.contains` (i Dvě dvojice, Trojice, Full house, Čtveřice).
  `params.hand = 'pair'` čtou boti při nákupu, v popisku není.
- **Meteorolog** čte úroveň v okamžiku skórování (po případném zvýšení v `beforeScoring`).

**Proč:** DESIGN 4.4 (jedna přesná věta, stav vidět v popisku, disciplína hooků, nálepky), ARCHITECTURE 2.7.

## 2026-10-01 — Vzácní a epičtí žolíci fáze 4 (č. 16–30): výklad mechanik

**Co:** `src/content/jokers/rare.ts` a `epic.ts`, texty `src/i18n/cs/jokers/rare.ts` a `epic.ts`, testy
`tests/unit/jokers-rare.test.ts` a `jokers-epic.test.ts`. Ceny, vzácnosti a čísla mechanik beze změny proti DESIGN 4.7.
Výklad míst, která tabulka nechává otevřená:

- **Babiččina truhla:** „×1,3 mult za každou spotřebku“ = **násobí se** — n spotřebek ve slotech dá ×1,3ⁿ (1 → ×1,3,
  2 → ×1,69, 3 → ×2,197), ne 1 + 0,3 n. Každá spotřebka je samostatný krok ×1,3 (UI je přehraje jako „tik tik“).
  Počítají se všechny spotřebky ve slotech (i s negativní edicí), bez spotřebek nic. Se 2 výchozími sloty je strop
  ×1,69 (v R1 pod dolní hranicí epického ×1,8, v R2 v pásmu ×1,45–2,1), se sloty navíc ×2,2–2,9 — ladit simulací.
- **Napodobitel:** cíl si vybírá v `copyTarget`, ne ve vlastním `onRoundStart` — engine u kopírujícího žolíka volá
  hooky **cíle** (`GameCore.resolveCopy`), vlastní `onRoundStart` by se nikdy nezavolal. `copyTarget` se ale volá
  v každém průchodu žolíků, i v `onBlindSelect`/`onRoundStart` při výběru útraty: první volání ve fázi `blind_select`
  s už založeným kolem je začátek kola, kolo se pozná podle `stats.roundsWon`. Náhoda přes `ctx.rng` (stream `joker`),
  stav `target` (uid) a `round`. Vybírá jen z jiných žolíků, které nejsou jiný Napodobitel, nejsou trvale debuffnutí
  (zvětralí) a nemají `copyable: false` — hook k registru přístup nemá, proto se nekopírovatelnost čte ze statických
  polí obsahu (žolík mimo obsah hry pohlídá engine: kopie nedá nic). Kopíruje jen v kole (od výběru útraty po
  vyplacení, tedy i v `onRoundEnd`/`onBossDefeated`), ve Večerce ne. Zmizí-li cíl, do konce kola nekopíruje nic;
  Napodobitel získaný během kola začne kopírovat od dalšího kola. Sám `copyable: false`. Popisek cíl neukazuje
  (`describe` nemá texty) — UI ho může zvýraznit podle `state.target`. Čistší cesta do budoucna (příloha B): vlastní
  hook kopírujícího žolíka volaný i při kopírování, nebo dotaz `EngineApi` na kopírovatelnost žolíka.
- **Zpožděný rychlík:** `params` jako u Skleněné (`{chance} z {odds}`); `probabilityMult` násobí čitatel všech
  pravděpodobností (DESIGN 0.1), tady tedy zvyšuje šanci na zpoždění. Při zpoždění jen bublina
  `jokers.late_train.delay`, edice žolíka platí dál (DESIGN 3.2).
- **Sněhulák:** stav `xmult`, −0,25 v `onRoundEnd` (kopie nic nemění ani neničí — `self.uid` je i v kopii uid cíle);
  při ×1 `destroyJoker(…, 'melted')` a hláška `jokers.snowman.melted` (jen když opravdu zmizel). Vydrží 6 kol
  (×2,5 … ×1,25). `noEternal`; vynuceně přibitý zůstane na ×1 a nic nedělá.
- **Sběrač hub:** počítá každé `api.destroyCard` (prasklé sklo, spotřebky, šéfové) od vstupu do slotu; ×(1 + 0,15 n)
  jedním krokem, při n = 0 žádný krok.
- **Hostinský:** `round.discardsUsed === 0` — jen zahození hráčem, zahození efektem (`discardFromHand`) se nepočítá.
- **Kolotoč:** „každá Postupka“ = zahraná ruka Postupku obsahuje (`hand.contains`, tedy i Postupka v barvě
  a Královská). `params.hand = 'straight'` čtou boti, v popisku není. Kopie dá jen +6 mult (`passive` se nekopíruje).
- **Sekera:** `debtLimit` +15 se sčítá (dvě Sekery −30 Kč); +8 mult při `money < 0` v kroku 4 (peníze z karet téže ruky
  už se započítaly). Kopírovatelná a bez `noRental` — není čistě ekonomická.
- **Ozvěna:** poslední karta v `scoring` (pořadí zahrání), neskórující „kopy“ se nepočítají; debuffnutá poslední
  karta se přeskočí celá. **Šťastná sedmička:** kamenná karta s hodnotou 7 se neopakuje (nemá hodnotu; pozná se přes
  `api.hasSuit(card, card.suit)`). U obou platí strop `MAX_ACTIVATIONS_PER_CARD`.
- **Stálý host** počítá dokončená (vyhraná nebo zachráněná) kola, přeskočené útraty ne; **Pivní břicho** přičítá
  v `afterHandScored` (první ruka +0, ruka zakázaná šéfem se nepočítá). Oba mají `noPerishable` — rostou časem ve
  slotu (`JokerDef.noPerishable`). **Kořenářka** reaguje jen na `kind === 'rada'`. **Pan vrchní** počítá všechny
  zahrané karty (i neskórující), **Stará garda** úroveň v okamžiku skórování.
- Texty: flavor Pana vrchního „Platím! – Za tři.“ s krátkou pomlčkou (dlouhá je v textech hry zakázaná).

**Proč:** DESIGN 4.4 (jedna přesná věta s čísly z `params`, stav v popisku, disciplína hooků, nálepky), ARCHITECTURE
2.7 (kopírování), CONTENT-GUIDE kap. 2–3.

## 2026-10-01 — Ladění žolíků fáze 4 podle hodnoty 4.3 (měření `scripts/joker-value.ts`)

**Co — měřicí nástroj** `npx tsx scripts/joker-value.ts [--runs 100] [--joker id,…] [--json soubor]` (testy
`tests/unit/jokers-value.test.ts`). Pro každého žolíka a seed `JV-<prefix>-<i>`:

1. Základní run bota „vhodné strategie“ (štítek `suit` → `flush`, `params.hand` z rodiny Dvojice → `pairs`, jinak
   `max`) a větev téhož runu, kde se žolík na začátku patra 1 (škálující na začátku patra 2, DESIGN 4.2) vloží do
   volného slotu. Prvních 6 kol ho bot nesmí prodat (přibitý; žolíci s `noEternal` přes obal bota — pravidlo 4:
   „ve slotu aspoň 6 kol“), pak s ním zachází jako s kterýmkoli jiným.
2. Každá ruka větve (karty v ruce, když bot hrál) se přepočítá na kopiích stavu se stejným RNG: **nejlepší tah
   jen se žolíkem proti nejlepšímu tahu bez žolíků** (kandidáti = skutečný tah + nejlepší odhady `planCandidates`).
   Bez toho by se do hodnoty míchal vliv ostatních žolíků bota na výběr tahu (Pivní tácek s Panem vrchním mění
   Trojici za Full house) a žolíci, kvůli kterým bot hraje jinak (Kolotoč), by dostali hodnotu tahu, který by bez
   nich nikdo nezahrál. Bez žolíka chybí i karty, které přinesl (Golem), a čipy, které kartám přidal (Klenotník —
   sleduje se rozdíl čipů karet světa se žolíkem a bez něj).
3. Izolovaný efekt (Δčipy, Δmult; u štítku `xmult` poměr multu) se promítne na referenční ruce 4.2:
   `(Rč + Δč)(Rm + Δm)·× / (Rč·Rm) − 1`. **R1** = ruce pater 1–3 s úrovněmi kombinací střídavě 1 a 2 (definice R1).
   **R2** = všechny ruce větve (runy patra 6–8 zatím skoro nedosáhnou), úroveň všech kombinací 4 (předpoklad do
   fáze 5 — bez pranostik zůstávají úrovně na 1; jinak by Meteorolog a Stará garda měly vždy 0) a škálující žolíci
   se stavem lineárně extrapolovaným na 16 dokončených kol od koupě (koupě v patře 2, průměr pater 6–8: počítadla
   žolíka i čipy karet z růstu za kolo sdruženého přes seedy). Kopírující žolík se izolovat nedá — měří se poměr
   skóre skutečné sestavy s ním / bez něj.
4. Ekonomika = Kč z rozpisu odměn připsané žolíkovi / kola ve slotu. Simulace = párový rozdíl dosaženého patra,
   vyhraných kol a výher větve proti základnímu runu (jen runy, které bodu koupě dosáhly).
5. Hodnocení (`verdict`): pravidlo 1 (dolní hranice aspoň v jednom okně), pravidlo 2 (horní v žádném), pravidlo 3
   — **špička = 95. percentil rukou okna R2** nejvýš 2× horní hranice R2. Maximum jedné ruky je jen šum vzorku
   a v R1 „plný build“ není: i Srdcař z ukázky 4.3 má s pěti ♥ vůči slabé ruce R1 +219 %.

**Co — boti** (`src/engine/sim/bots.ts`, `hand-eval.ts`): nákup a hra podle `JokerDef.tags` a nečíselných `params`.

- Barevní žolíci dostali `params.suit` (`H`/`S`/`D`/`C`, Srdcař, Hrobník, Klenotník, Křižák) a Meteorolog
  `params.level = 2` (první úroveň, za kterou něco dá; Stará garda už `level` měla) — nápověda pro boty, popisky
  ji nečtou, hooky čtou tytéž konstanty.
- Bot honí barvu, kterou chtějí jeho žolíci (+1,5 karty k počtu barvy za žolíka, v balíčku ×4), a kombinace
  z `params.hand` (preference ×1,2 pro celou „rodinu“ — Dvojice → vše s Dvojicí, `straight` → Postupky).
- Hodnocení nákupu: spotřebkový žolík (`consumable`) bez spotřebek v obsahu ×0,25, žolík na úroveň (`params.level`)
  bez možnosti úrovně zvyšovat ×0,25 (s pranostikami ×0,8, dokud úrovně nedosáhne), kopírující žolík s méně než
  2 jinými žolíky ×0,6, barevný žolík na barvu, kterou už chce jiný žolík, ×1,25. Žolíka koupí i do mínusu, když to
  dluhový limit dovolí (ne `econ`). Přehazování do dluhu jsem zkusil a vrátil — nepomohlo (Sekera Δ −1,2 kola
  proti −0,9 bez něj).
- Zahazování: když bot drží žolíka se štítkem `discard`, spočítá přesně na kopii, kolik skóre tahu zbude po
  zahození (Hostinský ×2,5 → 0,4), a zahodí jen tehdy, když to Monte Carlo odhad i po tomto trestu vyhrává.
- Řazení: kopírující žolík (`copy`) stojí tam, kam patří jeho cíl (`state.target`); +čipy/+mult vlevo, ×mult vpravo
  platí dál. `cloneGame`/`exactPlayScore` mají volitelné `mutate` (otázka „co kdyby“ na kopii stavu).
- Účinek (200 runů, stejné seedy a obsah, boti před/po, před změnou čísel): průměrné patro max 3,4 → 3,5,
  flush 3,3 → 3,5, pairs 3,4 → 3,6, nejlepší ruka +15–23 %; doba simulace +15 %. Neplatné akce 0.

**Co — změny čísel** (staré → nové; naměřeno R1 / R2 v %, nebo Kč/kolo; 100 seedů, stejná metodika):

| Žolík                      | Číslo                      | Před: naměřeno | Po: naměřeno | Důvod                                                                                |
| -------------------------- | -------------------------- | -------------- | ------------ | ------------------------------------------------------------------------------------ |
| Klenotník (`jeweler`)      | `chips` 3 → 5              | 3,1 / 6,2      | 6,0 / 14,3   | pod dolní hranicí v obou oknech (běžný R2 ≥ 8)                                       |
| Křižák (`crusader`)        | `mult` 8 → 12              | 32,8 / 6,2     | 51,3 / 9,4   | pod dolní hranicí; podmínka 2 ♣ platí jen ve ~35 % rukou                             |
| Ranní ptáče (`early_bird`) | `mult` 12 → 8              | 125,9 / 23,2   | 79,3 / 14,7  | R1 nad horní hranicí 100 (první ruka = 80 % rukou pater 1–3)                         |
| Zahrádkář (`gardener`)     | `money` 1 → 2 (za 3 karty) | 1,0 Kč         | 2,1 Kč       | pod 2–3 Kč/kolo; po vítězné ruce zbývají typicky 3–5 karet                           |
| Bazarník (`flea_trader`)   | `money` 1 → 3              | 0,9 Kč         | 2,1 Kč       | pod 2–3 Kč/kolo; bot sloty rychle zaplní                                             |
| Kolotoč (`carousel`)       | `mult` 6 → 14              | 25,6 / 5,8     | 58,7 / 12,0  | pod dolní hranicí; Postupka jen ve ~28 % rukou, špička R2 38 % < 120 %               |
| Ozvěna (`echo`)            | `retriggers` 1 → 4         | 14,8 / 4,5     | 64,3 / 20,9  | pod dolní hranicí; při 3 opakováních R1 47,7 % (těsně pod 50); flavor o ozvěnu delší |
| Hostinský (`innkeeper`)    | `xmult` 2 → 2,5            | 41,9 / 38,9    | 83,4 / 78,2  | pod dolní hranicí; bez zahození jen ~40–55 % rukou i s trestem za zahození u bota    |

Texty čtou `params`, takže se změnily samy; DESIGN 4.7 (tabulka + poznámka pod ní) a testy upravené.

**Mimo pásmo bez změny čísla** (číslem to spravit nejde nebo by to porušilo jiné pravidlo):

- **Noční směna** (17,9 / 4,6): poslední ruka kola je jen 7–9 % rukou. Strop pravidla 3 (špička R2 ≤ 60 % → nejvýš
  +24 mult) by dal jen R2 5,6 %. Přitom má v simulaci +0,6 vyhraného kola, mezi nejlepšími běžnými, protože efekt
  padne právě v ruce, která rozhoduje kolo. Nechávám 20; mechanika k revizi ve fázi 7 (např. „poslední 2 ruce“).
- **Šťastná sedmička** (8,2 / 2,6): sedmička je 1/13 karet. Bez úprav balíčku (fáze 5 a 7) to číslo nespraví;
  flavor „do třetice“ = 2 opakování. Přeměřit po fázi 5.
- **Sekera** (3,9 / 0,7, Δ −0,8 kola): dluh rozumný bot drží jen krátce po nákupu na dluh. Hodnota je hlavně
  ekonomická; mechanika k revizi ve fázi 7.
- **Napodobitel** (skutečná sestava 25,6 / 29,5): nemá čísla. Kopie náhodného žolíka ≈ průměrný žolík sestavy, což je
  pod epickým pásmem ×1,8–2,8. Revize mechaniky ve fázi 7, třeba „kopíruje souseda“.
- **Kořenářka, Sběrač hub, Babiččina truhla:** dnes 0. V obsahu nejsou babské rady, spotřebky ani ničení karet.
  Změřit ve fázi 5 a čísla do té doby neměnit.
- **Švejk:** užitkový, hodnotí se simulací (Δ ≈ 0 kol).

V pásmu podle R2 (pravidlo 1) jsou i Meteorolog a Stará garda. Obě hodnoty stojí na předpokladu úrovně 4 v R2
a přeměří se ve fázi 5 s pranostikami.

**Stav simulace** (`npm run simulate -- --runs 300 --stake 1 --bot all`, po změnách): `max`, `flush` i `pairs`
mají 0 % výher a průměrné patro 3,8. Prohry vrcholí v patře 4 (~49 %), patra 6 dosáhne 0,3–2,3 % runů.
`nojoker` je na 2,0, `econ` 2,5 a `random` prohraje vždy v patře 1. Bez pranostik, kupónů, obálek a šéfů zatím
cílových 25–35 % výher dosáhnout nejde. Kalibrace cílů je odložená na fázi 5–6/10. Sloupec „Δ výher“ z tabulky 4.3
proto dnes nahrazuje Δ vyhraných kol: u všech změřených žolíků je mezi −0,8 a +2,2.

**Proč:** DESIGN 4.2–4.4 a 12.4 krok 3 (ladit `params`, ne mechaniku), CLAUDE.md kap. 8 (žádný bezcenný ani
auto-win žolík).

## 2026-10-01 — Revize 30 žolíků fáze 4: texty, kombinace s enginem, fuzz

**Co:** prošel jsem všech 30 žolíků: vyrenderovaný popisek (`t()` s `params` a `describe`) proti kódu a DESIGN 4.7,
flavor (pravopis, tykání, rodová neutralita, žádné skutečné osoby, značky ani názvy z Balatra), `ArtSpec`, štítky
a testy. Nový test `tests/unit/jokers-combos.test.ts` ověřuje u **každého** žolíka:

- popisek přesně (všech 30) a že šablona nemá čísla natvrdo (výjimka: příklad „Q-K-A-2-3“ u Kolotoče); `params`,
  které popisek nečte, smí být jen nápověda pro boty (`suit`, `hand`, `level`),
- Napodobitel: kopie = druhá instance téhož žolíka se stejným stavem (stejné čipy, mult i měřená veličina — zahození
  u Švejka, vyleštění karty u Klenotníka), nekopírovatelné si nevybere, stav cíle se kopií nezdvojí ani za dvě kola
  (rada, zničená karta, slabé ruce, výhra kola); debuffnutý cíl nekopíruje,
- debuff: ruka bez efektu, bez `passive` (Kolotoč, Sekera) a bez edice; celé kolo bez odměny a beze změny počítadel;
  debuff skončí s kolem,
- edice: lesklá/holografická/duhová platí i u žolíka, který ve scénáři sám nic nedá (holografická +10 mult před
  vlastním ×mult), negativní +1 slot,
- prodej: cena podle DESIGN 4.1 se všemi 30 žolíky ve slotech (`onSell`), prodaný uprostřed kola už nic nedá
  (ani `passive`); prodej Sekery v dluhu nechá zůstatek záporný,
- fuzz: runy přes boty (testovací obsah se šéfy, spotřebkami, obálkami a radou ničící kartu; obsah hry) se všemi 30
  žolíky naráz i s náhodnými pěticemi — žádná výjimka, stav žolíků JSON-bezpečný po každé akci, uložení a načtení
  uprostřed kola dá stejné akce i stav jako run bez načítání.

**Opravy:**

- **Pokladnička:** vynuceně přibitá (výzva, `createJoker` s nálepkou — `noEternal` hlídá jen Večerka a obálky)
  se po rozbití v 8. kole zničit nedá a dřív pak vyplácela 2 + 8 Kč **každé** kolo. Teď bonus dá jednou a dál nic
  (`rounds > 8` → 0); test v `jokers-common.test.ts`.
- **Pivní břicho:** flavor „Každý půllitr se počítá. Dvakrát.“ opakoval pointu Pivního tácku („Každá čárka se
  počítá.“, CONTENT-GUIDE 11). Nový: „Tohle není břicho, to je dlouhodobá investice.“ (sedí na trvalý růst; DESIGN 4.7).
- **Švejk:** `ArtSpec` bez vzoru (jediný z 30; DESIGN 4.4/11) → `pattern: 'stripes'`.

**Bez změny (vědomě):** Pan vrchní má podmínku „nejvýš 3 karty“ jako jeden komerční žolík a Klenotník +5 trvalých čipů
jako jiný — mechanika a efekt se liší (×2 místo +mult, jen ♦ místo všech karet), téma i název jsou vlastní, takže to
není kopie 1:1 (CONTENT-GUIDE 13). Ruka zakázaná šéfem dál nespouští `afterHandScored` (Švejk ji nepočítá — viz výklad
běžných žolíků výše). Napodobitel cíl v popisku neukazuje (`describe` nemá texty) — úkol pro UI: zvýraznit cíl podle
`state.target` a u žolíků s `copyable: false` ukázat, že kopírovat nejdou.

**Proč:** CLAUDE.md kap. 3 (žolíci), 5 (humor) a 6 (čeština); DESIGN 4.4 (přesná věta, disciplína hooků, nálepky);
ARCHITECTURE 2.5–2.7 (pořadí skórování, kopírování, debuff, edice).

## 2026-10-01 — Fáze 3 (U4): e2e testy herní obrazovky a opravy ovládání

**Co:** `tests/e2e/game.spec.ts` (1366×768) projde kolo klávesnicí od výběru útraty po výhru kola (rozhoduje bot
z enginu nad uloženým stavem, UI se ovládá jen klávesami), autosave a obnovení, přeskočení útrat, dialogy ze hry,
myš, dotyk a fáze připravené uloženým runem z enginu (Večerka, pitva, výhra → Nekonečný režim). Ve všech testech
konzole bez chyb a varování. Opravy, které testy našly:

- **Enter na kartě v ruce = Zahrát.** Po kliknutí myší zůstane focus na kartě a Enter ji dřív jen přepnul (DESIGN 13.3
  říká Enter = Zahrát). Kartu teď přepíná klik, mezerník a 1–8; Enter v kole vždy hraje (i na zaměřené kartě).
  V obálce s rukou (výběr cílů) Enter kartu dál přepíná — žádná globální akce tam není.
- **Mezerník přeskočí animaci vždy.** Karta, žolík i spotřebka mezerník zastaví u sebe, takže se zaměřenou kartou
  přeskočení nefungovalo. App ho teď chytá ve fázi zachytávání (kromě textových polí a otevřeného dialogu).
- **Neplatné zahrání/zahození nemaže výběr.** `GameController.play/discard` výběr dřív smazal předem — X bez zahození
  přišel o vybrané karty. Teď ho po úspěchu dorovná `act` (zahrané karty z ruky zmizí), po chybě zůstane.
- **Bez ruky dostane jeviště celou výšku.** Ve výběru útraty a ve Večerce zabírala prázdná dolní řada s balíčkem
  ~150 px a karty útrat se na 1366×768 ořízly (tlačítko Vybrat napůl). Balíček se přesune do pravého dolního rohu
  jeviště (`.game-main.is-handless`, od 601 px; telefon se posouvá celou stránkou).
- **Karty letící na stůl se neořezávají.** Jeviště v kole nemá `overflow: hidden`/`auto` (FLIP z ruky na stůl
  a ze stolu pryč mizel na jeho hraně).
- **Oznámení neblokují kliknutí.** Dvě oznámení nad sebou zakryla na pár sekund tlačítka pitvy; tělo oznámení je teď
  průchozí pro ukazatel, klikací zůstává křížek.

**Proč:** CLAUDE.md kap. 4 (klávesy, rozvržení), DESIGN 13.2–13.3; Esc u bubliny s detailem karty pod ukazatelem ji
nejdřív zavře (WCAG 1.4.13) — to je záměr, ne chyba (test proto před Esc odsune myš).

## 2026-10-01 — Fáze 5: pranostiky (13) a úřední razítka (16)

**Co:** `src/content/pranostiky.ts` (13, cena 3 Kč, `levelUpHand(hand, 1)`) a `src/content/razitka.ts` (16, cena 6 Kč)
podle DESIGN 5.2 a 5.4, texty `src/i18n/cs/{pranostiky,razitka}.ts`, testy přes skutečný engine
(`tests/unit/pranostiky.test.ts`, `tests/unit/razitka.test.ts`). Rozhodnutí a upřesnění:

- **Popisek pranostiky** ukazuje i přírůstek za úroveň (`Barva +1 úroveň (+18 čipů a +2 mult za úroveň)`); čísla
  bere `params` přímo z `HAND_TYPE_DEFS` (`chipsPerLevel`, `multPerLevel`), takže se s tabulkou kombinací nerozejdou.
  Název kombinace je v textu napsaný (ne `{hand}`), aby popisek nezávisel na doplňování parametrů v UI.
- **Tajné pranostiky** hlídá engine (`consumableAllowed` v `shop/pool.ts`); test ověřuje obálku i Večerku před a po
  zahrání Pětice. Pranostiku tajné kombinace, kterou už hráč drží, jde použít vždy.
- **Výjimka z vyhlášky / Daňové přiznání** nikdy nesáhnou po náhradním žolíkovi (Pivní tácek): `canUse` vyžaduje
  volný slot a dostupného žolíka vzácnosti (`api.availableJokers`). Legendární žolíci zatím nejsou (fáze 7), takže
  Výjimku teď použít nejde — padá jen z razítkových obálek (váha 0,25) a dá se prodat. Daňové přiznání nuluje jen
  kladný zůstatek (dluh zůstává, jak říká DESIGN).
- **Ověřená kopie** kopíruje i stav (počítadla), nálepky, odpočet zvětrávání a prodejní bonus („kopie souhlasí
  s originálem“); negativní edice se nekopíruje. Ostatní (nepřibité) se zničí **před** vytvořením kopie, kopie pak
  projde `onAcquire`. `canUse` počítá slot po zničení včetně slotu, který si odnese zničený negativní žolík.
- **Postih nesmí být zadarmo:** Hromadné vyřízení jen při velikosti ruky ≥ 2 (a aspoň jednom žolíkovi bez edice),
  Úřední hodiny jen při ≥ 2 rukách za kolo, Kolaudace jen při ≥ 2 slotech spotřebek (DESIGN). Kontrola totožnosti jen
  na kartu bez edice (nepřepíše lepší edici horší).
- **Vyvlastnění** vezme nejpravějšího žolíka, který není přibitý (přibité přeskočí), a vyplatí 3× `sellValue`
  (zapůjčený 3 Kč). **Odvolání** jde jen ve fázi kola s aktivním šéfovským pravidlem a při `peníze − 5 ≥ −debtLimit`.
- **Zpětný odběr** funguje v kole i v razítkové obálce (ruka obálky), zničí `ceil(n/2)` náhodných karet (`ctx.rng`).
- **Sloučení spisů** určuje levou/pravou kartu podle pořadí v ruce, ne podle pořadí výběru.
- Flavory z DESIGN s dlouhou pomlčkou (`—`) mají v textech hry krátkou (`–`) podle CONTENT-GUIDE 12.

**Engine (obecně, s testy v `razitka.test.ts`):** `EngineApi.setJokerEdition`, `removeJokerStickers`, `copyJoker`
a dotaz `availableJokers({ rarity })` (pool `createJoker` bez náhradního žolíka; `shop/pool.ts` → `availableJokerIds`,
`pickJokerDefId` sdílí stejný výběr kandidátů, losování se nezměnilo). Nová událost `jokerChanged` (edice/nálepky).

**Testy jiných oblastí upravené kvůli spotřebkám v obsahu:** `jokers-bots.test.ts` (test „bez spotřebek v obsahu“
teď spotřebky z registru výslovně odebere) a `jokers-value.test.ts` (Stálý host: Δmult proti tahu bez žolíka už
nevychází přesně +16, protože bot s pranostikami občas zahraje bez žolíka jinou kombinaci — tolerance ±0,5).

**Otevřené pro simulaci:** boti (`sim/bots.ts`) zatím použijí každou spotřebku bez cíle, jakmile `canUse` dovolí —
i razítka s tvrdou cenou (Ověřená kopie zničí ostatní žolíky, Daňové přiznání vynuluje peníze, Úřední hodiny…).
Razítka do Večerky bez kupónu nechodí, ale z razítkových obálek ano; botům je potřeba dát hodnocení razítek.

**Proč:** CLAUDE.md kap. 3 (spotřební karty), 5 (humor), 6 (čeština); DESIGN 2.2.4, 5.1–5.4, příloha B.

## 2026-10-01 — Fáze 5: babské rady (22) a obálky (15)

**Co:** `src/content/rady.ts` (22 babských rad, DESIGN 5.3), `src/content/boosters.ts` (5 druhů × 3 velikosti,
DESIGN 2.9), texty `src/i18n/cs/{rady,boosters}.ts`, testy `tests/unit/{rady,boosters}.test.ts`. Čísla, cíle, ceny
a váhy přesně podle DESIGN (tabulka 5.3 je závazná i tam, kde zadání úkolu uvádělo jiná čísla: Pod slamníkem +50 %
max +12 Kč, ne ×2 do 20 Kč; Zaříkávání 1 z 3, ne 1 z 4; Babiččina barva 2–4 karty, Kynuté těsto a Generální úklid
až 3 karty). Výklady:

- **Babiččin recept** zopakuje `RunState.lastConsumable` (zapisuje se při každém použití, DESIGN 5.1), jen když je
  to babská rada nebo pranostika a ne recept sám. Po razítku nebo po receptu tlačítko Použít zhasne. Proč: jediný
  zdroj pravdy bez další historie ve stavu; popisek to říká přesně („naposledy použité spotřebky, pokud to byla…“).
- **Rosnička:** nejčastější kombinace podle `handLevels[h].played`, při shodě silnější, bez zahraných rukou Vysoká
  karta (stejně jako štítek Předpověď počasí). Vytváří, dokud jsou volné sloty (nejdřív pranostiku nejčastější
  kombinace, pak náhodnou); `canUse` chce aspoň 1 volný slot po uvolnění vlastního (DESIGN 5.1).
- **Jablko od stromu:** kopie nese vylepšení, pečeť **i bonusové čipy**, jen edici ne (bonusové čipy jsou vlastnost
  karty, ne edice). **Kopřivový odvar:** pravá karta dostane `api.cardChips(levá)` (hodnota + bonusové čipy; kamenná 0).
- **Pod slamníkem** jde použít i při 0 Kč nebo v dluhu, jen nic nedá (DESIGN: „při záporném zůstatku nic“).
- **Zaříkávání:** `ctx.chance(1, 3)` (násobí ho `probabilityMult`), lesklá/holografická 50 : 50 přes `ctx.rng`;
  bez žolíka bez edice nejde použít.
- **Kouzelný kotlík:** kandidáti = `availableJokers({ rarity })` bez sebe (odemčení, nezakázaní, nevlastnění,
  ne `noShop`). Bez kandidáta tlačítko zhasne — radši než proměnit vzácného žolíka v Pivní tácek jiné vzácnosti.
  Proměna na místě (`transformJoker`): uid, pozice, edice, nálepka i odpočet zvětrávání zůstanou; stav a prodejní
  bonus se založí znovu a nový žolík dostane `onAcquire` (z Golema tak přibudou kamenné karty).
- **Česnek na krk** ochrání karty do konce kola i před dalšími přepočty debuffu (`RoundState.cleansedCards`), jinak
  by je šéf po příští ruce zase vyřadil.
- **Popisky vylepšovacích rad** přebírají čísla vylepšení z `ENHANCEMENTS[].params` (`+25 čipů`, `×2 mult`, `1 z 5`),
  takže po změně balancu vylepšení nelžou.
- **Obálky:** id `<druh>_<velikost>` (`joker_normal`, `rada_mega`…) — štítky a výzvy na ně budou odkazovat. Vlastní
  texty `boosters.<id>.name|desc` (název „Velikost · Druh“ jako dosavadní fallback UI, popis s `{picks}`/`{options}`).
  Vzhled: ikona podle druhu, vzor podle velikosti (tlustá proužky + papíry, krabice od bot kostky + dárek).
  Logiku obálek (losování, dobraná ruka, zaručená Žolíková obálka v první Večerce) už engine měl; přibyla jen data.

**Engine (obecně, s testy v `rady.test.ts`):** `EngineApi.transformJoker`, `cleanseCard`, dotazy `jokerRarity`
a `consumableKind`; volitelné `RoundState.cleansedCards` (starší uložení bez migrace), které respektuje `bossDebuffs`;
`ConsumableCtx.targets` seřazené podle pozice v ruce (`Game.consumableCtx`), aby „levá/pravá karta“ (Zrcátko,
Kopřivový odvar, Sloučení spisů) nezávisela na pořadí kliknutí. Viz ARCHITECTURE 2.7.

**Proč:** CLAUDE.md kap. 3 (spotřebky, Večerka), 5 a 6; DESIGN 2.7, 2.9, 5.1, 5.3.

## 2026-10-01 — Fáze 5: kupóny (24 = 12 párů)

**Co:** `src/content/vouchers.ts` (12 párů tier 1 → tier 2 podle DESIGN 6, ceny 8–15 Kč přesně z tabulky), texty
`src/i18n/cs/vouchers.ts`, testy přes skutečný engine `tests/unit/vouchers.test.ts` (koupě `buyVoucher`, přesný efekt
každého kupónu, nabídka a hraniční případy). Čísla jsou jen v konstantách obsahu, popisky je čtou z `params`.
Rozhodnutí a upřesnění:

- **Delty se sčítají**, takže tier 2 přidává jen rozdíl proti tier 1: Zlatá věrnostní +20 % (celkem 40 %), Stavební
  spoření +4 (strop 12 Kč), Hologramová fólie `editionRateMult` ×1,4 (2,5 × 1,4 = 3,5), Kartářka nastaví šance
  vylepšení/pečeti na 50 %/20 % jako rozdíl proti výchozím 20 %/0 %. Švagr vedoucí `rerollCostStep −1` (výchozí krok
  1 Kč → 0; clamp na 0 v `modifiers.ts`).
- **„−1 patro“ (Úřední škrt, Amnestie) se nabízí a jde koupit až od patra 2** (`VoucherDef.available`). Proč:
  DESIGN 6 říká „min. 1“ — v patře 1 by kupón nic nesnížil a zbyl by jen trvalý postih (×1,1 cíle / +1 Kč), tedy
  past. Pokračuje se další útratou v pořadí s cíli nového patra; výhra stále až po šéfovi patra 8.
- **Kupón platí hned:** ceny přepočítá `dispatch` (sleva, Amnestie i na přehození), sloty z Druhého regálu / Regálu
  u pokladny se v otevřené Večerce hned doplní (`syncShopSlots`), přehození z Kamaráda za pultem / Švagra hned
  zlevní (s oběma stojí další přehození 3 Kč i po přehozeních už zaplacených v téže Večerce).
- **Rozkládací stůl** dává +1 kartu navíc jen v kole Šéfa: `passive` čte `round.blind === 'boss'`, modifikátory se
  přepočítají při výběru útraty a po výplatě.
- **Popisky váhových kupónů** (Trhací kalendář, Babiččina spíž, Stánek s kartami) uvádějí váhy přímo (3 → 7, 7 → 8,5,
  váha 5 proti žolíkům 14), Kartářka procenta (ne `…Chance`, aby je UI nenásobilo `probabilityMult`).
- **Tier 2 má `unlock: { type: 'custom', id: 'voucherTier1TwoRuns' }`** (DESIGN 11.3: koupě tier 1 ve 2 různých
  runech, nebo vše po 3 výhrách); vyhodnotí ho meta ve fázi 8, do té doby je pool kupónů celý odemčený.
- Flavor „Sbíráte body? — Ne. — Tak je máte.“ má v textu hry krátkou pomlčku (`–`) podle CONTENT-GUIDE 12.
- Bez kupónu na přehazování šéfa: DESIGN 6 ho mezi 12 páry nemá (engine to umí přes `flags.bossRerolls`, zůstává
  pro štítky/razítka).

**Engine (obecně, s testy ve `vouchers.test.ts`):** volitelné `VoucherDef.available?(ctx)` (čistá funkce v `readOnly`;
`voucherAvailable`, filtr v `eligibleVouchers`), `buyVoucher` odmítne (`cannotUse`, stav beze změny) kupón nedostupný,
už vlastněný a tier 2 bez tier 1; `syncShopSlots` doplní otevřenou Večerku po uplatnění kupónu (nikdy neubírá).
Viz ARCHITECTURE 2.8.

**Otevřené pro simulaci:** boti kupují každý dostupný kupón, i Úřední škrt (×1,1 cíle za kolo navíc) — vyhodnotit
v balanci (fáze 10), případně botům dát hodnocení kupónů.

**Proč:** CLAUDE.md kap. 3 (Večerka, kupóny), 5 a 6; DESIGN 2.5, 6, příloha B.

## 2026-10-01 — Fáze 5: boti se spotřebkami a předběžná kalibrace cílů

**Co — boti** (`src/engine/sim/value.ts` nový, `src/engine/sim/bots.ts`; testy `tests/unit/sim-consumables.test.ts`):

- **Ocenění sondou, ne podle id.** Spotřebky, obálky a kupóny boti nepoznávají podle id (sim zůstává nezávislý na
  obsahu): akci zkusí na kopii hry s přeseedovaným RNG a ocení změnu stavu v Kč — peníze, úrovně kombinací
  (`LEVEL_KC` × podíl kombinace na hře bota z `handTypeCounts` + priory stylu), trvalé modifikátory a patro (váhy
  `MOD_KC`, peníze za kolo × zbývající kola, `targetMult` logaritmicky), žolíky (součet hodnocení bota × 5 Kč), nové
  spotřebky a balíček. Hodnota karty = afinita (jak často ve hře bota skóruje: hlavní barva, hodnoty do párů, vysoké
  karty) × (3 Kč + 0,05 Kč × „cena“ karty při skórování) + co dá držená (ocelová) + peníze z vylepšení a pečetí za zbytek
  runu; balíček = 52 × průměr, takže zničení slabé karty balíček zlepší a slabá kopie ho zředí.
- **Výběr cílů:** jedna karta → sonda na každou; přesně dvě → každá uspořádaná dvojice; víc karet → když sonda
  s nejcennějšími kartami a s opačným pořadím dá stejný výsledek a všechny cíle se změnily stejně (vylepšení, pečeť,
  edice, barva, hodnota +n, bonusové čipy, zničení), spočítá přínos každé karty zvlášť a vezme ty kladné; jinak
  (Babiččina barva — barva podle první karty) „kotva“ + karty s nejlepším přínosem ve dvojici s ní. Když záleží na
  pořadí (levá/pravá karta), bot nejdřív pošle `reorderHand`; seed sond nezávisí na pořadí ruky, takže další
  rozhodnutí akci provede (žádné zacyklení, bot dál bez stavu mimo `RunState`).
- **Kdy:** pranostiky hned; spotřebky s cílem na začátku kola (dokud se nehrálo ani nezahazovalo) a v obálce s rukou;
  spotřebka, která dá jen peníze a méně než 6 Kč (Pod slamníkem), počká; destruktivní razítka (Ověřená kopie,
  Vyvlastnění, Daňové přiznání, Zpětný odběr v kole) bot použije jen při kladné hodnotě — se třemi dobrými žolíky
  Ověřenou kopii nepoužije, s jediným ano.
- **Večerka:** žolík, dokud jich je méně než patro + 1; kupóny podle hodnoty ze sondy (hodnota ≥ cena × 0,95);
  žolíci a výměny; pranostiky (koupit a použít), spotřebky bez cíle s kladnou hodnotou; obálky podle očekávané
  hodnoty (pranostiková = očekávané maximum z `options` dostupných pranostik, `expectedMaxOfK`); přehození i při
  plných slotech, je-li ve slotu žolík s hodnocením < 2 k výměně. **Pocit z ceny** (`priceFactor`): peníze nad rezervou
  na úrok nic nevydělají, takže s 5–30 Kč navíc stačí poměr hodnota/cena klesající z 1 na 0,35 — dřív bot v patře 8
  vcházel do Večerky s 75–105 Kč.
- **Žolíci a spotřebky:** se žolíkem ×mult za drženou spotřebku (štítky `consumable` + `xmult`, Babiččina truhla) má
  každá držená spotřebka cenu 25 Kč × (×mult − 1) — bot spotřebky drží a dokupuje do zásoby; se žolíkem, kterého
  akce „nakrmí“ (štítek `scaling`, číselný stav po sondě vzroste — Kořenářka po radě, Sběrač hub po zničené kartě),
  +1,5 Kč za jednotku růstu (nejvýš 3) a víc babských obálek.
- **`LEVEL_KC = 30`** z pokusu (100 runů, stejné seedy, staré cíle; průměrné patro `max`): 7 → 4,0; 12 → 4,0;
  20 → 4,4; 30 → 4,6; 45 → 4,5. Nízká cena úrovní nechávala bota s hlavní kombinací na úrovni ~1,7 na konci runu.
- **Účinek samotných botů** (staré cíle, 100 runů): průměrné patro max 3,5 → 4,7, flush 3,4 → 4,6, pairs 3,3 → 4,5,
  patra 5 dosáhne 55 % runů `max` (dřív 19 %); výhry pořád ~1 %. Neplatné akce 0. Doba: 300 runů × 6 botů 58 s →
  211 s (sondy + delší runy se snazší křivkou).

**Co — žolíci** (přeměření `npx tsx scripts/joker-value.ts --runs 100`, R2 úroveň 4; před = boti bez spotřebkové
logiky a staré cíle, po = konečný stav):

| Žolík                               | Číslo                   | Před: R1 / R2 % | Po: R1 / R2 % | Δ výher po | Hodnocení                                                        |
| ----------------------------------- | ----------------------- | --------------- | ------------- | ---------: | ---------------------------------------------------------------- |
| Kořenářka (`herbalist`)             | beze změny (+2 mult)    | 3,3 / 10,2      | 22,9 / 49,8   |  +19 p. b. | v pásmu R2 (vzácný 20–60); dřív bot skoro nepoužíval babské rady |
| Sběrač hub (`mushroom_picker`)      | `xmult` 0,15 → **0,25** | 0,2 / 16,3      | 3,0 / 69,8    |   +5 p. b. | s 0,15 a novými boty R2 29,5 (epický ≥ 45); špička R2 69 < 220   |
| Babiččina truhla (`grandmas_chest`) | beze změny (×1,3)       | 0,5 / 3,1       | 41,0 / 62,1   |   +4 p. b. | v pásmu R2 (epický 45–110); dřív bot spotřebky nedržel           |
| Meteorolog (`meteorologist`)        | beze změny (+2 mult)    | 11,9 / 15,0     | 11,9 / 15,0   |   +3 p. b. | v pásmu R2 (běžný 8–30)                                          |
| Stará garda (`old_guard`)           | beze změny (×1,5)       | 0,0 / 50,1      | 0,0 / 50,5    |   +4 p. b. | v pásmu R2 (vzácný 20–60); R1 = úrovně 1–2 z definice R1         |

Texty čtou `params`, DESIGN 4.7 a testy (`jokers-epic`, `jokers-combos`) upravené. **Sledovat:** Kořenářka má Δ výher
+19 p. b. (pásmo vzácného v simulaci 4–10; 100 seedů, párový rozdíl má šum ~±6 p. b.) — přeměřit po fázi 6 a 7.

**Co — cíle** (`TARGET_CURVES`, DESIGN 2.3.1 a 2.3.3, testy `targets`, `stakes`, `game`): křivky předběžně podle
obsahu fáze 5 (30 žolíků, spotřebky, obálky, kupóny, bez šéfů a štítků). Základ patra 1–8 staré → nové:

| Křivka | Staré                                                    | Nové                                                  |
| -----: | -------------------------------------------------------- | ----------------------------------------------------- |
|      1 | 250, 650, 1 600, 4 000, 9 500, 20 000, 40 000, 80 000    | 250, 550, 1 100, 2 200, 4 200, 7 500, 13 000, 22 000  |
|      2 | 250, 750, 2 000, 5 500, 14 000, 32 000, 70 000, 150 000  | 250, 600, 1 200, 2 500, 4 900, 9 000, 16 000, 27 000  |
|      3 | 250, 850, 2 500, 7 500, 20 000, 50 000, 115 000, 250 000 | 250, 650, 1 300, 2 800, 5 800, 11 000, 20 000, 35 000 |

Postup: medián nejlepší ruky `max` po patrech (200 runů, nové boty, staré cíle) 760 / 1 740 / 3 300 / 5 400 / 8 200 /
16 000 (přeživší) — skóre bota roste ×1,5–2,3 za patro, staré cíle ×2–2,5. Zkoušky na Desítce (200 runů, SIM-A,
max / flush / pairs): `…2 600, 4 500, 8 000, 13 000, 22 000` → 32,5 / 25 / 24 % s vrcholem proher v patře 4;
patra 3–4 snížená (`1 100, 2 200, 4 200, 7 500`) → 39 / 36,5 / 23,5 % s vrcholem v patrech 5–6. Křivky 2 a 3 nejdřív
se starými poměry ke křivce 1 (až ×1,9 / ×3,1): Dvanáctka 2,5 %, Bock i Imperial 0 % s 20–28 % proher už v patře 2;
proto mírnější poměry (×1,1–1,25 / ×1,2–1,6).

**Výsledky simulací** (`npm run simulate -- --runs 300 --stake 1|8 --bot all`, seedy SIM-A; % výher, průměrné patro):

| Bot     | Desítka před | Desítka po  | Imperial před | Imperial po |
| ------- | ------------ | ----------- | ------------- | ----------- |
| max     | 0 %, 3,5     | 36 %, 6,3   | 0 %, 2,7      | 0,3 %, 3,7  |
| flush   | 0 %, 3,4     | 37 %, 6,4   | 0 %, 2,7      | 0 %, 3,6    |
| pairs   | 0,3 %, 3,3   | 23,3 %, 6,1 | 0 %, 2,6      | 0,3 %, 3,6  |
| econ    | 0 %, 2,6     | 25,3 %, 4,4 | 0 %, 1,9      | 0 %, 2,2    |
| random  | 0 %, 1       | 0 %, 1      | 0 %, 1        | 0 %, 1      |
| nojoker | 0 %, 2,4     | 0 %, 3,5    | 0 %, 2,1      | 0 %, 2,6    |

- Desítka, další sady seedů (300 runů, max / flush / pairs): SIM-B 43 / 35,7 / 29,7 %, SIM-C 41 / 31,7 / 27,7 %.
  Nejlepší rozumná strategie 37–43 % (cíl fáze 5 ~35–45 %; šéfové ve fázi 6 ji mají stáhnout k 25–35 %).
- Desítka `max`: prohry v patrech 1–2 4 % (cíl < 10 %), vrchol proher v patrech 5–6 (14 / 11 %), patro 8 dosáhne
  47 % runů. `nojoker`: medián prohry v patře 3 (cíl 3–4), `random` prohraje v patře 1 vždy. Peníze při vstupu do
  Večerky: patro 1 10,5 Kč, patro 4 27 Kč (cíl 8–14 / 15–30). Neplatné akce 0 u všech botů.
- Ostatní síly piva (`max`, 200 runů, konečné křivky): Jedenáctka 17 %, Dvanáctka 11 %, Bock 0 %, Imperial 0 %
  (300 runů 0,3 %).

**Mimo pásmo / otevřené:**

- **Střední síly piva** jsou pod pásmy DESIGN 10 (Jedenáctka 20–30, Dvanáctka 14–22, Bock 4–8 %). Bot je velmi citlivý
  na ekonomiku: samotné +1 Kč ve Večerce (Jedenáctka, stejná křivka) srazí výhry z ~40 na 17 %, zvětrávání a Ležák
  přidají prohry už v patře 2. Ladí se křivkami 2/3 a šancemi nálepek ve fázi 10 (DESIGN 12.4 krok 6), až budou šéfové.
- **CLAUDE.md kap. 3** chce v patře 8 řádově statisíce — dnešní obsah na to nestačí (staré cíle ~1 % výher i s novými
  boty). Patro 8 se zvedne s fází 7 (100+ žolíků, legendární ×mult); křivky se kalibrují znovu po fázi 6 a 7.
- `pairs` zaostává za `max`/`flush` (23–30 %); `econ` vyhraje 25 %, ale 36 % runů prohraje v patře 2 (rezerva
  25 Kč místo žolíků).
- `docs/ARCHITECTURE.md` (seznam souborů `engine/sim`) nový soubor `value.ts` zatím neuvádí — mimo rozsah tohoto
  úkolu, doplnit při nejbližší úpravě architektury.

**Proč:** CLAUDE.md kap. 8 (simulace, cílová % výher), DESIGN 4.3 (pásma žolíků), 12.1–12.5 (postup ladění, každá
změna čísla do DECISIONS a tabulek).

## 2026-10-02 — Revize a uzavření fáze 3 (herní UI v1)

**Co — revize proti CLAUDE.md kap. 4 a 6 a DESIGN 13:**

- **Texty natvrdo:** v `src/ui/**` ani `src/main.ts` není český text mimo i18n. Výjimky jsou vědomé: vlastní jména
  v Titulcích (písmo, autor, licence, nástroje — data, ne věty; věty jsou v `credits.*`) a vývojářské zprávy do konzole
  (`console.warn/error`, hráč je nevidí). Všechny statické klíče `t('…')` v UI existují (kontrola skriptem při revizi).
- **Přístupnost a ovládání:** nový `tests/e2e/a11y.spec.ts` projde menu, novou hru, nastavení, titulky a všechny fáze
  hry (výběr útraty, kolo, konec kola, Večerka se žolíky, obálka, pitva, výhra) a dialogy (Info o runu, balíček,
  pauza, detail žolíka): každý ovládací prvek má přístupný název, odkazy `aria-labelledby/-describedby/-controls`
  vedou na existující id, Tab chodí jen po viditelných prvcích a zaměřený prvek se viditelně změní (`:focus-visible`
  a jiný vzhled než bez focusu), dialog drží focus (Tab i Shift+Tab) a Esc ho vrátí na tlačítko, které dialog
  otevřelo. Tlačítka nákupu ve Večerce („Koupit za 4 Kč“) a volby obálky („Vzít“, „Použít“) dostala
  `aria-describedby` s názvem zboží — čtečka ví, co se kupuje (viditelný popisek zůstává názvem, WCAG 2.5.3).
- **Funkčnost:** `scripts/ui-walkthrough.ts` (QA nástroj, ne součást `test:e2e` — trvá minuty) projde celý run přes UI:
  bot z enginu rozhoduje, prohlížeč akce provádí střídavě klávesami a myší a **po každé akci musí být uložený stav
  bajtově stejný jako výsledek enginu z předchozího uložení**. Ověřeno 8 runy (bez animací i s animacemi 4×, boti
  max / flush / econ): 4 pitvy v patrech 1–6 a 3 výhry v patře 8 → reload → Nekonečný režim → patro 9–10; v 5 runech
  dva reloady uprostřed runu (autosave → Pokračovat). 0 rozdílů, konzole čistá.
- **Výkon:** CSS přechody i `@keyframes` animují jen `transform`, `translate` a `opacity`, Web Animations v presenteru
  také; presenter měří karty dávkově (FLIP: všechna čtení, pak zápisy). Náklon karty za myší (`bindTilt`) dřív četl
  `getBoundingClientRect` při každém `pointermove` — teď měří jen při najetí / stisku a zapisuje nejvýš jednou za snímek
  (`requestAnimationFrame`). Build: hlavní chunk 332 kB (109 kB gzip), ikony samostatný chunk 344 kB (155 kB gzip,
  dynamický import), CSS 64 kB (14 kB gzip).

**Opravy z revize:**

- **Engine — prodaný slot Večerky sdílel objekt s koupeným žolíkem / spotřebkou.** `buy` vložil do řady tentýž objekt,
  na který dál ukazoval prodaný slot; změna `state` žolíka (např. +mult po použití spotřebky) se propsala i do slotu,
  ale po uložení a načtení už ne — živý a načtený stav se rozešly (našel průchod `ui-walkthrough`). Koupě teď vkládá
  hlubokou kopii (`detached`), test v `tests/unit/game.test.ts`. Obálky problém nemají (vybraná možnost z nabídky
  zmizí).
- **`formatNumber(Number.MAX_VALUE)` = „∞“** (DESIGN 1.3: přetečení v nekonečném režimu ukazuje nekonečno; dřív
  `1,8e308`), test ve `format.test.ts`. Otevřený bod fáze 3 z ROADMAP tím je uzavřený; druhý (názvy útrat a hlášky
  pitvy jen v CLI) už vyřešil sdílený `DEATH_QUOTES` v `src/i18n/cs/game.ts`.

**Vědomě odloženo:** ruku jde přeskládat jen tříděním (S / B), ne tažením. Engine akci `reorderHand` má a babské rady
s pravidlem „karta nejvíc vlevo“ ji využijí — přesun karet v ruce (tažení myší i dotykem + klávesová alternativa)
patří do fáze 5 k výběru cílů spotřebek.

**Proč:** CLAUDE.md kap. 2 (UI jen přes controller, výkon), kap. 4 (ovládání, dotyk), kap. 6 (texty), kap. 8 (konzole
bez chyb, determinismus „stejný seed = identický run“ včetně uložení); DESIGN 13.1–13.3.

## 2026-10-02 — Revize obsahu fáze 5: texty, převzatá čísla, kombinace s enginem, fuzz

**Co:** prošly se všechny vyrenderované popisky (`t()` s `params`) 13 pranostik, 22 rad, 16 razítek, 15 obálek
a 24 kupónů proti kódu a DESIGN (čísla, cíle, ceny, pravopis, tykání, rodová neutralita, názvy ≤ 3 slova, flavor,
názvy a čísla z cizích her). Nový test `tests/unit/phase5-review.test.ts`: každá spotřebka v kole šéfa, s prázdnou
rukou, na výběru útraty, ve Večerce přes „Koupit a použít“ (volné i plné sloty) a v obálce (použít / nechat si),
špatný počet cílů, tajné pranostiky, každý kupón přes uložení a načtení, chaos fuzz (60 runů, všechny akce
s náhodnými cíli, vnucený obsah) a všichni boti na všech balíčcích na Desítce i Imperialu. Registr testu = skutečný
obsah + testoví šéfové a dva testoví legendární žolíci (Odvolání a Výjimku z vyhlášky jinak se skutečným obsahem
použít nejde, dokud fáze 6 a 7 nepřinesou šéfy a legendy). Nálezy a opravy:

- **Převzatá čísla (CONTENT-GUIDE 13, DESIGN příloha A):** rozdělení „zaručené“ edice 50 / 35 / 15 % (Hromadné
  vyřízení, Kontrola totožnosti; v DESIGN i štítek Vyleštěné příbory) → **55 / 30 / 15 %**; šance edic hrací karty
  4 / 2,8 / 1,2 % → **5 / 2,5 / 1 %** (`EditionDef.weightCard`); vylepšení karty v karetní obálce 40 % → **35 %**
  (`BOOSTER_CARD_ENHANCE_CHANCE`). Původní trojice byly 1:1 čísla cizí hry; síla se změnila jen nepatrně.
- **Přeložený cizí název:** babská rada „Zaříkávání“ (`incantation`) = přeložený název karty cizí hry →
  **„Zaklepat na dřevo“ (`knock_on_wood`)**, mechanika beze změny, nový flavor „Ťuk, ťuk, ťuk. Hlavně to
  nezakřiknout.“, ikona pěst na dřevěném pozadí. Id kupónu Kartářka `fortune_teller` (anglický název cizího žolíka)
  → **`card_reader`**; český název zůstává (běžné slovo). Hráč ani uložení id ještě nevidí (před 1.0, bez migrace).
- **Kolaudace přeplnila sloty:** s plnými sloty šla „Koupit a použít“ (nebo použít z obálky) a ve slotech pak zůstaly
  2 spotřebky na 1 slot. `canUse` teď chce, aby se ostatní spotřebky po ubrání slotu vešly (razítko ze slotu svůj
  slot uvolní, i s negativní edicí); text to říká.
- **Negativní spotřebka si odnese svůj slot:** Rosnička a Babiččin recept počítaly volné místo i se slotem vlastní
  negativní edice, který po použití zmizí (`canUse` řekl ano, nic se nevytvořilo). Opraveno (v 1.0 negativní spotřebky
  běžně nevznikají, engine je podporuje).
- **Rady, které by nic nezměnily, nejdou použít** (DESIGN 5.3 „bez platného cíle je Použít neaktivní“): Babiččina
  barva, když všechny vybrané karty už mají barvu levé; Zrcátko v předsíni na dvě karty stejné hodnoty; Kynuté těsto
  na samá esa. Dřív se rada spotřebovala naprázdno.
- **Texty:** obálky „Vyber 1 z 3 pranostik“ (správně „ze 3“, ale „z 5“ — šablona to neumí) → „Nabídne 3 pranostiky,
  vybereš 1.“ s `|plural:`; Trhací kalendář „z 3 na 7“ → „(váha každé 3 → 7, žolíci mají 14)“; kupóny s číslem
  a slovem používají `|plural:` (dřív pevný tvar „ruka“, „karta“, „slot“); Rosnička, Babiččin recept a Odvolání mají
  mechaniku v jedné větě (Recept nově říká, že potřebuje volný slot, jako Rosnička); Kolaudace zmiňuje, že se ostatní
  spotřebky musí vejít. Flavor Svatého Václava je teď věrohodná pranostika („Na svatého Václava sklizeň bývá hotová.
  I ta královská.“) — jako jediná ji neměl ani v názvu, ani ve flavoru.
- **Ověřeno bez nálezu:** ceny, cíle, váhy a čísla všech 51 spotřebek, 15 obálek a 24 kupónů sedí s DESIGN 2.9, 5 a 6;
  sleva neplatí na přehození a Amnestie ano (jak říkají texty); chaos fuzz i boti bez výjimky a bez neplatných akcí,
  stav po každém kroku JSON-bezpečný a po uložení a načtení shodný (i modifikátory); `canUseConsumable` = `dispatch`.

**Vědomě ponecháno:**

- Pravděpodobnost „{chance} z {odds}“ (1 z 4, 1 z 12) zůstává zápisem v celé hře (i u žolíků); správné „ze 4“ by
  potřebovalo filtr předložky ve `format.ts` a sjednocení všech textů — nápad do `docs/IDEAS.md`.
- Nominativní popisky rad „Až {cards} vybrané karty dostanou…“ mají tvar pro 2–4 napsaný rovnou: `|plural:` by
  nespravil shodu slovesa („1 karta dostane“, „5 karet dostane“). Při změně čísla přepsat i text.
- Výjimka z vyhlášky a Odvolání se nabízejí, i když je se skutečným obsahem zatím nejde použít (fáze 6/7 doplní šéfy
  a legendy); fallback popisku obálky v `src/i18n/cs/art.ts` („Vyber {picks} z {options}.“) patří UI workflow.

**Proč:** CLAUDE.md kap. 3, 5, 6 a 7 (žádné názvy, texty ani čísla z cizích her), kap. 8 (testy, determinismus);
CONTENT-GUIDE 12–13; DESIGN 2.6, 2.9, 5.1–5.4, 6, příloha A.

## 2026-10-02 — Fáze 6: běžní šéfové 1–13 (výklad pravidel)

**Co:** `src/content/bosses/a.ts` (`BOSSES_A`), texty `src/i18n/cs/bosses/a.ts`, testy `tests/unit/bosses-a.test.ts`
(skutečný engine: kolo šéfa, zahrání, zahození, dobírání, Odvolání, uložení a načtení). Id, od patra, cíle, příchody
a porážky podle DESIGN 8.2; pitva podle přílohy C, u šéfů 6–13 vlastní hlášky. Bez změny enginu — stačily existující
hooky a `EngineApi` (včetně `cardRank` a `BossDef.params`, které doplnila skupina šéfů 14–25).

- **Strop „jen 1 ruka / 0 zahození / nejvýš 4 karty“** (Polední pauza, Sucho v obci, Garsonka 1+kk) = `passive`
  s rozdílem spočítaným v `onRoundStart` a uloženým v `round.flags` (ARCHITECTURE 2.7). Prostá delta (`hands: −3`)
  by s kupónem nebo balíčkem s jiným počtem rukou neplatila přesně; nové pole „strop“ v `Modifiers` by potřebovalo
  jinou skládací sémantiku (minimum). Žolík/štítek, který ruku přidá až během kola, platí navíc; Odvolání vrátí rozdíl.
- **Výluka na trati:** „každá druhá líznutá karta“ se počítá přes všechna dobrání kola (počítadlo v `round.flags`,
  hook `onDraw` + `setCardFaceDown`) — na začátku kola 2., 4., 6., 8. karta, pak střídavě dál. `drawIndex` v
  `isDrawnFaceDown` je jen pořadí v jednom dobrání (po zahrání 1 karty by nikdy nic nezakryl).
- **Inventura** používá `api.isFace`: se `allFaces` (Dvorní malíř, fáze 7) je mimo provoz každá karta s hodnotou —
  vědomá protisynergie, pravidla figur platí všude stejně (DESIGN 2.1). Kamenná karta figurou není.
- **Pověrčivá babka:** barva se losuje streamem `boss` v `onRoundStart`; divoká karta (všechny barvy) je mimo provoz,
  kamenná ne; `mergedSuits` platí jako všude (`api.hasSuit`). Hláška z DESIGN „…špatný den na {suit}.“ je
  `bosses.superstitious_granny.omen.<S|H|D|C>` (čtyři hotové věty, `api.message` po vylosování), protože UI ukazuje
  `intro` už při výběru útraty bez parametrů a obsah nesmí skládat české názvy barev; `intro` je „Počkej, nejdřív se
  kouknu do snáře.“
- **Černá kočka** vybírá 2 karty náhodně (stream `boss`) z karet, které po zahrání zůstaly v ruce (před dobráním),
  a vynechá už prokleté a vrácené do provozu (`cleansedCards`) — kletba tak vždy zasáhne nové karty. Méně karet
  v ruce = prokleje, kolik jich je.
- **Kapsář v tramvaji:** „nejvyšší hodnota“ = eso nejvýš, kamenná hodnotu nemá; při shodě karta nejvíc vlevo (hráč
  pořadí ovlivní přeřazením). Nucené zahození nespotřebuje zahození a ruka se dobere hned po zahrání. Mlha nad Labem
  stejně: kamenná trojka hodnotu nemá → lícem nahoru.
- **Exekutor:** vybírá jen z fungujících žolíků (zvětralý je už mimo provoz, zabavení by nic nezměnilo); při shodě
  prodejní ceny žolík nejvíc vlevo. Debuff je na uid (přeřazení ho nepřenese) a končí s kolem nebo Odvoláním.
- **Kontrola z finančáku, Parkovné:** srážka `addMoney(−1)` do dluhového limitu (bez peněz a bez limitu nic);
  daň po každé zahrané ruce včetně ruky zakázané Sousedem, parkovné za každé zahození bez ohledu na počet karet.
- **Odchylka — čísla v `rule` napsaná rovnou:** UI `bossTexts` (`src/ui/describe.ts`) zatím nepředává `params` šéfů,
  takže `{param}` by se v levém panelu a na výběru útraty ukázal nedosazený (a padal by `tests/unit/ui-art.test.ts`).
  Čísla jsou proto v textu a v `params`; test hlídá, že každé číslo z `params` v pravidle je. Až `bossTexts` dosadí
  `describeParams(def.params)`, přepíše se `rule` na `{fee|money}`, `{hands|plural:ruku,ruce,rukou}` apod.
- `tests/unit/ui-game.test.ts` (výběr útraty) čekal registr bez šéfů („obecné pravidlo“) — teď ověřuje jméno
  vylosovaného šéfa, bez šéfů v registru dál obecný text.

**Proč:** CLAUDE.md kap. 3 (šéfové s jedním jasným pravidlem), 5 (humor), 6 (texty jen v i18n), 8 (test na každou
položku, determinismus); DESIGN 8.1–8.2, příloha B a C; CONTENT-GUIDE 4 a 12.

## 2026-10-02 — Fáze 6: běžní šéfové 14–25 a fináloví šéfové F1–F5 (výklad pravidel, engine)

**Co:** `src/content/bosses/b.ts` (`BOSSES_B`) a `src/content/bosses/final.ts` (`BOSSES_FINAL`, `final: true`), texty
`src/i18n/cs/bosses/{b,final}.ts`, testy `tests/unit/bosses-b.test.ts` a `tests/unit/bosses-final.test.ts` (skutečný
engine: kolo šéfa, zahrání, zahození, přeřazení, prodej, Odvolání, konec kola, uložení a načtení). Id, od patra, cíle,
příchody a porážky podle DESIGN 8.2–8.3; pitva finálových šéfů podle přílohy C, u běžných 14–25 vlastní hlášky.

**Engine (obecně, s testy):**

- `BossHooks.isJokerDebuffed(ctx, joker, index)` — čistá funkce „má být žolík na této pozici mimo provoz?“. Engine ji
  přepočítá na začátku kola, po ruce, po zahození a po každé akci v kole (`refreshBossJokerDebuffs`), takže Jednooký
  hejtman sleduje **pozici** i po přeřazení a Výpadek proudu skončí hned po první ruce (ruka se pak dobere už se
  žolíky). Vypnuté žolíky eviduje volitelné `RoundState.ruleJokerDebuffs` (podmnožina `jokerDebuffs`) — cizí debuff
  (Krajský úřad) pravidlo nepřivlastní ani nezruší; bez migrace (chybí = žádné). Alternativa „dynamická kontrola
  pozice všude, kde se čte `debuffed`“ by znamenala měnit skórování, modifikátory, kopírování, odměny i UI.
- Ruce/zahození z pasivních efektů žolíků se po přepočtu nemění (platí stav na začátku kola jako u Exekutora) —
  jinak by šlo přeřazováním pod Hejtmanem ruce sbírat.
- `EngineApi.cardRank(card)` (kamenná karta hodnotu nemá → `null`, při Bílé hoře ano) a `BossDef.params`.
- `scripts/joker-value.ts`: ruce, ve kterých byl měřený žolík mimo provoz kvůli šéfovi (Výpadek proudu, Hejtman,
  Exekutor, Krajský úřad), se do hodnoty žolíka nepočítají — o jeho síle nic neříkají (kouřový test Pivního tácku).

**Výklad pravidel:**

- **Krajské derby:** rozhoduje celá zahraná ruka (i neskórující karta). Divoká karta (všechny barvy) ani kamenná (žádná)
  stranu nevolí, `mergedSuits` na červené/černé nic nemění. Poloviny nahoru (DESIGN 8.2), i v náhledu ruky.
- **Nová vyhláška:** `modifyBase` = `api.handBase(typ, 1)`; náhled ukazuje čipy × mult úrovně 1 (číslo úrovně v náhledu
  zůstává skutečné — UI).
- **Zabijačka:** po ruce (`afterHandPlayed`, stream `boss`) zničí 1 kartu ze skórujících (i mimo provoz), karty
  zničené už během skórování vynechá; skóre ruky se nemění, zničení je trvalé (balíček runu).
- **Bílá hora / Normalizace / Kocovina:** `passive` (`disableEnhancements`, `fixedCardChips: 5`, `hands: −1`) — Odvolání
  vrátí vše jako u každého `passive`. Normalizace dává 5 čipů i kamenné kartě (+50 z vylepšení) a ignoruje trvalé
  bonusové čipy karty (`cardChips`).
- **Jednooký hejtman:** mimo provoz pozice `≥ ceil(n/2)` (5 → 4. a 5., 4 → 3. a 4., 1 → nikdo); počítá se celá řada
  včetně zvětralých a negativních žolíků. Na začátku kola po `onBlindSelect` žolíků (jako Exekutor).
- **Tchyně na návštěvě:** náhodná karta ze zbytku ruky (zahazované karty už v ruce nejsou), `api.discardFromHand` —
  nespotřebuje zahození a nespouští pečetě ani žolíky na zahození; ruka se dobere normálně.
- **Influencerka Nikča:** kombinace se vybere jednou v `onRoundStart` podle `handLevels[*].played` (počty za run),
  při shodě silnější (pozdější v `HAND_TYPES`), uloží se do `round.flags['influencer.hand']` a během kola se nemění.
  Bez zahraných kombinací nepůlí nic. Kterou kombinaci si vybrala, hráč pozná z náhledu (UI ji zatím nevypisuje).
- **Výpadek proudu:** „v první ruce kola“ = od začátku kola do zahrání první ruky, tedy i při zahazování před ní
  (`onRoundStart` žolíků taky ne). Pasivní velikost ruky se vrátí hned po první ruce; pasivní ruce/zahození žolíků
  se v tomto kole nezapočítají (stav na začátku kola).
- **Sudé dny:** A, 3, 5, 7, 9 přes `cardRank` — figury (J = 11 taky) ani kamenné karty liché nejsou.
- **Pan starosta:** `adjustHandScore` porovná skóre ruky se **skutečným** skóre předchozí ruky (i nezapočítané),
  ostře větší; první ruka kola vždy. Předchozí skóre v `round.flags['mayor.lastScore']`.
- **Krajský úřad:** po každé ruce `setJokerDebuffed` na náhodného fungujícího (nedebuffnutého) žolíka; zvětralý
  se nevybírá, když nefunguje nikdo, nic. Konec kola a Odvolání debuffy ruší.
- **Velká voda:** místo `api.addRoundHandSize(−1)` počítadlo `round.flags['great_flood.hands']` + `passive`
  `handSize: −počet` — Odvolání tak vrátí celou velikost ruky a dočasná velikost z jiných efektů zůstane. Ruka nejmíň
  1 karta (`clampModifiers`), karty navíc se nezahazují.
- **Bílá paní:** po ruce i zahození se karty, které v ruce **zůstaly**, otočí lícem dolů a zamíchají (`shuffleHand`);
  nově dobrané přijdou lícem nahoru. Celá ruka zakrytá by byla hra naslepo, takhle je to paměťovka.
- **Odchylka — čísla v `rule` napsaná rovnou** (stejně jako skupina 1–13): `bossTexts` v `src/ui/describe.ts`
  `params` šéfů nedosazuje. Testy hlídají, že každé číslo z `params` v pravidle je. Až UI dosadí
  `describeParams(def.params)`, přepíší se pravidla na `{level}`, `{chips|plural:čip,čipy,čipů}` apod.

**Proč:** CLAUDE.md kap. 3 (šéfové s jedním jasným pravidlem, 5 finálových), 5 (humor), 6 (texty jen v i18n), 8 (test
na každou položku, determinismus — náhoda jen streamem `boss`/`deck`); DESIGN 8.1–8.3, příloha B a C; CONTENT-GUIDE 4.

## 2026-10-02 — Uzavření fáze 4 (žolíci v1 + Večerka): audit, finální ověření a vizuální opravy

**Co:** Fáze 4 je uzavřená, všech 13 podúkolů v `ROADMAP.md` odškrtnutých po kontrole proti kódu. Commit
`feat: jokers v1 and shop` čeká — pracovní strom sdílí rozpracované změny fází 5–6, commitují se jen soubory fáze 4
(výčet v `ROADMAP.md`, Aktuální stav).

- **Doplněno v auditu:** oprava tažení žolíka prstem (`src/ui/screens/game/topRow.ts` — dotykové tažení se rušilo hned
  po startu); Napodobitel v řadě (odznak s maskou a šipkou, zvýrazněný kopírovaný žolík, „Teď kopíruje: …“ /
  „Právě ho kopíruje: …“ v popisku pro čtečky, tooltipu, detailu i Info o runu); poznámka „Nejde zkopírovat“
  u `copyable: false`; tooltip zboží ve Večerce s cenou i prodejní cenou (engine počítá nad kopií stavu); Info o runu
  se žolíky v pořadí vyhodnocení, stavem počítadel, edicí, nálepkami a mimo provoz; testy `tests/unit/ui-jokers.test.ts`
  a `tests/e2e/jokers.spec.ts` (myš, dotyk, Napodobitel; konzole bez chyb).
- **Vizuální opravy z finální kontroly** (snímky Playwrightem v `test-results/phase4/`: 1366×768, 1024×768, 1920×1080,
  tablet 820×1180, telefon 390×844 — Večerka se žolíky, tooltipy, detail, řada v kole s negativním a zvětrávajícím
  žolíkem, Info o runu):
  1. **Tlačítka polic Večerky nebyla v jedné linii**, když se název zalomil („Krabice od bot · Hrací karty“ — tlačítko
     o řádek níž než soused). `.shop-slot__name` má `min-height` na dva řádky, takže hlavní tlačítko (Koupit / Otevřít
     / Uplatnit) sedí ve všech policích ve stejné výšce a „Koupit a použít“ visí pod ním. Zamítnuto: tlačítka ke dnu
     slotu (`margin-top: auto`) — se spotřebkou ve zboží by se „Koupit“ ostatních slotů zarovnalo s „Koupit a použít“;
     CSS subgrid s `auto-fill` — v obsahem určené šířce flex položky by se spočítal jediný sloupec.
  2. **1024×768 se spotřebkou ve zboží** (dvě tlačítka) byla Večerka o 27 px vyšší než stůl a spodní tlačítka obálek
     a kupónu uříznutá (už před fází 4 o 25 px). Media query `(min-width: 901px) and (max-height: 800px)` Večerku
     sevře: užší tlačítka lišty (cedule se nezalomí na dva řádky), menší mezery polic a spodní odsazení panelu.
     Všechna tlačítka jsou vidět, zbývá ~8 px posunu stolu (jen dřevěná lišta police). Jen layout, žádná animace.
  3. **Text negativní edice** dával v tooltipu dvě dvojtečky za sebou („Negativní: Přinese si vlastní místo: +1 slot…“).
     Nově „+1 slot pro svůj druh (žolíka nebo spotřebku) – přinese si vlastní místo.“ (číslo napřed jako u ostatních
     edic, `src/i18n/cs/modifiers.ts`).
  - Prověřeno, není chyba: „(teď+3 mult)“ v Info o runu — v DOM mezera je, jen háček „ď“ v Pixelify Sans do ní
    vizuálně zasahuje; „Nejde zkopírovat – …“ má pomlčku, Pixelify ji kreslí krátkou.
- **Ověření** (celý pracovní strom včetně rozpracovaných fází 5–6): `npm run typecheck` ✓, `npm run lint` ✓,
  `npm test` 46 souborů / 1 999 testů ✓, `npm run build` ✓, `npm run test:e2e` 29 ✓ (60 vizuálních přeskočeno bez
  `KARBAN_VISUAL=1`). První běh e2e souběžně s úpravami jiného workflow (build zachytil rozpracované soubory) hlásil
  15 selhání; opakovaný běh na ustáleném stromu 29/29 — selhání byla přechodná, ne regrese fáze 4.

**Proč:** CLAUDE.md kap. 9 (definice hotovo fáze), kap. 4 (Večerka, řada žolíků s drag & drop, Info o runu), kap. 6
(typografie textů), kap. 2 (min. 1024 px, dotyk plně funkční); DESIGN kap. 4 a 13.

## 2026-10-02 — Fáze 6: štítky za přeskočení (20) — výklad efektů a rozšíření enginu

**Co:** 20 štítků z DESIGN 7 v `src/content/tags.ts`, texty `src/i18n/cs/tags.ts`, testy `tests/unit/tags.test.ts`
(přes skutečný engine: přeskočení útraty, výběr útrat, Večerka, obálky, rozpis odměn, záchrana kola, uložení).

Rozšíření enginu (obecná, s testem; zapsáno v `docs/ARCHITECTURE.md` 2.6–2.8):

- **`EngineApi.openBooster(id)`** — obálka zdarma do fronty `RunState.flags.pendingBoosters`; `Game.dispatch` (a konec
  `newRun`) ji po akci otevře přes `startBooster`, jakmile je fáze výběr útraty nebo Večerka, zavření vrátí tam.
  Fronta místo okamžitého otevření: štítek může přijít i uprostřed kola nebo při zavírání jiné obálky — obálka pak
  počká (Večerka), víc obálek se otevře postupně a fronta přežije uložení. Bez nového pole ve `RunState` (flags).
- **`TagHooks.roundEndMoney`** — řádek `tag:<id>` v rozpisu odměn (DESIGN 2.4.2 krok 5, za balíčkem). `onRoundEnd`
  štítků se přesunul **za** sestavení rozpisu, aby se vyplácející štítek mohl v `onRoundEnd` spotřebovat (dřív běžel
  před rozpisem; žádný obsah na pořadí nezávisel).
- **`onShopEnter` štítků až po vygenerování Večerky** (dřív před) + příkazy `addFreeRerolls`, `addShopJoker`,
  `setShopJokerEdition`, `addShopVoucher`. Štítky „v příští Večerce“ tak upravují skutečnou nabídku; `passive` štítku
  při generování dál platí. Cesta `flags.freeRerolls` (přehození zdarma mimo Večerku) zůstává.
- **Pole položek Večerky** `priceMult`, `noEditionSurcharge`, `extra` (`ShopPriced`) — přepočet cen po každé akci
  je respektuje, takže sleva ze štítku nepřepíše a nezmizí. `extra` položky (žolík navíc) přehození nemění a do
  `shopCardSlots` se nepočítají (`syncShopSlots`).
- **`Modifiers.bossTargetMult`** (1) — násobí jen cíl šéfa (Šéf má chřipku 0,75 přes `passive`). Nový modifikátor
  místo úpravy `round.target`: náhled cíle šéfa na výběru útrat ukazuje sníženou hodnotu hned po přeskočení.

Výklad efektů (kde DESIGN 7 nechává prostor):

- **„Příští Večerka“** = `onShopEnter` první Večerky po získání; po přeskočení se Večerka nekoná, štítek čeká.
  **„Příští kolo“** = `onRoundStart` prvního kola po získání.
- **Obálky zdarma** (Obálka od strýce, Kalendář z trafiky, Balík od babičky, Úřední dopis, Mariáš na chalupě): otevřou
  se hned po přeskočení, zavřením (výběr i přeskočení) zpět na výběr útraty. Id obálek přes `boosterId(kind, size)`.
- **Zálohy:** počítá `stats.blindsSkipped`, které se zvýší před přidáním štítku — „včetně této“ tedy platí samo.
- **Brigáda na chmelu:** `floor(stats.handsPlayed / 2) × 1 Kč`, nejvýš 15 Kč.
- **Vyleštěné příbory / Fotonegativ:** „příští žolík“ = první **neprodaný žolík bez edice** v nabídce při vstupu;
  dostane edici (55/30/15 % streamem `tag`, resp. negativní) a cenu bez příplatku. **Odchylka:** když v nabídce
  žolík bez edice není, přibude žolík navíc (náhodná vzácnost podle vah) s touto edicí — štítek nepropadne naprázdno
  a nemusí čekat na přehození (DESIGN říká „spotřebuje se: příští Večerka“).
- **Doporučení od známého / Protekce:** žolík navíc (`extra`) dané vzácnosti, nálepky a edice jako v obchodě; poloviční
  cena = `priceMult 0,5` před slevou (zaokrouhlení polovinou nahoru jako u slev). Přehození položku navíc nechá.
  Popisek Doporučení „o 50 % levněji“ (číslo z `params`, ne slovo „poloviční“).
- **Úřední poukaz:** kupón navíc jen v té Večerce (z kupónů, které jde teď koupit a nejsou v nabídce); do kupónů patra
  se nezapíše, takže v další Večerce už není.
- **Šéf má chřipku:** platí pro nejbližší kolo šéfa (štítek jde získat jen před šéfem patra, takže je to „šéf tohoto
  patra“); spotřebuje se v `onRoundStart` kola šéfa, cíl je v tu chvíli spočítaný. Velká útrata s pravidlem šéfa
  (Imperial) ho nespotřebuje ani nesníží. Dva štítky se násobí (× 0,5625).
- **Termínovaný vklad:** vyplatí 15 Kč v rozpisu nejbližšího vyhraného kola šéfa (i zachráněného Lékařským
  potvrzením), Malá/Velká nic.
- **Předpověď počasí:** nejčastěji hraná podle `handLevels[*].played` (stejně jako Influencerka Nikča), při shodě
  pozdější v `HAND_TYPES`, bez zahraných rukou Vysoká karta.
- **Lékařské potvrzení:** „aspoň 50 %“ = `skóre × 100 ≥ cíl × 50` (přesně polovina stačí). Platí jen v kole, které
  začalo po získání (`self.state.armed` v `onRoundStart`) — štítek získaný uprostřed kola čeká na další. Vyhrané kolo
  bez potřeby záchrany štítek spotřebuje (`onRoundEnd`).
- **Bazar u silnice:** `api.createJoker({ rarity: 'common' })`; když vrátí null (plné sloty), +4 Kč.
- **Hromadění:** každý štítek působí sám za sebe (dva Termínované vklady = 2× 15 Kč, dvě chřipky se násobí).

**Pro UI (mimo tento krok):** obálka zdarma otevřená z výběru útraty má `booster.returnTo = 'blind_select'`;
rozpis odměn má zdroj `tag:<id>` (popisek `tags.<id>.name`); položky Večerky s `extra`/`priceMult`/`noEditionSurcharge`
stojí za odlišení (štítek „navíc“, přeškrtnutá cena).

**Proč:** CLAUDE.md kap. 3 (štítky za přeskočení, 20 kusů), 5 (humor), 6 (texty v i18n), 8 (test na každou položku,
determinismus — náhoda jen streamy `tag`/`shop`/`booster`/`joker`); DESIGN 7 a 2.4.2; ARCHITECTURE 2.7.

## 2026-10-02 — Fáze 6: UI šéfů a štítků

**Co:** šéfové a štítky jsou vidět a srozumitelné v celém UI.

- **Výběr útraty:** karta šéfa se žetonem (barva `BossDef.color`), pravidlem, cílem a odměnou; žeton má tooltip
  s pravidlem a hláškou příchodu (na kartě samotné hláška není, ať příchod něco překvapí). Když štítek mění cíl šéfa
  (`Modifiers.bossTargetMult`, Šéf má chřipku), karta to napíše („Šéf je oslabený: cíl −25 %“). Na Imperialu má
  Velká útrata „Pravidlo navíc“ i v levém panelu a na plakátu. Nízké okno (≤ 800 px) karty útrat zhušťuje, ať se
  i Velká útrata s pravidlem a štítkem vejde bez posouvání.
- **Příchod šéfa = plakát nad stolem** (žeton, „Šéf N. patra“, jméno, pravidlo, `intro` v uvozovkách), ne toast:
  je to hlavní moment kola. Neblokuje (pointer-events: none), visí 4,2 s skutečného času (text se musí dát přečíst
  i při rychlosti 4×) nebo zmizí, jakmile hráč zahraje / zahodí; čtečkám ho oznámí živá oblast. Porážka šéfa a použitý
  štítek jsou oznámení se žetonem (`toast` umí `title` a `media`). Přeskočení se štítkem použitým hned (obálky,
  peníze) je jedna hláška „Útrata přeskočena. Štítek: X.“ s tím, co štítek udělal — dvě hlášky o tomtéž byly šum.
- **„Proč?“ v tooltipu:** karta mimo provoz nebo lícem dolů a žolík vypnutý šéfem (`round.jokerDebuffs` — jen šéfové
  ho plní) dostanou řádek „Šéf X: pravidlo“, jen když pravidlo v kole platí (`bossReasonText`; po Odvolání nic).
  Čipy karty mimo provoz jsou v tooltipu ztlumené. Vypnutí / zapnutí žolíka během kola ukáže bublina „Mimo provoz!“ /
  „Zase jede!“ (zrušení na konci kola se neohlašuje).
- **Soused s vrtačkou předem:** `HandPreview.blockedReason` (engine, test v `scoring.test.ts`) — levý panel u výběru
  napíše „Neskóruje: …“ a přeškrtne čipy × mult. Pole je nepovinné (chybí = ruka projde), aby se neměnily existující
  porovnání náhledu. Volá se čistý `validateHand` v `readOnly`.
- **Velikost ruky** je v kole vidět vždy („Ruka: 8 karet“), změna proti začátku kola se zvýrazní („(−1)“) a po
  animaci ohlásí („Velká voda: ruka se zmenšila na 7 karet.“). Během přehrávání se číslo nemění (engine už má stav
  po akci). Po načtení uprostřed kola je výchozí hodnotou aktuální velikost (začátek kola UI nezná).
- **Štítky v levém panelu** jako malé žetony (tlačítka kvůli focusu a tooltipu), skryté, když žádné nejsou. Rozpis
  odměn má řádek „Štítek: Termínovaný vklad“ (zdroj `tag:<id>`). Zboží ze štítků má ve Večerce nálepku nad cenovkou
  („Navíc“, „Sleva 50 %“, „Edice zdarma“; celá řada polic se posune, ať karty zůstanou v linii).
- **Pitva** na šéfovi: žeton + hláška `death` + „Jméno: pravidlo“; Malá / Velká útrata obecné hlášky (příloha C).
  Info o runu má sekci „Šéf N. patra“ (pravidlo, cíl, stav; Imperial i pravidlo Velké útraty).
- **Otočení karty** (Bílá paní, odkrytí zahrané karty lícem dolů) má krátkou animaci překlopení (scaleX, vypnutelnou).
- `bossTexts` dosazuje `BossDef.params` do `rule`/`intro`/`defeat`/`death`, takže texty šéfů můžou přejít na
  `{param}` (teď mají čísla napsaná rovnou — přepis je na obsahu, testy obsahu kontrolují surový text).

**Proč:** CLAUDE.md kap. 3 (šéfové s hláškou při příchodu i porážce, štítky), 4 (výběr útraty, levý panel, pitva,
Info o runu), 5 (pitva podle příčiny), 6 (texty v i18n); DESIGN 7, 8, 13.1–13.2, příloha C. Ověřeno
`tests/unit/ui-bosses.test.ts` a `tests/e2e/bosses.spec.ts` (snímky v `test-results/phase6/`).

## 2026-10-02 — Fáze 7: legendární žolíci a přepracování čtyř žolíků pod pásmem

**Co — legendární žolíci (8, DESIGN 4.8):** `src/content/jokers/legendary.ts`, texty `src/i18n/cs/jokers/legendary.ts`,
testy `tests/unit/jokers-legendary.test.ts` (+ scénáře v `jokers-combos.test.ts`). Všichni `rarity: 'legendary'`,
cena 16 Kč (prodej 8 Kč), `noShop` — v nabídce Večerky ani v obálkách nejsou, vznikají jen razítkem „Výjimka
z vyhlášky“ (test s obsahem hry: rozdá postupně všech 8 různých, pak `canUse` = false). Všichni jdou kopírovat.
Výklad a změny proti tabulce 4.8:

- **Praotec Čech:** úroveň v `beforeScoring`, takže platí už pro tuto ruku; „první ruka“ = `ctx.firstHand` (ruka
  zakázaná šéfem `beforeScoring` nespustí a další už první není). Kopie zvýší úroveň znovu (chová se jako druhá
  instance), počítadlo `levels` pro popisek („zatím +N úrovní“) zvedá jen originál. Hláška jde přes `api.message`, ne jako
  krok skórování — krok bez čipů a multu v kroku 1 by se pletl s krokem edice.
- **Kněžna Libuše:** ×1,5 za dámu → **×1,4 a navíc na konci kola promění 1 náhodnou drženou kartu v dámu**
  (`onRoundEnd`, stream `joker`; jen karty s hodnotou, které dámou nejsou). Samotná ×1,5 za dámu (1/13 karet) dává
  +27 % / +27 % (R1 / R2, 30 seedů) — hluboko pod 150 / 100. S proměnou: ×1,5 R2 186 %, ale špička 659 % > 600 %;
  ×1,3 R2 77 %; proměna jen po šéfovi (×1,5) R2 70 %; **×1,4 R2 121 %, špička 438 %** ✔. Dáma = `api.cardRank` (kamenná
  ne, divoká ano). Kopie promění další kartu.
- **Blaničtí rytíři:** „pod polovinou“ = skóre kola před rukou × 100 < cíl × 50 (přesně polovina už ne).
- **Bruncvíkův meč:** „nejnižší“ podle `api.cardRank`; kamenná karta (bez hodnoty) se nepočítá, při shodě první
  v pořadí zahození. Kartu ničí a meč brousí jen originál, kopie dává jen ×mult. Stav `cuts`, ×mult = 1 + 0,2 × cuts
  (setiny zaokrouhlené). `params.base` vypuštěno (popisek ho nečte, `(teď ×1)` ukazuje začátek).
- **Doktor Faust:** +×0,05 → **+×0,06** za korunu (60 seedů: R2 100,6 % na hraně pásma → 119,0 %); strop ×5 od 67 Kč;
  peníze v okamžiku skórování, dluh = ×1.
- **Krakonoš:** kombinaci pranostiky zná registr — nový dotaz `EngineApi.consumableHand(defId)`. +2 Kč hned
  (mimo rozpis odměn). Kopie (Napodobitel ji ale nevybere, viz níže) by přidala úroveň i peníze znovu.
- **Hloupý Honza:** přesně Vysoká karta a Dvojice (ne „obsahuje“); `params.hand = 'pair'` je nápověda pro boty.
- **Orloj:** ×1 / ×2 / ×3 / ×4 → **×2 / ×3 / ×4** (od třetí ruky). Původní čísla +43 % / +69 % — v patrech 1–3 je
  ~80 % rukou první ruka kola. Pořadí = `round.handsPlayed` před rukou (zakázaná ruka se počítá).
- Ikony (hlavní ikona i dvojice ikona + rekvizita jsou unikátní): vousy + chalupa, křišťálová koule + koruna,
  zkřížené meče + hory, koruna + meč, smlouva + čertí maska, bouřka + smrk, sedlák + chleba, přesýpací hodiny + lebka.

**Co — engine (obecné dotazy, testy v `jokers-legendary.test.ts`):** `EngineApi.consumableHand(defId)` (kombinace
`ConsumableDef.hand`, jinak null) a `EngineApi.jokerCopyable(defId)` (`copyable !== false`, neznámý žolík false). Druhý
nahradil statický seznam nekopírovatelných žolíků v `epic.ts` (DECISIONS fáze 4 ho uváděl jako „čistší cestu do
budoucna“) — Napodobitel se teď ptá registru, takže funguje i s testovacím obsahem a se žolíky ze všech skupin.

**Co — přepracování (DESIGN 4.7, č. 7, 24, 25, 28):** mechanika, kterou číslem do pásma dostat nešlo (DECISIONS
„Ladění žolíků fáze 4“), je nová, téma a id zůstaly. Naměřeno `npx tsx scripts/joker-value.ts` (před: 20 seedů,
aktuální obsah; po: 60 seedů):

| Žolík            | Staře → nově                                                                              | Před R1 / R2 % | Po R1 / R2 % (špička R2) |
| ---------------- | ----------------------------------------------------------------------------------------- | -------------- | ------------------------ |
| Noční směna      | poslední ruka kola +20 → **v kole se šéfem každá ruka +14 mult**                          | 12,7 / 2,9     | 47,8 / 9,4 (35) ✔        |
| Šťastná sedmička | každá 7 ještě 2× → **každá skórující karta: 1 ze 7, že skóruje ještě 7×**                 | 9,2 / 3,6      | 71,6 / 24,2 (74) ✔       |
| Sekera           | dluh −15 Kč, v dluhu +8 → **dluh −15 Kč; +1 mult za každou korunu, která chybí do 15 Kč** | 6,4 / 0,9      | 89,0 / 11,2 (38) ✔       |
| Napodobitel      | náhodný žolík → **bez edice dostane duhovou; kopíruje nejdražšího běžného nebo vzácného** | 20,8 / 25,2    | 74,8 / 82,6 (183) ✔      |

- **Noční směna:** den = Malá a Velká útrata, noc = šéf („Po půlnoci platí noční tarif. A šéf chodí na kontrolu.“).
  Kolo se šéfem = `round.bossId !== null` (i Velká útrata se šéfem na Imperialu; vypnutý šéf na tom nic nemění). +12
  dávalo R2 8,2 % (na hraně), +14 má rezervu. Párově s Ranním ptáčetem (první ruka).
- **Šťastná sedmička:** hod `ctx.chance(1, 7)` jednou za skórující kartu a ruku (`retriggerScored` se volá jednou před
  aktivacemi; debuffnutá karta se přeskočí bez hodu), respektuje `probabilityMult` (UI násobí `{chance}`). „Jackpot“
  z automatu v nádražce; štítek `rank` vypuštěn. Zamítnuté varianty (odhad / měření): jen sedmičky + proměna karet
  v sedmičky (~16 % R1), „ruka obsahuje 7 → všechny karty ještě 1×“ (~27 %), každá 7. skórující karta 7× (~45 % R1) —
  opakování obyčejné karty je jen ~9 čipů, sedmička je 1/13 karet. Strop `MAX_ACTIVATIONS_PER_CARD` (10) platí; se
  skleněnou kartou je výhra vzácný jackpot (×2⁸), stejně jako Ozvěna se sklem.
- **Sekera:** dluh drží bot (a většina hráčů) jen chvíli po koupi na dluh, +8 v dluhu tak padlo ve 4–6 % rukou. Nově
  „čím míň v kapse, tím víc na tácku“ — protiváha úroku a rodinná dvojice s Doktorem Faustem (bohatý → ×mult). Dluhový
  limit i štítek `economy` zůstaly (kategorie ekonomika v rozložení fáze 4 se nemění); kopírovatelná.
- **Napodobitel:** jedna kopie má v sestavách botů strop ~36 % (R2, všechny ruce; v patrech 4+ ~44 %) — náhodný cíl
  25 %, nejdražší 35,5 %, nejvíc vpravo 30 %. Pásmo epického (R2 ≥ 45 %) tak samotné kopírování nedá; vlastní hooky
  kopírujícího žolíka engine nevolá (jen `copyTarget` a `onAcquire`), edici ale aplikuje vždy. Proto „kostým“:
  `onAcquire` mu dá duhovou edici (×1,5), pokud žádnou nemá. Zkoušeno: duhová + všechny vzácnosti R2 99–101 %, ale
  špička 275 % > 220 % (kopie epického ×2,5 × 1,5); holografická 301 % (nad), lesklá 131 % (nad); **duhová + jen běžní
  a vzácní** 82,6 %, špička 183 % ✔ („na hvězdy mu flitry nestačí“). Cíl = nejvyšší `api.sellValue`, při shodě nejvíc
  vlevo; volí se na začátku kola jako dřív (UI konvence `state.target`/`round` beze změny). Duhová edice zvedá prodejní
  cenu z 5 na 7 Kč — vědomě (edice se platí i jinde).
- Testy: `jokers-common/rare/epic.test.ts` (přesná čísla, hranice, RNG předpověď ze streamu, uložení a načtení),
  `jokers-combos.test.ts` (popisky, scénáře; kopie epických a legendárních ověřuje testovací `copier`, Napodobitel si je
  nevybere).

**Hodnocení Praotce Čecha a Krakonoše:** `joker-value.ts` úrovně kombinací sám nastavuje (R1 1–2, R2 4), takže trvalé
úrovně, které tito dva přidávají, nevidí (Praotec 46 / 10 %, Krakonoš 0 / 1 %). Dočasná analýza (scratch skript,
stejná projekce na R1/R2 jako nástroj, přidané úrovně extrapolované na 16 kol): **Praotec R1 123 %, R2 107 %**
(špička 244 %, 13,2 úrovně za run) ✔; **Krakonoš R2 42 %** jen z úrovní (11,6 úrovně za run) + ~2 Kč za pranostiku
a levnější úrovně (bot jich kupuje víc). Simulace nástroje (60 seedů): Δ výher **+15 p. b.** (Praotec) a **+25 p. b.**
(Krakonoš) — v pásmu legendárního 12–25 (pravidlo 4: užitkoví a spotřebkoví žolíci se ověřují simulací).

**Sledovat (fáze 10):** Δ výher legendárních ×mult žolíků je nad pásmem simulace (Libuše +43, Orloj +40, Honza a meč
+37 p. b.), protože základní run má po fázi 6 jen ~7 % výher — pásmo simulace přepočítat s kalibrací cílů. Libuše má
„reálně“ +543 % (balíček se postupně plní dámami až po Pětici dam); kdyby v simulaci dominovala, proměnu omezit
(např. jen po šéfovi) a zvednout ×mult.

**Proč:** CLAUDE.md kap. 3 (legendární žolíci jen ze speciálního efektu, 8 kusů), 5 (pověsti), 8 (žádný bezcenný
ani auto-win žolík, test na každého); DESIGN 4.3 (pásma, pravidla 1–5), 4.4 (jedna přesná věta, `params`, kopie,
náhoda přes `ctx.chance`), 4.8.

## 2026-10-02 — Běžní žolíci fáze 7 (29 kusů, `common2`): výběr, výklad mechanik a ladění podle hodnoty 4.3

**Co:** `src/content/jokers/common2.ts`, texty `src/i18n/cs/jokers/common2.ts`, testy
`tests/unit/jokers-common2.test.ts` (přesná čísla přes skutečné skórování, hranice, rozpis odměn, kopie, uložení
a načtení, texty, `ArtSpec`, fuzz s obsahem hry). Běžných je teď 15 + 29 = 44 (cíl DESIGN 4.1). Ceny 4–5 Kč.

- **Ze zásobníku DESIGN 4.9 (15):** Teta z poradny, Chatař, Střelec z pouti, Trafikant, Revizor, Hlídač parkoviště,
  Zlatník, Dlaždič, Pošťák, Hokynář, Táta u grilu, Učitelka, Hejkal, Tramvaják, Sázkař. **Vlastní (14):** Drbna
  z pavlače, Rundu všem, Nakládaný hermelín, Třináctý plat (Silvestr), Brigádník, Rybář, Popelář, Hrací automat,
  Kůlna, Náhradní autobus (výluka), Zabijačka, Městské derby, Hospodský kvíz, Sběrna surovin.
- **Kategorie (hlavní):** +mult 8, +čipy 4, ×mult 2, ekonomika 4, škálování 3, opakování 1, úpravy pravidel 2,
  spotřebky/balíček 5.
- **Úpravy návrhů ze zásobníku** (zásobník říká „čísla se doladí“):
  - _Trafikant_ — „první spotřebka ve Večerce za 1 Kč“ by potřebovala nové API ceny položky; místo toho „při vstupu do
    Večerky 1 z 2 pranostika do volného slotu“ (trafika = noviny s předpovědí počasí).
  - _Pošťák_ — sleva na obálky by potřebovala nový modifikátor; zůstalo jen „za každou otevřenou obálku 3 Kč“ (obálka za
    4 Kč tak vyjde zhruba napůl, stejný účinek jako návrh +1 Kč a −1 Kč).
  - _Hlídač parkoviště_ — králové v ruce (1/13 karet) dali R1 ≈ 23 %; rozšířeno na všechny figury (+4 mult za každou).
  - _Střelec z pouti_ — samotné desítky by měly R1 ≈ 30 %; „desítka nebo figura“ (karta za 10 čipů), +3 mult.
  - _Zlatník_ — bez zlatých karet by nedělal nic; místo „+2 Kč za zlatou kartu“ na konci kola pozlatí náhodnou kartu
    bez vylepšení v ruce (onRoundEnd běží před rozpisem, takže zlatá vydělá už v tomto kole).
  - _Dlaždič_ — „kamenné karty v ruce +5 mult“ by bez kamenných karet nedělal nic a bot kamenné karty radši hraje
    (+50 čipů); každé zahození promění první zahozenou kartu bez vylepšení na kamennou a mult dává **skórující**
    kamenná karta (+5). Partner Golema (ten dává čipy za tytéž karty).
  - _Hokynář_ — počítá běžné žolíky **jiného druhu** (jiní Hokynáři se nepočítají): dva Hokynáři se pak chovají
    stejně jako Hokynář a jeho kopie (Napodobitel je epický) a nevzniká smyčka „čím víc Hokynářů, tím víc“.
  - _Učitelka_ — „sudé“ jsou jen 2, 4, 6, 8 a 10 (figury a eso ne, kamenná nemá hodnotu); v popisku slovy, šablony
    popisků nesmí mít číslice.
- **Výklad hraničních případů:**
  - Debuffnuté skórující karty se nepočítají tam, kde žolík čte jejich vlastnosti (Učitelka, Derby, Kvíz, Hrací
    automat — „nedává nic“ jako u Křižáka); Revizor kontroluje všechny zahrané karty (i kopy a debuffnuté), Hermelín
    počítá všechny karty v ruce (i debuffnuté — v ruce pořád jsou), Hokynář i debuffnuté žolíky (sedí ve slotu).
  - Divoká karta je pro Derby červená i černá zároveň (sama stačí); kamenná nemá barvu ani hodnotu.
  - _Drbna_ si pamatuje poslední ruku od koupě i přes konec kola (stav `last`, zapisuje `afterHandScored` — ruka
    zakázaná šéfem se nepočítá). Verze „jen v tomto kole“ měla R2 6 % (bot opakuje kombinaci v kole málokdy).
  - _Popelář_ bere jen „odpad“ — zahozené karty s hodnotou nejvýš 5. Verze „+1 čip za každou zahozenou kartu“ měla R2
    44 % (nad 30).
  - _Zabijačka_ ničí nejnižší kartu bez vylepšení drženou v ruce (při shodě levější) v rozpisu odměn (jako
    Pokladnička — jednou za kolo, kopie rozpis nedostávají); zlaté karty v ruce už vyplatily. Žolíci napravo, kteří
    počítají karty v ruce (Zahrádkář), zničenou kartu nevidí. Partneři: Sběrna surovin a Sběrač hub.
  - _Náhradní autobus_ — `round.discardsUsed` hook vidí už po zahození; prvních 2 zahození → `addRoundHandSize(+1)`,
    ruka se dobere hned po hoocích zahození. Bez stavu, kopie přidá kartu navíc.
  - _Chatař_ počítá prázdné sloty stejně jako engine pro novou spotřebku (`consumableSlots − držené`); Kůlna (+1 slot)
    je jeho partner, Babiččina truhla protihráč.
  - Náhoda jen přes `ctx.chance` (Teta, Trafikant, Hejkal, Sázkař, Rybář) a `ctx.rng` (Zlatník); Trafikant a Teta bez
    volného slotu nehází (RNG se neposune).
- **Kopírování a nálepky (DESIGN 4.4/7, 4.4/12):** `copyable: false` mají Trafikant (efekt jen ve Večerce, kde
  Napodobitel nekopíruje), Pošťák (Večerka), Sázkař, Třináctý plat, Brigádník, Zabijačka (rozpis odměn) a Kůlna
  (čisté pravidlo). `noRental` ekonomičtí (Pošťák, Sázkař, Třináctý plat, Brigádník, Zabijačka). `noPerishable`
  škálující, kteří rostou časem ve slotu (Rybář, Popelář, Sběrna surovin). Stav jen u Drbny a škálujících; kopie ho
  nemění (Rybář nehází, Popelář/Sběrna nepřičítají), jen čte.
- **Art:** hlavní ikony jsou unikátní proti 30 žolíkům fáze 4 i mezi sebou, dvojice ikona + rekvizita unikátní mezi
  všemi žolíky, pozadí unikátní mezi běžnými. Ikony, které se hodí pro vzácné/epické/legendární nápady ze zásobníku
  (čarodějnice, věštecká koule, kostel, kouzelnický klobouk…), jsem nechal volné.

**Ladění podle hodnoty** (`npx tsx scripts/joker-value.ts --runs 60`, staré → nové, R1 / R2 v %):
Chatař `mult` 4 → 3 (93,8 / 19,3 → 69 / 14 — pořád skoro v každé ruce, horní okraj R1), Revizor `chips` 40 → 50
(33 / 10 → 45 / 13), Učitelka `mult` 10 → 15 (20 / 4, POD → 39 / 9), Tramvaják `mult` 8 → 12 (27 / 6, POD → 37 / 8),
Rundu všem ×1,5 → ×1,4 (R2 30,4, NAD → 23), Brigádník `money` 1 → 2 (1,4 → 2,8 Kč/kolo), Pošťák `money` 2 → 3,
Dlaždič `mult` 3 → 5 (po změně mechaniky 20 / 6 → 32 / 10), Sběrna surovin `mult` 2 → 3 se stropem +21 mult (R2 7,7, POD → 14,4; strop drží kombinaci se Zabijačkou pod 2× horní hranicí). Mechanika změněná po měření: Drbna, Popelář, Dlaždič
(viz výše).

**Naměřeno po ladění** (100 seedů; R1 / R2 v %, Kč/kolo, Δ kol simulace; pásmo běžného 35–100 / 8–30 / 2–3 Kč):

| Žolík                                                               | R1 / R2                          | Kč/kolo | Δ kol        | Hodnocení    |
| ------------------------------------------------------------------- | -------------------------------- | ------- | ------------ | ------------ |
| Chatař                                                              | 70,6 / 14,1                      | –       | +1,1         | v pásmu      |
| Střelec z pouti                                                     | 60,3 / 11,7                      | –       | +0,1         | v pásmu      |
| Revizor                                                             | 46,2 / 13,6                      | –       | +0,8         | v pásmu      |
| Hlídač parkoviště                                                   | 49,8 / 10,2                      | –       | +1,9         | v pásmu      |
| Dlaždič                                                             | 29,8 / 9,1                       | –       | +0,8         | v pásmu (R2) |
| Táta u grilu                                                        | 45,8 / 13,6                      | –       | +1,1         | v pásmu      |
| Učitelka                                                            | 38,1 / 8,3                       | –       | +2,1         | v pásmu      |
| Hejkal                                                              | 64,2 / 12,8                      | –       | −0,1         | v pásmu      |
| Tramvaják                                                           | 37,1 / 8,4                       | –       | +2,3         | v pásmu      |
| Drbna z pavlače                                                     | 10,8 / 12,9                      | –       | +1,3         | v pásmu (R2) |
| Rundu všem                                                          | 24,2 / 23,6                      | –       | +0,4         | v pásmu (R2) |
| Nakládaný hermelín                                                  | 39,9 / 12,0                      | –       | +1,1         | v pásmu      |
| Rybář                                                               | 14,8 / 26,5                      | –       | +0,5         | v pásmu (R2) |
| Popelář                                                             | 12,0 / 16,4                      | –       | −0,1         | v pásmu (R2) |
| Hrací automat                                                       | 26,4 / 8,4                       | –       | +1,4         | v pásmu (R2) |
| Městské derby                                                       | 74,8 / 14,6                      | –       | +1,3         | v pásmu      |
| Hospodský kvíz                                                      | 50,0 / 14,9                      | –       | +0,7         | v pásmu      |
| Sběrna surovin                                                      | 6,6 / 14,4                       | –       | −0,9         | v pásmu (R2) |
| Sázkař                                                              | –                                | 2,1     | +1,1         | v pásmu (Kč) |
| Třináctý plat                                                       | –                                | 2,9     | +1,0         | v pásmu (Kč) |
| Brigádník                                                           | –                                | 2,8     | +1,6         | v pásmu (Kč) |
| Zabijačka                                                           | –                                | 2,0     | +2,5         | v pásmu (Kč) |
| Hokynář                                                             | izolovaně 0,2 / 0,2, reálně 52 % | –       | +1,5         | viz níže     |
| Teta z poradny, Trafikant, Pošťák, Kůlna, Náhradní autobus, Zlatník | ≈ 0                              | –       | +0,7 až +1,9 | jen simulace |

- Nástroj u Zabijačky, Sázkaře a části „jen simulace“ hlásí „POD pásmem“ kvůli šumu ±0,4 % v R1 (jiné hody RNG nebo
  zničená karta mění stav kopie) — skóre ruky žolík nemění, hodnotí se podle Kč/kolo nebo simulace.
- **Hokynář** se izolovaně změřit nedá (nástroj měří tah jen s ním, bez ostatních žolíků, a ty Hokynář počítá);
  reálně (skutečná sestava bota) +52 %, srovnatelně s Pivním táckem (71 %) a Srdcařem (77 %).
- **Teta, Trafikant** (spotřebky), **Pošťák** (peníze mimo rozpis), **Kůlna, Náhradní autobus** (pravidla)
  a **Zlatník** (peníze připíše zlatým kartám) jsou jen simulace: Δ +0,7 až +1,9 kola. Sloupec Δ výher je při 100
  seedech šum (Brigádník s 2,8 Kč/kolo +17 p. b.), proto ho tabulka neuvádí.
- **Integrace do `tests/unit/jokers-combos.test.ts`** (soubor mimo zadání, test teď padá na chybějícím scénáři pro
  každého nového žolíka): scénáře pro všech 29 jsem ověřil v kopii testu (480/480 zelených: Napodobitel, debuff,
  edice, prodej, dvě kola, fuzz). Žolíci s kartami v ruce (Hlídač parkoviště, Hermelín, Zlatník) potřebují nové pole
  scénáře `pick` (indexy zahraných karet), `runScenario` pak hraje `sc.pick ? sc.pick.map((i) => cards[i]!) : cards`.

**Proč:** CLAUDE.md kap. 3 (žolíci = data + hooky, 100+ žolíků), 5 (humor, archetypy, žádné skutečné osoby ani
značky), 6 (texty v i18n, typografie), 8 (test na každého žolíka, determinismus, žádný bezcenný ani auto-win); DESIGN
4.1–4.5 a 4.9; CONTENT-GUIDE kap. 3 a 11–14.

## 2026-10-02 — Vzácní žolíci fáze 7 (22 kusů, `rare2`): výběr, výklad mechanik a ladění podle hodnoty 4.3

**Co:** `src/content/jokers/rare2.ts`, texty `src/i18n/cs/jokers/rare2.ts`, testy `tests/unit/jokers-rare2.test.ts`
(přesná čísla přes skutečné skórování, hranice, rozpis odměn, kopie, uložení a načtení, texty, `ArtSpec`, fuzz s obsahem
hry). Vzácných je teď 10 + 22 = 32 (cíl DESIGN 4.1). Ceny 6–7 Kč (7 Kč: Kronikář, Sklář, Kopírák).

- **Ze zásobníku DESIGN 4.9 (15):** Známý na úřadě, Kronikář, Kominík, Sklář, Notář, Čarodějnice, Vodník, Bludička,
  Polednice, Klekánice, Pan farář, Vědma, Dvorní malíř, Barvoslepý strýc, Vyšlapaná pěšina (ze „Zkratky přes louku“).
  **Vlastní (7):** Válečná kořist (husité, Žižka ve flavoru), Defenestrace (historie), Kopírák (úřady), Anonymní
  diskutér, Virální video, Sociální bublina (internet a memy), Brňák (Hradec vs. Brno).
- **Kategorie (hlavní):** +mult 3 (Kominík, Diskutér, Pan farář), +čipy 2 (Virální video, Bublina), ×mult 4 (Bludička,
  Polednice, Klekánice, Brňák), ekonomika 3 (Notář, Defenestrace, Válečná kořist — ta i škálující), škálování 2
  (Kronikář, Vodník), opakování 0, úpravy pravidel 4 (Známý na úřadě, Dvorní malíř, Barvoslepý strýc, Pěšina),
  kopírování 1 (Kopírák), spotřebky/balíček 3 (Čarodějnice, Vědma, Sklář).
- **Opakování 0 (vědomě):** Pan farář (návrh „červená pečeť ještě 1×“) i Sociální bublina byly v konceptu opakující.
  Opakování má izolovaně jen hodnotu čipů karty a s víc opakováními na víc kartách dělá špičky se skleněnými
  a multovými kartami (pravidlo 3). Naměřeno (R1 / R2 %, 30–60 seedů): farář „karta s vylepšením, pečetí nebo edicí
  ještě 1×“ 5,5 / 5,2; bublina „stejná barva → každá ještě 2×“ 120 / 51, ale špička R2 221 > 120; „ještě 1×“
  24 / 8,5; „stejná hodnota → ještě 2×“ 22 / 9. Obě mechaniky jsou proto jiné (viz níže); opakování nechávám epickým
  a obsahovým patchům.

**Úpravy návrhů ze zásobníku** (zásobník říká „čísla se doladí“):

- _Známý na úřadě_ — akci `rerollBoss` povoluje jen `RunState.flags.bossRerolls` a do stavu runu smí hook zapisovat
  jen přes `api` (CONTENT-GUIDE 2). Proto: po každém přeskočení útraty přelosuje šéfa patra (`api.rerollBoss`,
  hráč tedy rozhoduje přeskočením) a navíc `passive` `bossTargetMult` 0,8 (cíl šéfa −20 %), aby nebyl mrtvý bez
  přeskakování. `copyable: false` (pravidlo + efekt mimo kolo).
- _Kominík_ — „šance šťastných karet ×2“ by potřebovala modifikátor jen pro šťastné karty (`probabilityMult` je
  globální a zdvojení všech šancí je známý komerční vzor). Nově: každá skórující piková, křížová (saze) nebo šťastná
  karta: 1 z 2 → +6 mult. `params.suit = 'S'` je nápověda pro boty.
- _Sklář_ — prasknutí žolík zabránit nemůže (`afterScored` vylepšení ničí kartu). Proto „vyfoukne znovu“: za každou
  zničenou skleněnou kartu přidá do balíčku stejnou (hodnota, barva, pečeť, edice, bonusové čipy; v kole na náhodné
  místo dobíracího balíčku) + při získání 1 skleněnou kartu, ať není mrtvý. Jen první Sklář v řadě a ne kopie
  (`copyable: false`): dva by každou prasklou kartu zdvojily. Se 3 kartami při získání R2 76,9 % a špička 467 % (nad),
  s 1 kartou viz tabulka.
- _Notář_ — „+6 mult za kartu s pečetí“ by bez pečetí v balíčku nedělal nic (naměřeno ≈ 0). Nově pečetě dodává:
  první ruka Malé a Velké útraty dá první skórující kartě bez pečeti (nedebuffnuté) zlatou pečeť ještě před
  skórováním (`beforeScoring`, vydělá hned). Navazuje na razítko „Ověřeno notářem“. Varianta „každé kolo“ dala
  6,9 Kč/kolo (nad pásmem 3–5), bez kola šéfa 4,2 Kč/kolo.
- _Vodník_ — ♦ → **♥** (dušičky pod hrníčky = srdíčka); +1 mult za každou zahozenou srdcovou kartu (i divokou a
  debuffnutou, jako Popelář). Bez štítku `suit`: bot by honil srdcovou Barvu místo zahazování srdcí.
- _Bludička_ — 1 z 4 ×3 má špičku 200 % (> 120, pravidlo 3) → **1 z 3 ×2** (průměr ×1,33, špička 100 %).
- _Pan farář_ — opakování bylo pod pásmem (viz výše). Nově **+5 mult za každou kartu plného balíčku s vylepšením,
  pečetí nebo edicí** („farníci“; vylepšení jen když platí — Bílá hora). Partner Notáře, babských rad a razítek.
  +2 mult: 15,9 / 11,0; +4: 22,4 / 17,7; +5 viz tabulka.
- _Vědma_ — „jediná ruka dosáhne cíle kola“ dávala 0,8 pranostiky/kolo (~15 úrovní za run, úroveň legendárního Praotce
  Čecha). Nově jen **Malá útrata** (nejvýš jednou za patro, bez stavu): 0,24 pranostiky/kolo.
- _Dvorní malíř_ — čisté `allFaces` (`copyable: false`). Sám nic nedá; je to díl buildu (Střelec z pouti, Hlídač
  parkoviště, Defenestrace; protihráči Revizor, Klekánice a šéf Inventura).
- _Zkratka přes louku_ → **Vyšlapaná pěšina**: „Zkratka“ je překlad názvu komerčního žolíka se stejnou mechanikou
  (CLAUDE.md kap. 7). Čisté `straightGaps`.
- Beze změny proti návrhu: Kronikář (+2 mult za kombinaci zahranou od koupě poprvé, zapisuje v `beforeScoring`),
  Čarodějnice (razítko po porážce šéfa), Polednice (druhá ruka kola ×2), Klekánice (×2 bez figury v ruce po zahrání;
  prázdná ruka podmínku splní), Barvoslepý strýc (`mergedSuits`).

**Vlastní — výklad:**

- _Válečná kořist_ — na konci kola +2 Kč za každého šéfa poraženého od koupě (`onBossDefeated` běží před rozpisem,
  šéf vydělá už v kole, kdy padl). Jméno bez osoby: šéf „Jednooký hejtman“ už Žižku připomíná.
- _Defenestrace_ — každé zahození s aspoň jednou figurou dá 5 Kč (hned, jednou za zahození). 4 Kč dávaly 2,8 Kč/kolo.
- _Kopírák_ — kopíruje nejpravějšího běžného nebo vzácného žolíka, kterého jde kopírovat (kromě sebe; epické
  a legendární ne, jako Napodobitel). Varianty: soused vpravo −0,7 % (bot ho neumí postavit), nejlevější běžný
  17,9 / 13,0, nejpravější běžný nebo vzácný viz tabulka. `copyable: false`.
- _Anonymní diskutér_ — +7 mult za každou zahranou kartu, která neskóruje (kopa). +4 dávalo 30 / 5.
- _Virální video_ — čipy podle pořadí ruky v kole: 64, 32, 16 … 1, pak nic.
- _Sociální bublina_ — když mají všechny nedebuffnuté skórující karty stejnou barvu nebo stejnou hodnotu, každá dá
  +15 čipů (Dvojice, Trojice, Čtveřice, Barva, Vysoká karta; ne Dvě dvojice, Full house, Postupka). +12 dávalo 44 / 13.
- _Brňák_ — ×1,5 mult, jen když stojí v řadě úplně vlevo (napětí s pravidlem „×mult patří doprava“). Nejde
  kopírovat (`copyable: false`): kopie násobí jen na pozici kopírujícího žolíka a úplně vlevo může stát jen jeden
  z nich. Bot řadí ×mult doprava, proto „reálně“ jen 5,6 % a simulace −6,7 p. b. — hráč ho postaví vlevo.

**Kopírování a nálepky:** `copyable: false` — Známý na úřadě, Sklář, Dvorní malíř, Barvoslepý strýc, Pěšina,
Válečná kořist (rozpis odměn se kopiím nepočítá), Kopírák, Brňák. `noRental` — Notář, Válečná kořist, Defenestrace.
`noPerishable` — Kronikář, Vodník, Válečná kořist. Stav mají jen Kronikář (`seen`), Vodník (`mult`) a Kořist
(`bosses`); kopie ho nemění. Náhoda jen `ctx.chance` (Kominík, Bludička) a `ctx.rng` (Sklář).

**Art:** hlavní ikony unikátní mezi všemi žolíky (i proti rozpracovaným `epic2` v době zápisu — Kopírák a Defenestrace
kvůli tomu `save` a `exit-door`), dvojice ikona + rekvizita unikátní, pozadí unikátní mezi vzácnými.

**Naměřeno** (`npx tsx scripts/joker-value.ts --runs 60`, celý obsah včetně `epic2`; ladění během práce šlo přes kopii
nástroje bez `epic2`, který tehdy při běhu padal — čísla se liší o ±3 p. b.; R1 / R2 v %, špička = 95. percentil R2;
pásmo vzácného 50–130 / 20–60 / 3–5 Kč, špička ≤ 120):

| Žolík             | R1 / R2     | Špička R2 | Hodnocení                                  |
| ----------------- | ----------- | --------: | ------------------------------------------ |
| Kronikář          | 75,6 / 24,3 |        35 | v pásmu                                    |
| Kominík           | 82,1 / 18,3 |        45 | v pásmu (R1)                               |
| Sklář             | 41,4 / 21,9 |       144 | R2 v pásmu, špička nad (viz níže)          |
| Vodník            | 37,5 / 39,6 |        39 | v pásmu (R2)                               |
| Bludička          | 34,5 / 36,4 |       100 | v pásmu (R2)                               |
| Polednice         | 25,9 / 32,2 |       100 | v pásmu (R2)                               |
| Klekánice         | 47,7 / 43,9 |       100 | v pásmu (R2)                               |
| Pan farář         | 27,4 / 21,4 |       100 | v pásmu (R2)                               |
| Barvoslepý strýc  | 78,3 / 26,7 |        80 | v pásmu                                    |
| Vyšlapaná pěšina  | 57,0 / 22,8 |        77 | v pásmu                                    |
| Anonymní diskutér | 65,1 / 11,4 |        52 | v pásmu (R1)                               |
| Virální video     | 88,2 / 23,7 |        32 | v pásmu                                    |
| Kopírák           | 20,5 / 28,6 |       100 | v pásmu (R2, skutečná sestava)             |
| Brňák             | 50,0 / 50,5 |        50 | v pásmu                                    |
| Sociální bublina  | 54,8 / 16,8 |        38 | v pásmu (R1)                               |
| Dvorní malíř      | 0,0 / 0,1   |         0 | užitkový — hodnota jen v kombinaci         |
| Známý na úřadě    | –           |         – | jen simulace (Δ výher −6,7 až +13,3 = šum) |

Ekonomika a spotřebky nástroj neměří (peníze mimo rozpis, spotřebky). Proto vlastní měření (scratch skript, bot `max`,
žolík přibitý od patra 1 do konce runu, 60 seedů, bez něj 8/60 výher): **Notář** 4,2 Kč/kolo ze zlatých pečetí
(Δ výher +18 p. b.), **Defenestrace** 2,8 Kč/kolo při 4 Kč → při 5 Kč ≈ 3,5 Kč/kolo (+12), **Válečná kořist**
5,95 Kč/kolo (+17; nástroj s prodejem po 6 kolech 2,6 Kč/kolo, patra 1–3 1,6 — průměr obou v pásmu, pozdní peníze mají
menší cenu), **Čarodějnice** 0,20 razítka/kolo (+7), **Vědma** 0,24 pranostiky/kolo (+8). Δ výher simulace je při
60 seedech šum ±15 p. b. (stejně jako u běžných — peníze bot vždy promění v sílu).

- **Sklář:** špička 143 % je ×2 skleněné karty, kterou žolík přinesl — „svět bez žolíka“ tu kartu vůbec nemá (jako u
  Golema), takže se do špičky počítá i to, že karta doplnila Dvojici či Barvu. Samotný efekt (×2 + čipy karty) je
  ≤ 120 %. Nechávám; sledovat v simulaci fáze 10.

**Integrace do `tests/unit/jokers-combos.test.ts`** (soubor mimo zadání; padá na chybějících scénářích všech nových
žolíků): scénáře pro všech 22 jsem ověřil v dočasné kopii testu s žolíky fáze 4, legendárními a `rare2` (488/488
zelených: popisky, Napodobitel, dvě kola, debuff, edice, prodej, fuzz). Do `SCENARIOS` patří:
`office_connection`, `glassblower`, `court_painter`, `viral_video`, `carbon_paper`: `{ hand: 'KS' }`; `chronicler`,
`klekanice`, `social_bubble`: `{ hand: 'KS KH' }`; `chimney_sweep`: `{ hand: 'KS KC', setup: probabilityMult 2 }`;
`will_o_wisp`: `{ hand: 'KS KH', setup: probabilityMult 3 }`; `notary_public`: `{ hand: 'KS KH', measure: (_g, r) =>
r.moneyEarned }`; `witch`: setup `round.target = 1; round.blind = 'boss'; round.bossId = 'wall'`, measure počet
spotřebek; `seer`: setup `round.target = 1`, measure počet spotřebek; `water_goblin`: `state: { mult: 3 }`;
`noon_witch`: setup `round.handsPlayed = 1`; `parish_priest`: `{ hand: 'KS:bonus KH' }`; `colorblind_uncle`:
`'2H 5D 7H 9D JH'`; `trodden_path`: `'3S 5H 6D 8C 9S'`; `war_loot`: `{ hand: 'KS', state: { bosses: 2 } }`;
`anonymous_commenter`: `'KS KH 5C'`; `defenestration`: setup zahodí K♠ z ruky `'KS 2C'` a uloží zisk do
`WeakMap<Game, number>`, measure ho čte (prodej žolíka uprostřed kola peníze taky mění); `brno_native`: setup přesune
Brňáka na začátek řady (`state.jokers`, pak `invalidate()`), jinak by v sestavě s Napodobitelem nestál vlevo.

**Proč:** CLAUDE.md kap. 3 (žolíci = data + hooky, 100+ žolíků), 5 (humor, archetypy, žádné skutečné osoby ani
značky), 6 (texty v i18n, typografie), 7 (žádné převzaté názvy), 8 (test na každého žolíka, determinismus, žádný
bezcenný ani auto-win); DESIGN 4.1–4.5 a 4.9; CONTENT-GUIDE kap. 2–3.

## 2026-10-02 — Epičtí žolíci fáze 7 (12 kusů, `epic2`): výběr, výklad mechanik a ladění podle hodnoty 4.3

**Co:** `src/content/jokers/epic2.ts`, texty `src/i18n/cs/jokers/epic2.ts`, testy `tests/unit/jokers-epic2.test.ts`
(přesná čísla přes skutečné skórování, hranice, rozpis odměn, stav přes víc rukou a kol, kopie, uložení a načtení,
texty, `ArtSpec`, fuzz s obsahem hry). Epických je teď 5 + 12 = 17 (cíl DESIGN 4.1). Ceny 8–10 Kč.

- **Ze zásobníku DESIGN 4.9 (4):** Pivní sommelier, Archivář, Kouzelník z pouti, Turistický průvodce. **Vlastní (8,
  velké české reálie):** Spartakiáda (normalizace), Kupónová privatizace (90. léta), Lázeňský host (Karlovy Vary),
  Dechovka, Karlův most, Dálnice D1, Směnárna (pražská turistická past), Silvestr.
- **Kategorie (hlavní):** ×mult 4 (Sommelier, Karlův most, D1, Směnárna), škálování 2 (Lázeňský host, Silvestr — oba
  rostou v ×mult), opakování 2 (Dechovka, Spartakiáda — `rare2` opakování nechal epickým), úpravy pravidel 2
  (Kouzelník, Průvodce), kopírování 1 (Archivář), ekonomika 1 (Kupónová privatizace). Spotřebky/balíček 0.
- **Zamítnuto: Zrcadlové bludiště** (kopíroval žolíka na zrcadlové pozici řady, první ↔ poslední). S Kopírákem
  z `rare2` by byli kopírující 4 (Napodobitel, Kopírák, Archivář, Bludiště) — nad stropem 3 z DESIGN 4.5. Naměřeno
  s duhovým kostýmem: s epickými cíli 61 / 80, špička R2 247 > 220; jen s běžnými a vzácnými cíli 58 / 60 ✔. Místo něj
  Spartakiáda. Číslo: kopírování fáze 7 = Kopírák + Archivář = 2 (cíl DESIGN 4.9).

**Úpravy návrhů ze zásobníku** (zásobník říká „čísla se doladí“; R1 / R2 v %, špička = 95. percentil R2):

- _Pivní sommelier_ — +×0,25 → **+×0,7 za každou různou kombinaci kola včetně právě hrané**. Boti vyhrávají kolo
  průměrně za 1,4–1,9 ruky (60 runů, bot `max`, všechna patra), takže +×0,25 by dalo skoro vždy jen ×1,25–1,5.
  +×0,75: 91 / 103, špička 225 > 220; **+×0,7: 85 / 97, špička 210** ✔. Kombinace bere z `round.handTypesPlayed`
  (při skórování ještě bez této ruky), takže se počítají i ruce zakázané šéfem.
- _Archivář_ — samotná kopie souseda vlevo měří 20 / 19 (POD): kopie průměrného žolíka bota ≈ +20 %, stejně jako
  u Napodobitele ve fázi 4. Zkoušeno (30–60 seedů): + slot žolíka navíc (`passive`, „místo nezabírá“) 24 / 22 a v
  simulaci jen +2,2 kola (Napodobitel +5,6) — nástroj slot neumí ocenit a simulace ho nedorovná; lesklá edice při
  získání 119 / 95, ale špička 238; holografická 273 / 163 (NAD); **duhová 87 / 91, špička 170** ✔. Archivář tedy
  dostává stejný „kostým“ jako Napodobitel (duhová při získání bez edice). Od Napodobitele a Kopíráku se liší cílem
  (soused vlevo — hráč ho řídí přeřazením), vzácností (kopíruje i epické a legendární) a dobou (kopíruje kdykoli, i ve
  Večerce: `onSell`, `onConsumableUsed`). Nekopírovatelného souseda si nevybere (`api.jokerCopyable`), souseda mimo
  provoz vyřadí engine. `state.target` (konvence UI a botů) zapisuje `copyTarget` při každém průchodu žolíků — po
  přeřazení ho UI uvidí až po další akci s hooky. **Úkol pro UI** (mimo zadání): `copyStatusText` ukazuje mimo kolo
  „vybere na začátku kola“ (`art.copy.idle`), Archivář ale kopíruje i mimo kolo a cíl je vždy soused vlevo.
- _Kouzelník z pouti_ — samotné `allCardsScore` přidá jen čipy kopů (izolovaně R1 ≈ +20 %). Navíc **každá skórující
  karta ×1,15** (za každou aktivaci, i opakovanou): ×1,1 60 / 56; **×1,15 94 / 91, špička 113** ✔.
- _Turistický průvodce_ — samotné `fourCardStraightFlush` 52 / 20 (POD). S ×mult navrch nástroj promítá skok
  kombinace (Dvojice → Barva) multiplikativně: ×1,5 218 / 138 (NAD), ×1,2 149 / 95, ale špička 308; i čisté pravidlo
  se štítkem `xmult` mělo špičku 236. Proto bonus v čipech (navíc odlišení od Kolotoče, který za Postupku dává +mult):
  +4 mult 105 / 28; **+40 čipů 113 / 36** ✔ (pozdě slabší, pravidlo 1 splněné v R1). Partner balíčku Turistický
  (pravidlo tam už platí, čipy ne).

**Vlastní — výklad a ladění:**

- _Spartakiáda_ — **v první ruce kola (`ctx.firstHand`) skóruje každá skórující karta ještě 2×** (i kamenná,
  debuffnutá se přeskočí). 1× by dalo ≈ 45 % R1. **91 / 36, špička 112** ✔ (raný žolík). Opakování se sčítá
  s Dechovkou a červenou pečetí, strop `MAX_ACTIVATIONS_PER_CARD` platí.
- _Kupónová privatizace_ — rozpis odměn: **+1 Kč za každých celých 5 % cíle, o které skóre kola cíl překročilo, nejvýš
  8 Kč** (bez desetinných čísel: ⌊přebytek × 100 / (cíl × 5)⌋). Boti končí kolo s mediánem 1,35–1,67× cíle. 1 Kč / 10 %
  (max 10): 3,9 Kč/kolo; 1 Kč / 5 % (max 10): 6,9 Kč (7,5 v patrech 1–3) a Δ +5,2 kola; **max 8: 5,5 Kč (6,3)** ✔.
  Kolo zachráněné pod cílem nedá nic. Nástroj hlásí „POD“ kvůli šumu skóre (≈ 1–6 %, jiné peníze → jiný průběh) —
  hodnotí se podle Kč/kolo jako u ekonomických žolíků `common2`.
- _Lázeňský host_ — **za každé kolo bez zahazování (`round.discardsUsed === 0` na konci kola) trvale +×0,15**
  (zahození efektem se nepočítá, jako u Hostinského — partner). +×0,1: R2 64; **+×0,15: 15 / 103, špička 102** ✔.
  Boti odložený efekt neznají (zahazují, i když by neměli), v simulaci Δ +0,5 kola.
- _Dechovka_ — **každá skórující karta skóruje ještě 2× za každou další skórující kartu stejné hodnoty** (Dvojice 2×,
  Trojice 4×, Čtveřice 6×, Pětice 8×; Full house 4× a 2×). Kamenná karta hodnotu nemá, debuffnutá „nedává nic“.
  1× za kartu: 51 / 20 (POD); **2×: 121 / 75, špička 159** ✔. Pětice s červenou pečetí je přesně na stropu 10 aktivací.
- _Karlův most_ — **×3, pokud v ruce zůstala karta stejné hodnoty jako některá skórující** (jednou za ruku). Skórující
  debuffnutá karta se nepočítá, karta v ruce ano (i debuffnutá a lícem dolů), kamenná nemá hodnotu. ×2,5: 46 / 50
  (na hraně); **×3: 64 / 72, špička 200** ✔.
- _Dálnice D1_ — **×2 mult; ruka o 1 kartu menší** (`passive handSize −1`, kopie dá jen ×2). **100 / 100** — nástroj
  měří ruce izolovaně, cena (menší ruka) se ukáže jen v simulaci (Δ +1,7 kola).
- _Směnárna_ — **×1 a +×0,1 za každých celých 15 čipů, které ruka má v okamžiku kroku 4 na pozici Směnárny, nejvýš
  ×2,5** (`ctx.chips`: základ, karty, žolíci nalevo a vlastní lesklá edice — edice „před“ platí před vlastním efektem,
  DESIGN 3.1). Strop drží čipový build pod „auto-win“. **47 / 81, špička 120** ✔ (pozdní žolík).
- _Silvestr_ — **po každé porážce šéfa trvale +×0,2** (`onBossDefeated`). **10 / 101, špička 101** ✔. Rodina
  s Válečnou kořistí z `rare2` (stejný spouštěč, peníze místo ×mult).
- **Kopírování a nálepky:** `copyable: false` — Archivář (kopírující), Kupónová privatizace (rozpis odměn).
  `noRental` — Privatizace. `noPerishable` — Lázeňský host, Silvestr. Stav: Archivář (`target`), Lázeňský host
  (`rounds`), Silvestr (`bosses`); kopie ho nemění. Žádná náhoda.
- **Art:** hlavní ikony unikátní mezi všemi žolíky (včetně `rare2`), dvojice ikona + rekvizita unikátní, pozadí
  unikátní mezi epickými: lahev + hvězdy, papíry + brýle, klobouk + králík, deštník + stopa, kruh + megafon,
  továrna + známka, vana + cylindr, buben + noty, lucerna + koruna, kužel + prasklá pneumatika, bankovka + váhy,
  rachejtle + budík.

**Naměřeno po ladění** (`npx tsx scripts/joker-value.ts --runs 60`, obsah včetně `rare2`; pásmo epického 80–180 /
45–110 / 5–7 Kč, špička ≤ 220):

| Žolík                | R1 / R2       | Špička R2 | Reálně | Kč/kolo   | Δ kol | Hodnocení                  |
| -------------------- | ------------- | --------: | -----: | --------- | ----: | -------------------------- |
| Pivní sommelier      | 84,7 / 96,8   |       210 |     88 | –         |  +3,1 | v pásmu                    |
| Archivář             | 86,5 / 91,1   |       170 |     91 | –         |  +1,4 | v pásmu (skutečná sestava) |
| Kouzelník z pouti    | 94,2 / 90,7   |       113 |    136 | –         |  +2,5 | v pásmu                    |
| Turistický průvodce  | 112,7 / 35,9  |        94 |    418 | –         |  +3,2 | v pásmu (R1)               |
| Spartakiáda          | 91,0 / 36,0   |       112 |    104 | –         |  +1,5 | v pásmu (R1)               |
| Kupónová privatizace | –             |         – |      – | 5,5 (6,3) |  +3,7 | v pásmu (Kč)               |
| Lázeňský host        | 15,1 / 102,6  |       102 |     51 | –         |  +0,5 | v pásmu (R2)               |
| Dechovka             | 120,6 / 74,9  |       159 |    244 | –         |  +2,3 | v pásmu                    |
| Karlův most          | 63,7 / 71,8   |       200 |     81 | –         |  +0,7 | v pásmu (R2)               |
| Dálnice D1           | 100,0 / 100,3 |       100 |     97 | –         |  +1,7 | v pásmu                    |
| Směnárna             | 46,7 / 81,1   |       120 |     71 | –         |  +0,8 | v pásmu (R2)               |
| Silvestr             | 9,7 / 101,1   |       101 |     51 | –         |  +0,8 | v pásmu (R2)               |

„Reálně“ (sestava bota se žolíkem / bez něj) je u Průvodce a Dechovky vysoko (418 / 244 %), protože boti s nimi honí
Barvy a Dvojice a jejich ostatní žolíci (Párty pro dva, barevní) se tím spouštějí častěji — pravidla 4.3 hodnotí
izolovaný efekt. Sloupec Δ výher je při 60 seedech šum (−5 až +52 p. b.), proto ho tabulka neuvádí.

**Integrace do `tests/unit/jokers-combos.test.ts`** (soubor mimo zadání; padá na chybějícím scénáři pro každého nového
žolíka, stejně jako u `common2` a `rare2`): scénáře ověřené v kopii testu (414/414 zelených se žolíky fáze 4,
legendárními a `epic2`). Karlův most potřebuje pole `pick` navržené u `common2` (`runScenario` pak hraje
`sc.pick ? sc.pick.map((i) => cards[i]!) : cards`). Směnárna má ruku nad stropem ×2,5 — jinak by lesklá edice
(+50 čipů před efektem) zvýšila i její ×mult a test edic (`[čipy + 50, stejný mult]`) by neplatil.

```ts
beer_sommelier: { hand: 'KS KH' },
archivist: { hand: 'KS' },
fair_magician: { hand: 'KS KH' },
tour_guide: { hand: 'AH 9H 6H 2H' },
spartakiada: { hand: 'KS KH' },
voucher_privatization: { hand: 'KS' },
spa_guest: { hand: 'KS KH', state: { rounds: 2 } },
brass_band: { hand: 'KS KH' },
charles_bridge: { hand: 'KS KH KD', pick: [0, 1] },
d1_motorway: { hand: 'KS KH' },
exchange_office: { hand: 'KS+300 KH' },
new_years_eve: { hand: 'KS KH', state: { bosses: 2 } },
```

**Proč:** CLAUDE.md kap. 3 (žolíci = data + hooky, 100+ žolíků), 5 (humor, velké české reálie, žádné skutečné osoby
ani značky), 6 (texty v i18n, typografie), 7 (žádné převzaté názvy), 8 (test na každého žolíka, determinismus, žádný
bezcenný ani auto-win); DESIGN 4.1–4.5 a 4.9; CONTENT-GUIDE kap. 2–3.

## 2026-10-02 — Fáze 6: ladění se šéfy (boti a pravidla šéfů, letalita šéfů, křivky cílů)

**Výchozí stav** (před úpravou, `npm run simulate`, Desítka, 100 runů SIM-A): max 20 %, flush 16 %, pairs 12 %,
nojoker 0 %, neplatné akce 0. Boti pravidla šéfů znali jen přes přesný přepočet tahu: karty lícem dolů nehráli
(Výluka na trati 67 % letalita u `max`), pod Jednookým hejtmanem řadili ×mult žolíky doprava (= vypnuté), Monte Carlo
zahazování nevědělo o Bílé paní (zahazovali, dokud nedošla zahození) a přeskakovali útraty za jakýkoli štítek.

**Co — boti** (`src/engine/sim/bots.ts`, `hand-eval.ts`; testy `tests/unit/sim-bosses.test.ts`, upravený test
přeskakování v `review2-sim-save.test.ts`). Pravidla bot nepoznává podle id — čte náhled enginu nebo zkouší akci
na kopii hry (sonda), takže funguje i pro budoucí šéfy:

- **Zakázané kombinace** (`HandPreview.blockedReason`, Soused s vrtačkou): kandidát má skóre 0 a příznak `blocked`;
  `EvalEnv.blocked` (z kandidátů v ruce, `blockedTypes`) dá kombinaci skóre 0 i v Monte Carlo po zahození.
- **Karty lícem dolů**: bot je bere jako „průměrnou“ kartu (`FACE_DOWN_KEEP`), doplňuje jimi tah (protočí se,
  skórují normálně), náhled i přesný přepočet počítá jen z viditelných karet (neznámé karty neodhaluje). Pod šéfem,
  který soudí celou ruku (`validateHand`, `adjustHandScore`), je do tahu nepřidává (`EvalEnv.hiddenPad`).
- **Sonda zahození** (`discardEffects`, jen se šéfem s `onDiscard`/`onDraw`/`isDrawnFaceDown`): kolik držených karet
  zahození vezme navíc (Tchyně), jestli se držené karty otočí (Bílá paní) a jaký podíl dobraných přijde lícem dolů
  (Výluka, Mlha). Monte Carlo pak ztracené karty losuje, otočené nevidí a dobrané karty s tímto podílem skryje —
  pod Bílou paní bot přestal pálit zahození a Výluka přestala lákat k honbě za Barvou.
- **Pozice žolíků** (`positionalDebuffs`): sonda dvou pořadí na kopii hry najde pozice vypnuté pravidlem
  (`round.ruleJokerDebuffs` v obou pořadích); fungující pozice dostanou nejlépe hodnocené žolíky (v rámci skupin
  běžný klíč +čipy/+mult vlevo, ×mult vpravo). Pravidlo, které vypíná všechny pozice, pořadí nemění; po přeřazení bot
  znovu nepřeřazuje (stabilní řazení, test).
- **Žolíci vypnutí do první ruky** (`jokersReturnAfterHand`, Výpadek proudu): sonda zahraje tah na kopii; když se
  po ruce žolíci vrátí, bot v kole bez žolíků nezahazuje (letalita Výpadku 11 % → 3–5 %).
- **Poslední ruka kola**: `bestUtility(…, lastHand)` dá ruce, která cíl dosáhne, navíc celý cíl (rozhoduje šance na
  výhru, ne průměr). Zbývající cíl se pro Monte Carlo přepočte poměrem přesného skóre k odhadu bez žolíků
  (`exactScale`) — dřív se odhad bez žolíků porovnával s cílem v bodech se žolíky a strop i bonus neplatily.
- **Náhoda ve skórování**: první přesný přepočet se dělá 2× (v poslední ruce 3×); když se vzorky liší, bere se tolik
  vzorků u každého kandidáta — průměr, v poslední ruce nejhorší vzorek. Předtím bot v Polední pauze hrál Dvojici,
  kterou mu jeden šťastný hod ohodnotil nad cíl (792 místo obvyklých 372 bodů při cíli 570).
- **Přeskakování útrat**: jen za štítek, jehož hodnota ze sondy (peníze, úrovně, žolík, spotřebky; obálka zdarma
  odhadem `boosterWorth`; nižší cíl šéfa 40 Kč × snížení; štítek „na později“ paušál 4 Kč) je aspoň 1,1× ztráta
  (odměna za útratu + 1,5 × peníze za nevyužitou ruku + úrok + 3 Kč za Večerku), a jen se silným buildem (průměrná
  nejlepší ruka × ruce ≥ 2,5× cíl **následující** útraty). Pokus (200 runů SIM-B): plošné přeskakování se silným
  buildem max 17 / flush 16 / pairs 11 %, bez přeskakování 25 / 22 / 14,5 %, nové 24 / 23 / 15 % (bot teď skáče
  0,1–0,2× za run, hlavně za Předpověď počasí a Šéf má chřipku). Rezerva na úrok `interestStep × (patro − 1)` ověřena:
  menší (`patro − 2`) i větší (`patro`) rezerva shodně ~24 % proti ~32 %.
- **Výstup simulace** (`RunResult.bosses`, `skipTags`; `SimSummary.bosses` = letalita šéfů v útratě Šéf, `avgSkips`,
  `skipTags`): v JSON výstupu `npm run simulate -- --json`; textový výstup `scripts/simulate.ts` je beze změny (mimo
  rozsah úkolu — letalitu šéfů do textu doplnit ve fázi 10).

**Co — cíle šéfů** (`src/content/bosses/{a,b,final}.ts`, DESIGN 8.2/8.3, testy `bosses-a/b/final`). Letalita se měří
při setkání v útratě Šéf a **normuje podle patra** (relativní letalita = úmrtí / očekávaná úmrtí podle letality všech
běžných šéfů v témže patře) — šéfové s `minAnte 1` jinak vypadají neškodně jen proto, že je hráč potká v patře 1–2,
kde se skoro neumírá. Data: Desítka, max + flush + pairs × SIM-A + SIM-B × 300 runů = 1 800 runů. „Před“ = hotoví boti,
původní cíle (101 žolíků teprve během ladění — obsah fáze 7 přibýval paralelně); „po“ = konečný stav.

| Šéf                    | Cíl před → po | Letalita před (rel.) | Letalita po (rel.) | Proč                                            |
| ---------------------- | ------------: | -------------------: | -----------------: | ----------------------------------------------- |
| Polední pauza          |  1,25 → 0,65× |        27,1 % (2,43) |       5,7 % (0,82) | jedna ruka: rozptyl jedné ruky, ne průměr       |
| Výluka na trati        |        2 → 1× |        25,7 % (2,38) |      11,1 % (1,61) | polovina ruky zakrytá                           |
| Jednooký hejtman       |      2 → 1,4× |        25,5 % (1,97) |       9,9 % (1,24) | polovina žolíků i s dobrým pořadím              |
| Garsonka 1+kk          |     2 → 1,35× |        20,1 % (1,82) |       9,0 % (1,34) | bez Postupek a Barev                            |
| Nová vyhláška          |      2 → 1,1× |        22,0 % (1,71) |      11,4 % (1,36) | boti stojí na úrovních kombinací                |
| Exekutor               |     2 → 1,75× |        12,2 % (1,11) |       9,6 % (1,41) | bez nejcennějšího žolíka (rel. 1,5 v mezikroku) |
| Krajské derby          |     2 → 1,75× |        13,4 % (1,19) |       9,4 % (1,37) | rel. 1,6–1,8 v mezikrocích                      |
| Kontrola z finančáku   |     2 → 2,25× |         3,3 % (0,44) |       4,1 % (0,80) | mírné pravidlo                                  |
| Parkovné               |     2 → 2,25× |         1,2 % (0,20) |       3,0 % (0,70) | mírné pravidlo                                  |
| Kapsář v tramvaji      |     2 → 2,25× |         2,7 % (0,26) |       3,8 % (0,55) | mírné pravidlo                                  |
| Tchyně na návštěvě     |     2 → 2,25× |         2,9 % (0,43) |       3,7 % (0,80) | mírné pravidlo                                  |
| Zabijačka              |      2 → 2,5× |         6,0 % (0,46) |       5,4 % (0,63) | bolí až v dalších kolech                        |
| Výpadek proudu         |            2× |        11,2 % (1,56) |       3,4 % (0,71) | jen bot (nezahazuje bez žolíků)                 |
| Pan starosta (finální) |      2 → 2,5× |               19,4 % |            16–20 % | finální mají mít 20–40 %                        |
| Krajský úřad (finální) |     2 → 2,25× |               26,5 % |             23,2 % |                                                 |
| Velká voda (finální)   |      2 → 2,5× |               14,0 % |             22,7 % |                                                 |
| Bílá paní (finální)    |      2 → 1,5× |            34,5–48 % |             27,2 % | vidí se jen nově dobrané karty                  |
| Protihluková stěna     |          4,5× |               47,3 % |             39,1 % | jen nižší patro 8 křivky 1 (číslo v textu)      |

Ostatní šéfové beze změny (2×; Šanon na šanonu 3×). Rozpětí po: běžní šéfové 2,6–11,5 % (relativně 0,38–1,61, před
0,20–2,43), průměr 6,0 %; fináloví 16–39 %. Relativní letalita jednoho šéfa má při ~40 úmrtích šum ±15 %; nejvyšší
po (Šanon, Výluka, Soused 1,61) se mezi sadami přelévají (Soused 1,03–1,61, Polední pauza 0,82–1,77).

**Co — křivky** (`src/engine/run/targets.ts`, DESIGN 2.3.1 a 2.3.3, testy `targets`, `stakes`, `game`):

| Křivka | Před (fáze 5)                                         | Po                                                   |
| -----: | ----------------------------------------------------- | ---------------------------------------------------- |
|      1 | 250, 550, 1 100, 2 200, 4 200, 7 500, 13 000, 22 000  | 250, 550, 1 100, 2 200, 4 300, 7 800, 13 500, 21 000 |
|      2 | 250, 600, 1 200, 2 500, 4 900, 9 000, 16 000, 27 000  | 250, 550, 1 100, 2 300, 4 500, 8 000, 14 000, 23 000 |
|      3 | 250, 650, 1 300, 2 800, 5 800, 11 000, 20 000, 35 000 | 250, 550, 1 150, 2 400, 4 700, 8 600, 15 500, 26 000 |

Křivka 1: patra 5–7 výš, patro 8 níž — prohry v patře 8 byly nejčastější (15 % runů), DESIGN 12.1 chce vrchol
v patrech 5–7, a Protihluková stěna (4,5× v textu) měla 47 %. Křivky 2 a 3: vyšší síly piva končily v patře 2 ve
20–30 % runů (ekonomika Jedenáctky a Ležáku) — patra 1–3 jsou teď skoro jako křivka 1, ztížení přidávají od patra 4;
pořadí křivek (1 ≤ 2 ≤ 3 v každém patře) zůstává.

**Výsledky simulací** (`npm run simulate -- --runs 300 --stake 1|8 --bot all`, SIM-A; % výher):

| Bot     | Desítka před | Desítka po  | Imperial před | Imperial po |
| ------- | ------------ | ----------- | ------------- | ----------- |
| max     | 20 %, 5,5    | 32,3 %, 6,3 | 0 %, 3,1      | 1 %, 3,7    |
| flush   | 16 %, 5,8    | 32 %, 6,4   | 0 %, 3,1      | 1,3 %, 3,6  |
| pairs   | 12 %, 5,4    | 27,7 %, 6,2 | 0,3 %, 3,1    | 1 %, 3,6    |
| econ    | –            | 20,7 %, 4,3 | –             | 0 %, 1,9    |
| random  | –            | 0 %, 1      | –             | 0 %, 1      |
| nojoker | 0 %, 2,9     | 0 %, 3,0    | –             | 0 %, 2,3    |

(% výher, průměrné patro.) „Před“ = výchozí stav (Desítka 100 runů; Imperial 300 runů po první úpravě cílů šéfů,
staré křivky). Po: nejlepší rozumná strategie `max` 32,3 % (cíl 25–35 %), Imperial 1,3 % (< 3 %); `nojoker` medián
prohry v patře 3 (cíl 3–4), `random` prohraje v patrech 1–2 vždy; neplatné akce 0 u všech botů. Doba: Desítka 204 s,
Imperial 76 s za všech 6 botů.

Další sady a síly piva (300 runů, SIM-A, konečné cíle; `max` / `flush`): Desítka SIM-B 29,0 / 35,7 % (pairs 25,7 %).
Jedenáctka 13,7 / 14,0 %, Dvanáctka 14,7 / 14,0 %, Speciál 13,0 / 11,7 %, Ležák 3,3 / 4,7 %, Bock 2,3 / 3,3 %,
Doppelbock 2,7 / 1,0 %, Imperial 1,0 / 1,3 % (před úpravou křivek: Jedenáctka 13,3, Dvanáctka 7,0, Speciál 9,3, Ležák
0,7, Bock 0,7, Doppelbock 0,3, Imperial 0 % u `max`). Rozložení proher na Desítce (1 800 runů): patra 1–8 2,1 / 3,6 /
6,6 / 9,1 / 11,7 / 11,8 / 10,1 / 13,9 % runů (patra 1–2 5,7 % < 10 %). Patro 8 zůstává o něco nad patry 5–7: plyne to
přímo z letality finálových šéfů 20–40 % (DESIGN 12.1) — patra 8 dosáhne ~48 % runů a ~27 % z nich padne na
finálovém šéfovi, tedy ~13 % runů jen na něm. Peníze při vstupu do Večerky patro 1 ~10 Kč,
patro 4 ~27 Kč (cíl 8–14 / 15–30). Neplatné akce 0 u všech botů. Doba: ~70–80 s na 300 runů rozumného bota.

**Mimo pásmo / otevřené:**

- **Střední síly piva** (DESIGN 10): Dvanáctka a Speciál v pásmu, Jedenáctka (14 % proti 20–30), Ležák (~4 % proti
  7–12), Bock (~3 % proti 4–8) a Doppelbock (~2 % proti 3–6) pod ním. Příčina je ekonomika, ne křivka: Jedenáctka má
  stejnou křivku jako Desítka a samotné +1 Kč ve Večerce srazí výhry z ~33 na ~14 %; Ležák (bez peněz za nevyužité
  ruce) z ~13 na ~4 % (o 2 Kč méně v první Večerce, 4,8 místo 6,9 koupených žolíků). Křivkou to opravit nejde, aniž by
  „vyšší“ křivka byla lehčí než křivka 1. Návrh pro fázi 10 (`src/content/stakes.ts`, mimo rozsah úkolu): Jedenáctka
  +1 Kč jen na přehození a obálky (nebo jen na žolíky), Ležák polovina peněz za nevyužité ruce nebo až od patra 3.
- **Protihluková stěna** (39 %, horní okraj 20–40 %) a **Šanon na šanonu** (relativně 1,2–1,8) mají násobek cíle
  v textu pravidla (`src/i18n/cs/bosses/{b,final}.ts`, mimo rozsah úkolu); návrh: Stěna 4×, Šanon 2,75×.
- **Imperial**: pravidlo šéfa ve Velké útratě bere cíl Velké (1,5×), ne snížený cíl šéfa — Polední pauza s jednou
  rukou na 1,5× základu je tam nejčastější šéfovská příčina prohry (9–10 % proher). Imperial je v pásmu (< 3 %), ale
  ve fázi 10 zvážit cíl Velké × min(1, cíl šéfa / 2) pro šéfy s nižším cílem (engine, DESIGN 10).
- **Patro 8 a „statisíce“ (CLAUDE.md kap. 3):** vítězné runy `max`/`flush` mají medián nejlepší ruky 60–75 000 (p90
  ~180–250 000) při cíli šéfa patra 8 42 000. Aby patro 8 chtělo řádově statisíce (šéf ~300 000, základ ~150 000),
  potřebují boti ~5–7× silnější ruce: (1) obsah — víc ×mult a opakování (legendární a epičtí ×mult žolíci dostupnější,
  škálující ×mult, synergie s úrovněmi), (2) boti — kupovat žolíky podle synergie s buildem (×mult na hlavní
  kombinaci, opakování na skórující karty) místo vzácnosti × štítku, soustředit pranostiky na hlavní kombinaci,
  držet ×mult vpravo i při kopírování a plánovat víc tahů dopředu. Obojí patří do fáze 7 (obsah) a 10 (boti, balanc);
  pak se křivky zvednou zpět k původnímu návrhu (patro 8: 80 000 / 150 000 / 250 000).
- Obsah se během ladění měnil (paralelní fáze 7: 67 → 101 žolíků), výsledky jsou snímek; po uzavření fáze 7 přeměřit
  (DESIGN 12.4 krok 7: 3 sady × 500 runů).
- `tests/unit/jokers-combos.test.ts` padá na nových žolících fáze 7 (paralelní práce, mimo tento úkol).

**Proč:** CLAUDE.md kap. 8 (simulace, cílová % výher, žádný šéf výrazně smrtelnější), DESIGN 8, 10, 12.1–12.5
(postup ladění, letalita šéfů, každá změna čísla do DECISIONS a tabulek).

## 2026-10-02 — Fáze 7: balíčky 9–12, ověření tajných kombinací a nekonečného režimu

**Co:** `src/content/decks.ts` má všech 12 balíčků z DESIGN kap. 9 v pořadí tabulky (= pořadí v menu): přibyly
Úřednický (`clerk`), Babiččin (`grandmas`), Vetešnický (`junk_shop`) a Kalendářový (`almanac`). Texty
`src/i18n/cs/decks.ts`, testy `tests/unit/decks.test.ts`, nové `tests/unit/secret-hands.test.ts` a
`tests/unit/endless.test.ts`.

- **Engine — `DeckDef.startingVouchers`** (obecné, malé rozšíření; test v `decks.test.ts` s testovacím registrem):
  kupóny uplatněné zdarma na startu runu, stejně jako `ChallengeDef.startingVouchers` — přes `redeemVoucher` (zapíše
  kupón, `onRedeem`, vyřadí ho z nabídky patra), **před** `onRunStart` balíčku, bez kontroly `VoucherDef.available`;
  kupón uplatněný dvakrát (balíček + výzva) se přeskočí, neznámé id se tiše přeskočí (jako u výzev). Nepočítá se do
  nákupů (`stats`) — pro odemčení „kup 5 kupónů“ se počítají jen koupené.
- **Úřednický:** `startingVouchers: ['loyalty_card', 'tear_calendar']` (později `['tear_calendar', 'counter_buddy']`, viz
  „Balanc po fázi 7“). Popisek jmenuje kupóny natvrdo (DeckDef
  `params` jsou jen čísla a řetězce bez i18n), test hlídá, že obsahuje přesně `vouchers.<id>.name`.
- **Babiččin:** `consumableSlots +1`; v `onRunStart` vytvoří **2 různé** babské rady (vážený los z `RADY` podle
  `ConsumableDef.weight`, bez `noShop`, stream `misc`, kandidáti seřazení podle id). Různé, protože „dvě stejné rady“
  působí jako chyba a balíček má ukázat šíři rad; obecný `createConsumable({ kind })` vylučovat neumí a kvůli jednomu
  balíčku se engine nerozšiřuje.
- **Vetešnický:** `shopCardSlots −1`; v `onRunStart` `api.createJoker({ rarity: 'rare' })` — bez edice a **bez
  nálepek i na Doppelbocku/Imperialu** (startovní dar, ne zboží z Večerky), respektuje odemčený pool a zákazy výzvy;
  žolík je „získaný“ (`onAcquire` se volá, na rozdíl od startovních žolíků výzvy — jde o náhodný dar z Večerky).
- **Kalendářový:** `discards −1`; `onBossDefeated` vytvoří pranostiku nejčastěji hrané kombinace runu
  (`handLevels.played`, **při shodě silnější**, bez zahrané ruky Vysoká karta — stejné pravidlo jako babská rada
  Rosnička; helper `almanacHand` je vlastní, protože `mostPlayedHand` v radách bere kontext spotřebky). Bez volného
  slotu `+2 Kč` hned (`addMoney(…, 'deck')`, ne v rozpisu odměn — `onBossDefeated` běží před ním) a hláška
  `decks.almanac.full`; po vytvoření hláška `decks.almanac.made`. Tajná kombinace sem přijde jen zahraná (= objevená).
- **Odemčení** (`UnlockCondition.custom`, vyhodnotí fáze 8): `vouchersBought5` (kup celkem 5 kupónů), `radyUsed30`
  (použij celkem 30 babských rad), `jokersSold25` (prodej celkem 25 žolíků), `handLevel6` (zvyš kombinaci na úroveň 6).
- **Ikony obálek:** `papers`, `spectacles`, `old-lantern`, `calendar` — každý balíček má jinou ikonu (test).

**Dohratelnost a orientační síla** (bot `max`, Desítka, 40 seedů `SIM-BAL-*`, po zapojení fáze 6 a 101 žolíků):
Hospodský 30 %, Štamgastův 40 %, **Úřednický 67,5 %**, Turistický 27,5 %, Mariášový 55 %, Obrázkový 47,5 %, Notářský
55 %, Zbohatlík 30 %, Dlužník 25 %, Babiččin 47,5 %, Vetešnický 40 %, Kalendářový 50 %. Všechny balíčky bot dohraje
bez neplatné akce a do 12 seedů aspoň jednou vyhraje (test). Úřednický je zřetelně nejsilnější (dva kupóny za 18 Kč
hned na startu; bot sám kupóny kupuje málo, takže pro něj je dar cennější než pro hráče) — **úkol pro fázi 10**
(balanc): zvážit např. jen Věrnostní kartu, nebo kupóny za cenu startovních peněz (vyřešeno 2026-10-02: Trhací
kalendář + Kamarád za pultem, „Balanc po fázi 7“). Pravidla teď drží DESIGN kap. 9.

**Tajné kombinace (DESIGN 2.2.4) — ověřeno end-to-end se skutečným obsahem** (`secret-hands.test.ts`): detekce Pětice,
Barevného full housu a Barevné pětice i s divokými kartami a relace „obsahuje“; objev v runu (`discoveredHands`,
`handDiscovered` jen u tajné a jen při prvním zahrání; přežije uložení; nový run začíná bez objevů); pranostiky
tajných kombinací se bez objevu neobjeví ve Večerce (150 přehození s Trhacím kalendářem), v obálkách ani v náhodném
vytváření — po zahrání Pětice jen Na Hromnice; Úřední hodiny („všechny kombinace“) zvýší i neobjevené, běžné efekty
ne; Kalendářový vytvoří pranostiku tajné kombinace, když je nejhranější. Engine nepotřeboval opravu.
**Zjištění pro UI a fázi 8** (UI tento úkol neměnil): Info o runu ukazuje „???“ podle `discoveredHands` runu
(`modals.ts`, test v `ui-game.test.ts`) ✔. Chybí: (1) objev v **profilu** — DESIGN chce tajné kombinace vidět i
v dalších runech; dnes je zdroj jen run, fáze 8 musí předat profilové objevy (např. přes `unlockedPool` nebo nové pole)
a UI je sloučit; (2) **sbírka** (`gallery.ts`) kombinace nezobrazuje vůbec a pranostiky tajných kombinací v ní ukazují
název kombinace (popisek z `describe.ts`) bez ohledu na objev; (3) levý panel při výběru karet ukáže název tajné
kombinace (např. „Pětice“) ještě před prvním zahráním — DESIGN to nezakazuje, ale prozradí ji; rozhodnutí nechávám UI.

**Nekonečný režim (DESIGN 1.3) — ověřeno** (`endless.test.ts`): cíle pater 9–20 (Malá/Velká/Šéf) pro všechny tři
křivky — tabulka přepočítaná nezávisle podle vzorce (patro 20, křivka 1: 220 000 000 000 jako v DESIGN 2.3.3);
orientační čísla 24/32/40; průchod patry 9–24 se skutečným obsahem (finálový šéf jen v patrech 16 a 24, porážka šéfa
už není výhra, cíle ve hře = `blindTarget` s násobkem šéfa, křivka podle síly piva); přetečení přesně od **patra 210**
ve všech křivkách (209 konečné i s násobkem ×4,5) → `Number.MAX_VALUE`, `formatNumber` „∞“, skóre ruky i kola se
zastaví na stropu a strop splní cíl, uložení bez `Infinity`/`null`; finálový šéf i za přetečením (208, 216). Engine
nepotřeboval opravu. Statistika „nejvyšší patro“ a achievement „Tepelná smrt vesmíru“ patří do fáze 8.

**Proč:** CLAUDE.md kap. 3 (12 balíčků, tajné kombinace, nekonečný režim), 8 (testy, simulace), DESIGN kap. 1.3,
2.2.4 a 9; CONTENT-GUIDE kap. 8.1.

## 2026-10-02 — Revize fáze 6 (šéfové a štítky): texty, kombinace s enginem, fuzz

**Texty** (skriptem vyrenderovaných všech 30 šéfů — `name`, `rule` s `params`, `intro`, `defeat`, `death` — a 20 štítků,
porovnaných s kódem a s DESIGN 7, 8.2, 8.3 a přílohou C): názvy nejvýš 3 slova, hlášky příchodu a porážky i pitvy
sedí s DESIGN (jediná odchylka je dřív zapsaná úvodní hláška Pověrčivé babky), čísla v textu sedí s kódem, tykání
(vykání jen u úředních postav — viz „Oslovení hráče: tykání“), hráč je oslovený rodově neutrálně, žádná jména žijících
osob ani značky. Srovnání s Balatrem: žádný převzatý ani přeložený název či text (The Hook, The Wall, The Needle,
The Psychic, Violet Vessel, Cerulean Bell, Verdant Leaf, Amber Acorn, Crimson Heart, Investment/Juggle/Double/Boss
Tag…); mechaniky inspirované žánrem mají vlastní čísla a české téma (Polední pauza 0,65×, Šanon na šanonu 3×,
Protihluková stěna 4,5× — dálniční stěna je vlastní česká reálie, ne překlad „The Wall“; Termínovaný vklad 15 Kč,
Brigáda na chmelu 1 Kč za 2 ruce se stropem 15 Kč…).

- **Oprava — čísla v pravidlech šéfů jen přes `{param}`:** `rule` měla čísla napsaná rovnou (odchylka z doby, kdy
  `bossTexts` nedosazoval `params`). Teď `{fee|money}`, `{hands|plural:ruku,ruce,rukou}`, `{cards|plural:…}` s tvary
  podle pádu, `{target}×` u Šanonu na šanonu a Protihlukové stěny — změna `targetMult` těchto šéfů už nevyžaduje změnu
  textu (blok „číslo v textu“ z ladění odpadá). Textový režim simulace (`npm run simulate -- --play`) `params` šéfů
  dosazuje také. Vyrenderované texty jsou beze změny (porovnáno diffem); testy šéfů ověřují, že změna `params` změní
  text. CONTENT-GUIDE kap. 4 a ARCHITECTURE 2.7 aktualizované.

**Kombinace s enginem** (`tests/unit/phase6-review.test.ts`, 123 testů, skutečný obsah):

- každý šéf × uložení a načtení uprostřed kola: dvojče ukládané po každé akci má stejný stav i stejné události
  (boti `max` a `flush`, sestava s Archivářem, Kopírákem a Napodobitelem),
- každý šéf s pravidlem × Odvolání po zahození i zahrané ruce: zmizí debuffy, karty lícem dolů, vypnutí žolíci i
  `passive`, cíl zůstává, a zbytek kola je bajt po bajtu stejný jako dvojče se šéfem bez pravidla,
- kopírování × šéfové, kteří vypínají žolíky (Exekutor, Jednooký hejtman po přeřazení, Výpadek proudu, Krajský
  úřad): kopie žolíka mimo provoz nedá nic, po Odvolání zase ano. Napodobitel si cíl vybírá při výběru útraty (před
  pravidlem šéfa), pod Exekutorem tak může kopírovat zabaveného žolíka a v kole nedá nic — ponecháno: sedí s popiskem
  („kopíruje tvého nejdražšího…“) i s pravidlem „kopie žolíka mimo provoz nedá nic“, pod Výpadkem proudu si naopak
  cíl vybere správně,
- nekonečný režim: po šéfovi patra 15 se v patře 16 losuje finálový šéf; každý finální šéf v patře 16 má exponenciální
  cíl a jeho pravidlo se projeví po každé ruce,
- každý štítek × uložení a načtení od přeskočení po spotřebování (do konce patra se spotřebuje každý),
- fuzz: 30 šéfů × Desítka a Imperial, boti `max`/`flush`/`pairs`/`econ`/`random`, šéf vnucený do každého patra (i
  finální do běžných), štítky všech 20 druhů na útratách, náhodné přeskakování a Odvolání uprostřed kola, snížené
  cíle (run dojde do nekonečného režimu): žádná výjimka, JSON-bezpečný stav, 0 neplatných akcí, uložení a načtení po
  každé akci beze změny. Delší průzkumný běh mimo testy (240 runů až do patra 16–18) nic nenašel.

**Oprava enginu — třídění ruky prozrazovalo karty lícem dolů:** `sortHand` řadil i zakryté karty podle skryté
hodnoty. Pod Bílou paní se zamíchaná zakrytá ruka dala jedním stiskem S seřadit, pod Výlukou a Mlhou prozradila
pozice zakryté karty mezi odkrytými její hodnotu. Teď se řadí jen odkryté karty, zakryté zůstanou vpravo
v dosavadním pořadí (DESIGN 2.1, test; testovací bot `tests/unit/fixtures/bot.ts` řadí stejně).

**Otevřené (mimo rozsah — patří UI workflow, `src/ui/**`):**

- náhled balíčku ukazuje karty mimo dobírací balíček ztlumeně, takže se z něj pod Výlukou nebo Bílou paní dají
  odvodit zakryté karty v ruce (zvážit, aby karty lícem dolů v ruce náhled neprozradil),
- toasty se při více hláškách po sobě vrší přes pravou část ruky a balíček,
- fáze 5: přesun karet v ruce tažením a e2e test „otevřít obálku, vybrat kartu, použít spotřebku“ (tok jsem ověřil
  jen dočasným Playwright skriptem: koupě a použití pranostiky, kupón, obálka rad s dobranou rukou a cílem, obálka
  pranostik „nechat si“, prodej, babská rada na vybranou kartu v kole, konzole čistá),
- balanc: na Imperialu bere pravidlo šéfa ve Velké útratě cíl Velké (1,5×) i u šéfů se sníženým cílem — beze
  změny (DESIGN 10 to tak chce a Imperial je v pásmu < 3 %).

**Proč:** CLAUDE.md kap. 3, 5, 6 a 8; CONTENT-GUIDE kap. 12 a 14 (všechna čísla přes `{param}`, test efektu
i hranic, uložení a načtení).

## 2026-10-02 — Revize obsahu fáze 7: 101 žolíků (texty, duplicity, kombinace s enginem, fuzz)

**Co — počty:** 44 běžných (15 + 29), 32 vzácných (10 + 22), 17 epických (5 + 12), 8 legendárních = **101** (cíl
DESIGN 4.1 ✔). Hlavní kategorie každého žolíka a finální seznam jsou v DESIGN 4.10; rozložení proti plánu 4.9:
+mult 18 / 18, +čipy 9 / 10, ×mult 21 / 16 (z toho 5 legendárních), ekonomika 12 / 12, škálování 13 / 14 (2 legendární),
opakování 5 / 7, úpravy pravidel 10 / 10, kopírování 3 / 3, spotřebky a balíček 10 / 11 (1 legendární). Bez legendárních
sedí +mult, ×mult, ekonomika, úpravy a kopírování přesně; odchylky jsou vědomé (legendární jsou z 5/8 ×mult podle 4.8,
opakování u vzácných dělalo špičky nad pravidlem 3) a přijímám je — doplnění opakování a čipů je kandidát na obsahové
patche.

**Co — jak:** všech 101 popisků vyrenderovaných s `params` a `describe(self)` (scratch skript nad `jokerTexts`),
přečtené proti kódu všech sedmi souborů a proti seznamu názvů komerční předlohy. Názvy jsou unikátní a nejvýš
trojslovné, hlavní ikony i dvojice ikona + rekvizita jsou unikátní (hlídá `jokers-combos.test.ts`), štítky odpovídají
kategorii, oslovení je rodově neutrální, žádné žijící osoby ani značky (Dálnice D1, Karlův most a Spartakiáda jsou
místa a události, Žižka ve flavoru Válečné kořisti je historická postava).

**Nálezy a opravy:**

1. **Bludička = duplikát Zpožděného rychlíku** (DESIGN 4.4/10): obojí byl náhodný ×mult za ruku bez podmínky (×1,5 s
   šancí 5/6 a ×2 s šancí 1/3), lišila se jen čísla. Nově **„V kole se šéfem dá každá ruka ×2 mult.“** (bludičky
   svítí v noci, noc = šéf jako u Noční směny; rodina se stejnou podmínkou a jiným typem efektu). Bez náhody, kopie
   násobí znovu, vypnutý šéf podmínku nemění (`round.bossId`). Naměřeno `joker-value.ts` 60 seedů: **R1 30,2 %,
   R2 28,9 %, špička 100** (pásmo vzácného R2 20–60 ✔; dříve 34,5 / 36,4). Flavor: „Svítí jen v té největší tmě. Kam
   vede, to už neřekne.“
2. **Rybář = náhodná verze Stálého hosta**: obojí na konci kola trvale zvedalo +mult (jistě +1, nebo 1 z 3 +2). Nově
   **„Po každém zahození 1 z 2, že něco chytí: náhodnou babskou radu (potřebuje volný slot).“** (zahození = nahození
   udice). Kategorie škálování → spotřebky a balíček. Vzniká rodina zdrojů spotřebek s různým typem a spouštěčem
   (Trafikant: pranostika ve Večerce, Rybář: rada při zahození, Čarodějnice: razítko po šéfovi); partner Tety
   z poradny a Kořenářky, protihráč Hostinského a Lázeňského hosta. Bez volného slotu nehází (RNG se neposune), kopie
   hodí znovu (jako Teta), stav ani `noPerishable` už nemá. Šance: 1 z 3 dávala jen 0,08–0,12 rady za kolo (boti mívají
   sloty plné), **1 z 2 dává 0,11–0,17** (Trafikant 0,15–0,16; 40 runů na bota, scratch skript). `joker-value.ts`:
   R1 2,9 / R2 0,7 % je šum z karet upravených radou, simulace Δ kol +0,3 — hodnotí se jako ostatní spotřebkoví
   žolíci (jen simulace). Flavor: „Největší kapr mu zase utekl. Domů nese aspoň dobrou radu.“
3. **Hlídač parkoviště → Vrátný** (`parking_attendant` → `doorman`): téma parkoviště spolu se spouštěčem „figury
   držené v ruce“ kopírovalo téma i spouštěč žolíka komerční předlohy (CONTENT-GUIDE 13: inspirace mechanikou ano,
   stejné téma ne). Mechanika beze změny (+4 mult za figuru v ruce), ikona klíč + císařská koruna, flavor „Pana
   ředitele pozdraví, paní hlavní účetní taky. Tebe dál nepustí.“ `id` se mění — nic není vydané (CONTENT-GUIDE 2:
   po vydání se `id` nemění).
4. **Kopírák neukazoval cíl:** UI (`copyStatusText`, `copiedBy`) i boti (`slotOrderKey`) čtou cíl kopírujícího žolíka
   ze `state.target` (konvence Napodobitele a Archiváře), Kopírák ho nezapisoval — tooltip v kole hlásil „V tomto kole
   nemá koho kopírovat“, i když kopíroval (ověřeno skriptem: skóre s kopií Pivního tácku, text „nemá koho“). Nově
   `initState: { target: null }` a `copyTarget` zapisuje cíl jako Archivář (jen originál). Test v `jokers-rare2.test.ts`.
5. **Texty:** Třináctý plat — flavor „…z ní zbyde ohňostroj“ (nespisovné „zbyde“ a stejná pointa jako Silvestr:
   půlnoc a ohňostroj) → „Prémie za splnění plánu. Plán zněl: porazit šéfa.“, rekvizita rachejtle → trofej (rachejtle
   je hlavní ikona Silvestra). Hrací automat „tu samou“ → „stejnou“. Barvoslepý strýc „mají jednu barvu“ → „se
   počítají jako jedna barva“ (přesnost mechaniky). Polednice — flavor „…dítě ztichlo…“ odkazoval na smrt dítěte
   v Erbenově baladě (CONTENT-GUIDE 13) → „Kdo v poledne zlobí, toho si odnese. Kdo hraje, tomu zdvojnásobí mult.“
6. **`tests/unit/jokers-combos.test.ts` — integrace všech skupin** (padal na 299 testech, protože chyběly scénáře):
   pole scénáře `pick` (indexy zahraných karet), scénáře všech 71 nových žolíků (návrhy autorů skupin v DECISIONS,
   upravené pro Vrátného, Rybáře a Bludičku), přesné znění všech 101 popisků. Test zesílený: debuff porovnává
   **všechny** modifikátory (dřív jen `debtLimit` a `straightWrap`, takže nové `passive` žolíky — Kůlna, Dvorní malíř,
   Barvoslepý strýc, Pěšina, D1, Kouzelník, Průvodce, Známý na úřadě — nepokrýval); nově **Archivář kopíruje každého
   žolíka** (i epické a legendární; kopie = druhá instance, nekopírovatelného nevybere, stav po dvou kolech se zahozením
   se kopií nezdvojí); fuzz pouští všech 101 žolíků naráz (testovací obsah i obsah hry) a 20 pětic, které pokrývají
   všech 101 (střídavě testovací obsah a obsah hry, Napodobitel v každé druhé), s uložením a načtením uprostřed kola,
   a nově hlídá **0 neplatných akcí bota** (dřív se nepočítaly, jen se po 3 obcházely).

7. **Hodnota po fázi 6** (`npx tsx scripts/joker-value.ts --runs 60`, všech 101 žolíků, celý obsah včetně šéfů;
   sporné přeměřené na 100 seedech). Mimo pásmo 4.3 vyšli tři, ladění číslem v `params` (pravidlo 5):
   - **Hostinský** ×2,5 → **×2,2**: R1 / R2 124 / 126 % (NAD, R2 do 110) → **95 / 94 %**, špička 120. Boti se po fázi 6
     s Hostinským zahazování vyhýbají (trest za zahození), takže ×mult platí v ~80 % rukou — a hráč to udělá taky.
     DESIGN 4.7 č. 29 upravený; test botů (`jokers-bots.test.ts`) má ruku, kde rozhodnutí s ×2,2 pořád platí.
   - **Tramvaják** +12 → **+15 mult**: 31,5 / 7,0 % (POD; autor měřil před fází 6 37 / 8,4) → **38,8 / 8,6 %**.
   - **Sázkař** 6 → **7 Kč**: 1,9 Kč/kolo (POD, očekávaná hodnota přesně 2,0 na hraně) → **2,4 Kč/kolo**.

   Ostatní hlášení nástroje („POD“, „jen simulace“, „ŠPIČKA“) jsou známá a zdůvodněná u skupin: ekonomika a spotřebky,
   které nástroj neměří nebo měří šumem (Zahrádkář 2,1 Kč, Zabijačka 2,0 Kč na hraně — ničení nejnižší karty má cenu,
   kterou nástroj nevidí, Válečná kořist, Defenestrace, Notář, Čarodějnice, Vědma, Rybář, Kupónová privatizace
   5,6 Kč/kolo), čistá pravidla (Švejk, Dvorní malíř), úrovně kombinací (Praotec Čech, Krakonoš) a Sklář (špička 144 —
   skleněná karta, kterou žolík sám přinesl). Pivní břicho je na hraně (60 seedů R2 19,3 %, 100 seedů 21,4 %) —
   ponecháno.

**Zkontrolováno a ponecháno:**

- Rodiny se stejným spouštěčem a jiným typem efektu (DESIGN 4.4/10): Noční směna + Bludička (šéf), Ranní ptáče +
  Spartakiáda + Virální video (první ruka), Sběrna surovin + Sběrač hub (zničená karta, +mult se stropem / ×mult),
  Třináctý plat + Válečná kořist + Silvestr (šéf), Bazarník + Chatař (prázdné sloty), Golem + Dlaždič (kamenné karty),
  Teta + Rybář (rady), kopírující trojice s různým cílem (nejdražší / nejpravější / soused vlevo, strop 3 ✔).
- Sklář (téma sklo a spouštěč zničená skleněná karta) — téma je dané vylepšením, efekt je vlastní; Vědma — lidová
  postava (Libuše), ne překlad názvu; Dvorní malíř, Barvoslepý strýc, Vyšlapaná pěšina, Kouzelník a Průvodce mají
  pravidla inspirovaná předlohou, ale vlastní názvy i témata.
- Noční směna má po fázi 6 R2 7,9–8,1 % (60 seedů), R1 41–44 % — pravidlo 1 (dolní hranice aspoň v jednom okně)
  splněno.
- Simulace (`npm run simulate -- --runs 60`): 0 neplatných akcí všech botů, žádná výjimka; výhry max 33 %, flush 37 %,
  pairs 30 %. Dechovka a Dálnice D1 jsou v malých vzorcích (3–8 runů) mezi „nejsilnějšími“ u více botů — sledovat
  při balancu ve fázi 10 (`joker-value.ts` je má v pásmu).

**Mimo zadání (nahlášeno; kupón opraven 2026-10-02 přejmenováním na Žlutou cenovku, viz „Balanc po fázi 7“):** kupón „Věrnostní karta“ (fáze 5) nese český překlad názvu žolíka předlohy
(Loyalty Card) — obecný pojem s jinou mechanikou, ale CONTENT-GUIDE 13 zakazuje i přeložené názvy; přejmenovat při
revizi kupónů (balíček Úřednický ho uvádí jménem a test to hlídá). UI: `copyStatusText` mimo kolo hlásí „vybere na
začátku kola“ i u Archiváře a Kopíráku, kteří kopírují i mimo kolo (soubory UI patří fázi 6).

**Proč:** CLAUDE.md kap. 3 (100+ žolíků, data + hooky, test na každého), 5 (humor bez vulgarit a tragédií), 6
(spisovné texty, rodová neutralita), 7 (žádné převzaté názvy), 8 (žádný bezcenný ani auto-win, žádný duplikát);
DESIGN 4.3–4.5, 4.9; CONTENT-GUIDE kap. 11–14.

## 2026-10-02 — Fáze 5 (UI): přesun karet v ruce, náhled balíčku bez zakrytých karet, fronta hlášek, e2e spotřebek

**Přesun karet v ruce** (`src/ui/screens/game/handArea.ts`, akce `reorderHand` v kole i v dobrané ruce obálky):

- Tažení myší i prstem přes nový společný `attachDragSort` (`src/ui/components/dragSort.ts`), na který přešla i řada
  žolíků (`topRow.ts`) — obě řady se chovají stejně: krátký klik / tap = výběr (detail), tah od prahu 6 px (myš) /
  10 px (prst) = přesun, klik po tahu se pohltí, `pointercancel` vrátí vše beze změny, po puštění se uzly přeskládají
  hned (bez probliknutí) a položka „dosedne“ krátkou animací.
- Posun přes CSS vlastnost `translate` (ne `transform`): skládá se s povytažením vybrané karty (`transform` z
  `.is-selected`), takže tažená i tříděná vybraná karta zůstává nahoře. FLIP při třídění přešel na `translate` taky.
  Tažená karta se nenaklání (tilt by se změřeným obdélníkem neseděl).
- Dotyk: karty v ruce mají `touch-action: none` (jako žolíci) — s `pan-y` Chrome po rychlém tahu spustil setrvačný
  pohyb a první následující tap spolkl (ověřeno v Playwrightu). Výjimka telefon ≤ 600 px, kde se obrazovka posouvá:
  `pan-y pinch-zoom` (svislý tah posune stránku, vodorovný kartu).
- Klávesnice: **Shift + ← / →** posune kartu o místo — zaměřenou, pokud je vybraná, jinak naposledy vybranou, jinak
  zaměřenou (Tab) (`pickMoveTarget`). Focus zůstává na kartě (prohlížeč ho při `insertBefore` ztrácí — `updateHand`
  ho vrací), živá oblast ohlásí novou pozici, na kraji jen hláška. Zapsáno v nápovědě kláves v Nastavení
  (`settings.keys.items.move`) a v DESIGN 13.3.
- Tooltip: nový stisk ruší pohlcení kliku z dlouhého stisku, po kterém klik nepřišel (tah po dlouhém stisku jinak
  snědl příští tap).

**Náhled balíčku** (`deckPreviewModel` v `modals.ts`): karty lícem dolů mimo dobírací balíček (zakrytá ruka pod
Výlukou, Mlhou, Bílou paní; zakryté zahozené) jsou neznámé. Když nějaké jsou, náhled ukáže jen dobírací balíček
(žádné ztlumené karty venku — jinak by zakrytou kartu prozradila mezera v řadě barvy) a řádek „Lícem dolů (n)“ s ruby;
legenda to vysvětlí. Bez zakrytých karet beze změny (ztlumené karty venku podle hodnoty).

**Hlášky** (`src/ui/components/toast.ts`):

- Na herní obrazovce sloupec nahoře uprostřed jeviště, široký nejvýš 24 rem — mimo ruku, Zahrát / Zahodit a balíček.
  U panelu fáze (Večerka, obálka, výběr útraty, konec kola) začíná až pod jeho záhlavím: uprostřed jeviště by jinak
  na užší Večerce zakryl Přehodit (ověřeno snímkem). Kotva je funkce vracející obdélník
  (`setToastAnchor((needed) => rect)`), poloha se změří při každé nové hlášce a při změně velikosti okna. Mimo hru
  zůstává roh vpravo dole. Hláška tak může na chvíli zakrýt obrázek zboží, ne tlačítka — upřesněno níž („Fáze 5 (UI):
  vizuální kontrola snímky“): když se sloupec vejde do volného místa pod panelem, jde tam.
- Nejvýš **3** naráz (dřív 4), nejnovější dole, nejstarší odchází animací; ostatní se posunou plynule (FLIP přes
  `translate`). Stejná hláška znovu (druh + nadpis + text) nepřibude: obnoví se čas a naskočí počet „×2“
  (`common.repeated`) — opakované chyby (X bez zahození) se nevrší.
- Rychlost hry: výchozí doba ÷ √rychlost s dolní mezí (info/úspěch 4 s → nejméně 2,2 s, varování 5 → 2,8 s, chyba
  6 → 4 s), aby šlo dočíst; čte se z `--speed` na `<html>`. Vypnuté animace / reduced motion: příchod i odchod bez
  animace (odchod hned, ne až po 400 ms).

**Večerka — „Koupit a použít“ u spotřebek s cíli:** engine ji odmítne (ve Večerce není ruka, `targetPool` je prázdný).
Tlačítko se teď ukáže i u nich, ale neaktivní a fokusovatelné (`aria-disabled`, třída `btn--inert`, důvod v `title` i
skrytém popisu); klik / Enter řekne proč (hláška `game.shop.useNeedsHand` — i na dotyku, kde `title` není vidět).
U spotřebek bez cílů je neaktivní, když by použití nic neudělalo (`Game.canUseConsumable` nad kopií stavu, stejně jako
prodejní ceny). Detail spotřebky s cíli mimo kolo a obálku vysvětlí, že chybí ruka (`game.consumable.needsHand`).

**Písmo:** Pixelify Sans v použitých podmnožinách nemá ligatury „fi“ / „fl“ — vykreslovalo se „A“ („Kontrola
z Anančáku“). `font-variant-ligatures: none` na `body`.

**Testy:** e2e `tests/e2e/consumables.spec.ts` (Večerka: pranostika do slotu → použít → úroveň v Info o runu; rada
s cíli bez ruky; prodej; kupón Druhý regál / Žlutá cenovka (dřív Věrnostní karta); obálka rad s cílem v dobrané ruce → vylepšení na kartě
i v uloženém stavu; obálka pranostik „Nechat si“; obálka hracích karet; v kole Babiččina barva a razítko s pečetí),
`tests/e2e/hand.spec.ts` (tažení myší i prstem, Shift + šipka, ruka obálky, náhled balíčku pod Výlukou, hlášky mimo
ruku a tlačítka), společní pomocníci `tests/e2e/helpers.ts`; unit `tests/unit/ui-hand.test.ts` (happy-dom).

**Proč:** CLAUDE.md kap. 4 (drag & drop, klávesy, dotyk), 6 (texty přes `t()`), 8 (e2e); ROADMAP „Známé otevřené
body“ fáze 5 a 6/9.

## 2026-10-02 — Fáze 5 (UI): vizuální kontrola snímky (Večerka, obálky, spotřebky, úpravy karet, tažení, hlášky)

Dočasný Playwright skript (mimo repozitář) nafotil na 1366 × 768 a tabletu 820 × 1180 (dotyk) Večerku se spotřebkou
a kupónem (i tooltip a hlášku), obálku babských rad s dobranou rukou a vybranými cíli, obálku pranostik, kolo se
spotřebkami ve slotech (tooltip i detail), ruku se všemi vylepšeními / pečetěmi / edicemi (i zblízka 2×), tažení karty
uprostřed pohybu a víc hlášek naráz v kole, ve Večerce i v obálce; obálky navíc na 1024 × 768, 1280 × 720,
1920 × 1080, tabletu na šířku a telefonu. Konzole všude čistá. Opravy:

- **Mega obálka (6 možností) se nevešla do jedné řady** na 1024 × 768 a na tabletu na výšku: šestá možnost spadla do
  druhé řady **pod dobranou ruku** (tlačítka Použít / Nechat si nešla stisknout). Od 601 px se při 6 možnostech řada
  nezalamuje (`.booster__options:has(> :nth-child(6))`), mezera je 0,5 rem a možnosti mají základ
  `max(--card-w × 1,3; 5,6 rem)` se smrštěním (jeviště s místem pro balíček na tabletu). Telefon se dál skládá do řad
  (stránka se posouvá). Tlačítka obálky mají užší vnitřní okraj (0,4 em) — „Nechat si“ se v užší možnosti nelámalo.
- **Tlačítka obálky nebyla v jedné linii** pod dvouřádkovým názvem („Kvetoucí kapradí“, „Březen, duben, máj“):
  možnosti mají výšku řady a tlačítka `margin-top: auto` (bez navýšení řady, když jsou všechny názvy jednořádkové).
- **Hlášky ve Večerce zakrývaly zboží, i když pod panelem bylo volné místo** (tablet: skoro třetina obrazovky): kotva
  hlášek dostane výšku sloupce (`setToastAnchor((needed) => rect)`, měří se po přidání hlášky, přesun dorovná FLIP)
  a `GameView.toastRect` dá sloupec pod panel fáze, když se tam celý vejde; jinak zůstává hned pod záhlavím. Na
  1366 × 768 se pod Večerku vejdou 1–2 hlášky; tři vyšší jdou pod záhlaví (zakryjí na chvíli obrázek zboží, ne
  tlačítka).
- **Čísla kláves pod kartami během tažení lhala** (uhýbající karty ukazovaly staré pozice, číslo tažené karty se
  překrývalo s číslem karty pod ní): během tažení jsou skrytá (`opacity`), po puštění se ukážou nová.

Zkontrolováno a ponecháno: duhová edice přebarví i zlaté vylepšení (vylepšení pozná odznak v rohu; duhová = posun
barev celé karty), dlouhý stisk nechá tooltip otevřený do dalšího dotyku mimo (záměr, `tooltip.ts`), pořadí hlášek po
pranostice („… je teď na úrovni 2“ nad „Použito: …“) odpovídá pořadí událostí enginu.

Paralelní obsah fáze 7 přejmenoval kupón `loyalty_card` → `yellow_price` a štítek `voucher_slip` → `mailbox_flyer`;
e2e testy (`consumables.spec.ts`, `bosses.spec.ts`) používají nová id.

Testy: `tests/e2e/consumables.spec.ts` — mega obálka rad na 1024 × 768 i tabletu (6 možností v jedné řadě, žádné
tlačítko pod rukou ani balíčkem, Použít / Nechat si v jedné linii), hláška ve Večerce na tabletu pod panelem (mimo
zboží a balíček); `tests/unit/ui-hand.test.ts` — kotva-funkce dostane výšku sloupce.

**Proč:** CLAUDE.md kap. 4 (tablet s dotykem plně funkční, rozvržení), 8 (konzole bez chyb); zadání vizuální kontroly
fáze 5.

## 2026-10-02 — Fáze 8 (M1): meta engine — profil, odemykání, statistiky, denní run

Meta vrstva je v `src/engine/meta/**` (čistý TS bez DOM a hodin; čas dodává volající jako `nowIso`), přehled API
v `docs/ARCHITECTURE.md` 5.1, testy `tests/unit/meta-{profile,settings,unlocks,runs,daily}.test.ts`.

- **Profil = jediný zdroj meta dat** (`karban.profile`, obálka `save.ts` kind `profile`, `PROFILE_VERSION` 1,
  migrace `PROFILE_MIGRATIONS`). Po migracích vždy `normalizeProfile`: poškozené pole se nahradí výchozím, neplatné
  položky se zahodí — platná obálka se kvůli jednomu poli **neztratí**. Neplatná obálka nebo novější verze →
  `restoreProfile` vrátí nový profil a původní data k záloze; zálohu `karban.profile.backup.<ms>` zapíše
  `src/ui/settings.ts` a nový profil zapíše **jen po úspěšné záloze** (jinak nechá data na místě).
- **Nastavení je součást profilu** (DESIGN 13.4): `Settings`, `DEFAULT_SETTINGS`, `sanitizeSettings` se přesunuly do
  `engine/meta/settings.ts`, `src/ui/settings.ts` je reexportuje (API beze změny); `loadSettings` / `saveSettings`
  čtou a píšou profil. Starý klíč `karban.settings` se při prvním načtení zmigruje do nového profilu a smaže (při
  existujícím profilu se jen uklidí).
- **Achievementy v registru:** `ContentRegistry.achievements?` je volitelné (testovací registry enginu se nemění, run
  ho nečte); obsah `src/content/achievements.ts`. Definice `AchievementDef` má `id`, `category`, `hidden?`,
  `allowSeeded?`, `icon?` a `check(ctx)`, která vrací `boolean` nebo `{ progress, target }`; výjimka = nesplněno
  (rozbitý achievement nesmí shodit hru), uložený průběh = maximum. Kontrola běží po každé události, na konci runu
  a v `refreshMeta` (mimo run).
- **Funkce mutují profil** (jako engine `RunState`) a vracejí `MetaNotice[]` (`unlock` / `stake` / `achievement`) pro
  toasty. „Čisté“ = bez IO, DOM, hodin a `Math.random`, deterministické (stejné akce = stejný profil — test).
- **Co se kam počítá:**

  | Run                                                    | Statistiky runů, balíčků, sil piva | Počítadla, rekordy, objevy, odemčení, achievementy | Síla piva | Historie |
  | ------------------------------------------------------ | :--------------------------------: | :------------------------------------------------: | :-------: | :------: |
  | hlavní hra                                             |                ano                 |                        ano                         |    ano    |   ano    |
  | denní run — oficiální pokus                            |                ano                 |                        ano                         |    ne     |   ano    |
  | denní run mimo soutěž (další pokus, ručně / starý den) |                 ne                 |         ne (jako seedovaný; `allowSeeded`)         |    ne     |   ano    |
  | výzva                                                  |  ne (vlastní `stats.challenges`)   |                        ano                         |    ne     |   ano    |
  | seedovaný run                                          |                 ne                 |           jen achievementy `allowSeeded`           |    ne     |   ano    |

  Seedovaný run nemění ani objevy: ve známém seedu by šly „farmit“ objevové achievementy a legendární žolíci.
  `runsTotal` počítá i pokusy výzev, `winsTotal` / `winRun` jen hlavní hru a oficiální denní run (DESIGN 11.1
  „výhry napříč balíčky a obtížnostmi“).

- **Výsledek se zapisuje hned:** `victory` = výhra (série, nejrychlejší výhra, odemčení síly piva), `gameOver` =
  prohra (příčina pro pitvu, šéf); `finishRun` pak jen zapíše historii a denní záznam. Nekonečný režim po výhře
  zůstává výhrou (v historii nejvyšší patro). Opuštění (nová hra přes neuzavřený run — `startRun` ho uzavře sám —
  nebo `finishRun` mimo `game_over` / `victory`) přerušuje sérii.
- **Rozehraný run v profilu** (`Profile.current`): druh runu, seedovaný/oficiální, počítadla runu (`RunCounters`:
  útrata a přehození v jedné Večerce, série max. úroku, Na dřeň, zůstatek na konci kola, sklo, spotřebky podle druhu,
  koupené kupóny, kola první rukou) — přežije reload. Identita = seed + balíček + síla + výzva + denní; `resumeRun` je
  idempotentní, při neshodě (import profilu) uzavře cizí run jako opuštěný a tento zaeviduje jako nezadaný seed.
- **Pool nového runu** (`unlockedPoolFor`): hlavní hra a výzvy = odemčení žolíci a kupóny; legendární žolíci bez
  podmínky jsou v poolu vždy (odemykají se objevením z razítka, takže musí jít vytvořit). Denní **i seedovaný** run =
  celý obsah: stejný seed = stejný run pro všechny (sdílení seedu, reprodukce chyb) a seedovaný run se nepočítá, takže
  to nejde zneužít.
- **Odemykání jen ze stavu profilu:** počítadla a rekordy se aktualizují živě po každé události, `evaluateUnlock`
  proto dává i průběh do sbírky. `UnlockCondition` rozšířena o `stat`, `roundEndMoney`, `handLevel`, `beatBoss`,
  `useConsumable`, `winChallenge`, `achievement` (a `discover` o štítky, šéfy, obálky). Vlastní podmínky: registr
  v `unlocks.ts` s vestavěnými id obsahu (`vouchersBought5`, `sealedCardsInRun`, `roundEndInDebt`, `radyUsed30`,
  `jokersSold25`, `handLevel6`, `voucherTier1TwoRuns`) + `registerCustomUnlock`; `validateRegistry` hlásí neznámé id.
  Seznamy odemčených položek se ukládají (odemčení je trvalé, i kdyby podmínka později „přestala platit“).
- **Výzvy bez vlastního `unlock`** mají výchozí podmínku podle pořadí v registru (po pěti: 1 / 3 / 6 / 10 výher).
- **Tier 2 kupónu:** tier 1 **koupený ve Večerce** ve 2 různých runech (startovní kupóny balíčku a výzvy se
  nepočítají), nebo 3 výhry.
- **Síla piva:** výhra na úrovni N ≥ nejvyšší odemčené → N + 1 pro ten balíček (opakovaná výhra níž nic nedá,
  Imperial je strop); jen hlavní hra.
- **Objev** = položka se hráči ukázala: sloty, Večerka (zboží, obálky, kupón), obálka, výběr útraty (šéf, štítky),
  šéf kola, karty balíčku (vylepšení, pečetě, edice), zahrané kombinace. Štítek „Nové“ = `Profile.unseen`
  (`kategorie:id`) — přidá ho odemčení, objev i achievement; výchozí odemčené položky „Nové“ nejsou.
- **Seed:** `parseSeedInput` (mezery pryč, velká písmena, abeceda bez I/O/0/1, délka 8) vrací kód chyby `empty` /
  `invalidChars` / `tooShort` / `tooLong` / `invalidDate` / `reserved`; ruční `DEN-YYYYMMDD` je platný (přehraje den
  mimo soutěž), jiné tvary s pomlčkou (`SIM-…`) `reserved`.
- **Denní run:** balíček z id seřazených podle kódových jednotek, síla piva 1–min(5, nejvyšší úroveň) z vlastní kopie
  streamu `misc` seedu. Oficiální pokus se zabere **při startu** (odchod a nový start nedá druhý oficiální pokus);
  pokračování z uložení zůstane oficiální, je-li dnešní záznam rozehraný se stejným seedem.
- **Statistiky:** „utraceno“ = platby ve Večerce (`moneyChanged` s důvodem `purchase`, stejně jako
  `RunStats.moneySpent`), „vyděláno“ = kladné změny peněz; „maximální úrok“ = úrok ≥ ⌊`interestCap` ×
  `interestMult`⌋ z modifikátorů (`MetaCtx.mods` od UI, jinak dopočet z kopie stavu runu).
- **Tutoriál:** 9 kroků DESIGN 13.5 (`TUTORIAL_STEPS`) jde dokončit i mimo pořadí; přeskočení vypne
  `settings.tutorial`, znovuzapnutí ho zapne a začne od začátku; achievement pozná `profile.tutorial.completed`.

Zbývá na další agenty fáze 8: obsah achievementů (`src/content/achievements.ts` + texty), podmínky odemčení ~31
žolíků v `src/content/jokers/*.ts` (DESIGN 11.3: ≈ 70 od začátku), UI (profil v `App`, toasty, sbírka, statistiky,
historie, denní run, zadání seedu s kódy chyb, tutoriál).

**Proč:** CLAUDE.md kap. 2 (ukládání: verzovat, migrace, nikdy neztratit profil), 3 (odemykání, sbírka, statistiky,
achievementy, denní a seedované runy, historie), 4 (nastavení, tutoriál); DESIGN 9–11 a 13.4–13.5.

## 2026-10-02 — Balanc po fázi 7: převzaté názvy, síly piva, balíčky, patro 8

**Co:** uzavření obsahu fáze 7 — přejmenování názvů převzatých z předlohy, kalibrace všech 8 sil piva a balíčků
simulací s plným obsahem (101 žolíků, 30 šéfů, 20 štítků, 51 spotřebek, 24 kupónů) a měření, kolik bodů dnes boti
v patře 8 skutečně udělají. Navazuje na rozpracovaný stav (křivky 1–3 zvednuté proti fázi 6, Jedenáctka a Ležák až
od 2. / 3. patra, Úřednický s Kamarádem za pultem), který jsem simulací ověřil a dotáhl.

**1. Převzaté názvy z předlohy — přejmenováno** (CLAUDE.md kap. 1 a 7, CONTENT-GUIDE 13: ani přeložené názvy).
Hráč ani uložení nová id ještě neviděli (před 1.0, nic nasazeno), proto bez migrace uložení.

| Typ          | Dřív (`id`)                          | Nově (`id`)                           | Proč                                                     |
| ------------ | ------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| kupón tier 1 | Věrnostní karta (`loyalty_card`)     | Žlutá cenovka (`yellow_price`)        | překlad názvu žolíka předlohy                            |
| kupón tier 2 | Zlatá věrnostní (`gold_loyalty`)     | Přelepená cenovka (`relabeled_price`) | odvozený od tier 1                                       |
| kupón tier 2 | Kartářka (`card_reader`)             | Sběratelská burza (`collectors_fair`) | překlad názvu žolíka předlohy                            |
| štítek       | Fotonegativ (`photo_negative`)       | Rentgen od zubaře (`dental_xray`)     | štítek „negativní“ předlohy pod stejným obrazem negativu |
| štítek       | Úřední poukaz (`voucher_slip`)       | Leták ve schránce (`mailbox_flyer`)   | překlad štítku na kupón z předlohy                       |
| finální šéf  | Protihluková stěna (`noise_barrier`) | Fronta na banány (`banana_queue`)     | „zeď s vysokým cílem“ = obraz šéfa předlohy              |
| test         | testovací šéf `fortune_teller`       | `suit_oracle`                         | anglický název žolíka předlohy v testu                   |
| rezerva (D)  | Fronta na banány (jiné pravidlo)     | Čekárna u doktora                     | kolize s novým finálním šéfem                            |

Mechaniky a čísla se nemění (Žlutá cenovka 20 %, Přelepená 40 % celkem, Sběratelská burza 50 % / 20 %, Fronta na
banány 4,5× základ patra). Texty, art (`ticket`/`papers`, `magnifying-glass`, `tooth`, `papers`, `hourglass` +
`shopping-cart`), testy (`vouchers`, `tags`, `bosses-final`, `decks`, `phase6-review`, `review2-rules`), DESIGN 6,
7, 8.3, 9 a přílohy B a D, CONTENT-GUIDE (vzor kupónu, výzvy, velká písmena) a ARCHITECTURE jsou přepsané. Boti
kupóny ani štítky podle id nepoznávají (oceňují je sondou), takže je přejmenování nezměnilo.

**Audit ostatních názvů:** prošel jsem všech 101 žolíků, 24 kupónů, 20 štítků, 30 šéfů, 12 balíčků, 8 sil piva,
51 spotřebek, 15 obálek, 17 úprav karet a 13 kombinací proti názvům předlohy (žolíci, kupóny, štítky, útraty a
šéfové, balíčky, sázky, tarotové, planetární a spektrální karty, druhy obálek). Další přeložený ani obrazem převzatý
název jsem nenašel; obecné pojmy dané zadáním (kombinace, vylepšení, pečetě a edice v CLAUDE.md kap. 3) zůstávají.
Staré názvy zůstaly jen v komentářích souborů, které tento úkol neměl měnit (paralelní fáze 8):
`src/engine/types.ts` (Kartářka, Fotonegativ), `src/engine/content-types.ts`, `src/engine/shop/prices.ts` a
`src/ui/screens/game/shop.ts` (Fotonegativ) — opravit při nejbližší úpravě těch souborů.

**2. Simulace — metodika.** Boti `max`, `flush`, `pairs` (Desítka, Imperial; 300 runů na bota) a `max`, `flush`
(Jedenáctka–Doppelbock; 200 runů), balíček Hospodský, sady seedů `SIM-A-*` (= `npm run simulate`), `SIM-B-*`,
u Doppelbocku a Imperialu i `SIM-C-*` a `SIM-D-*`. Číslo „nejlepší“ = nejlepší bot po sloučení sad (v závorce
nejlepší bot jednotlivých sad). Rozptyl je velký: při 200 runech a ~6 % je směrodatná chyba ~1,7 p. b. a sady se
běžně liší o 3 p. b. (Imperial `max`: A 2,3 %, B 6,0 %, C 3,7 % na stejných pravidlech), proto rozhoduje souhrn
sad, ne jedna sada. `npm run simulate -- --runs 300 --stake 1 --bot all` dává stejná čísla jako sada A (max
31,3 %, flush 34 %, pairs 25,7 %, econ 18 %, random 0 % — 99,7 % proher v patře 1, nojoker 0 % s mediánem prohry
v patře 3, 0 neplatných akcí) a `--stake 8` po kalibraci stejná jako sada A Imperialu (max 2 %, flush 0,7 %,
pairs 0 %, econ 0,3 %, random a nojoker 0 %).

**3. Síly piva — před a po** (před = stav na začátku této práce; Desítka–Ležák se pravidly nezměnily):

| Síla piva  | Pásmo   | Před: nejlepší (sady)     | Po: nejlepší (sady)              | Změna                                        |
| ---------- | ------- | ------------------------- | -------------------------------- | -------------------------------------------- |
| Desítka    | 25–35 % | 32,7 % (A 34, B 34)       | beze změny                       | —                                            |
| Jedenáctka | 20–30 % | 22,0 % (A 23,5, B 22,5)   | beze změny                       | —                                            |
| Dvanáctka  | 14–22 % | 14,0 % (A 14,5, B 13,5)   | beze změny                       | —                                            |
| Speciál    | 10–17 % | 16,0 % (A 16, B 17)       | beze změny                       | —                                            |
| Ležák      | 7–12 %  | 9,0 % (A 7,5, B 10,5)     | beze změny                       | —                                            |
| Bock       | 4–8 %   | 7,3 % (A 6,5, B 8)        | 6,5 % (A 6, B 7,5, D 7,5)        | křivka 3 od patra 4 ×~1,12                   |
| Doppelbock | 3–6 %   | 5,8 % (A 4,5, B 7)        | 3,5 % (A 3,5, B 4, C 4, D 3,5)   | + přibitých 25 % (20), zapůjčených 25 % (15) |
| Imperial   | < 3 %   | 4,0 % (A 2,3, B 6, C 3,7) | 2,0 % (A 2, B 2,3, C 2,3, D 2,3) | + cíle šéfů ×1,2                             |

- **Křivka 3** od patra 4: 2 800 / 5 600 / 10 000 / 18 000 / 29 000 → 3 100 / 6 300 / 11 000 / 20 000 / 32 000
  (×~1,12; patra 1–3 beze změny). Samotná křivka stáhla Imperial jen na 3,2 % (A–C) a Doppelbock na 5,3 % (A, B).
- **Doppelbock 25 % / 25 %** (dřív 20 % / 15 %): s novou křivkou 3 Doppelbock 3,5 % (A–D). Měřená byla i varianta
  30 % / 25 % (Doppelbock 4,2 % ze sad A, B, D; Imperial bez ×1,2 2,9 %), ale 30 % je číslo žebříčku předlohy
  (DESIGN příloha A) — proto 25 %.
- **Imperial: cíle šéfů ×1,2** (`bossTargetMult`, stejné pole jako štítek Šéf má chřipku; násobky se násobí).
  S ×1,1 2,8 % (sada B 4,3 %), s ×1,2 2,0 % a všechny čtyři sady 2,0–2,3 %. Pravidlo zůstává jedno — „šéf u každého
  stolu“: pravidlo šéfa ve Velké útratě a přísnější šéfové; popisek i DESIGN 10 to říkají.
- **Jedenáctka a Ležák až od 2. / 3. patra** (rozpracovaná změna) — ověřeno: se ztížením od 1. patra a dnešními
  křivkami sada A Jedenáctka 19,5 % (teď 23,5 %) a Ležák 4,5 % (teď 7,5 %), Ležák by byl pod pásmem.
- **Speciál (zvětrávání) boty prakticky nebrzdí:** Speciál se zvětráváním 0 / 25 / 50 % → 14,0 / 16,0 / 15,5 %
  (A+B). Dvanáctka a Speciál proto leží v překryvu pásem 14–17 % a křivka 2 zůstává (snížit ji by vytlačilo
  Speciál nad 17 %). Úkol pro fázi 10: ztížení Speciálu, které bota (i hráče) opravdu stojí.

**4. Balíčky** (Desítka, nejlepší z `max` a `flush`, 200 runů, sada A; Hospodský 34 %):

| Balíček    |  Výhry | Balíček   |  Výhry | Balíček     | Výhry |
| ---------- | -----: | --------- | -----: | ----------- | ----: |
| Štamgastův | 39,5 % | Obrázkový | 50,5 % | Babiččin    |  44 % |
| Úřednický  | 34,5 % | Notářský  |   50 % | Vetešnický  |  35 % |
| Turistický |   41 % | Zbohatlík | 30,5 % | Kalendářový |  43 % |
| Mariášový  |   40 % | Dlužník   | 30,5 % |             |       |

- **Úřednický:** se Žlutou cenovkou a Trhacím kalendářem 66,5 % (`flush`; `max` 64 %) — sleva 20 % od prvního
  nákupu je nejsilnější ekonomika; s Trhacím kalendářem a Kamarádem za pultem (rozpracovaná změna) **34,5 %**
  (`max` 32 %), tedy jako Hospodský a v rozmezí ostatních balíčků. Popisek, DESIGN 9 a test (`decks.test.ts` hlídá
  názvy kupónů v popisku) odpovídají.
- **Mariášový nad rozmezím:** bez úprav 60,5 % (`max`; `flush` 52 %) — v 32 kartách 7–A chodí Barva i Postupka skoro
  samy. Nově **cíle všech útrat ×1,2** (jako Turistický): 40 % (`flush`; `max` 39 %); ×1,3 dalo 37 %, −1 zahození
  53 %. Popisek „… a cíle všech útrat jsou ×1,2“, DESIGN 9, test (`modsDiff`, cíle 300 / 450 / 600).
- Obrázkový, Notářský, Babiččin a Kalendářový jsou nad pásmem DESIGN 12.1 (±7 p. b. od Hospodského), ale v rozmezí
  25–55 %; ladit až se silnějšími boty ve fázi 10 (boti dnes hrají „ekonomicky“ a malé nebo pečetěné balíčky jim
  sedí víc než člověku).

**5. Patro 8 — kolik boti skutečně udělají** (Desítka, sady A+B, 542 vítězných runů z 1 800): nejlepší ruka v patře 8
má medián **70 000** (p25 46 000, p75 114 000, **p90 231 000**; `max` 68 000 / p90 199 000, `flush` 75 000 /
272 000, `pairs` 70 000 / 210 000), ruku ≥ 100 000 zahraje 30 % vítězů a ≥ 200 000 12 %; kolo finálového šéfa
končí na mediánu 81 000 bodů při cíli 58 000 (1,28×). Imperial po kalibraci (46 výher z 3 600 runů, sady A–D):
medián 59 000, p90 128 000.
**Pokusy se zvednutou křivkou 1** (patra 1–3 beze změny, od patra 4 geometricky): základ patra 8 **50 000**
(`… 2300, 5000, 10500, 23000, 50000`) → Desítka 12 % (`flush`; `max` 9,5 %, `pairs` 7 %); **100 000**
(`… 2300, 5900, 15000, 39000, 100000`) → 3 % (vítězové pak mají v patře 8 medián nejlepší ruky 290 000).
Zvednout patro 8 na ~100 000 a udržet pásmo 25–35 % tedy dnes nejde — křivky 1 a 2 zůstávají (základ patra 8:
23 000 / 26 000 / 32 000, Šéf 46 000–64 000 a na Imperialu 77 000, Fronta na banány 105 000–145 000 a na Imperialu
175 000) a cíl „statisíce“ přechází do fáze 10:

**Plán pro fázi 10 (v tomto pořadí, každý krok s celou sadou simulací podle DESIGN 12.4):**

1. **Metrika síly bota do `npm run simulate`:** `RunResult.bestHandByAnte` (nejlepší ruka v každém patře, z událostí
   `handPlayed`) a do souhrnu medián a p90 nejlepší ruky v patře 8 u vítězných runů a medián poměru skóre/cíl
   v kole finálového šéfa (dnes jen scratch skript nad `simulateRun`). Cíl celé akce: medián ≥ 250 000.
2. **Silnější boti** (`src/engine/sim/bots.ts`, `value.ts`):
   - `jokerRating` (dnes vzácnost × štítky z tabulek `RARITY_VALUE`/`TAG_VALUE`) nahradit **měřenou mezní hodnotou**:
     přesné skóre (`exactPlayScore`) 3–5 typických rukou bota (nejhranější kombinace z `handLevels.played`
     poskládané z aktuálního balíčku) se žolíkem a bez něj; ×mult a škálující žolíci tak v pozdních patrech dostanou
     váhu, kterou mají, a ploché +čipy se včas prodají;
   - **plán buildu:** od patra 2 hlavní kombinace (úroveň × četnost) a pranostiky na ni kupovat i nad poměr ceny —
     úrovně se sčítají přes celý run; obálky pranostik brát, když v nich hlavní kombinace je;
   - **úprava balíčku:** babské rady a razítka cílit i na zúžení balíčku (ničit karty mimo hlavní barvu nebo hodnoty)
     a přebarvení na hlavní barvu, ne jen na „největší přínos jedné karty“; - pořadí žolíků ověřit přesným skóre dvou pořadí (jako u Jednookého hejtmana), přehazovat pro chybějící ×mult;
   - přijetí kroku: na dnešních křivkách Desítka ≥ 45 % a medián nejlepší ruky v patře 8 aspoň 2× dnešní.
3. **Zvednout křivky po krocích:** základ patra 8 křivky 1 23 000 → 35 000 → 50 000 → 70 000 → 100 000; patra 4–8
   geometricky se stejným poměrem mezi patry, patra 1–3 beze změny (rozjezd bez žolíků se nemění); křivky 2 a 3
   držet ve stejném poměru ke křivce 1 jako dnes (patro 8: +13 % a +39 %). Po každém kroku všech 8 sil piva × 3
   prefixy; krok, který stáhne některou sílu piva pod pásmo, se vrátí a pokračuje se krokem 2.
4. **Když boti narazí na strop dřív** (zlepšení < 10 % mediánu za další úpravu): škálovat **pozdní** obsah, ne
   rozjezd — přírůstky úrovní kombinací (DESIGN 2.2.1) ×1,5 od Trojice výš, ×mult epických a legendárních žolíků
   +0,25 až +0,5, růst škálujících žolíků ×1,5; přeměřit tabulku 4.3 (`scripts/joker-value.ts`,
   `tests/unit/jokers-value.test.ts`, `content.test.ts`) a znovu krok 3.
5. **Kontrola člověkem:** 3–5 runů na Desítce s novými čísly; vyhrává-li člověk zjevně snáz než boti (> 60 %),
   zvednout křivku i bez dalšího zlepšení botů a pásma v DESIGN 12.1 brát jako dolní mez.

**Mimo pásmo / otevřené (fáze 10):** Δ výher žolíků ze `simulate` není normalizovaná na patro koupě (DESIGN 4.3,
pravidlo 4) — epičtí žolíci jako Pivní sommelier, Směnárna nebo Karlův most ukazují +30 až +54 p. b. hlavně proto,
že žolíka mají runy, které přežily déle; před laděním čísel žolíků přidat normalizaci (runy, které dosáhly patra
koupě) a minimální počet kol ve slotu. Letalita šéfů po uzavření obsahu (Desítka, `max` + `flush` + `pairs`, sada A, nenormovaná podle
patra): fináloví Fronta na banány 33 %, Bílá paní 29 %, Krajský úřad 23 %, Velká voda 22 %, Pan starosta 18 % (těsně
pod pásmem 20–40 %); běžní 0,4–14 % (nejvýš Garsonka 1+kk 14 % a Nová vyhláška 14 %, nejníž Parkovné 0,4 % a
Pověrčivá babka 1,7 % — oba `minAnte 1`, potkávají hráče v prvních patrech). Normované přeměření a případné doladění
`targetMult` patří do fáze 10 spolu se silnějšími boty.

**Testy:** `stakes.test.ts` (Doppelbock 25 / 25 %, Imperial `bossTargetMult` 1,2 a cíl šéfa 600 v patře 1, popisek;
oprava `'done'` → `'defeated'` v rozpracovaném testu Jedenáctky), `targets.test.ts` a `endless.test.ts` (křivka 3
v patrech 4–20), `game.test.ts` (cíl šéfa patra 16 v nekonečném režimu 580 000 000 po zvednutí křivky 1),
`decks.test.ts` (Mariášový), `review-correctness.test.ts` (testovací šéf `suit_oracle`). DESIGN 2.3.1, 2.3.3, 6,
9, 10, příloha A, B a D, `src/engine/sim/runner.ts` (komentář pásem).

**Proč:** CLAUDE.md kap. 1 a 7 (žádné převzaté názvy ani čísla), kap. 3 (patro 8 řádově statisíce — zatím plán),
kap. 8 (Desítka 25–35 %, Imperial < 3 %, žádné auto-win), DESIGN 10, 12.1 a 12.4.

## 2026-10-02 — Fáze 8 (M2): 20 výzev — pravidla v enginu, pořadí a ladění

**Co:** `src/content/challenges.ts` (20 výzev DESIGN 11.1 s `unlock: winsTotal` 1/3/6/10 po pěticích), texty
`src/i18n/cs/challenges.ts` (`name`, `desc`, `flavor`, `rules.<klíč>`; čísla přes `ChallengeDef.params`), testy
`tests/unit/challenges.test.ts` (obsah, start, pravidla každé výzvy, bot) a `tests/unit/challenge-rules.test.ts`
(obecná pravidla enginu na testovacím registru).

**Pravidla v enginu obecně, ne podle id výzvy:**

- **`Modifiers`** (skládají se jako ostatní, ukládají se v `extraModifiers`, mohou je použít i balíčky/kupóny):
  `noJokers` (pool, Večerka, Žolíková obálka, `createJoker`, `addShopJoker`, `openBooster`), `noSkip` (útraty bez
  štítků, `skipBlind` → `cannotSkip`), `autoSkip` (Malá a Velká se ve výběru útraty přeskočí samy se štítky —
  `Game.settle()` po každé akci a na konci `newRun`; obálka zdarma ze štítku řadu přeruší a po jejím zavření se
  pokračuje), `noReroll` (`reroll` → `cannotUse`, i bezplatné), `flatShopPrice` / `flatSellPrice` (pevná cena přebije
  slevy i `shopPriceAdd`; zdarma zůstává zdarma), `handCost` / `discardCost` (srážka přes `addMoney`, tedy jen do
  dluhového limitu — ruku jde zahrát vždy, jinak by se kolo zaseklo), `glassBreakOdds` (0 = výchozí 1 z 5; čte ho
  skleněné vylepšení a jeho popisek přes nové `EnhancementDef.describe(mods)`), `finalAnte` (výchozí 8; Konec světa
  +4 → 12; finálový šéf v patře 8 a jeho násobcích **i** v patře výhry — `isFinalAnte(ante, finalAnte)`).
- **`ChallengeDef`** (data jiného typu než číslo/přepínač, engine je čte živě přes `GameCore.challenge()`): `stake`
  (výchozí 1 — výzva přebije `NewRunOptions.stake` i `deckId`; dřívější test pořadí `onRunStart` dostal `stake: 2`
  ve výzvě), `startingHandLevels`, `startingRandomJokers` (stream `joker`, celý registr bez ohledu na odemčení —
  stejné podmínky pro všechny), `maxScoringHand` (silnější kombinace = zakázaná ruka jako u šéfa: krok
  `source: 'challenge'`, `blockedReason` = `MSG.challengeHandTooStrong`, i v náhledu; nový `ScoreSourceKind`
  `'challenge'`), `jokerSticker` (vynucená nálepka každého získaného žolíka; kdo ji nesmí nést, je z poolu venku),
  `bannedConsumables`, `bannedConsumableKinds`, `bannedBoosterKinds`, `bannedTags`, `consumableCost` (pevná základní
  cena podle druhu), `params` (čísla do textů), hooky `passive`, `onAnteStart` (start runu po `onRunStart` a každá
  porážka šéfa; ne `changeAnte`), `isCardDebuffed` a `isJokerDebuffed` (platí ve všech útratách, vypnutí šéfa je neruší,
  sdílí přepočet s pravidlem šéfa v `run/draw.ts`).
- Uložení: `RunState` se nemění (pravidla jsou v `extraModifiers` a v definici podle `challengeId`) — bez migrace.
- **UI:** výběr útraty bez tlačítka Přeskočit při `noSkip` (hláška „Tady se nepřeskakuje…“), Přehodit zakázané
  s vysvětlením při `noReroll`, levý panel ukazuje patro `x/finalAnte`, Info o runu má sekci Výzva (název + pravidla).
  Obrazovka výběru výzev patří UI úkolu fáze 8.

**Pořadí a ladění (bot `max`, Desítka, 20–30 runů na výzvu):** původní pořadí DESIGN nemělo s obtížností nic
společného (Suchý únor jako první výzva: 0 % výher; Švejkova anabáze 90 %). Výzvy jsou teď po pěticích seřazené podle
obtížnosti a pět čísel je doladěných (DESIGN 11.1 „Upřesnění“): Skleník sklo 1 z 2, Švejk úroveň 4 (a pranostiky
silnějších kombinací se nabízejí dál — jejich zákaz Dvojici krmil z každé pranostiky), Malometrážní byt ruka 6 + 1 ruka
(s pěti kartami ~88 % proher hned v první útratě), Kasino bez odměn za útraty a dýška, Suchý únor cíle ×0,5. Výsledek
(% výher, 30 runů, po uzavření fáze 7): 1. skupina Skleník 63, Vánoční kapr 57, Jednotná cena 43, Švejk 43, Rychlík
53; 2. skupina Mariáš u Vaňků 33, Minimalista 23, Velký třesk 37, Kasino 33, Malometrážní byt 47 (třetina runů padne
v patře 1); 3. skupina Svíčky 23, Roční období 33, Kamenolom 17, Krátká paměť 13, Byrokracie 17; 4. skupina Rovnou za
ředitelem 3, Svatba 7, Půjčovna 0, Suchý únor 0, Konec světa 7. Boti hrají výzvy hůř než člověk (neumí honit sklo,
zakázané ruce, dluh, držet málo zapůjčených žolíků), takže čísla berou jen jako pořadí.

**Bot:** Rychlík vyžadoval, aby boti respektovali `noReroll` (a náhodný bot `noSkip`) — úprava `src/engine/sim/bots.ts`
beze změny chování mimo výzvy (bez spotřeby RNG navíc).

**Proč:** CLAUDE.md kap. 3 (20 výzev se zvláštními pravidly a vlastním vtipným názvem), kap. 2 (engine
deterministický, data + hooky, stav serializovatelný), kap. 8 (balanc simulací, žádné auto-win); DESIGN 11.1.

## 2026-10-02 — Fáze 8 (M3): 78 achievementů a podmínky odemčení obsahu

**Co:** obsah achievementů (`src/content/achievements.ts`, texty `src/i18n/cs/achievements.ts`), podmínky odemčení
23 žolíků (`unlock` v `src/content/jokers/{rare,rare2,epic,epic2}.ts`), texty podmínek pro sbírku (`meta.unlock.*`
přes `unlockText`), vlastní podmínka `distinctHands8`. Finální seznamy: DESIGN 11.2 a 11.3. Testy
`tests/unit/achievements.test.ts` (každý achievement: těsně před splněním nic, po splnění udělen s oznámením — přes
`startRun` / `applyRunEvent` / `finishRun` / `refreshMeta`) a `tests/unit/unlocks-content.test.ts`.

- **Achievementy = `AchievementDef` + texty.** Přidal jsem `AchievementDef.params` (čísla do textů, stejné konstanty
  čte `check` — jako `JokerDef.params`); texty `achievements.<id>.name|desc|flavor`, skryté navíc `hint` (CONTENT-GUIDE
  kap. 10 počítal s `flavor`). UI: `t('achievements.<id>.desc', def.params)`. Ikony z `ICON_NAMES` (test).
- **Tři druhy kontrol:** celoživotní (jen profil, vrací průběh pro sbírku a splní se i zpětně po importu),
  okamžikové (událost + stav runu po akci) a jednoho runu (`run` / `current.counters`, mimo run průběh 0 → sbírka
  ukáže uložené maximum). Výhry „na síle piva X“ = X nebo silnější (jako `winRun` se `stake`); „Zavíračka“ počítá i
  dokončené výzvy (výzva je run; do statistik runů se nepočítá, do achievementů ano — M1).
- **Změny podmínek proti návrhu DESIGN 11.2:** _Kopírka na úřadě_ → „měj najednou 2 kopírující žolíky“ (kopírující
  žolíci se navzájem nekopírují, `copyable: false`); _Notářský zápis_ → „zahraj ruku, ve které skórují karty se všemi
  druhy pečetí“ (původní „měj v balíčku všechny 4 pečetě“ by Notářský balíček splnil při startu); _Ještě jedno!_ =
  libovolný šéf poražený v nekonečném režimu. Achievementy „všechno“ (Encyklopedista, Muzeum žolíků, Turné po
  hospodách…) počítají s aktuálním registrem, text čísla neuvádí.
- **Žolíci: 70 od začátku + 23 s podmínkou + 8 legendárních objevem** (DESIGN 11.3: všech 44 běžných, 19/32 vzácných,
  7/17 epických). Zamčení jsou ti, ke kterým sedí tematická podmínka (Kořenářka ← 10 babských rad, Sklář ← 5 rozbitých
  skleněných karet, Válečná kořist ← 10 šéfů, Defenestrace ← 150 zahozených karet, Kopírák ← 15 koupených žolíků…)
  a nikdo z ikonických žolíků zadání (Pivní tácek, Švejk, Golem, Zpožděný rychlík zůstávají volní). Podmínky jsou
  vestavěné typy `UnlockCondition`, jediná nová vlastní je `distinctHands8` (Pivní sommelier: 8 různých kombinací
  napříč runy). Řetězy: Sekera (0 Kč na konci kola) → „Na sekeru“ / Dlužník (kolo v mínusu); Turistický balíček
  (25 Postupek) → Turistický průvodce (výhra s ním).
- **Sněhulák: 3 kola vyhraná první rukou** (DESIGN uváděl jedno). Jedno kolo první rukou přijde v prvním runu skoro
  samo (Malá útrata patra 1), epický žolík by se odemkl bez zásluhy — a test M1 `meta-runs` s přesným seznamem
  oznámení po prvním vyhraném kole tak zůstal platný.
- **Texty podmínek:** `unlockText(registry, cond, subject?)` / `unlockTextFor(registry, category, id)` v
  `src/engine/meta/unlockText.ts` vrací i18n klíče a parametry (engine texty nezná); `refs` = parametry, které jsou
  samy textem (název balíčku, šéfa, kombinace, síly piva). Věta položky `meta.unlock.items.<kategorie>.<id>` má
  přednost (skloňování: „s Turistickým balíčkem“, „10 Postupek“), jinak šablona `meta.unlock.cond.<typ>`. Čísla
  vestavěných vlastních podmínek jsou v `CUSTOM_UNLOCK_PARAMS` (sdílí vyhodnocovač i text). UI je skládá v
  `src/ui/metaText.ts` (`unlockSpecText`).
- **Výkon:** 78 kontrol po každé události stojí ≈ 0,15 ms navíc na událost (celý run botem ≈ 15–35 ms meta místo
  4–11 ms); modifikátory (sloty žolíků) se počítají líně jen u „Plného lokálu“ s aspoň 5 žolíky.

**Proč:** CLAUDE.md kap. 3 (60+ achievementů s vtipnými názvy, odemykání, sbírka), kap. 5 (humor, příklady „Pět piv
a jdu domů“, „Na sekeru“), kap. 6 (texty jen v i18n, čísla přes parametry), kap. 8 (každý achievement otestovaný);
DESIGN 9, 11.2, 11.3.

## 2026-10-02 — Fáze 8 (M4): profilová vrstva UI, nová hra podle odemčení, sbírka, statistiky

Kód: `src/ui/profile.ts` (`ProfileController`), `src/ui/metaText.ts`, `src/ui/seed.ts`, `src/ui/components/tabs.ts`,
`src/ui/screens/{newGame,collection,stats}.ts`, `src/ui/styles/meta.css`; testy `tests/unit/ui-meta-{profile,screens}.test.ts`.

- **Jediná instance profilu v `App`** (`app.profiles` = `ProfileController`, `app.profile`, `app.settings` je getter
  nad `profile.settings`). Nastavení se mění jen přes `app.updateSettings` → profil → uložení; `saveSettings` /
  `loadSettings` (čtou úložiště) zůstávají pro testy a nástroje, aplikace je nepoužívá (jinak by dvě kopie profilu
  přepisovaly jedna druhou).
- **Profil se nikdy neztratí:** načtení přes `restoreStoredProfile` (settings.ts, z M1). Poškozená data → záloha
  `karban.profile.backup.<ms>` (milisekundy, ne ISO jako v zadání úkolu — klíč už testuje `meta-settings.test.ts`
  a je bez dvojteček), nový profil a toast; když zálohu nejde zapsat, profil jede jen v paměti a uložená data se
  nepřepíšou (ani nastavením). Selhání zápisu se ohlásí jednou. **Export přibalí zálohy** (`profileBackups`), aby
  šly vytáhnout i mimo prohlížeč; import je ignoruje.
- **Napojení na run:** `GameController` dostal pozorovatele (`RunObserver.onEvents` hned po uložení runu — stav po
  celé akci, jak chce `applyRunEvents`; `onSettled` po doběhnutí animací). Profil ukládá po každé akci, ale toasty
  „Odemčeno: …“ / „Achievement: …“ ukáže až po animaci (nepřeruší skórování), nejvýš 3 naráz (třetí shrne zbytek
  „…a další novinky“). Chyba meta vrstvy se jen zaloguje, hru nezastaví. `bus.onAny` jsem nepoužil: emituje během
  `dispatch` s rozpracovaným stavem.
- **Konec runu:** prohra jde do historie **hned při `gameOver`** (run se po prohře neukládá, pitva je jen obrazovka —
  reload by jinak historii odložil do příštího startu); výhra po tlačítku „Konec“ (`profiles.finish`), nekonečný režim
  pokračuje a uzavře se při prohře. Nový run přes rozehraný uzavře starý jako opuštěný (`startRun`).
- **Runy zakládá profil** (`profiles.newRun({ deckId, stake, seed, seeded?, challengeId?, daily? })`): pool obsahu
  podle druhu runu (`poolModeFor`: denní > seedovaný > výzva > hlavní hra) a `startRun`. Obrazovky výzev a denního
  runu (další úkol) zavolají totéž. Pokračování přes `profiles.resume()`; herní obrazovka připojí i controller
  založený mimo profil (`attach` → `resumeRun`, idempotentní; dohraný run se jen připojí).
- **Nová hra:** zamčené balíčky jsou v radiogroup jako `aria-disabled` (název, silueta, zámek, „Jak odemknout“
  s průběhem), šipky je přeskakují; síly piva podle zvoleného balíčku (při přepnutí balíčku se síla sníží na
  nejvyšší odemčenou) s poznámkou, co odemkne další; „tácek“ s nejsilnější vyhranou silou (DESIGN 9). Seed:
  `parseSeedInput` při psaní (chyba pod polem, `aria-invalid`, start ji nespustí). Prázdné pole = náhodný seed
  z `crypto.getRandomValues` (záložně `Math.random`, jen UI). **Seed vylosovaný tlačítkem „Náhodný“ a nezměněný se
  nepočítá jako zadaný** — jinak by hráč omylem přišel o započítání runu. Zadaný seed = seedovaný run (poznámka
  pod polem), ručně zadaný `DEN-RRRRMMDD` = denní run mimo soutěž s balíčkem a silou ze seedu.
- **Sbírka:** položky se staví líně jen pro otevřenou záložku; detail v dialogu. Balíčky, síly piva a výzvy ukazují
  název i zamčené (jsou to režimy hry, podmínka je to zajímavé); žolíci a kupóny zamčení jen „Zamčeno“, neobjevené
  „???“. Nezískaný achievement má vybledlou ikonu (ne černou siluetu — byla by nečitelná), skrytý otazník
  a nápovědu `achievements.<id>.hint`. Štítek „Nové“ zmizí po otevření detailu a pro celou záložku při odchodu
  z ní (hráč novinky viděl); počet novinek je na záložkách i na tlačítku Sbírka v menu. Filtr vzácnosti
  a zaměření (`JokerTag`) jen u žolíků, řazení podle pořadí / vzácnosti (žolíci) / názvu (neobjevené na konec) /
  četnosti. Texty podmínek skládá `unlockText` z M3 (`unlockSpecText` v `metaText.ts`) — žádné druhé šablony v UI.
- **Statistiky** v záložkách Přehled · Balíčky · Síla piva · Šéfové · Historie · Denní runy; data jen z profilu,
  seedované runy jen v historii (poznámka v přehledu). Datum bez `Intl` (`metaText.formatDateTime`, místní čas;
  denní run podle klíče dne v UTC). Text ke sdílení denního runu podle DESIGN 11.7.
- **Menu:** Sbírka a Statistiky aktivní; Výzvy a Denní run zůstávají „Už brzy“ do dalšího úkolu.
- **E2E:** testy zadávaly seedy, které `parseSeedInput` odmítne (`KARBAN1`, `A11Y1`…) — přepsané na platné osmiznakové
  (pro test přeskočení ověřený seed, jehož štítky neotevřou obálku); testy s Mariášovým balíčkem a Dvanáctkou si
  vloží profil s odemčeným vším.

**Proč:** CLAUDE.md kap. 2 (profil se nesmí ztratit, autosave po každé akci), 3 (odemykání, sbírka, statistiky,
seed, historie), 4 (obrazovky, přístupnost); DESIGN 9–11, 13.4.

## 2026-10-02 — Fáze 8 (M5): výzvy, denní run, oznámení, tutoriál Štamgast, zálohy profilu

**Co:**

- **Výzvy** (`src/ui/screens/challenges.ts`): seznam po várkách (1 / 3 / 6 / 10 výher, podmínka z `ChallengeDef.unlock`)
  a detail vybrané výzvy. Zamčená výzva ukáže název (je to režim hry, M4) a podmínku s průběhem, pravidla až po
  odemčení. Stav položky: zamčeno / nehráno / zkoušeno / dokončeno (odznak s pohárem) / rozehráno (Pokračovat).
  Start = `profiles.newRun({ deckId, stake: def.stake ?? 1, seed: náhodný, challengeId })` přes společný
  `src/ui/runStart.ts` (potvrzení přepsání rozehrané hry). Výběr výzvy sundá štítek „Nové“; počet nových výzev je
  i na tlačítku v menu. Na úzké obrazovce je detail nad seznamem (doporučená výzva s tlačítkem Hrát hned na očích).
- **Denní run** (`src/ui/screens/daily.ts`): dnešní `DEN-YYYYMMDD` (UTC), balíček a síla piva ze seedu, stav pokusu
  (`dailyStatus`: čeká / rozehraný / ztracený / odehraný). Oficiální pokus i „Hrát znovu mimo soutěž“ zakládají run
  stejně (`daily: true`, ne seedovaný) — jestli je oficiální, rozhoduje meta vrstva (první run dne). Text ke
  sdílení (`dailyShareText`, kopírování do schránky) na obrazovce, v historii denních i na pitvě / výhře (u pokusu
  mimo soutěž s poznámkou). Odpočet do dalšího dne je statický (bez tikání). Menu má u Denního runu cedulku „Dnes“,
  dokud oficiální pokus čeká.
- **Oznámení** (`src/ui/metaNotices.ts`): toast s ikonou na tácku (achievement `def.icon`, odemčená věc ikona z její
  `art`), štítkem („Achievement“, „Odemčeno · žolík“), názvem a popisem; **fronta** — nejvýš 2 naráz, další přijde,
  až předchozí odejde (`ToastOptions.onClose`), přebytek nad 8 shrne „…a další novinky“. Toasty dál nepřekrývají
  ovládání (mimo ruku a tlačítka, kliknutí propadne). Dřívější limit „3 naráz, zbytek shrnout“ nahrazen frontou —
  nic se neztratí, jen počká.
- **Novinky runu na pitvě a výhře:** `ProfileController` si pamatuje oznámení rozehraného runu (`runNotices`, klíč =
  seed + balíček + síla + výzva + denní) a doplní achievementy získané od začátku runu podle data (po načtení
  stránky se oznámení nepamatují). Kompaktní žetony (ikona + název, štítek a popis v `title` a pro čtečku), ať
  tlačítka Nová hra / Menu zůstanou na 1366 × 768 vidět. Nezapočítaný run (seed, denní mimo soutěž) má poznámku.
- **Tutoriál Štamgast** (`src/ui/tutorial.ts`): nemodální bublina s postavičkou (vlastní SVG z ikon `mustache`
  a `beer-stein`, `src/ui/art/stamgast.ts`) mimo `#app`, vrstva nad jevištěm a pod dialogy; nebere focus, kliknout
  jde jen na ni. Krok vybírá čistá `pendingTutorialStep` ze stavu hry: v kole výběr → Zahrát → Zahodit → cíl a ruce
  → pořadí žolíků (až v kole, kde bublina pod řadou žolíků nic nezakryje), šéf má přednost; konec kola → výplata;
  Večerka → koupě žolíka; výběr útraty → šéf, přeskočení (až po první výplatě — nejdřív se hraje). Krok dokončí
  „Rozumím“, nebo sama akce (`stepsDoneByEvents`: zahraná ruka, zahození, výhra kola, výplata, koupě žolíka,
  přeskočení, poražený šéf; výběr karty). „Přeskočit tutoriál“ = `skipTutorial`. Dokončení posledního kroku →
  `profiles.refresh()` → achievement „Štamgastův žák“. **Umístění:** kandidáti u cíle a u záložních míst (Zahrát →
  nad ruku), vyhraje ten, který nejmíň zakrývá ovládací prvky (`placeBubble`, čistá funkce); cíl zvýrazní pulzující
  rámeček. Stejná rada se po animaci tahu znovu neohlašuje. Tutoriál instaluje `src/main.ts`; **`?tutorial=off`**
  ho vypne pro celé sezení — e2e testy ho tak mají všechny kromě `tests/e2e/meta.spec.ts` (jinak lze vypnout
  profilem, `Settings.tutorial`). Hooky: `App.onScreenChange`, `GameController.onEvents`.
- **Nastavení:** „Zapnout tutoriál znovu“ (`restartTutorial`, od první rady); přepínač Rad Štamgasta při zapnutí
  vrátí i přeskočený tutoriál. **Reset profilu nejdřív zazálohuje profil** do `karban.profile.backup.<ms>` a zálohy
  nemaže (dřív mazal všechno včetně záloh) — profil se nesmí ztratit, zálohy jdou do exportu. Totéž import:
  přepisovaný profil jde do zálohy. Potvrzení importu řekne, co soubor obsahuje (`importSummary`: profil s počtem
  runů a achievementů, rozehraná hra s balíčkem a patrem, nebo jen nastavení). Validace a migrace importu zůstávají
  z M4 (`parseImport`).
- **Menu:** žádné „Už brzy“ — Výzvy i Denní run vedou na své obrazovky (texty `menu.comingSoon*` zůstávají
  v i18n pro komponentu tlačítka).

**Proč:** CLAUDE.md kap. 2 (profil se nikdy neztratí, export/import), 3 (výzvy, denní run, achievementy), 4
(obrazovky, tutoriál jde přeskočit a znovu zapnout, nastavení), 5 (humor v textech); DESIGN 11.1, 11.7, 13.4, 13.5.

### 2026-10-02 — Fáze 8: vizuální kontrola meta obrazovek

**Co:** Snímky všech meta obrazovek na 1366×768, 1024×768, 1920×1080, tabletu 820×1180 a telefonu 390×844
(`KARBAN_VISUAL=1 npx playwright test visual-meta`, čerstvý i plný profil; metriky a snímky jako u U5, sdílená výbava
`tests/e2e/visualKit.ts` hlídá navíc kontrast textu na jednobarevném pozadí). Opravy vzhledu bez změny chování:

- **Výzvy:** na široké obrazovce je detail `position: sticky` (vyšší než okno se posouvá uvnitř) — po výběru výzvy
  ze spodku seznamu byl detail mimo obraz. Zamčená výzva i silueta v detailu sbírky mají zámek / otazník (dřív šedý
  obdélník). Nadpisy várek ve světlejší zlaté (`--money`; `--accent` na suknu má u drobného písma jen 3,8 : 1),
  stejně podtitul menu na úzkých obrazovkách.
- **Sbírka:** achievementy mají nadpisy kategorií (`meta.collection.achievementCategories`) — skupiny bez nadpisu
  vypadaly jako díry v mřížce.
- **Nová hra:** zámek zamčeného balíčku měl kvůli pořadí CSS (`.icon` = 1em) 16 px místo 45 px; zamčená síla piva
  má vybledlý jen tácek, název zůstává čitelný.
- **Pitva a výhra:** tlačítka jsou `sticky` u spodního okraje jeviště — první výhra odemkne celou várku výzev
  a tlačítka Konec / Nekonečný režim byla pod okrajem.
- **Oznámení:** herní obrazovka po vložení do stránky znovu umístí oblast oznámení nad stůl — oznámení z doby před
  vložením (obnovení / založení runu) zůstávala v rohu přes ruku a tlačítko Zahodit.
- **Statistiky:** šéfové ve dvou sloupcích (příčiny proher vedle tabulky), na telefonu užší tabulky se zalomeným
  záhlavím a stínem u okraje, když se tabulka posouvá.
- **Dotyk:** tlačítka bubliny tutoriálu a křížek oznámení aspoň 44 px (`pointer: coarse`).

**Proč:** CLAUDE.md kap. 2 (tablet plně funkční, přístupnost), 4 (obrazovky), 8 (kontrast, Lighthouse
přístupnost > 90).

## 2026-10-02 — Revize a uzavření fáze 8 (meta)

**Co:** Revize textů, robustnosti profilu, ochrany proti „farmení“ a počtů obsahu; nálezy opravené s testy
(`tests/unit/phase8-review.test.ts`, test rodové neutrality v `tests/unit/i18n.test.ts`).

- **Texty** (vypsané skriptem: výzvy s pravidly, 78 achievementů, podmínky odemčení všech položek, `meta.*`, menu,
  Nová hra, Nastavení): oslovení hráče bylo místy v mužském rodě — „Říkal jsi…“, „Řekl jsi pět“, „Ani jsi nestihl…“,
  „ty jsi u toho byl“, „odcházíš jako vítěz“, „jsi ještě nehrál“ (statistiky), „jsi ho jednou vyslechl“ (nastavení)
  → neutrální tvary; nový test projde všechny texty a minulý čas ve 2. osobě odmítne. Achievement _Rozehřátý_ →
  _Rozehřívačka_ (přídavné jméno o hráči). „Vyhraj celkem 1 run.“ → „Vyhraj svůj první run.“ (`winsTotalFirst`),
  podmínka tier 2 kupónu „Pořiď kupón … ve 2 různých runech, nebo …“, legendy „Odemkne se prvním získáním“
  (dřív „až ho poprvé získáš“ i u Kněžny Libuše), „Měj v balíčku najednou 5 karet s pečetí“ (bez „v jednom runu“),
  nápověda neobjevené položky „Zatím se ti to neukázalo.“ (dřív v mužském rodě i u pranostik), „Finálový šéf“
  jednotně (sbírka měla „Finální“), `+{chips}` čipů přes `plural`, výherní obrazovka říká patro výhry („Šéf 12.
  patra…“ u Konce světa, dřív vždy „osmého“). Převzaté názvy z Balatra ani žijící osoby / značky: bez nálezu.
- **Profil se nikdy neztratí:** reset i import profil přepsaly, i když se záloha nepodařila zapsat (plné úložiště
  — přesně situace, kdy se ukládání kazí). Teď `backupStoredProfile` vyhodí `ProfileBackupError` a reset ani import
  neproběhnou (hláška `settings.reset.backupFailed` / `settings.import.errors.backupFailed`). Export bez profilu
  (`profile: null`) dřív profil smazal a export bez `settings` přebil nastavení výchozími — teď obojí nechá být. Záloha
  poškozeného profilu při startu mohla přepsat zálohu se stejnou milisekundou — sdílený `writeProfileBackup`.
  Poškozený JSON, cizí JSON, jiný druh uložení, novější verze i verze bez migrace → přesná data v záloze, nový profil;
  platná obálka bez klíčů se doplní (testy).
- **Farmení:** seedované runy se dál nepočítají nikam kromě historie a „Semínko zaseto“ (ověřeno). Nově:
  1. _Denní run:_ pokračování denního runu, který profil nezná, bylo oficiální i bez záznamu dne (kód proti
     komentáři) — teď jen s rozehraným záznamem dne se stejným seedem, jinak mimo soutěž.
  2. _Import staršího profilu_ vracel dnešní oficiální pokus — `mergeDailyRecords` doplní do importovaného profilu
     dny ze současného. (Reset profilu dny nepřenáší; lokální hru nejde ochránit úplně — zápis do úložiště
     ručně, reset bez návratu zálohy. Cílem je, aby to nešlo běžným ovládáním.)
  3. _Opakované zakládání runu:_ startovní výbava (Velký třesk = 2 legendy, Vetešnický = vzácný žolík, Babiččin =
     rady) se zapsala do sbírky hned po založení, takže „Staré pověsti české“ (všechny legendy) šly získat ~11 starty
     výzvy a „Vyjeli z hory“ jedním. Startovní žolíci a spotřebky (`uid < RunCounters.startUid`, nové pole, chybějící =
     0 = bez omezení) se objeví až po první vyhrané útratě runu (`isStartingItem`); achievement „Vyjeli z hory“ také.
     DESIGN 11.4 objev definuje obchodem, obálkou, šéfem a štítkem, takže start do něj nepatří.
  4. Run z importu, který profil nezná, se dál počítá jako hlavní hra: import libovolného profilu je stejně možný,
     takže omezovat import runu by nic nechránilo a rozbilo by obnovu po ztraceném zápisu.
- **Sbírka:** obálky neměly záložku, ale objevené obálky dostávaly štítek „Nové“ → počet novinek na tlačítku Sbírka
  v menu nešel nikdy vynulovat. Nová záložka **Obálky** (název, druh, cena); test hlídá, že každá kategorie „Nových“
  má záložku. Počty: 20 výzev, 78 achievementů, 70 / 101 žolíků od začátku, 2 / 12 balíčků, 12 / 24 kupónů.
- **Tajné kombinace přes runy** (otevřený bod z fáze 7): „Info o runu“ ukazovalo tajnou kombinaci jen po zahrání
  v aktuálním runu; DESIGN 2.2.4 chce, aby objev v profilu platil ve všech dalších runech (na úrovni 1). Opraveno
  (`profile.discovered.hands`); pranostiky tajných kombinací se dál nabízejí až po zahrání v aktuálním runu.
- Komentáře se starými názvy obsahu (Kartářka, Fotonegativ, Úřední poukaz) opravené na nové.

**Proč:** CLAUDE.md kap. 2 (profil se nikdy neztratí), 3 (výzvy, achievementy, denní run, seed), 5–6 (tykání,
humor, plural), DESIGN 11, 13.4; CONTENT-GUIDE kap. 12 (rodová neutralita).
