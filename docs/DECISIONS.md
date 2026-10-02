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
