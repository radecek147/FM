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
