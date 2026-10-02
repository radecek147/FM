/**
 * Startovní balíčky (src/content/decks.ts) podle docs/DESIGN.md kap. 9 — všech 12: pravidla přesně podle tabulky,
 * texty, podmínky odemčení, startovní kupóny (`DeckDef.startingVouchers`) a dohratelnost botem.
 */
import { describe, expect, it } from 'vitest';
import { almanacHand, DECKS } from '../../src/content/decks';
import { buildRegistry } from '../../src/content/index';
import type { BaseCtx, VoucherDef } from '../../src/engine/content-types';
import { BASE_MODIFIERS } from '../../src/engine/effects/modifiers';
import { Game } from '../../src/engine/run/game';
import { deserializeRun, serializeRun } from '../../src/engine/save/save';
import { createBot, simSeed, simulateRun } from '../../src/engine/sim';
import type { Card, GameEvent, HandType, Modifiers, RunState } from '../../src/engine/types';
import { HAND_TYPES, RANKS, SUITS } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { typo } from '../../src/i18n/format';
import { ART, makeRegistry, selectBoss, setupRound, winNextHand } from './fixtures/registry';

const reg = buildRegistry();

function newGame(deckId: string, seed = 'DECKTEST'): Game {
  return Game.newRun({ seed, deckId, stake: 1 }, reg);
}

function modsDiff(deckId: string): Partial<Modifiers> {
  const m = newGame(deckId).modifiers();
  const out: Partial<Modifiers> = {};
  for (const key of Object.keys(BASE_MODIFIERS) as (keyof Modifiers)[]) {
    if (m[key] !== BASE_MODIFIERS[key]) (out as Record<string, unknown>)[key] = m[key];
  }
  return out;
}

const composition = (deck: readonly Card[]) =>
  deck.map((c) => `${c.rank}${c.suit}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe('balíčky – seznam a texty', () => {
  it('id podle DESIGN kap. 9, Hospodský první', () => {
    expect(DECKS.map((d) => d.id)).toEqual([
      'pub',
      'regulars',
      'clerk',
      'tourist',
      'marias',
      'court',
      'notary',
      'nouveau_riche',
      'debtor',
      'grandmas',
      'junk_shop',
      'almanac',
    ]);
    expect(DECKS[0]!.unlock).toBeUndefined();
    expect(DECKS.find((d) => d.id === 'regulars')!.unlock).toBeUndefined();
  });

  it('každý balíček má název, popis a flavor; čísla v popisku jdou z params', () => {
    const flavors: Record<string, string> = {
      pub: 'Lepkavé karty a tácek pod sklenicí.',
      regulars: 'Má tu vlastní věšák. Na žolíky.',
      tourist: 'Po červené, pak po modré, pak se ztratit.',
      marias: 'Kdo nehraje, nevyhraje. Kdo hraje, flekuje.',
      court: 'Samí páni, žádní pěšáci.',
      notary: 'Ověřeno, orazítkováno, zaplombováno.',
      nouveau_riche: 'Peníze jsou, čas není.',
      debtor: 'Půjčka? Já? Jen na chvilku.',
      clerk: 'Všechno vyřízeno předem. Na razítko.',
      grandmas: 'Babička ví všechno. A ráda to řekne.',
      junk_shop: 'Všechno z druhé ruky, něco i ze třetí.',
      almanac: 'Pranostika na každý den, i na ty, kdy se nehraje.',
    };
    for (const d of DECKS) {
      for (const field of ['name', 'desc', 'flavor'])
        expect(hasKey(`decks.${d.id}.${field}`), `${d.id}.${field}`).toBe(true);
      expect(t(`decks.${d.id}.name`).split(/\s+/).length).toBeLessThanOrEqual(3);
      const raw = t(`decks.${d.id}.desc`);
      for (const m of raw.matchAll(/\{(\w+)/g))
        expect(d.params ?? {}, `${d.id}: {${m[1]}}`).toHaveProperty(m[1]!);
      expect(t(`decks.${d.id}.desc`, d.params ?? {})).not.toMatch(/[{}⟦]/);
      expect(t(`decks.${d.id}.flavor`)).toBe(typo(flavors[d.id]!));
    }
    expect(t('decks.debtor.desc', DECKS.find((d) => d.id === 'debtor')!.params)).toContain('−10 Kč');
    expect(t('decks.court.desc', DECKS.find((d) => d.id === 'court')!.params)).toContain('×2,1');
    expect(t('decks.marias.desc', DECKS.find((d) => d.id === 'marias')!.params)).toContain(
      'cíle všech útrat jsou ×1,2',
    );
    expect(t('decks.grandmas.desc', DECKS.find((d) => d.id === 'grandmas')!.params)).toContain(
      typo('o 1 slot víc. Na startu dostaneš 1 náhodnou babskou radu'),
    );
    expect(t('decks.junk_shop.desc', DECKS.find((d) => d.id === 'junk_shop')!.params)).toContain(
      typo('o 1 kartový slot méně'),
    );
    const almanac = t('decks.almanac.desc', DECKS.find((d) => d.id === 'almanac')!.params);
    expect(almanac).toContain(typo('dostaneš 2 Kč'));
    expect(almanac).toContain(typo('o 2 zahození méně'));
    expect(t('decks.almanac.full', { money: 2 })).toContain(typo('2 Kč'));
    expect(hasKey('decks.almanac.made')).toBe(true);
  });

  it('Úřednický: popisek jmenuje přesně startovní kupóny (názvy z textů kupónů)', () => {
    const clerk = DECKS.find((d) => d.id === 'clerk')!;
    expect(clerk.startingVouchers).toEqual(['tear_calendar', 'counter_buddy']);
    const desc = t('decks.clerk.desc');
    for (const v of clerk.startingVouchers!) {
      expect(reg.vouchers[v], v).toBeDefined();
      expect(desc).toContain(t(`vouchers.${v}.name`));
    }
  });

  it('podmínky odemčení podle DESIGN kap. 9 (od začátku jen Hospodský a Štamgastův)', () => {
    const unlocks = Object.fromEntries(DECKS.map((d) => [d.id, d.unlock ?? null]));
    expect(unlocks).toEqual({
      pub: null,
      regulars: null,
      clerk: { type: 'custom', id: 'vouchersBought5' },
      tourist: { type: 'playHand', hand: 'straight', count: 25 },
      marias: { type: 'playHand', hand: 'four' },
      court: { type: 'winRun', deck: 'marias' },
      notary: { type: 'custom', id: 'sealedCardsInRun' },
      nouveau_riche: { type: 'haveMoney', atLeast: 50 },
      debtor: { type: 'custom', id: 'roundEndInDebt' },
      grandmas: { type: 'custom', id: 'radyUsed30' },
      junk_shop: { type: 'custom', id: 'jokersSold25' },
      almanac: { type: 'custom', id: 'handLevel6' },
    });
  });

  it('obálky balíčků mají každá jinou ikonu', () => {
    const icons = DECKS.map((d) => d.art.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('balíčky – pravidla', () => {
  it('Hospodský: standardních 52 karet, pravidla beze změny, start s 5 Kč', () => {
    const g = newGame('pub');
    expect(g.state.deck).toHaveLength(52);
    expect(new Set(g.state.deck.map((c) => `${c.rank}${c.suit}`)).size).toBe(52);
    expect(g.state.deck.every((c) => !c.enhancement && !c.seal && !c.edition)).toBe(true);
    expect(modsDiff('pub')).toEqual({});
    expect(g.state.money).toBe(5);
  });

  it('Štamgastův: +1 slot žolíka (6), start s 0 Kč', () => {
    expect(modsDiff('regulars')).toEqual({ jokerSlots: 6 });
    expect(newGame('regulars').state.money).toBe(0);
    expect(newGame('regulars').state.deck).toHaveLength(52);
  });

  it('Turistický: Postupka i Barva ze 4 karet, cíle ×1,5', () => {
    expect(modsDiff('tourist')).toEqual({ fourCardStraightFlush: true, targetMult: 1.5 });
    const g = newGame('tourist');
    expect(g.blindTarget('small')).toBe(380);
    expect(g.blindTarget('boss')).toBe(750);
    const cards = setupRound(g, '2H 7H 9H KH 3S');
    expect(g.preview(cards.slice(0, 4).map((c) => c.id)).hand?.type).toBe('flush');
    const run = setupRound(g, '5C 6D 7S 8H KD');
    expect(g.preview(run.slice(0, 4).map((c) => c.id)).hand?.type).toBe('straight');
  });

  it('Mariášový: 32 karet 7–A ve 4 barvách, Postupka A-2-3-4-5 nejde, cíle ×1,2', () => {
    const g = newGame('marias');
    expect(g.state.deck).toHaveLength(32);
    const expected = SUITS.flatMap((s) => RANKS.filter((r) => r >= 7).map((r) => `${r}${s}`));
    expect(composition(g.state.deck)).toEqual([...expected].sort());
    expect(g.state.deck.some((c) => c.rank < 7)).toBe(false);
    expect(modsDiff('marias')).toEqual({ targetMult: 1.2 });
    expect([g.blindTarget('small'), g.blindTarget('big'), g.blindTarget('boss')]).toEqual([300, 450, 600]);
  });

  it('Obrázkový: 32 karet J–A, každá 2×; 7 karet v ruce; cíle ×2,1', () => {
    const g = newGame('court');
    expect(g.state.deck).toHaveLength(32);
    const counts = new Map<string, number>();
    for (const c of g.state.deck)
      counts.set(`${c.rank}${c.suit}`, (counts.get(`${c.rank}${c.suit}`) ?? 0) + 1);
    expect(counts.size).toBe(16);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(g.state.deck.every((c) => c.rank >= 11)).toBe(true);
    expect(modsDiff('court')).toEqual({ handSize: 7, targetMult: 2.1 });
    expect(g.blindTarget('small')).toBe(530);
    g.dispatch({ type: 'selectBlind' });
    expect(g.state.round!.hand).toHaveLength(7);
  });

  it('Notářský: −1 slot spotřebky, ~6 % karet s náhodnou pečetí, deterministicky podle seedu', () => {
    expect(modsDiff('notary')).toEqual({ consumableSlots: 1 });
    const a = newGame('notary', 'NOTARY1');
    const b = newGame('notary', 'NOTARY1');
    expect(a.state.deck).toEqual(b.state.deck);
    expect(a.state.deck).toHaveLength(52);
    let sealed = 0;
    let total = 0;
    const kinds = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const deck = newGame('notary', `NOTARY${i}`).state.deck;
      total += deck.length;
      for (const c of deck)
        if (c.seal) {
          sealed++;
          kinds.add(c.seal);
        }
    }
    expect(sealed / total).toBeGreaterThan(0.04);
    expect(sealed / total).toBeLessThan(0.08);
    expect([...kinds].sort()).toEqual(Object.keys(reg.seals).sort());
  });

  it('Zbohatlík: odměny ×2, úrok ×1,5, nevyužitá ruka o 1 Kč víc, 2 ruce', () => {
    expect(modsDiff('nouveau_riche')).toEqual({
      hands: 2,
      blindRewardMult: 2,
      interestMult: 1.5,
      moneyPerUnusedHand: 2,
    });
    const g = newGame('nouveau_riche');
    g.dispatch({ type: 'selectBlind' });
    expect(g.state.round!.handsLeft).toBe(2);
    winNextHand(g);
    g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] });
    const r = g.state.rewards!;
    expect(r.blindReward).toBe(6);
    expect(r.unusedHands).toBe(2);
    // Úrok 1 Kč × 1,5 = 1,5 → dolů na celé koruny.
    expect(r.interest).toBe(1);
  });

  it('Dlužník: start −10 Kč, dluh do −20 Kč, úrok ×2 jen z kladného zůstatku', () => {
    expect(modsDiff('debtor')).toEqual({ debtLimit: 20, interestMult: 2 });
    const g = newGame('debtor');
    expect(g.state.money).toBe(-10);
    g.dispatch({ type: 'selectBlind' });
    winNextHand(g);
    g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] });
    expect(g.state.rewards!.interest).toBe(0);
    const rich = newGame('debtor');
    rich._core.state.money = 12;
    rich.dispatch({ type: 'selectBlind' });
    winNextHand(rich);
    rich.dispatch({ type: 'play', cardIds: [rich.state.round!.hand[0]!] });
    expect(rich.state.rewards!.interest).toBe(4);
  });
});

// ─────────────────────────── Balíčky fáze 7 ───────────────────────────

/** Vyhraje aktuální útratu (cíl 1, zahraje první kartu) a vrátí události hry. */
function winCurrent(g: Game): GameEvent[] {
  if (g.state.phase === 'blind_select') g.dispatch({ type: 'selectBlind' });
  winNextHand(g);
  const res = g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] });
  if (!res.ok) throw new Error(`play: ${res.error}`);
  return res.events;
}

/** Porazí šéfa bez pravidla (Šanon na šanonu — jen vyšší cíl) jednou kartou a vrátí události hry. */
function beatBoss(g: Game): GameEvent[] {
  selectBoss(g, 'binder_tower');
  const cards = setupRound(g, 'KS');
  winNextHand(g);
  const res = g.dispatch({ type: 'play', cardIds: [cards[0]!.id] });
  if (!res.ok) throw new Error(`play: ${res.error}`);
  return res.events;
}

const pranostikaHand = (defId: string): HandType | undefined => reg.consumables[defId]?.hand;

describe('balíčky fáze 7 – pravidla', () => {
  it('Úřednický: start s kupóny Trhací kalendář a Kamarád za pultem (zdarma, s jejich efekty)', () => {
    const g = newGame('clerk');
    expect(g.state.vouchers).toEqual(['tear_calendar', 'counter_buddy']);
    expect(g.state.money).toBe(5);
    expect(g.state.deck).toHaveLength(52);
    expect(modsDiff('clerk')).toEqual({ rerollBaseCost: 3, shopWeightPranostika: 7, shopWeightRada: 7 });
    // Kupón patra nikdy nenabídne to, co už balíček dal.
    for (let i = 0; i < 30; i++) {
      const offered = newGame('clerk', `CLERK${i}`).state.anteVouchers;
      expect(offered).not.toContain('counter_buddy');
      expect(offered).not.toContain('tear_calendar');
    }
    // Uložení a načtení: kupóny zůstanou, pravidla také.
    const loaded = Game.fromState(deserializeRun(serializeRun(g.state as RunState)), reg);
    expect(loaded.state.vouchers).toEqual(['tear_calendar', 'counter_buddy']);
    expect(loaded.modifiers()).toEqual(g.modifiers());
  });

  it('Babiččin: +1 slot spotřebky (3), start s 1 náhodnou babskou radou, deterministicky podle seedu', () => {
    expect(modsDiff('grandmas')).toEqual({ consumableSlots: 3 });
    const a = newGame('grandmas', 'GRANNY1');
    expect(a.state.consumables.map((c) => c.defId)).toEqual(
      newGame('grandmas', 'GRANNY1').state.consumables.map((c) => c.defId),
    );
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const g = newGame('grandmas', `GRANNY${i}`);
      const ids = g.state.consumables.map((c) => c.defId);
      expect(ids).toHaveLength(1);
      for (const id of ids) {
        expect(reg.consumables[id]!.kind).toBe('rada');
        expect(reg.consumables[id]!.noShop).not.toBe(true);
        seen.add(id);
      }
      expect(g.state.consumables.every((c) => c.edition === null)).toBe(true);
    }
    // Rady se losují z celé nabídky, ne pořád ty samé.
    expect(seen.size).toBeGreaterThanOrEqual(12);
    // Třetí slot zůstává volný.
    const g = newGame('grandmas');
    expect(g.state.consumables.length).toBeLessThan(g.modifiers().consumableSlots);
  });

  it('Vetešnický: start s 1 náhodným vzácným žolíkem (bez edice a nálepek i na Imperialu), Večerka s 1 kartovým slotem', () => {
    expect(modsDiff('junk_shop')).toEqual({ shopCardSlots: 1 });
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const g = Game.newRun({ seed: `JUNK${i}`, deckId: 'junk_shop', stake: i % 2 ? 8 : 1 }, reg);
      expect(g.state.jokers).toHaveLength(1);
      const j = g.state.jokers[0]!;
      expect(reg.jokers[j.defId]!.rarity).toBe('rare');
      expect(j.edition).toBeNull();
      expect(j.stickers).toEqual([]);
      seen.add(j.defId);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
    const a = newGame('junk_shop', 'JUNKSAME');
    expect(a.state.jokers.map((j) => j.defId)).toEqual(
      newGame('junk_shop', 'JUNKSAME').state.jokers.map((j) => j.defId),
    );
    // Večerka: jeden kartový slot (položky navíc ze štítků se nepočítají), obálky beze změny.
    const g = newGame('junk_shop');
    winCurrent(g);
    g.dispatch({ type: 'cashOut' });
    expect(g.state.phase).toBe('shop');
    expect(g.state.shop!.items.filter((it) => !it.extra)).toHaveLength(1);
    expect(g.state.shop!.boosters).toHaveLength(newGame('pub').modifiers().shopBoosterSlots);
  });

  it('Kalendářový: −2 zahození (1); po porážce šéfa pranostika nejčastěji hrané kombinace (při shodě silnější)', () => {
    expect(modsDiff('almanac')).toEqual({ discards: 1 });
    const g = newGame('almanac');
    g.dispatch({ type: 'selectBlind' });
    expect(g.state.round!.discardsLeft).toBe(1);
    // Malá útrata nic nevytvoří.
    winCurrent(g);
    expect(g.state.consumables).toEqual([]);
    g.dispatch({ type: 'cashOut' });
    g.dispatch({ type: 'leaveShop' });
    const s = g._core.state;
    s.handLevels.pair.played = 3;
    s.handLevels.flush.played = 3;
    s.handLevels.two_pair.played = 2;
    const events = beatBoss(g);
    expect(g.state.consumables).toHaveLength(1);
    expect(g.state.consumables[0]!.edition).toBeNull();
    expect(pranostikaHand(g.state.consumables[0]!.defId)).toBe('flush');
    expect(events).toContainEqual({ type: 'message', key: 'decks.almanac.made' });
  });

  it('Kalendářový: bez volného slotu spotřebky dá místo pranostiky 2 Kč', () => {
    const g = newGame('almanac');
    g._core.api.createConsumable({ kind: 'rada' });
    g._core.api.createConsumable({ kind: 'rada' });
    expect(g.state.consumables).toHaveLength(g.modifiers().consumableSlots);
    const before = g.state.consumables.map((c) => c.defId);
    const money = g.state.money;
    const events = beatBoss(g);
    expect(g.state.consumables.map((c) => c.defId)).toEqual(before);
    // Peníze hned (rozpis odměn se vyplácí až po „Vyúčtovat“).
    expect(g.state.money).toBe(money + 2);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'moneyChanged', delta: 2, reason: 'deck' }),
    );
    expect(events).toContainEqual({ type: 'message', key: 'decks.almanac.full', params: { money: 2 } });
  });

  it('Kalendářový: výběr kombinace — nejčastější, při shodě silnější, bez zahrané ruky Vysoká karta', () => {
    const ctxWith = (played: Partial<Record<HandType, number>>): BaseCtx => {
      const handLevels = Object.fromEntries(
        HAND_TYPES.map((h) => [h, { level: 1, played: played[h] ?? 0 }]),
      ) as RunState['handLevels'];
      return { state: { handLevels } } as unknown as BaseCtx;
    };
    expect(almanacHand(ctxWith({}))).toBe('high_card');
    expect(almanacHand(ctxWith({ pair: 4, flush: 2 }))).toBe('pair');
    expect(almanacHand(ctxWith({ pair: 2, flush: 2, high_card: 2 }))).toBe('flush');
    // Tajná kombinace jen tehdy, když ji hráč zahrál (`played` > 0 znamená objevená).
    expect(almanacHand(ctxWith({ five: 3, four: 3 }))).toBe('five');
  });
});

describe('DeckDef.startingVouchers (engine)', () => {
  const order: string[] = [];
  const voucher: VoucherDef = {
    id: 'stamp',
    tier: 1,
    cost: 5,
    passive: () => ({ hands: 1 }),
    onRedeem: () => void order.push('redeem'),
    art: ART,
  };
  const testReg = makeRegistry({
    vouchers: [voucher],
    decks: [
      {
        id: 'stamped',
        startingVouchers: ['stamp', 'stamp', 'unknown_voucher'],
        onRunStart: () => void order.push('deck'),
        art: ART,
      },
    ],
    challenges: [{ id: 'stamp_twice', deckId: 'stamped', startingVouchers: ['stamp'], art: ART }],
  });

  it('kupóny se uplatní na startu před `onRunStart` balíčku, každý jednou, neznámý se přeskočí', () => {
    order.length = 0;
    const g = Game.newRun({ seed: 'STAMP', deckId: 'stamped', stake: 1 }, testReg);
    expect(g.state.vouchers).toEqual(['stamp']);
    expect(order).toEqual(['redeem', 'deck']);
    expect(g.modifiers().hands).toBe(BASE_MODIFIERS.hands + 1);
    expect(g.state.money).toBe(5);
  });

  it('výzva se stejným startovním kupónem ho neuplatní podruhé', () => {
    order.length = 0;
    const g = Game.newRun(
      { seed: 'STAMP', deckId: 'stamped', stake: 1, challengeId: 'stamp_twice' },
      testReg,
    );
    expect(g.state.vouchers).toEqual(['stamp']);
    expect(order).toEqual(['redeem', 'deck']);
  });
});

describe('balíčky – dohratelnost botem', () => {
  // Každý balíček na Desítce: bot `max` doběhne bez neplatné akce a do 12 seedů aspoň jednou vyhraje.
  it.each(DECKS.map((d) => [d.id]))(
    '%s: run jde dohrát do výhry',
    (deckId) => {
      const bot = createBot('max');
      let won: string | null = null;
      for (let i = 1; i <= 12 && !won; i++) {
        const r = simulateRun(reg, { seed: simSeed('DECKWIN', i), deckId, stake: 1, bot });
        expect(r.invalidActions, `${deckId} ${r.seed}`).toBe(0);
        expect(r.cause, `${deckId} ${r.seed}`).not.toBe('actionLimit');
        expect(r.deckId).toBe(deckId);
        if (r.won) won = r.seed;
      }
      expect(won, deckId).not.toBeNull();
    },
    120_000,
  );
});
