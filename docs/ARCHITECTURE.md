# Architektura — Karban

> Technický přehled. Herní pravidla a čísla jsou v `docs/DESIGN.md`, rozhodnutí v `docs/DECISIONS.md`.

## 1. Vrstvy

```
┌──────────────────────────────────────────────────────────────┐
│ src/ui/**        DOM + CSS renderer, obrazovky, animace,     │
│                  částice (canvas), zvuk (Web Audio)           │
│   ▲ události (EventBus)          │ akce (dispatch)           │
│   │ snapshot stavu (readonly)    ▼                           │
│ src/engine/**    čistý TypeScript, BEZ DOM, deterministický  │
│   ▲ ContentRegistry (dependency injection)                   │
│ src/content/**   DATA: žolíci, šéfové, spotřebky, balíčky…   │
│ src/i18n/**      všechny texty (cs) + formátování čísel       │
└──────────────────────────────────────────────────────────────┘
```

Pravidla závislostí (hlídá ESLint `no-restricted-imports` / `no-restricted-globals`):

- `engine` neimportuje `ui`, `content` ani `i18n` a nesahá na `window`/`document`/`localStorage`.
  Obsah dostává přes `ContentRegistry` (viz `src/engine/content-types.ts`).
- `content` importuje jen typy a pomocné funkce z `engine` (nikdy UI).
- `ui` čte stav jen přes snapshot (`Readonly<RunState>`) a mění ho jen akcemi (`game.dispatch(action)`).
- Texty jsou výhradně v `src/i18n/cs.ts` (+ podmoduly `src/i18n/cs/*.ts`). Engine emituje klíče a čísla.
  I statické `index.html` (titulek, meta popis, `<noscript>`) má jen zástupné symboly `{{t:klíč}}`, které při
  buildu/dev dosadí plugin `karban-i18n-html` ve `vite.config.ts`.

## 2. Engine

### 2.1 Stav

`RunState` (`src/engine/types.ts`) je **čistě JSON-serializovatelný** objekt: žádné `Set`, `Map`,
třídy ani funkce. Obsahuje i stav RNG streamů, takže `JSON.parse(JSON.stringify(state))` je plnohodnotné
uložení. Definice obsahu se ve stavu odkazují přes `defId`.

### 2.2 Akce a události

```ts
const game = Game.newRun({ deckId: 'pub', stake: 1, seed: 'ABCD2345' }, registry);
game.bus.on('handPlayed', (e) => ui.animateScore(e.result));
const res = game.dispatch({ type: 'play', cardIds: [12, 7, 3] });
if (!res.ok) ui.toast(t(`errors.${res.error}`));
```

- `dispatch(action)` validuje fázi a vstupy, změní stav, emituje události na `bus` a vrátí je i v
  `ActionResult.events` (UI je může přehrát sekvenčně s animací).
- Neplatná akce stav **nemění** a vrací `{ ok: false, error }`.
- Determinismus: stejný seed + stejná posloupnost akcí ⇒ identický stav (testováno).

### 2.3 RNG

`src/engine/rng/rng.ts` — xoshiro128** seedovaný hashem cyrb128. Každý účel má vlastní stream
(`deck`, `shop`, `booster`, `boss`, `tag`, `joker`, `card`, `consumable`, `misc`), seedovaný
`hash(seed + ':' + stream)`. Díky tomu např. přehazování obchodu neovlivní míchání balíčku.
`rngFromState(state.rng.shop)` mutuje pole ve stavu na místě → pokrok streamu se ukládá.

Denní run: `dailySeed(date)` = `DEN-YYYYMMDD` (UTC).

### 2.4 Moduly

| Modul                     | Odpovědnost                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `engine/types.ts`         | datové typy stavu, akcí, událostí                                                        |
| `engine/content-types.ts` | rozhraní definic obsahu, hooků, `EngineApi`, `ContentRegistry`                           |
| `engine/rng/`             | seedovaný RNG                                                                            |
| `engine/events.ts`        | typovaný `EventBus`                                                                      |
| `engine/cards/`           | tvorba karet, standardní balíček, čipy karty, barvy (divoká/kamenná)                     |
| `engine/hands/`           | detekce kombinací (vč. tajných, divokých karet, modifikátorů 4 prstů/mezer/kolem dokola) |
| `engine/scoring/`         | skórovací pipeline → `ScoreResult` s kroky pro animaci                                   |
| `engine/effects/`         | skládání `Modifiers`, volání hooků žolíků/šéfů/štítků, implementace `EngineApi`          |
| `engine/run/`             | `Game` — stavový automat runu (útraty, kola, odměny, konec, nekonečný režim), cíle       |
| `engine/shop/`            | generování obchodu a boosterů, ceny, přehození, prodej                                   |
| `engine/save/`            | serializace, verze formátu, migrace                                                      |
| `engine/meta/`            | profil hráče: odemykání, statistiky, achievementy, historie (fáze 8)                     |
| `engine/sim/`             | boti a headless simulace (`npm run simulate`)                                            |

### 2.5 Skórování (pořadí je závazné a otestované)

1. **Základ kombinace**: čipy a mult podle úrovně (`HandTypeDef` + `chipsPerLevel`/`multPerLevel`),
   případně upravené šéfem (`BossHooks.modifyBase`). Žolíci s `beforeScoring` běží před tímto krokem
   (mohou např. zvýšit úroveň kombinace).
2. **Skórující karty zleva doprava** (v pořadí, v jakém je hráč zahrál). Pro každou aktivaci karty:
   čipy karty → vylepšení (`EnhancementDef.onScored`) → edice karty → pečeť (`SealDef.onScored`) →
   žolíci zleva doprava (`onCardScored`). Opakované aktivace (červená pečeť, `retriggerScored`)
   zopakují celou sekvenci. Debuffnutá karta nedává nic (ale počítá se do kombinace).
3. **Karty držené v ruce** zleva doprava: vylepšení (`onHeld`, např. ocelová ×1,5) → žolíci
   (`onCardHeld`), včetně opakování (`retriggerHeld`).
4. **Žolíci zleva doprava** (`onHandPlayed`): edice žolíka typu „before“ (lesklá +čipy,
   holografická +mult) → vlastní efekt žolíka → edice typu „after“ (duhová ×mult).
5. `score = floor(chips × mult)`. Pak `afterHandScored` (počítadla), šéf `afterHandPlayed`,
   zničení karet (sklo praskne apod.).

Každá změna čipů/multu/peněz se zapíše jako `ScoreStep` (s průběžnými hodnotami), UI je přehraje.
Velká čísla: počítáme v `number` (double); nad 1e15 formátujeme vědecky (`src/i18n/format.ts`).

### 2.6 Modifikátory

`Modifiers` = `BASE_MODIFIERS` + delty ze zdrojů v tomto pořadí: obtížnost (všechny úrovně ≤ zvolená),
balíček, výzva (`extraModifiers`), kupóny, štítky, žolíci (`passive`), šéf (`passive`, pokud není
vypnutý). Čísla se sčítají, pole končící na `Mult` se násobí, booleany se ORují.

### 2.7 Hooky obsahu

Viz `JokerHooks`, `BossHooks`, `TagHooks` v `content-types.ts`. Hooky smí:

- číst stav (`ctx.state`, `ctx.api.*` dotazy),
- měnit **pouze** `ctx.self.state` (žolíci/štítky) a stav přes `ctx.api` příkazy,
- pro náhodu používat výhradně `ctx.rng` / `ctx.chance(n, d)`.

Kopírující žolíci (`copyTarget`) volají hook cílového žolíka s `isCopy = true` — hook pak nesmí měnit
`self.state` (aby se počítadla nenavyšovala dvakrát).

## 3. Obsah (`src/content`)

Každá položka = jeden objekt v odpovídajícím souboru + texty v `src/i18n/cs/*.ts` + test.
`src/content/index.ts` sestaví `ContentRegistry` a ověří konzistenci (unikátní id, existence textů,
`requires` u kupónů…). Test `tests/unit/content.test.ts` hlídá, že každá položka má název, popis,
flavor a že texty dodržují typografii.

## 4. UI (`src/ui`)

- Vlastní lehký helper `h(tag, props, ...children)` (`src/ui/dom.ts`) — žádný framework.
- `src/ui/app.ts` — router obrazovek (menu, nová hra, hra, sbírka, statistiky, nastavení, titulky).
- `src/ui/controller.ts` — drží instanci `Game`, předává akce, řadí události do fronty animací,
  po každé akci autosave.
- Obrazovky v `src/ui/screens/*`, komponenty v `src/ui/components/*`.
- Animace: CSS transform/opacity + `src/ui/fx/particles.ts` (jediný `<canvas>` overlay).
- Zvuk: `src/ui/audio/` — syntetizované SFX (jsfxr-like) a procedurální chiptune.
- Témata a barvoslepý režim přes CSS proměnné na `:root`.
- Obrázky: `src/ui/art/` skládá SVG žolíků z `ArtSpec` (ikona + paleta + vzor), karty jsou SVG.

## 5. Ukládání

- `localStorage`: `karban.profile` (profil, odemčení, statistiky, nastavení) a `karban.run` (rozehraný run).
- Formát `{ format: 'karban-save', kind: 'run' | 'profile', version: N, data }`. Migrace v
  `src/engine/save/migrations.ts` (čisté funkce `vN → vN+1`), testované. Profil se nikdy nesmí ztratit:
  při chybě načtení se poškozená data zálohují do `karban.profile.backup.<timestamp>`.
- Export/import JSON z nastavení.

## 6. Testy

- `tests/unit/**` (Vitest): kombinace, skórování, pořadí efektů, každý žolík, RNG determinismus,
  save/load roundtrip, migrace, obsahová konzistence, simulace jako smoke test. Pokrytí enginu ≥ 80 %.
- `tests/e2e/**` (Playwright): spuštění, zahrání ruky, obchod, uložení/načtení, screenshot,
  vykreslení věty „Příliš žluťoučký kůň úpěl ďábelské ódy“.

## 7. Skripty

- `npm run simulate -- --runs 500 --stake 1 [--deck pub] [--strategy all] [--seed-prefix A] [--json out.json]`
  — headless boti (seed runu `i` = `SIM-<prefix>-<i>`, viz `docs/DESIGN.md` kap. 12).
- `npm run fetch-assets` — stáhne/extrahuje volně licencované assety a přegeneruje `ASSETS.md`.
- `npm run deploy` — build pro GitHub Pages (`BASE_PATH=/<repo>/`).
