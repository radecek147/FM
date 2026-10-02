/**
 * Výzvy (docs/DESIGN.md kap. 11.1): 20 výzev v pořadí tabulky, odemykání po 1/3/6/10 výhrách, texty, start runu,
 * pravidla každé výzvy a dohratelnost botem bez neplatných akcí. Obecná pravidla enginu (bez konkrétního obsahu)
 * hlídá tests/unit/challenge-rules.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  CHALLENGES,
  END_OF_WORLD_FINAL_ANTE,
  MICRO_FLAT_HAND_SIZE,
  seasonSuit,
} from '../../src/content/challenges';
import { MARIAS_TARGET_MULT } from '../../src/content/decks';
import { buildRegistry, validateRegistry } from '../../src/content/index';
import type { NewRunOptions } from '../../src/engine/content-types';
import { MSG, RENTAL_BUY_PRICE } from '../../src/engine/constants';
import { Game } from '../../src/engine/run/game';
import { blindTarget } from '../../src/engine/run/targets';
import { createBot, simSeed, simulateRun } from '../../src/engine/sim';
import { eligibleVouchers, generateShop } from '../../src/engine/shop/shop';
import type { ActionResult, GameEvent, HandType, Suit } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { challengeTexts, enhancementTexts } from '../../src/ui/describe';

const REG = buildRegistry();

/** Pořadí výzev = DESIGN 11.1 (po pěticích podle obtížnosti). */
const ORDER = [
  'greenhouse',
  'christmas_carp',
  'flat_price',
  'svejk_anabasis',
  'express',
  'marias_party',
  'minimalist',
  'big_bang',
  'border_casino',
  'micro_flat',
  'candlelight',
  'four_seasons',
  'quarry',
  'short_memory',
  'bureaucracy',
  'straight_to_boss',
  'lifelong_wedding',
  'costume_rental',
  'dry_february',
  'end_of_world',
];

function ok(res: ActionResult): GameEvent[] {
  if (!res.ok) throw new Error(`akce selhala: ${res.error}`);
  return res.events;
}

/** Run výzvy — s „cizím“ balíčkem a silou piva, které výzva musí přebít. */
function run(id: string, opts: Partial<NewRunOptions> = {}): Game {
  return Game.newRun({ seed: 'CHALLENGE', deckId: 'court', stake: 5, challengeId: id, ...opts }, REG);
}

/** Otevře čerstvou Večerku (fáze shop). */
function openShop(g: Game, money = 200): void {
  const core = g._core;
  core.state.money = money;
  core.state.phase = 'shop';
  core.state.shop = generateShop(core);
}

/** Zavře otevřené obálky zdarma (štítky ze startovního přeskočení). */
function closeBoosters(g: Game): void {
  for (let i = 0; i < 4 && g.state.phase === 'booster'; i++) ok(g.dispatch({ type: 'skipBooster' }));
}

/** Vybere aktuální útratu, pokud je na řadě výběr. */
function selectIfNeeded(g: Game): void {
  if (g.state.phase === 'blind_select') ok(g.dispatch({ type: 'selectBlind' }));
}

/** Vyhraje běžící kolo jednou kartou. */
function winRound(g: Game): void {
  g._core.state.round!.target = 1;
  ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
}

/** Z výběru útraty rovnou na šéfa patra (Malá a Velká přeskočené bez štítků) a vyhrát. */
function beatBoss(g: Game): void {
  const s = g._core.state;
  s.blinds[0]!.status = 'skipped';
  s.blinds[1]!.status = 'skipped';
  s.blinds[2]!.status = 'current';
  s.blindIndex = 2;
  ok(g.dispatch({ type: 'selectBlind' }));
  winRound(g);
}

/** Projde `n` pater (šéf → výplata → odchod z Večerky); vrací štítky nabídnuté v jednotlivých patrech. */
function passAntes(g: Game, n: number): string[] {
  const tags: string[] = [];
  for (let i = 0; i < n; i++) {
    for (const b of g.state.blinds) if (b.skipTagId) tags.push(b.skipTagId);
    beatBoss(g);
    ok(g.dispatch({ type: 'cashOut' }));
    if (g.state.phase === 'booster') ok(g.dispatch({ type: 'skipBooster' }));
    ok(g.dispatch({ type: 'leaveShop' }));
  }
  return tags;
}

/** Projde `n` čerstvých Večerek a vrátí jejich nabídky. */
function shops(g: Game, n = 40): NonNullable<Game['state']['shop']>[] {
  const out: NonNullable<Game['state']['shop']>[] = [];
  for (let i = 0; i < n; i++) {
    openShop(g);
    out.push(JSON.parse(JSON.stringify(g.state.shop)) as NonNullable<Game['state']['shop']>);
  }
  return out;
}

// ─────────────────────────── Obsah ───────────────────────────

describe('výzvy – obsah (DESIGN 11.1)', () => {
  it('je jich 20 v pořadí tabulky a registr je konzistentní', () => {
    expect(CHALLENGES.map((c) => c.id)).toEqual(ORDER);
    expect(Object.keys(REG.challenges)).toEqual(ORDER);
    expect(validateRegistry(REG)).toEqual([]);
    for (const c of CHALLENGES) {
      expect(REG.decks[c.deckId], c.id).toBeDefined();
      // Hrají se na Desítce.
      expect(c.stake ?? 1, c.id).toBe(1);
    }
  });

  it('odemykají se po 1, 3, 6 a 10 výhrách (po pěticích)', () => {
    expect(CHALLENGES.map((c) => c.unlock)).toEqual(
      ORDER.map((_, i) => ({ type: 'winsTotal', count: [1, 3, 6, 10][Math.floor(i / 5)] })),
    );
  });

  it('každá výzva má název, popis, hlášku a text každého pravidla bez nedosazených parametrů', () => {
    for (const c of CHALLENGES) {
      for (const k of ['name', 'desc', 'flavor'])
        expect(hasKey(`challenges.${c.id}.${k}`), `${c.id}.${k}`).toBe(true);
      expect(c.ruleKeys?.length ?? 0, c.id).toBeGreaterThan(0);
      for (const key of c.ruleKeys ?? [])
        expect(hasKey(`challenges.${c.id}.rules.${key}`), `${c.id}.rules.${key}`).toBe(true);
      const tx = challengeTexts(c.id, { registry: REG });
      expect(tx.rules).toHaveLength(c.ruleKeys!.length);
      for (const text of [tx.name, tx.desc, tx.flavor ?? '', ...tx.rules]) {
        expect(text, c.id).not.toContain('⟦');
        expect(text, c.id).not.toMatch(/\{[\w.]+(\|[^}]*)?\}/);
        expect(text.trim().length, c.id).toBeGreaterThan(0);
      }
    }
  });

  it('názvy obsahu v textech odpovídají registru a čísla v textech pravidlům', () => {
    const rules = (id: string) =>
      challengeTexts(id, { registry: REG })
        .rules.join(' ')
        .replace(/\u00a0/g, ' ');
    expect(rules('dry_february')).toContain(t('vouchers.tear_calendar.name'));
    expect(rules('greenhouse')).toContain(t('consumables.apple_tree.name'));
    expect(rules('greenhouse')).toContain('1 ze 2');
    expect(rules('quarry')).toContain(t('jokers.golem.name'));
    expect(rules('quarry')).toContain('64 karet');
    expect(rules('svejk_anabasis')).toContain(t('jokers.svejk.name'));
    expect(rules('svejk_anabasis')).toContain('úrovni 4');
    expect(rules('bureaucracy')).toContain('1 Kč');
    expect(rules('bureaucracy')).toContain('−15 Kč');
    expect(rules('flat_price')).toContain('5 Kč');
    expect(rules('flat_price')).toContain('2 Kč');
    expect(rules('micro_flat')).toContain(`${MICRO_FLAT_HAND_SIZE} karet`);
    expect(rules('end_of_world')).toContain(`patra ${END_OF_WORLD_FINAL_ANTE}`);
    expect(rules('big_bang')).toContain('×3');
    expect(rules('marias_party')).toContain('×1,25');
  });
});

// ─────────────────────────── Start runu ───────────────────────────

interface StartSpec {
  deck: string;
  /** null = nekontrolovat (štítky ze startovního přeskočení mohou dát peníze). */
  money: number | null;
  cards: number;
  jokers?: [string, string[]][];
  consumables?: string[];
  vouchers?: string[];
}

const START: Record<string, StartSpec> = {
  greenhouse: { deck: 'pub', money: 5, cards: 52, consumables: ['apple_tree', 'apple_tree'] },
  minimalist: { deck: 'pub', money: 5, cards: 52 },
  flat_price: { deck: 'pub', money: 5, cards: 52 },
  svejk_anabasis: { deck: 'pub', money: 5, cards: 52, jokers: [['svejk', []]] },
  express: { deck: 'pub', money: 5, cards: 52 },
  marias_party: { deck: 'marias', money: 5, cards: 32 },
  christmas_carp: { deck: 'pub', money: 5, cards: 52 },
  big_bang: { deck: 'pub', money: 5, cards: 52 },
  border_casino: { deck: 'pub', money: 5, cards: 52 },
  candlelight: { deck: 'pub', money: 5, cards: 52 },
  micro_flat: { deck: 'pub', money: 5, cards: 52 },
  four_seasons: { deck: 'pub', money: 5, cards: 52 },
  quarry: { deck: 'pub', money: 5, cards: 64, jokers: [['golem', ['eternal']]] },
  short_memory: { deck: 'pub', money: 5, cards: 52 },
  bureaucracy: { deck: 'pub', money: 15, cards: 52 },
  straight_to_boss: { deck: 'pub', money: null, cards: 52 },
  lifelong_wedding: { deck: 'regulars', money: 0, cards: 52 },
  costume_rental: { deck: 'pub', money: 10, cards: 52 },
  dry_february: { deck: 'pub', money: 10, cards: 52, vouchers: ['tear_calendar'] },
  end_of_world: { deck: 'pub', money: 5, cards: 52 },
};

describe('výzvy – start runu', () => {
  it.each(ORDER)('%s: balíček, Desítka, peníze, karty, žolíci, spotřebky a kupóny', (id) => {
    const exp = START[id]!;
    const s = run(id).state;
    expect(s.challengeId).toBe(id);
    expect([s.deckId, s.stake]).toEqual([exp.deck, 1]);
    if (exp.money !== null) expect(s.money).toBe(exp.money);
    else expect(s.money).toBeGreaterThanOrEqual(10);
    expect(s.deck).toHaveLength(exp.cards);
    if (id !== 'big_bang') expect(s.jokers.map((j) => [j.defId, j.stickers])).toEqual(exp.jokers ?? []);
    expect(s.consumables.map((c) => c.defId)).toEqual(exp.consumables ?? []);
    expect(s.vouchers).toEqual(exp.vouchers ?? []);
  });
});

// ─────────────────────────── Pravidla ───────────────────────────

describe('výzvy – pravidla', () => {
  it('Skleník: ♥ a ♦ skleněné, ostatní bez vylepšení; sklo praská 1 ze 2 (i v popisku)', () => {
    const g = run('greenhouse');
    for (const c of g.state.deck)
      expect(c.enhancement, `${c.rank}${c.suit}`).toBe(c.suit === 'H' || c.suit === 'D' ? 'glass' : null);
    expect(g.modifiers().glassBreakOdds).toBe(2);
    expect(REG.enhancements.glass!.describe!(g.modifiers())).toEqual({ odds: 2 });
    expect(
      enhancementTexts('glass', { registry: REG, mods: g.modifiers() }).desc.replace(/\u00a0/g, ' '),
    ).toContain('1 ze 2');
  });

  it('Minimalista: nejvýš 3 karty; Vysoká karta, Dvojice a Trojice na úrovni 3', () => {
    const g = run('minimalist');
    expect(g.modifiers().maxSelect).toBe(3);
    const levels = (['high_card', 'pair', 'three', 'two_pair'] as HandType[]).map(
      (h) => g.state.handLevels[h].level,
    );
    expect(levels).toEqual([3, 3, 3, 1]);
    selectIfNeeded(g);
    expect(g.dispatch({ type: 'play', cardIds: g.state.round!.hand.slice(0, 4) })).toEqual({
      ok: false,
      error: 'invalidSelection',
    });
    expect(g.dispatch({ type: 'play', cardIds: g.state.round!.hand.slice(0, 3) }).ok).toBe(true);
  });

  it('Jednotná cena: vše ve Večerce za 5 Kč (i přehození), prodej za 2 Kč, slevové kupóny se nenabízejí', () => {
    const g = run('flat_price');
    for (const shop of shops(g, 20)) {
      for (const it of shop.items) expect(it.price).toBe(5);
      for (const b of shop.boosters) expect(b.price).toBe(5);
      for (const v of shop.vouchers) expect(v.price).toBe(5);
      expect(shop.rerollCost).toBe(5);
    }
    g._core.api.createJoker({ rarity: 'epic' });
    g._core.api.createConsumable({ kind: 'razitko' });
    expect(g.sellValue(g.state.jokers[0]!.uid)).toBe(2);
    expect(g.sellValue(g.state.consumables[0]!.uid)).toBe(2);
    const offered = eligibleVouchers(g._core);
    for (const v of ['yellow_price', 'relabeled_price', 'counter_buddy', 'manager_inlaw', 'amnesty'])
      expect(offered).not.toContain(v);
  });

  it('Švejkova anabáze: nad Dvojici se neboduje (0 bodů, ruka spotřebovaná); Vysoká karta a Dvojice na úrovni 4', () => {
    const g = run('svejk_anabasis');
    expect([g.state.handLevels.high_card.level, g.state.handLevels.pair.level]).toEqual([4, 4]);
    selectIfNeeded(g);
    const core = g._core;
    const round = core.state.round!;
    round.drawPile.unshift(...round.hand);
    round.hand = [];
    const add = (suit: Suit, rank: 2 | 5 | 9 | 13 | 14) =>
      core.api.addCard({ suit, rank }, { toHand: true }).id;
    const twoPair = [add('S', 9), add('H', 9), add('D', 5), add('C', 5)];
    const pair = [add('S', 14), add('H', 14)];
    expect(g.preview(twoPair).blockedReason).toBe(MSG.challengeHandTooStrong);
    const blocked = ok(g.dispatch({ type: 'play', cardIds: twoPair })).find((e) => e.type === 'handPlayed');
    expect(blocked?.type === 'handPlayed' && [blocked.result.score, blocked.result.blockedReason]).toEqual([
      0,
      MSG.challengeHandTooStrong,
    ]);
    expect(g.state.round!.handsLeft).toBe(3);
    const scored = ok(g.dispatch({ type: 'play', cardIds: pair })).find((e) => e.type === 'handPlayed');
    expect(scored?.type === 'handPlayed' && scored.result.score).toBeGreaterThan(0);
  });

  it('Rychlík bez zastávky: nepřeskakuje se (bez štítků), Večerka nemá přehození, +1 ruka', () => {
    const g = run('express');
    expect(g.modifiers().hands).toBe(5);
    expect(g.state.blinds.map((b) => b.skipTagId)).toEqual([null, null, null]);
    expect(g.dispatch({ type: 'skipBlind' })).toEqual({ ok: false, error: 'cannotSkip' });
    openShop(g);
    g._core.state.shop!.freeRerolls = 1;
    expect(g.dispatch({ type: 'reroll' })).toEqual({ ok: false, error: 'cannotUse' });
    for (const v of ['counter_buddy', 'manager_inlaw']) expect(eligibleVouchers(g._core)).not.toContain(v);
    expect(passAntes(run('express'), 4)).toEqual([]);
  });

  it('Mariáš u Vaňků: Mariášový balíček, Barva a Postupka v barvě na úrovni 3, bez karetních obálek, cíle ×1,25', () => {
    const g = run('marias_party');
    expect(g.state.deck.every((c) => c.rank >= 7)).toBe(true);
    expect([g.state.handLevels.flush.level, g.state.handLevels.straight_flush.level]).toEqual([3, 3]);
    for (const shop of shops(g))
      expect(shop.boosters.some((b) => b.boosterId.startsWith('card_'))).toBe(false);
    expect(g._core.api.openBooster('card_jumbo')).toBe(false);
    // Mariášový balíček má vlastní cíle ×1,2 — výzva je násobí dál.
    expect(g.modifiers().targetMult).toBeCloseTo(MARIAS_TARGET_MULT * 1.25);
    expect(g.blindTarget('small')).toBe(
      blindTarget(1, 'small', 1, { targetMult: MARIAS_TARGET_MULT * 1.25 }),
    );
    expect(passAntes(run('marias_party'), 6)).not.toContain('cottage_marias');
  });

  it('Vánoční kapr: 0 zahození, +2 ruce, +1 karta v ruce; kupóny na zahození se nenabízejí', () => {
    const g = run('christmas_carp');
    const m = g.modifiers();
    expect([m.discards, m.hands, m.handSize]).toEqual([0, 6, 9]);
    selectIfNeeded(g);
    expect(g.state.round!.hand).toHaveLength(9);
    expect(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] })).toEqual({
      ok: false,
      error: 'noDiscardsLeft',
    });
    for (const v of ['dumpster', 'recycling_yard']) expect(eligibleVouchers(g._core)).not.toContain(v);
  });

  it('Velký třesk: 2 různí náhodní legendární žolíci (přibití, i bez odemčení), cíle ×3', () => {
    const g = run('big_bang', { unlockedPool: { jokers: [], vouchers: null, boosters: null } });
    const jokers = g.state.jokers;
    expect(jokers).toHaveLength(2);
    expect(new Set(jokers.map((j) => j.defId)).size).toBe(2);
    for (const j of jokers) {
      expect(REG.jokers[j.defId]!.rarity).toBe('legendary');
      expect(j.stickers).toEqual(['eternal']);
    }
    expect(run('big_bang').state.jokers.map((j) => j.defId)).toEqual(jokers.map((j) => j.defId));
    expect(g.modifiers().targetMult).toBe(3);
    expect(g.dispatch({ type: 'sellJoker', uid: jokers[0]!.uid })).toEqual({
      ok: false,
      error: 'cannotSell',
    });
  });

  it('Kasino u hranic: všech 52 karet šťastných; úrok, odměna za útratu ani nevyužité ruce nic nedají', () => {
    const g = run('border_casino');
    expect(g.state.deck.every((c) => c.enhancement === 'lucky')).toBe(true);
    selectIfNeeded(g);
    g._core.state.money = 50;
    winRound(g);
    const r = g.state.rewards!;
    expect([r.blindReward, r.interest, r.unusedHands]).toEqual([0, 0, 0]);
    for (const v of ['savings_account', 'building_savings', 'nonstop'])
      expect(eligibleVouchers(g._core)).not.toContain(v);
  });

  it('Večer při svíčkách: +1 ruka; žolíci nefungují v první ruce kola', () => {
    const g = run('candlelight');
    expect(g.modifiers().hands).toBe(5);
    g._core.api.createJoker({ defId: 'beer_mat' });
    selectIfNeeded(g);
    expect(g.state.jokers[0]!.debuffed).toBe(true);
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.jokers[0]!.debuffed).toBe(false);
  });

  it('Malometrážní byt: ruka 6 karet, +1 ruka, +2 sloty žolíků', () => {
    const g = run('micro_flat');
    const m = g.modifiers();
    expect([m.handSize, m.hands, m.jokerSlots]).toEqual([6, 5, 7]);
    selectIfNeeded(g);
    expect(g.state.round!.hand).toHaveLength(6);
  });

  it('Čtyři roční období: v patrech 1 a 5 ♥, 2 a 6 ♠, 3 a 7 ♦, 4 a 8 ♣ mimo provoz — ve všech útratách', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(seasonSuit)).toEqual([
      'H',
      'S',
      'D',
      'C',
      'H',
      'S',
      'D',
      'C',
      'H',
    ]);
    const g = run('four_seasons');
    selectIfNeeded(g);
    expect(g.state.round!.blind).toBe('small');
    for (const c of g.state.deck) expect(c.debuffed, `${c.rank}${c.suit}`).toBe(c.suit === 'H');
    winRound(g);
    ok(g.dispatch({ type: 'cashOut' }));
    ok(g.dispatch({ type: 'leaveShop' }));
    g._core.api.changeAnte(1);
    selectIfNeeded(g);
    expect(g.state.round!.blind).toBe('big');
    for (const c of g.state.deck) expect(c.debuffed, `${c.rank}${c.suit}`).toBe(c.suit === 'S');
  });

  it('Kamenolom: 64 karet (12 kamenných), přibitý Golem, babské rady nikde', () => {
    const g = run('quarry');
    expect(g.state.deck.filter((c) => c.enhancement === 'stone')).toHaveLength(12);
    expect(g.dispatch({ type: 'sellJoker', uid: g.state.jokers[0]!.uid })).toEqual({
      ok: false,
      error: 'cannotSell',
    });
    for (const shop of shops(g)) {
      for (const it of shop.items) if (it.kind === 'consumable') expect(it.consumableKind).not.toBe('rada');
      expect(shop.boosters.some((b) => b.boosterId.startsWith('rada_'))).toBe(false);
    }
    expect(g._core.api.createConsumable({ kind: 'rada' })).toBeNull();
    expect(g._core.api.openBooster('rada_normal')).toBe(false);
    expect(passAntes(run('quarry'), 6)).not.toContain('grandma_parcel');
  });

  it('Krátká paměť: pranostiky za 1 Kč; úrovně kombinací se na začátku patra vrátí na 1', () => {
    const g = run('short_memory');
    for (const shop of shops(g)) {
      for (const it of shop.items)
        if (it.kind === 'consumable' && it.consumableKind === 'pranostika') expect(it.price).toBe(1);
    }
    g._core.state.phase = 'blind_select';
    g._core.state.shop = null;
    g._core.api.levelUpHand('pair', 3);
    g._core.api.levelUpHand('flush', 1);
    beatBoss(g);
    const events = ok(g.dispatch({ type: 'cashOut' }));
    expect([g.state.ante, g.state.handLevels.pair.level, g.state.handLevels.flush.level]).toEqual([2, 1, 1]);
    expect(events).toContainEqual({ type: 'handLeveled', hand: 'pair', level: 1, delta: -3 });
  });

  it('Byrokracie: ruka i zahození po 1 Kč, dluh až do −15 Kč', () => {
    const g = run('bureaucracy');
    expect(g.modifiers().debtLimit).toBe(15);
    selectIfNeeded(g);
    ok(g.dispatch({ type: 'discard', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.money).toBe(14);
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.money).toBe(13);
    g._core.state.money = -15;
    ok(g.dispatch({ type: 'play', cardIds: [g.state.round!.hand[0]!] }));
    expect(g.state.money).toBe(-15);
  });

  it('Rovnou za ředitelem: Malá a Velká se přeskočí samy (se štítky), v každém patře', () => {
    const g = run('straight_to_boss');
    closeBoosters(g);
    expect([g.state.phase, g.state.blindIndex]).toEqual(['blind_select', 2]);
    expect(g.state.blinds.map((b) => b.status)).toEqual(['skipped', 'skipped', 'current']);
    expect(g.state.stats.blindsSkipped).toBe(2);
    ok(g.dispatch({ type: 'selectBlind' }));
    winRound(g);
    ok(g.dispatch({ type: 'cashOut' }));
    closeBoosters(g);
    ok(g.dispatch({ type: 'leaveShop' }));
    closeBoosters(g);
    expect([g.state.ante, g.state.blindIndex, g.state.stats.blindsSkipped]).toEqual([2, 2, 4]);
  });

  it('Svatba na doživotí: Štamgastův balíček (6 slotů), všichni žolíci přibití, kdo nesmí být, se nenabízí', () => {
    const g = run('lifelong_wedding');
    expect(g.modifiers().jokerSlots).toBe(6);
    for (const shop of shops(g))
      for (const it of shop.items) if (it.kind === 'joker') expect(it.joker.stickers).toEqual(['eternal']);
    const offered = g._core.api.availableJokers();
    expect(offered).not.toContain('piggy_bank');
    const j = g._core.api.createJoker({ rarity: 'common' })!;
    expect(j.stickers).toEqual(['eternal']);
    expect(g.dispatch({ type: 'sellJoker', uid: j.uid })).toEqual({ ok: false, error: 'cannotSell' });
  });

  it('Půjčovna kostýmů: všichni žolíci zapůjčení (za 2 Kč), kdo se půjčit nedá, se nenabízí', () => {
    const g = run('costume_rental');
    let seen = 0;
    for (const shop of shops(g)) {
      for (const it of shop.items) {
        if (it.kind !== 'joker') continue;
        seen++;
        expect(it.joker.stickers).toEqual(['rental']);
        expect(it.price).toBe(RENTAL_BUY_PRICE);
        expect(REG.jokers[it.joker.defId]!.noRental).not.toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(g._core.api.createJoker({ rarity: 'rare' })!.stickers).toEqual(['rental']);
  });

  it('Suchý únor: žolíci ani nic se žolíky nikde, +2 sloty spotřebek, poloviční cíle', () => {
    const g = run('dry_february');
    const def = REG.challenges.dry_february!;
    expect(g.modifiers().consumableSlots).toBe(4);
    expect(g.blindTarget('small')).toBe(blindTarget(1, 'small', 1, { targetMult: 0.5 }));
    for (const shop of shops(g)) {
      expect(shop.items.some((it) => it.kind === 'joker')).toBe(false);
      expect(shop.boosters.some((b) => b.boosterId.startsWith('joker_'))).toBe(false);
      for (const it of shop.items)
        if (it.kind === 'consumable') expect(def.bannedConsumables).not.toContain(it.consumable.defId);
    }
    expect(g._core.api.createJoker({ rarity: 'common' })).toBeNull();
    expect(g._core.api.openBooster('joker_normal')).toBe(false);
    const offered = eligibleVouchers(g._core);
    for (const v of def.bannedVouchers!) expect(offered).not.toContain(v);
    const tags = passAntes(run('dry_february'), 7);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of def.bannedTags!) expect(tags).not.toContain(tag);
  });

  it('Konec světa: cíle ×1,25, finálový šéf v patře 8 i 12, výhra až po šéfovi patra 12', () => {
    const g = run('end_of_world');
    expect(g.modifiers().finalAnte).toBe(12);
    expect(g.blindTarget('small')).toBe(blindTarget(1, 'small', 1, { targetMult: 1.25 }));
    g._core.api.changeAnte(7);
    expect(REG.bosses[g.state.blinds[2]!.bossId!]!.final).toBe(true);
    beatBoss(g);
    expect(g.state.phase).toBe('round_end');
    ok(g.dispatch({ type: 'cashOut' }));
    expect(REG.bosses[g.state.blinds[2]!.bossId!]!.final).not.toBe(true);
    ok(g.dispatch({ type: 'leaveShop' }));
    g._core.api.changeAnte(12 - g.state.ante);
    expect(REG.bosses[g.state.blinds[2]!.bossId!]!.final).toBe(true);
    beatBoss(g);
    expect(g.state.phase).toBe('victory');
  });
});

// ─────────────────────────── Bot ───────────────────────────

describe('výzvy – dohratelnost botem', () => {
  it.each(ORDER)(
    '%s: bot dohraje run bez neplatných akcí',
    (id) => {
      const bot = createBot('max');
      for (let i = 1; i <= 2; i++) {
        const r = simulateRun(REG, {
          seed: simSeed(`CH-${id}`, i),
          deckId: REG.challenges[id]!.deckId,
          stake: 1,
          bot,
          challengeId: id,
        });
        expect(r.invalidActions, `${r.seed}: ${JSON.stringify(r.invalidByCode)}`).toBe(0);
        expect(r.cause, r.seed).not.toBe('actionLimit');
        expect([r.deckId, r.stake]).toEqual([REG.challenges[id]!.deckId, 1]);
      }
    },
    60_000,
  );

  it('boti respektují zákaz přeskakování a přehazování (Rychlík bez zastávky)', () => {
    for (const name of ['random', 'econ', 'flush', 'pairs'] as const) {
      const bot = createBot(name);
      for (let i = 1; i <= 2; i++) {
        const r = simulateRun(REG, {
          seed: simSeed(`EXP-${name}`, i),
          deckId: 'pub',
          stake: 1,
          bot,
          challengeId: 'express',
        });
        expect(r.invalidActions, `${name} ${r.seed}: ${JSON.stringify(r.invalidByCode)}`).toBe(0);
        expect([r.rerolls, r.blindsSkipped]).toEqual([0, 0]);
      }
    }
  }, 120_000);
});
