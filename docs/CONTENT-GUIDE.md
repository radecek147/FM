# Průvodce tvorbou obsahu — Karban

> Jak přidat žolíka, šéfa, spotřebku, kupón, štítek, balíček, výzvu nebo achievement tak, aby seděl
> mechanicky, jazykově i humorem. Závazné typy jsou v `src/engine/content-types.ts`, architektura
> v `docs/ARCHITECTURE.md`, čísla a cílové hodnoty v `docs/DESIGN.md`.

## 1. Princip: položka = data + texty + test

Každá položka obsahu se skládá ze tří (u některých čtyř) částí:

1. **Definice** — jeden objekt v `src/content/*.ts` podle typu z `src/engine/content-types.ts`
   (čísla, hooky, `ArtSpec`, podmínka odemčení).
2. **Texty** — v `src/i18n/cs/*.ts` pod klíčem odvozeným z `id` (název, mechanika, flavor, případně hlášky).
3. **Test** — v `tests/unit/**`, ověří, že mechanika dělá přesně to, co říká popisek.
4. (**Art**) — `ArtSpec` v definici; UI z něj složí procedurální SVG. Nové ikony jen z povolených zdrojů
   a se záznamem v `ASSETS.md`.

`src/content/index.ts` vše sestaví do `ContentRegistry` a ověří konzistenci (unikátní `id`, existence
textů, platné odkazy). `tests/unit/content.test.ts` hlídá, že každá položka má všechny texty a že
dodržují typografii. Engine obsah nikdy neimportuje — dostává ho přes registr.

| Typ                       | Definice (soubor)             | Typ v `content-types.ts`                    | Klíče textů                                           |
| ------------------------- | ----------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Žolík                     | `src/content/jokers*.ts`      | `JokerDef`                                  | `jokers.<id>.name\|desc\|flavor`                      |
| Šéf                       | `src/content/bosses.ts`       | `BossDef`                                   | `bosses.<id>.name\|rule\|intro\|defeat\|death`        |
| Pranostika                | `src/content/pranostiky.ts`   | `ConsumableDef` (`kind: 'pranostika'`)      | `consumables.<id>.name\|desc\|flavor`                 |
| Babská rada               | `src/content/rady.ts`         | `ConsumableDef` (`kind: 'rada'`)            | `consumables.<id>.name\|desc\|flavor`                 |
| Úřední razítko            | `src/content/razitka.ts`      | `ConsumableDef` (`kind: 'razitko'`)         | `consumables.<id>.name\|desc\|flavor`                 |
| Kupón                     | `src/content/vouchers.ts`     | `VoucherDef`                                | `vouchers.<id>.name\|desc\|flavor`                    |
| Štítek                    | `src/content/tags.ts`         | `TagDef`                                    | `tags.<id>.name\|desc\|flavor`                        |
| Startovní balíček         | `src/content/decks.ts`        | `DeckDef`                                   | `decks.<id>.name\|desc\|flavor`                       |
| Booster                   | `src/content/boosters.ts`     | `BoosterDef`                                | `boosters.<id>.name\|desc`                            |
| Obtížnost                 | `src/content/stakes.ts`       | `StakeDef`                                  | `stakes.<id>.name\|desc\|flavor`                      |
| Výzva                     | `src/content/challenges.ts`   | `ChallengeDef`                              | `challenges.<id>.name\|desc\|flavor` (+ `rules`)      |
| Vylepšení / pečeť / edice | `src/content/modifiers.ts`    | `EnhancementDef` / `SealDef` / `EditionDef` | `enhancements.<id>…`, `seals.<id>…`, `editions.<id>…` |
| Achievement               | `src/content/achievements.ts` | `AchievementDef` (vznikne ve fázi 8)        | `achievements.<id>.name\|desc\|flavor`                |

## 2. Společná pravidla pro všechny položky

- **`id`** — `snake_case`, jen ASCII bez diakritiky, unikátní v rámci typu. Smí to být přepis českého
  názvu (`kronikar`, `uredni_hodiny`) — je to datový klíč, ne identifikátor kódu. **Po vydání se `id`
  nikdy nemění** (ukládá se do savu a profilu); přejmenovává se jen text.
- **Čísla jen na jednom místě.** Hodnoty mechaniky dej do konstant a ty použij v `params` (pro popisek)
  i v hooku. Popisek čte čísla přes `{param}`, nikdy je nepiš do textu natvrdo.
- **Determinismus.** Náhoda výhradně přes `ctx.rng` nebo `ctx.chance(čitatel, jmenovatel)` (respektuje
  modifikátor pravděpodobností). Žádné `Math.random()`, `Date.now()` ani čtení z DOM.
- **Stav.** Hook smí měnit jen `ctx.self.state` (žolíci, štítky) a zbytek světa přes `ctx.api.*`.
  Stav musí být JSON-serializovatelný (čísla, řetězce, booleany, pole, prosté objekty).
- **Kopie.** Když hook běží s `ctx.isCopy === true` (kopírující žolík), **nesmí** měnit `self.state` —
  jinak by se počítadla navyšovala dvakrát.
- **Modifikátory se skládají.** Delty `Modifiers` se sčítají (pole končící na `Mult` se násobí,
  booleany ORují) — `0` tedy neznamená „vypnout“, ale „beze změny“. Na „−1 zahození“ vrať `discards: -1`.
- **Žádné texty v obsahu.** Definice obsahuje jen i18n klíče (např. `message: 'jokers.kronikar.note'`).
- **Ceny a vzácnost** podle tabulek v `docs/DESIGN.md`. Čísla jsou vlastní, ne převzatá odjinud.
- **`unlock`** — podmínka odemčení (`UnlockCondition`); bez ní je položka odemčená od začátku. Ať je
  podmínka tematicky spřízněná s položkou (žolík na Postupky se odemkne zahráním Postupek).
- **`art`** — `ArtSpec`: `icon` (název ikony z game-icons, např. `quill-ink`), `bg`, `fg`, volitelně
  `accent`, `pattern`, `prop`. Položka musí být na první pohled rozpoznatelná od ostatních.

## 3. Jak přidat žolíka

### 3.1 Definice

Žolíci žijí v `src/content/jokers.ts` (při velkém počtu rozdělených do `jokers-common.ts`,
`jokers-rare.ts`…, které `jokers.ts` jen re-exportuje). Jednoduchý žolík:

```ts
// src/content/jokers.ts
import type { JokerDef } from '../engine/content-types';

const OFFICE_CARDS = 3;
const OFFICE_XMULT = 1.5;

export const uredniHodiny: JokerDef = {
  id: 'uredni_hodiny',
  rarity: 'common',
  cost: 5, // podle tabulky cen v docs/DESIGN.md
  tags: ['xmult', 'hand'],
  params: { cards: OFFICE_CARDS, xmult: OFFICE_XMULT },
  hooks: {
    onHandPlayed: (ctx) => (ctx.played.length === OFFICE_CARDS ? { xmult: OFFICE_XMULT } : null),
  },
  art: { icon: 'stopwatch', bg: '#2b3a55', fg: '#f2e8c9', pattern: 'grid' },
};
```

Žolík s vnitřním stavem (počítadlo) a dynamickým popiskem:

```ts
import type { JokerDef } from '../engine/content-types';
import type { JokerInstance } from '../engine/types';

const CHRONICLE_MULT = 3;

function seenHands(self: JokerInstance): string[] {
  const v = self.state.seen;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export const kronikar: JokerDef = {
  id: 'kronikar',
  rarity: 'rare',
  cost: 7,
  tags: ['mult', 'scaling', 'hand'],
  params: { mult: CHRONICLE_MULT },
  initState: () => ({ seen: [] }),
  describe: (self) => ({ current: seenHands(self).length * CHRONICLE_MULT }),
  hooks: {
    beforeScoring: (ctx) => {
      if (ctx.isCopy) return;
      const seen = seenHands(ctx.self);
      if (!seen.includes(ctx.hand.type)) ctx.self.state.seen = [...seen, ctx.hand.type];
    },
    onHandPlayed: (ctx) => ({ mult: seenHands(ctx.self).length * CHRONICLE_MULT }),
  },
  art: { icon: 'quill-ink', bg: '#3b2f2a', fg: '#f4e4c1', accent: '#c8a24a', pattern: 'stripes' },
  unlock: { type: 'discover', category: 'jokers', count: 10 },
};
```

Kterým hookem co udělat (pořadí skórování viz `docs/ARCHITECTURE.md` 2.5):

| Hook                                                                                  | Kdy běží                              | Typické použití                            |
| ------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `passive`                                                                             | stále (čistá funkce)                  | +sloty, velikost ruky, Postupka ze 4 karet |
| `beforeScoring`                                                                       | po detekci kombinace, před skórováním | nabíjení počítadel, vylepšení kombinace    |
| `onCardScored` / `retriggerScored`                                                    | každá aktivace skórující karty        | +čipy/+mult za kartu, opakování karet      |
| `onCardHeld` / `retriggerHeld`                                                        | karty držené v ruce                   | efekty „v ruce“                            |
| `onHandPlayed`                                                                        | hlavní efekt po zahrání ruky          | +čipy, +mult, ×mult                        |
| `afterHandScored`                                                                     | po sečtení skóre                      | počítadla podle skóre, peníze              |
| `onDiscard`                                                                           | po zahození                           | efekty za zahozené karty                   |
| `onBlindSelect`, `onRoundStart`, `onRoundEnd`, `roundEndMoney`                        | průběh kola                           | peníze na konci kola, příprava             |
| `onShopEnter`, `onReroll`, `onSell`, `onBoosterOpened`, `onBoosterSkipped`            | Večerka                               | ekonomika, sběratelé                       |
| `onCardAdded`, `onCardDestroyed`, `onConsumableUsed`, `onBossDefeated`, `onSkipBlind` | události runu                         | reakce na změny balíčku a průběhu          |
| `copyTarget`                                                                          | kopírující žolíci                     | vrací `uid` kopírovaného žolíka            |

Další pole: `copyable: false` (nejde kopírovat), `noShop: true` (jen ze speciálních efektů),
`tags` (pro simulaci a filtry ve sbírce — vyber všechny, které sedí).

### 3.2 Texty

```ts
// src/i18n/cs/jokers.ts
export const jokers = {
  uredni_hodiny: {
    name: 'Úřední hodiny',
    desc: 'Když zahraješ přesně {cards} karty, ×{xmult} mult.',
    flavor: 'Po–St 8:00–11:30. V pátek nestránkový den.',
  },
  kronikar: {
    name: 'Kronikář',
    desc: 'Za každou kombinaci, kterou od koupě zahraješ poprvé, trvale +{mult} mult (teď +{current} mult).',
    flavor: 'Zapsal to do kroniky. Krasopisně a s chybou.',
  },
};
```

- `desc` = mechanika, `flavor` = hláška **bez uvozovek** (UI ji vysází kurzívou v „…“).
- Čísla dosazená do `{param}` se musí zobrazit česky (`×1,5`, `1 340`). Formátování zajišťuje
  `src/i18n/format.ts` — nikdy do textu nepiš `1.5` ani číslo bez formátování.
- Pevné číslo → slovo napiš rovnou ve správném tvaru („3 karty“) a při změně čísla tvar zkontroluj.
  Číslo, které se mění (stav, `describe`), skloňuj přes `plural()`.

### 3.3 Test

Každý žolík má aspoň jeden test — efekt nastane, když má, a nenastane, když nemá. U žolíků se stavem
navíc kopie (`isCopy`) a save/load. Testovací helpery (`tests/unit/helpers.ts`) vzniknou ve fázích 1–4;
schematicky:

```ts
// tests/unit/jokers/kronikar.test.ts
import { describe, expect, it } from 'vitest';
import { playHand, setupRun } from '../helpers';

describe('Kronikář', () => {
  it('za každou novou kombinaci přidá +3 mult', () => {
    const game = setupRun({ jokers: ['kronikar'], hand: ['AS', 'AH', 'KC', 'KD', '7S', '2H', '9C', '4D'] });
    expect(playHand(game, ['AS', 'AH']).jokerMult('kronikar')).toBe(3); // Dvojice poprvé
    expect(playHand(game, ['KC', 'KD']).jokerMult('kronikar')).toBe(3); // Dvojice podruhé — beze změny
  });

  it('kopie nenavyšuje počítadlo dvakrát', () => {
    /* … */
  });
  it('stav přežije uložení a načtení', () => {
    /* … */
  });
});
```

## 4. Jak přidat šéfa

```ts
// src/content/bosses.ts
import type { BossDef } from '../engine/content-types';

export const revizor: BossDef = {
  id: 'revizor',
  minAnte: 2,
  color: '#7a2e3a',
  hooks: {
    // první ruka kola bez ♦ („jízdenky“) neskóruje
    validateHand: (ctx) =>
      ctx.firstHand && !ctx.played.some((c) => ctx.api.hasSuit(c, 'D')) ? 'bosses.revizor.reject' : null,
  },
  art: { icon: 'ticket', bg: '#2d1b20', fg: '#f0d7a1', pattern: 'checker' },
};
```

- Jedno **jasné pravidlo** (`rule`), které se vejde do levého panelu jednou větou.
- `final: true` = finálový šéf jen pro patro 8 (a každé 8. patro nekonečného režimu) — těžší.
- `minAnte`, `targetMult` (default 2), `reward` (default 5) a `color` volitelně.
- Texty: `name`, `rule`, `intro` (hláška při příchodu), `defeat` (při porážce), `death` (hláška do
  „pitvy“, když na něm run skončí). Plus klíče vlastních zpráv (`bosses.revizor.reject`).

```ts
revizor: {
  name: 'Revizor',
  rule: 'První ruka kola bez kárové karty neskóruje.',
  intro: 'Dobrý den, přepravní kontrola. Jízdenky, prosím.',
  defeat: 'No dobře. Ale příště si to označte.',
  death: 'Pokuta na místě, nebo složenkou?',
  reject: 'Bez jízdenky? To bude pokuta.',
},
```

Test: pravidlo platí (ruka bez ♦ neskóruje, s ♦ ano) a po `disableBoss` přestane platit.

## 5. Jak přidat spotřebku

Tři typy, všechny `ConsumableDef` s `use(ctx)` a volitelným `canUse(ctx)`:

- **Pranostika** (`src/content/pranostiky.ts`, `kind: 'pranostika'`) — zvyšuje úroveň kombinace
  (`hand: 'full_house'`, v `use` volá `ctx.api.levelUpHand`). Na každou kombinaci jedna, název je
  parafráze skutečné pranostiky.
- **Babská rada** (`src/content/rady.ts`, `kind: 'rada'`) — mění hrací karty nebo dává drobný užitek.
  Cíle v ruce určuje `target: { min, max }`, v `use` je máš v `ctx.targets`.
- **Úřední razítko** (`src/content/razitka.ts`, `kind: 'razitko'`) — vzácné, silné, **s cenou**
  (každé razítko něco stojí: peníze, ruku, slot, kartu…).

```ts
export const hermankovyObklad: ConsumableDef = {
  id: 'hermankovy_obklad',
  kind: 'rada',
  cost: 3,
  target: { min: 1, max: 2 },
  use: (ctx) => {
    for (const card of ctx.targets) ctx.api.modifyCard(card.id, { enhancement: 'bonus' });
  },
  art: { icon: 'flower-pot', bg: '#33402a', fg: '#f6efc6', pattern: 'dots' },
};
```

Texty (`consumables.<id>`):

- Pranostika: **Svatý Martin** — Full house +1 úroveň. _Přijel na bílém koni, odjel s full housem._
- Babská rada: **Heřmánkový obklad** — Až 2 vybrané karty se stanou bonusovými. _Na všechno pomůže
  heřmánek. Na zbytek slivovice._
- Razítko: **Ověřená kopie** — Zdvojí vybraného žolíka; kopie se po 5 kolech rozpadne. _Kolek, okénko
  číslo 7, přijďte zítra._

Test: efekt na cílech, `canUse` při špatném počtu cílů vrací `false`, cena razítka se opravdu zaplatí.

## 6. Jak přidat kupón

Kupóny jsou **páry**: základ (`tier: 1`) a vylepšení (`tier: 2`, `requires: '<id základu>'`). Efekt je
trvalý na celý run — obvykle `passive` (delta `Modifiers`), jednorázové věci v `onRedeem`.

```ts
const DISCOUNT_BASE = 15;
const DISCOUNT_GOLD = 30;

export const vernostniKarta: VoucherDef = {
  id: 'vernostni_karta',
  tier: 1,
  cost: 10,
  params: { pct: DISCOUNT_BASE },
  passive: () => ({ shopDiscountPct: DISCOUNT_BASE }),
  art: { icon: 'ticket', bg: '#1f3b3a', fg: '#e8f1d4', pattern: 'dots' },
};

export const zlataVernostniKarta: VoucherDef = {
  id: 'zlata_vernostni_karta',
  tier: 2,
  requires: 'vernostni_karta',
  cost: 10,
  params: { pct: DISCOUNT_GOLD },
  // modifikátory se sčítají: 15 + 15 = 30 %
  passive: () => ({ shopDiscountPct: DISCOUNT_GOLD - DISCOUNT_BASE }),
  art: { icon: 'ticket', bg: '#3b2f12', fg: '#ffe9a8', pattern: 'rays' },
};
```

Text: **Věrnostní karta** — Všechno ve Večerce je o {pct} % levnější. _Desáté razítko a rohlík máš
zdarma._ Test: cena ve Večerce po uplatnění, tier 2 nejde koupit bez tier 1.

## 7. Jak přidat štítek

Štítek se dostane za přeskočení Malé nebo Velké útraty. Každý hook (`onAdded`, `onBlindSelect`,
`onRoundStart`, `onRoundEnd`, `onShopEnter`) vrací **`true`, když se štítek tím spotřeboval** (pak se
odebere). `passive` mění generování Večerky, dokud štítek trvá. `minAnte` = od kterého patra se nabízí.

```ts
const COASTER_MONEY = 8;

export const pivniTacek: TagDef = {
  id: 'pivni_tacek',
  params: { money: COASTER_MONEY },
  hooks: {
    onShopEnter: (ctx) => {
      ctx.api.addMoney(COASTER_MONEY, 'tag');
      return true;
    },
  },
  art: { icon: 'beer-stein', bg: '#3a2a14', fg: '#f7e7c3', pattern: 'waves' },
};
```

Text (`desc: 'Při příchodu do Večerky dostaneš {money}\u00a0Kč.'`): **Pivní tácek** — Při příchodu do
Večerky dostaneš 8 Kč. _Čárky se počítají až při placení._ Test: peníze přibudou a štítek zmizí.

## 8. Jak přidat balíček

### 8.1 Startovní balíček (`DeckDef`)

Každý balíček **mění pravidla** — jinak nemá důvod existovat. K dispozici: `buildDeck(rng)` (vlastní
složení), `passive` (delta `Modifiers`), `onRunStart` (startovní žolíci, spotřebky…),
`roundEndMoney`, `startingMoney`.

```ts
export const chalupar: DeckDef = {
  id: 'chalupar',
  passive: () => ({ jokerSlots: 1, discards: -1 }),
  art: { icon: 'house', bg: '#2f3d2a', fg: '#efe3c2', pattern: 'zigzag' },
  unlock: { type: 'winsTotal', count: 1 },
};
```

Text: **Chalupářský balíček** — +1 slot žolíka, ale −1 zahození v každém kole. _Na chalupě je pořád
co dělat, a proto se nic nedělá._ Test: modifikátory na začátku runu, vlastní složení balíčku.

### 8.2 Booster (`BoosterDef`)

Booster = balíček ve Večerce, ze kterého hráč vybírá. Určuje `kind` (`pranostika`, `rada`, `razitko`,
`joker`, `card`), `size`, `options` (kolik se nabídne), `picks` (kolik si vybrat), `cost`, `weight`.
Texty `boosters.<id>.name|desc` — v `desc` použij `plural()` pro počty.

## 9. Jak přidat výzvu

Výzva = předpřipravený run se zvláštními pravidly (`ChallengeDef`): `deckId`, `extraModifiers`,
`startingMoney`, `startingJokers`, `startingConsumables`, `startingVouchers`, `bannedJokers`,
`bannedVouchers`, `customDeck`, `onRunStart`. Každé zvláštní pravidlo výzvy má text v `ruleKeys`
(texty pod `challenges.<id>.rules.<klíč>`), aby ho hráč viděl na obrazovce výzev; pravidla, která
nejdou vyjádřit modifikátory ani zákazy, se vynucují v `onRunStart` nebo přes hooky.

```ts
export const tydenBezInternetu: ChallengeDef = {
  id: 'tyden_bez_internetu',
  deckId: 'red',
  extraModifiers: { shopCardSlots: -1, rerollCostStep: 2 },
  bannedVouchers: ['vernostni_karta'],
  ruleKeys: ['fewerSlots', 'pricierReroll', 'noLoyalty'],
  art: { icon: 'old-lantern', bg: '#1d2430', fg: '#dfe6f0', pattern: 'grid' },
};
```

Text: **Týden bez internetu** — Ve Večerce je o 1 slot karet méně, přehazování zdražuje rychleji
a věrnostní kartu nekoupíš. _Zkusíš, co dělali lidi dřív. Karban._ Test: run se založí s pravidly
výzvy a zakázané věci se neobjeví.

## 10. Jak přidat achievement

Achievementy přibudou ve fázi 8 v `src/content/achievements.ts`; typ `AchievementDef` vznikne
v `src/engine/meta/`. Plánovaný tvar (upřesní se ve fázi 8 a zapíše do DECISIONS):

```ts
// návrh
export interface AchievementDef {
  id: string;
  /** Podmínka nad profilem a statistikami (stejný typ jako odemykání)… */
  condition?: UnlockCondition;
  /** …nebo reakce na událost runu: vrátí true, když je splněno. */
  onEvent?(event: GameEvent, state: Readonly<RunState>): boolean;
  /** Skrytý, dokud ho hráč nezíská (ve sbírce jen „???“). */
  hidden?: boolean;
  /** Co se tím odemkne (žolík, balíček…). */
  unlocks?: { category: 'jokers' | 'decks' | 'vouchers' | 'consumables'; id: string }[];
  art: ArtSpec;
}
```

Texty `achievements.<id>.name|desc|flavor`. Příklad: **Ranní ptáče** — Vyhraj Malou útratu první
rukou. _…dál doskáče. Hlavně do večerky._ Název je pointa, popis je přesná podmínka. Test: splní se
přesně při podmínce a ne dřív.

## 11. Tón humoru

Shrnutí `CLAUDE.md` kap. 5 vlastními slovy:

- **Laskavá, suchá satira všedního Česka**, k tomu historie a internet. Smějeme se situacím, úřadům,
  zvykům a sobě — ne lidem, kteří se nemůžou bránit.
- **Pointa, ne vulgarita.** Výjimečné „sakra“ projde, nic silnějšího.
- **Archetypy místo skutečných lidí a značek**: pan starosta, teta z poradny, zahrádkář, influencerka,
  revizor, štamgast, večerka, diskont.
- **Vtip patří do názvu a flavoru, mechanika je vždy suchá a přesná.** Hráč musí z popisku pochopit
  efekt bez přemýšlení nad slovní hříčkou.
- **Mechanika sedí na téma.** Kronikář sbírá nové kombinace, Revizor chce „jízdenku“, Chalupář má víc
  místa a míň času.
- **Krátce.** Flavor je jedna hláška (ideálně do ~90 znaků). Nevysvětluj vtip a neopakuj pointu, kterou
  už má jiná položka.
- Reálie, ze kterých čerpat: pranostiky a přísloví, úřední čeština, hospoda a čárky na tácku, panelák,
  chata a chalupa, vlak a výluka, zabijačka, pouť, Silvestr, inventura, soused s vrtačkou, rivalita
  měst, pověsti (vodník, Golem, Blaník), dějiny (husité, Bílá hora, normalizace), Švejk jako literární
  postava, internetové memy převedené do češtiny.

Osvědčené vzorce (vlastní příklady formátu **Název** — mechanika. _Flavor._):

| Vzorec                            | Příklad                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Úřední čeština v absurdní situaci | **Přepážka č. 7** — Musíš zahrát přesně tolik karet, kolik ti zbývá rukou. _Tady jste špatně, to je o patro výš._           |
| Přísloví s twistem                | **Svatý Martin** — Full house +1 úroveň. _Přijel na bílém koni, odjel s full housem._                                       |
| Hospodská moudrost                | **Pivní tácek** — Ve Večerce dostaneš 8 Kč. _Čárky se počítají až při placení._                                             |
| Pověst a dějiny                   | **Vodník** — +1 mult za každou kartu zničenou v tomto runu. _Dušičky pod pokličkou. Jako koníček._                          |
| Domácí realita                    | **Tchyně na návštěvě** — Ruka bez srdcové karty nedá čipy z karet. _Neříkám, že to děláš špatně. Jen bych to dělala jinak._ |

## 12. Čeština a typografie

- **Všechny texty jen v `src/i18n`**, diakritika všude správně, hráči **tykáme**.
- **Uvozovky:** české „takhle“ (U+201E a U+201C), vnořené ‚takhle‘. Nikdy rovné `"` v textu pro hráče.
- **Nezlomitelná mezera (NBSP, U+00A0)** — v kódu ji piš jako ` `:
  - po jednopísmenných předložkách a spojkách: `k`, `s`, `v`, `z`, `o`, `u`, `a`, `i` („v ruce“),
  - v číslech jako oddělovač tisíců: `1 340 000`,
  - mezi číslem a jednotkou: `5 Kč`, `10 %`, `+30 čipů`.
- **Desetinná čárka**: `×1,5`, `2,5 Kč`. Znak násobení je `×` (U+00D7), ne písmeno `x`.
- **Velká čísla** nad 1e15 vědecky s čárkou: `1,23e16` (dělá `format.ts`).
- **Pomlčky:** rozsah bez mezer `2–4`, `Po–St`; větná pomlčka s mezerami `–`; zápor ve statickém textu
  `−1 zahození` (U+2212). Trojtečka `…` (U+2026).
- **Velká písmena:** v názvech jen první slovo a vlastní jména („Zlatá věrnostní karta“, „Svatý
  Martin“). Herní pojmy s velkým písmenem jako v UI: názvy kombinací (Dvojice, Full house), útrat
  (Malá útrata, Velká útrata, Šéf), Večerka. Figury a barvy v textu malými („za každého krále“, „kárová
  karta“).
- **Jednotky hry:** `+4 mult`, `×2 mult` („mult“ se neskloňuje), `+30 čipů`, peníze vždy `Kč`.
- **Skloňování:** kdekoli se proměnné číslo pojí se slovem, použij
  `plural(n, 'karta', 'karty', 'karet')` (1 / 2–4 / 0 a 5+):

| Slovo    | 1        | 2–4      | 0, 5+    |
| -------- | -------- | -------- | -------- |
| karta    | karta    | karty    | karet    |
| ruka     | ruka     | ruce     | rukou    |
| zahození | zahození | zahození | zahození |
| žolík    | žolík    | žolíci   | žolíků   |
| kolo     | kolo     | kola     | kol      |
| čip      | čip      | čipy     | čipů     |
| úroveň   | úroveň   | úrovně   | úrovní   |
| koruna   | koruna   | koruny   | korun    |
| patro    | patro    | patra    | pater    |

## 13. Zakázaný obsah

- **Nic z Balatra ani jiné komerční hry**: názvy (ani přeložené), texty, čísla, obrázky, ikony, hudba,
  zvuky. Inspirace mechanikou je v pořádku, ale ne kopie 1:1 se stejnými čísly a stejným tématem.
- **Žijící reální lidé** (jména, přezdívky, karikatury). Používej archetypy.
- **Skutečné značky, firmy, produkty a loga** (pivovary, obchodní řetězce, auta, aplikace…). Obecné
  pojmy (ležák, večerka, diskont, Pendolino jako typ vlaku) jsou v pořádku.
- **Josef Lada** — jeho díla jsou chráněná do konce roku 2027: žádné obrázky, žádné napodobování jeho
  stylu, žádné jeho postavy. Totéž pro další chráněné postavy a večerníčky (např. Krtek, Pat a Mat,
  Rumcajs, Spejbl a Hurvínek). Švejk jako Haškova literární postava ano, Ladovy ilustrace ne.
- Assety jen z povolených zdrojů s licencí v `ASSETS.md` (viz `CLAUDE.md` kap. 7) — žádné obrázky
  z vyhledávačů, Pinterestu, fanouškovských wiki ani Steamu.
- Žádné zesměšňování skupin lidí (národnost, víra, postižení, orientace), žádná stranická politika,
  žádné vtipy o skutečných tragédiích.

## 14. Checklist kvality položky

Před commitem projdi u každé nové položky:

- [ ] `id` unikátní, `snake_case`, ASCII; po vydání se nemění
- [ ] **Název** max. 3 slova, česky s diakritikou, velké jen první slovo a vlastní jména
- [ ] **Mechanika** = jedna přesná věta; všechna čísla přes `{param}` a **shodná s kódem** (konstanty)
- [ ] **Flavor** = jedna vtipná hláška, bez uvozovek, ideálně do ~90 znaků, pointa neopakuje jinou položku
- [ ] **Vzácnost** odpovídá síle (cílové hodnoty vzácností v `docs/DESIGN.md`)
- [ ] **Cena** podle tabulky v `docs/DESIGN.md`
- [ ] **Podmínka odemčení** (`unlock`) — tematická, nebo vědomě odemčeno od začátku
- [ ] **Art** (`ArtSpec`) — rozpoznatelný, ikona z povoleného zdroje se záznamem v `ASSETS.md`
- [ ] `tags` vyplněné (simulace, filtry ve sbírce)
- [ ] **Test**: efekt nastane / nenastane / hraniční případ; u stavu i `isCopy` a save/load
- [ ] Typografie: NBSP, české uvozovky, desetinná čárka, `×`, `plural()` u proměnných čísel
- [ ] Žádný zakázaný obsah (kap. 13)
- [ ] `npm test` zelené, `npm run simulate` neukazuje, že je položka bezcenná ani „auto-win“
- [ ] Commit `content: add <typ> <id>` (anglicky), větší změna čísel zapsaná do `docs/DESIGN.md`
