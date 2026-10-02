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

Spotřebky mají tři soubory podle `CLAUDE.md` kap. 2 (`pranostiky.ts`, `rady.ts`, `razitka.ts`);
`src/content/consumables.ts` je jen spojí do jednoho pole `CONSUMABLES` pro registr.

## 2. Společná pravidla pro všechny položky

- **`id`** — `snake_case`, jen ASCII, unikátní v rámci typu, **anglicky** jako ostatní identifikátory
  (`CLAUDE.md` kap. 1) a jako v `docs/DESIGN.md` (`beer_mat`, `office_hours`, `tax_audit`). Vlastní jména
  a česká slova bez překladu se píšou ASCII přepisem (`svejk`, `libuse`, `desitka`, `marias`). **Po vydání se
  `id` nikdy nemění** (ukládá se do savu a profilu); přejmenovává se jen text.
- **Čísla jen na jednom místě.** Hodnoty mechaniky dej do konstant a ty použij v `params` (pro popisek)
  i v hooku. Popisek čte čísla přes `{param}`, nikdy je nepiš do textu natvrdo.
- **Determinismus.** Náhoda výhradně přes `ctx.rng` nebo `ctx.chance(čitatel, jmenovatel)` (respektuje
  modifikátor pravděpodobností). Žádné `Math.random()`, `Date.now()` ani čtení z DOM.
- **Stav.** Hook smí měnit jen `ctx.self.state` (žolíci, štítky) a zbytek světa přes `ctx.api.*`.
  Stav musí být JSON-serializovatelný (čísla, řetězce, booleany, pole, prosté objekty).
- **Kopie.** Když hook běží s `ctx.isCopy === true` (kopírující žolík), **nesmí** měnit `self.state` —
  jinak by se počítadla navyšovala dvakrát. Engine to jistí i sám: `ctx.self` je pak kopie instance cíle (změny se
  zahodí), takže ji neporovnávej identitou (`===`) s instancemi ve `state.jokers` — pozici dává `ctx.index`.
  `ctx.self.uid` je i v kopii uid **cíle**: hook, který ničí sám sebe (`api.destroyJoker(ctx.self.uid)`), musí při
  `isCopy` skončit, jinak kopírující žolík zničí originál.
- **`passive` je čistá funkce.** Volá se kdykoli (i při dotazech UI) a nesmí nic měnit; `ctx.rng`/`ctx.chance` v ní
  pracují na kopii streamu (stav RNG se neposune). Totéž platí pro `ConsumableDef.canUse` a šéfův `modifyBase`
  v náhledu ruky. Objekt `ctx.mods` / `api.modifiers()` je zmrazený — pravidla měň deltou, ne zápisem do něj.
- **Čísla musí být konečná.** NaN z hooku engine ignoruje; nekonečno ve skórování ořízne na `Number.MAX_VALUE`,
  jinde (delty modifikátorů, peníze, odměny, příkazy API) ho ignoruje.
- **Modifikátory se skládají.** Delty `Modifiers` se sčítají (pole končící na `Mult` se násobí,
  booleany ORují) — `0` tedy neznamená „vypnout“, ale „beze změny“. Na „−1 zahození“ vrať `discards: -1`.
- **Žádné texty v obsahu.** Definice obsahuje jen i18n klíče (např. `message: 'jokers.chronicler.note'`).
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

const SHORT_ORDER_CARDS = 3;
const SHORT_ORDER_XMULT = 1.5;

export const shortOrder: JokerDef = {
  id: 'short_order',
  rarity: 'common',
  cost: 5, // podle tabulky cen v docs/DESIGN.md
  tags: ['xmult', 'hand'],
  params: { cards: SHORT_ORDER_CARDS, xmult: SHORT_ORDER_XMULT },
  hooks: {
    onHandPlayed: (ctx) => (ctx.played.length === SHORT_ORDER_CARDS ? { xmult: SHORT_ORDER_XMULT } : null),
  },
  art: { icon: 'stopwatch', bg: '#2b3a55', fg: '#f2e8c9', pattern: 'grid' },
};
```

Žolík s vnitřním stavem (počítadlo) a dynamickým popiskem:

```ts
import type { JokerDef } from '../engine/content-types';
import type { JokerInstance } from '../engine/types';

const CHRONICLE_MULT = 2;

function seenHands(self: JokerInstance): string[] {
  const v = self.state.seen;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export const chronicler: JokerDef = {
  id: 'chronicler',
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
  short_order: {
    name: 'Na minutku',
    desc: 'Když zahraješ přesně {cards} karty, ×{xmult} mult.',
    flavor: 'Hotovo za minutku. Minutka tu má dvacet minut.',
  },
  chronicler: {
    name: 'Kronikář',
    desc: 'Za každou kombinaci, kterou od jeho koupě zahraješ poprvé, trvale +{mult} mult (teď +{current} mult).',
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
navíc kopie (`isCopy`) a save/load. Testovací helpery jsou v `tests/unit/fixtures/registry.ts` (`makeRegistry`,
`makeGame`, `setupRound`, `play`, zápis karet `KH:mult@red~foil`); další přibudou s obsahem. Schematicky:

```ts
// tests/unit/jokers/chronicler.test.ts
import { describe, expect, it } from 'vitest';
import { playHand, setupRun } from '../helpers';

describe('Kronikář', () => {
  it('za každou novou kombinaci přidá +2 mult', () => {
    const game = setupRun({ jokers: ['chronicler'], hand: ['AS', 'AH', 'KC', 'KD', '7S', '2H', '9C', '4D'] });
    expect(playHand(game, ['AS', 'AH']).jokerMult('chronicler')).toBe(2); // Dvojice poprvé
    expect(playHand(game, ['KC', 'KD']).jokerMult('chronicler')).toBe(2); // Dvojice podruhé — beze změny
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

const MANDATORY_KIT_CARDS = 4;

// Šéf z rezervy pro patche (docs/DESIGN.md, příloha D).
export const mandatoryKit: BossDef = {
  id: 'mandatory_kit',
  minAnte: 2,
  color: '#7a2e3a',
  params: { cards: MANDATORY_KIT_CARDS },
  hooks: {
    // ruka s méně než 4 kartami neskóruje
    validateHand: (ctx) => (ctx.played.length < MANDATORY_KIT_CARDS ? 'bosses.mandatory_kit.reject' : null),
  },
  art: { icon: 'traffic-cone', bg: '#2d1b20', fg: '#f0d7a1', pattern: 'checker' },
};
```

- Jedno **jasné pravidlo** (`rule`), které se vejde do levého panelu jednou větou.
- `final: true` = finálový šéf jen pro patro 8 (a každé 8. patro nekonečného režimu) — těžší.
- `minAnte`, `targetMult` (default 2), `reward` (default 5) a `color` volitelně.
- Texty: `name`, `rule`, `intro` (hláška při příchodu), `defeat` (při porážce), `death` (hláška do
  „pitvy“, když na něm run skončí). Plus klíče vlastních zpráv (`bosses.mandatory_kit.reject`).
- Čísla v `rule` jen přes `{param}` z `params` (dosadí je `bossTexts` v UI i textový režim simulace) — číslo pravidla
  i textu je pak jedna konstanta, včetně násobku cíle u šéfů typu „jen vyšší cíl“.

```ts
mandatory_kit: {
  name: 'Povinná výbava',
  rule: 'Ruka s méně než {cards|plural:kartou,kartami,kartami} neskóruje.',
  intro: 'Silniční kontrola. Lékárničku, vestu a čtyři karty, prosím.',
  defeat: 'Výbava kompletní. Šťastnou cestu.',
  death: 'Bez povinné výbavy dál nepojedete.',
  reject: 'Chybí povinná výbava. Aspoň čtyři karty!',
},
```

Test: pravidlo platí (ruka ze 3 karet neskóruje, ze 4 ano) a po `disableBoss` přestane platit.

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
// src/content/rady.ts — Heřmánkový čaj (docs/DESIGN.md kap. 5.3)
export const chamomile: ConsumableDef = {
  id: 'chamomile',
  kind: 'rada',
  cost: 4,
  target: { min: 1, max: 3 },
  use: (ctx) => {
    for (const card of ctx.targets) ctx.api.modifyCard(card.id, { enhancement: 'bonus' });
  },
  art: { icon: 'flower-pot', bg: '#33402a', fg: '#f6efc6', pattern: 'dots' },
};
```

Texty (`consumables.<id>`):

- Pranostika: **Martin na koni** — Full house +1 úroveň. _Martin přijel na bílém koni a chalupa je plná._
- Babská rada: **Heřmánkový čaj** — Až 3 vybrané karty dostanou vylepšení Prémiová (+25 čipů). _Na všechno
  pomůže heřmánek._
- Razítko: **Ověřená kopie** — Zkopíruje žolíka nejvíc vlevo; všichni ostatní žolíci (kromě přibitých) se zničí.
  _Kopie souhlasí s originálem. Originály skartovány._

Test: efekt na cílech, `canUse` při špatném počtu cílů vrací `false`, cena razítka se opravdu zaplatí.

## 6. Jak přidat kupón

Kupóny jsou **páry**: základ (`tier: 1`) a vylepšení (`tier: 2`, `requires: '<id základu>'`). Efekt je
trvalý na celý run — obvykle `passive` (delta `Modifiers`), jednorázové věci v `onRedeem`.

```ts
const DISCOUNT_BASE = 20;
const DISCOUNT_GOLD = 40;

export const loyaltyCard: VoucherDef = {
  id: 'loyalty_card',
  tier: 1,
  cost: 10,
  params: { pct: DISCOUNT_BASE },
  passive: () => ({ shopDiscountPct: DISCOUNT_BASE }),
  art: { icon: 'ticket', bg: '#1f3b3a', fg: '#e8f1d4', pattern: 'dots' },
};

export const goldLoyalty: VoucherDef = {
  id: 'gold_loyalty',
  tier: 2,
  requires: 'loyalty_card',
  cost: 13,
  params: { pct: DISCOUNT_GOLD },
  // modifikátory se sčítají: 20 + 20 = 40 %
  passive: () => ({ shopDiscountPct: DISCOUNT_GOLD - DISCOUNT_BASE }),
  art: { icon: 'ticket', bg: '#3b2f12', fg: '#ffe9a8', pattern: 'rays' },
};
```

Text: **Věrnostní karta** — Všechno ve Večerce je o {pct} % levnější. _Sbíráte body? — Ne. — Tak je máte._
Test: cena ve Večerce po uplatnění, tier 2 nejde koupit bez tier 1.

Kupón, který má smysl jen za určitých podmínek, dostane `available(ctx)` — čistou funkci (bez RNG a změn stavu),
kterou engine kontroluje při losování kupónu patra i při koupi (Úřední škrt: `ctx.state.ante >= 2`). `passive` smí
číst stav (Rozkládací stůl: `ctx.state.round?.blind === 'boss'`); přepočítá se při každém `invalidate()` enginu
(výběr útraty, výplata, koupě, hooky…).

## 7. Jak přidat štítek

Štítek se dostane za přeskočení Malé nebo Velké útraty. Každý hook (`onAdded`, `onBlindSelect`,
`onRoundStart`, `onRoundEnd`, `onShopEnter`, `onRoundLost`) vrací **`true`, když se štítek tím spotřeboval** (pak se
odebere). `passive` mění pravidla, dokud štítek trvá (Šéf má chřipku: `bossTargetMult`). `minAnte` = od kterého
patra se nabízí.

- „Hned“ = `onAdded`; obálka zdarma přes `ctx.api.openBooster(boosterId('joker', 'jumbo'))` — engine ji otevře
  hned po přeskočení a zavřením se hráč vrátí na výběr útraty.
- „Příští Večerka“ = `onShopEnter`: nabídka je už vygenerovaná, uprav ji přes `api.addShopJoker`,
  `setShopJokerEdition`, `addShopVoucher`, `addFreeRerolls`.
- „Příští kolo“ = `onRoundStart` (ruka se dobere až po něm, `api.addRoundHandSize` platí hned).
- Peníze v rozpisu odměn = `roundEndMoney`; spotřebovat se dá v `onRoundEnd`, který běží až po rozpisu.

```ts
const COAT_CHANGE_MONEY = 6;

// Drobné v kabátě (docs/DESIGN.md kap. 7) — spotřebuje se hned po získání.
export const coatChange: TagDef = {
  id: 'coat_change',
  params: { money: COAT_CHANGE_MONEY },
  hooks: {
    onAdded: (ctx) => {
      ctx.api.addMoney(COAT_CHANGE_MONEY, 'tag');
      return true;
    },
  },
  art: { icon: 'wallet', bg: '#3a2a14', fg: '#f7e7c3', pattern: 'waves' },
};
```

Text (`desc: 'Dostaneš {money|money}.'`): **Drobné v kabátě** — Dostaneš 6 Kč. _Z loňské zimy, ještě
s účtenkou._ Test: peníze přibudou a štítek zmizí.

## 8. Jak přidat balíček

### 8.1 Startovní balíček (`DeckDef`)

Každý balíček **mění pravidla** — jinak nemá důvod existovat. K dispozici: `buildDeck(rng)` (vlastní
složení), `passive` (delta `Modifiers`), `onRunStart` (startovní žolíci, spotřebky…),
`roundEndMoney`, `startingMoney`.

```ts
export const cottage: DeckDef = {
  id: 'cottage',
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
export const offlineWeek: ChallengeDef = {
  id: 'offline_week',
  deckId: 'pub',
  extraModifiers: { shopCardSlots: -1, rerollCostStep: 2 },
  bannedVouchers: ['loyalty_card'],
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

Texty `achievements.<id>.name|desc|flavor`. Příklad (docs/DESIGN.md kap. 11.2): **Jednou ranou** — Poraz
šéfa první rukou. _Sedm jich bylo. Šéf jen jeden._ Název je pointa, popis je přesná podmínka. Test: splní se
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
- **Mechanika sedí na téma.** Kronikář sbírá nové kombinace, Povinná výbava chce „čtyři karty jako
  lékárničku“, Chalupář má víc místa a míň času.
- **Krátce.** Flavor je jedna hláška (ideálně do ~90 znaků). Nevysvětluj vtip a neopakuj pointu, kterou
  už má jiná položka.
- Reálie, ze kterých čerpat: pranostiky a přísloví, úřední čeština, hospoda a čárky na tácku, panelák,
  chata a chalupa, vlak a výluka, zabijačka, pouť, Silvestr, inventura, soused s vrtačkou, rivalita
  měst, pověsti (vodník, Golem, Blaník), dějiny (husité, Bílá hora, normalizace), Švejk jako literární
  postava, internetové memy převedené do češtiny.

Osvědčené vzorce (vlastní příklady formátu **Název** — mechanika. _Flavor._):

| Vzorec                            | Příklad                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Úřední čeština v absurdní situaci | **Přepážka č. 7** — Musíš zahrát přesně tolik karet, kolik ti zbývá rukou. _Tady jste špatně, to je o patro výš._                         |
| Přísloví s twistem                | **Martin na koni** — Full house +1 úroveň. _Martin přijel na bílém koni a chalupa je plná._                                               |
| Hospodská moudrost                | **Pivní tácek** — +10 čipů a +2 mult. _Každá čárka se počítá._                                                                            |
| Pověst a dějiny                   | **Vodník** — Každá zahozená kárová karta mu trvale dá +1 mult. _Dušičky pod pokličkou. Jako koníček._                                     |
| Domácí realita                    | **Tchyně na návštěvě** — Každé zahození ti navíc zahodí 1 náhodnou kartu z ruky. _Neříkám, že to děláš špatně. Jen bych to dělala jinak._ |

## 12. Čeština a typografie

- **Všechny texty jen v `src/i18n`**, diakritika všude správně, hráči **tykáme**.
- **Rodově neutrálně:** hráč může být kdokoli, takže žádný minulý čas ani přídavná jména v 2. osobě
  („jsi zahrál“, „kdybys dupal“, „jsi hrdý“). Použij rozkazovací způsob, přítomný/budoucí čas nebo neosobní
  tvar: „Dokud se v tomto kole nezahazovalo…“, „Zatím se ti neukázal.“ Postavy (šéfové, žolíci) mluví, jak chtějí.
- Předložka **s/z** se před slovem na s-, z-, š-, ž- vokalizuje: „se žolíky“, „ze stolu“, „se sekerou“.
- **Uvozovky:** české „takhle“ (U+201E a U+201C), vnořené ‚takhle‘. Nikdy rovné `"` v textu pro hráče.
- **Nezlomitelná mezera (NBSP, U+00A0)** — v kódu ji piš jako `\u00a0` (nikdy jako neviditelný znak):
  - po jednopísmenných předložkách a spojkách: `k`, `s`, `v`, `z`, `o`, `u`, `a`, `i` („v ruce“),
  - v číslech jako oddělovač tisíců: `1 340 000`,
  - mezi číslem a jednotkou: `5 Kč`, `10 %`, `+30 čipů`,
  - před větnou pomlčkou (pomlčka nesmí začínat řádek).
    `t()` to doplní automaticky (`typo()` v `src/i18n/format.ts`: jednopísmenná slova, číslo + slovo/jednotka,
    mezera před `–`) a čísla z `{param}` formátuje `format.ts` — v textech tedy stačí obyčejné mezery.
- **Desetinná čárka**: `×1,5`, `2,5 Kč`. Znak násobení je `×` (U+00D7), ne písmeno `x`.
- **Velká čísla** nad 1e15 vědecky s čárkou: `1,23e16` (dělá `format.ts`).
- **Pomlčky:** rozsah bez mezer `2–4`, `Po–St`; větná pomlčka je **krátká** `–` (U+2013) s mezerami — dlouhá
  `—` (U+2014) se v české sazbě nepoužívá a v textech hry být nesmí (hlídá to `tests/unit/i18n.test.ts`);
  zápor ve statickém textu `−1 zahození` (U+2212). Trojtečka `…` (U+2026). (Dokumentace v `docs/` smí `—` používat.)
- **Velká písmena:** v názvech jen první slovo a vlastní jména („Zlatá věrnostní“, „Martin na koni“,
  „Svatý Václav“). Herní pojmy s velkým písmenem jako v UI: názvy kombinací (Dvojice, Full house), útrat
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
- [ ] Typografie: NBSP, české uvozovky, krátká pomlčka, desetinná čárka, `×`, `plural()` u proměnných čísel
- [ ] Hráč je oslovený rodově neutrálně (žádné „jsi zahrál“)
- [ ] Žádný zakázaný obsah (kap. 13)
- [ ] `npm test` zelené, `npm run simulate` neukazuje, že je položka bezcenná ani „auto-win“
- [ ] Commit `content: add <typ> <id>` (anglicky), větší změna čísel zapsaná do `docs/DESIGN.md`
