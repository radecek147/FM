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
