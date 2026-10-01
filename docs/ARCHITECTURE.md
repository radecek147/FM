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

| Modul                     | Odpovědnost                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `engine/types.ts`         | datové typy stavu, akcí, událostí                                                                                         |
| `engine/content-types.ts` | rozhraní definic obsahu, hooků, `EngineApi`, `ContentRegistry`                                                            |
| `engine/constants.ts`     | čísla pravidel z DESIGN 2.10 (odměny, násobky útrat, vzácnosti, nálepky, strop opakování, seed) a i18n klíče hlášek `MSG` |
| `engine/rng/`             | seedovaný RNG                                                                                                             |
| `engine/events.ts`        | typovaný `EventBus`                                                                                                       |
| `engine/cards/`           | tvorba karet, standardní balíček, čipy karty, barvy (divoká/kamenná)                                                      |
| `engine/hands/`           | detekce kombinací (vč. tajných, divokých karet, modifikátorů 4 prstů/mezer/kolem dokola)                                  |
| `engine/scoring/`         | skórovací pipeline → `ScoreResult` s kroky pro animaci                                                                    |
| `engine/effects/`         | skládání `Modifiers`, volání hooků žolíků/šéfů/štítků, implementace `EngineApi`                                           |
| `engine/run/`             | `Game` — stavový automat runu (útraty, kola, odměny, konec, nekonečný režim), cíle, losování šéfů (`bosses.ts`)           |
| `engine/shop/`            | generování obchodu a boosterů (`shop.ts`), pooly a edice (`pool.ts`), ceny a prodej (`prices.ts`)                         |
| `engine/save/`            | serializace, verze formátu, migrace                                                                                       |
| `engine/meta/`            | profil hráče: odemykání, statistiky, achievementy, historie (fáze 8)                                                      |
| `engine/sim/`             | boti a headless simulace (`npm run simulate`)                                                                             |

### 2.5 Skórování (pořadí je závazné a otestované)

1. **Základ kombinace**: čipy a mult podle úrovně (`HandTypeDef` + `chipsPerLevel`/`multPerLevel`),
   případně upravené šéfem (`BossHooks.modifyBase`). Žolíci s `beforeScoring` běží před tímto krokem
   (mohou např. zvýšit úroveň kombinace).
2. **Skórující karty zleva doprava** (v pořadí, v jakém je hráč zahrál). Pro každou aktivaci karty:
   čipy karty → vylepšení (`EnhancementDef.onScored`) → edice karty → pečeť (`SealDef.onScored`) →
   žolíci zleva doprava (`onCardScored`). Opakované aktivace (červená pečeť, `retriggerScored`)
   zopakují celou sekvenci. Debuffnutá karta nedává nic (ale počítá se do kombinace).
3. **Karty držené v ruce** zleva doprava: vylepšení (`onHeld`, např. ocelová ×1,5) → žolíci
   (`onCardHeld`), včetně opakování (`retriggerHeld`). `EffectResult.destroyCard` tu nic nezničí — platí jen
   pro efekty skórující karty (krok 2 a `afterScored`).
4. **Žolíci zleva doprava** (`onHandPlayed`): edice žolíka typu „before“ (lesklá +čipy,
   holografická +mult) → vlastní efekt žolíka → edice typu „after“ (duhová ×mult).
5. `score = floor(chips × mult)`, šéf může skóre upravit (`BossHooks.adjustHandScore`). Pak `afterHandScored`
   (počítadla), šéf `afterHandPlayed`, `afterScored` vylepšení (jednou za ruku: hod skla, Ohmataná +3 čipy;
   `afterScoredCards` ve `scoring/score.ts`) a zničení označených karet.

Počet aktivací jedné karty je nejvýš `MAX_ACTIVATIONS_PER_CARD` (10). Platná vylepšení dává `GameCore.enhancements()`
— při `Modifiers.disableEnhancements` (Bílá hora) prázdný registr, karta se pak chová jako bez vylepšení.

Každá změna čipů/multu/peněz se zapíše jako **samostatný** `ScoreStep` (s průběžnými hodnotami), UI je přehraje —
efekt `{ chips, mult }` dá dva kroky (čipy → mult → ×mult → peníze), zpráva efektu patří k jeho prvnímu kroku.
Neplatné hodnoty efektu (NaN) se ignorují, nekonečno se ořízne na `Number.MAX_VALUE` (skóre ruky i kola zůstává
konečné, aby šlo uložit do JSON).
Velká čísla: počítáme v `number` (double); nad 1e15 formátujeme vědecky (`src/i18n/format.ts`).

### 2.6 Modifikátory

`Modifiers` = `BASE_MODIFIERS` + delty ze zdrojů v tomto pořadí: obtížnost (všechny úrovně ≤ zvolená),
balíček, výzva a trvalé efekty (`extraModifiers`, doplňuje `api.addPermanentModifier` přes `mergeDelta`), kupóny,
štítky, žolíci (`passive`), šéf (`passive`, pokud není vypnutý), dočasná velikost ruky kola
(`RoundState.handSizeDelta`). Čísla se sčítají, pole končící na `Mult` se násobí, booleany se ORují; výsledek se
ořízne na rozumné meze (`clampModifiers`). Neplatná čísla v deltě (NaN, ±∞) i přetečení se ignorují.

`GameCore.mods()` drží výsledek v cache a vrací ho **zmrazený** (nikdo ho nesmí měnit — pravidla mění jen delty).
Cache se zneplatní po každé změně, která může změnit výsledek: příkazy API, každý hook žolíka/štítku, hooky šéfa
s vedlejšími účinky (`onRoundStart`, `afterHandPlayed`, `onDiscard`, `onDraw`) a konec akce. `passive` musí být čistá
funkce; běží v `GameCore.readOnly` — `ctx.rng`/`ctx.chance` v ní pracují na kopii streamu a stav RNG neposunou
(stejně náhled ruky a `ConsumableDef.canUse`: dotazy UI nesmí měnit run). `passive`, která sama čte `mods()`, dostane
`BASE_MODIFIERS` (ochrana proti rekurzi).

### 2.7 Hooky obsahu

Viz `JokerHooks`, `BossHooks`, `TagHooks` v `content-types.ts`. Hooky smí:

- číst stav (`ctx.state`, `ctx.api.*` dotazy),
- měnit **pouze** `ctx.self.state` (žolíci/štítky) a stav přes `ctx.api` příkazy,
- pro náhodu používat výhradně `ctx.rng` / `ctx.chance(n, d)`.

`EngineApi` (`ctx.api`, implementace `effects/api.ts`, typy v `content-types.ts`) — příkazy jsou deterministické,
emitují události a respektují limity (sloty, dluhový limit, „jen během kola“):

| Oblast             | Příkazy                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| peníze             | `addMoney` (ořízne dluhovým limitem), `setMoney` (přesně)                                                                |
| kolo a ruka        | `addHands`, `addDiscards`, `drawCards`, `addRoundHandSize`, `discardFromHand`, `setCardFaceDown`, `shuffleHand`          |
| kombinace          | `levelUpHand`, `levelUpAll`, `handBase` (dotaz na základ úrovně)                                                         |
| žolíci a spotřebky | `createJoker`, `destroyJoker`, `setJokerDebuffed`, `createConsumable`                                                    |
| karty balíčku      | `addCard`, `copyCard`, `destroyCard`, `modifyCard`                                                                       |
| run                | `addTag`, `disableBoss`, `rerollBoss`, `changeAnte`, `addPermanentModifier`, `message` (i18n klíč)                       |
| dotazy (bez změn)  | `getCard`, `handCards`, `modifiers` (zmrazené), `handLevel`, `isFace`, `hasSuit`, `cardChips`, `jokerSlots`, `sellValue` |

Číselné vstupy příkazů: NaN a ±∞ se ignorují, počty (ruce, zahození, úrovně, patra, velikost ruky) se usekávají na
celá čísla, peníze a statistiky se zastaví na `Number.MAX_VALUE` — stav musí zůstat uložitelný do JSON.

Kopírující žolíci (`copyTarget`) volají hook cílového žolíka s `isCopy = true` — hook pak nesmí měnit
`self.state` (aby se počítadla nenavyšovala dvakrát); engine to jistí i sám: při `isCopy` dostane hook kopii instance
cíle a její změny se zahodí. V řetězu kopírujících žolíků dostane každý článek do `copyTarget` svou vlastní pozici
(`index`), hook cíle pak pozici kopírujícího. Cyklus, debuffnutý cíl nebo `copyable: false` = nic.
`JokerCtx.index` je vždy **aktuální** pozice žolíka — když hook dřív v témže průchodu zničí jiného žolíka (Sněhulák
roztaje), ostatní se posunou a kopírující „souseda“ vidí skutečného souseda.

Robustnost: vnoření téhož hooku žolíků (`onCardAdded` → `api.addCard` → `onCardAdded`…) je omezené
`MAX_NESTED_HOOK_DEPTH` (3), hlubší volání se přeskočí. Žolík s id, které registr nezná (obsah odebraný od uložení),
nic nedělá — stejně jako neznámý šéf, štítek, vylepšení či edice. Výjimka z hooku uprostřed akce vrátí stav do stavu
před akcí (jako neplatná akce) a propadne volajícímu. Po každé akci `dispatch` dobere prázdnou ruku v kole (spotřebka
zničila celou ruku…); nejsou-li karty ani pak, je to prohra z nedostatku karet.

Debuffy hracích karet určuje jen šéf (`BossHooks.isCardDebuffed`). Dočasné debuffy z jeho pravidla (Černá kočka) se
ukládají do `RoundState.flags`; engine po hooku šéfa `onRoundStart`, `afterHandPlayed` (až po `afterScored`),
`onDiscard` a `onDraw` přepočítá `Card.debuffed` celého balíčku, takže platí hned i pro karty v ruce.

Zvláštní hooky (volají se jen jednomu adresátovi, ne všem zleva doprava): `JokerHooks.onAcquire` (žolík vstoupil do
slotů — koupě, obálka, `createJoker`; ne startovní žolíci výzvy), `JokerHooks.preventGameOver` a
`TagHooks.onRoundLost` (záchrana prohraného kola; štítky se ptají první), `DeckDef.onBossDefeated`. Hlášky, které
engine emituje (`ScoreStep.message`, událost `message`), jsou i18n klíče z `MSG` v `engine/constants.ts`.

### 2.8 Večerka a ceny

Ceny počítá `shop/prices.ts` podle DESIGN 2.5.2 (sleva zaokrouhlená polovinou nahoru, minimum 1 Kč, pak
`shopPriceAdd`; položky `free` za 0). `Game.dispatch` po každé úspěšné akci přepočítá ceny neprodaných položek
(`refreshShopPrices`), takže kupón se slevou platí hned. Prodejní ceny nezávisí na slevách ani `shopPriceAdd`.
Akce `pickBooster` umí `keep: true` — vybraná spotřebka se uloží do slotu místo použití.

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
- Formát `{ format: 'karban-save', kind: 'run' | 'profile', version: N, savedAt, data }` (`src/engine/save/save.ts`:
  `serializeRun`, `deserializeRun`, `SaveError`). Migrace `RUN_MIGRATIONS` ve stejném souboru (čisté funkce
  `vN → vN+1`, aplikují se postupně; testy roundtripu a migrací patří do fáze 2). Profil se nikdy nesmí ztratit:
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
