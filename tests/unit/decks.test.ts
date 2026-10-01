/**
 * Startovní balíčky (src/content/decks.ts) podle docs/DESIGN.md kap. 9 — zatím ty, které stačí vyjádřit
 * modifikátory, startovními penězi a vlastním složením (zbytek přijde ve fázi 7).
 */
import { describe, expect, it } from 'vitest';
import { DECKS } from '../../src/content/decks';
import { buildRegistry } from '../../src/content/index';
import { BASE_MODIFIERS } from '../../src/engine/effects/modifiers';
import { Game } from '../../src/engine/run/game';
import type { Card, Modifiers } from '../../src/engine/types';
import { RANKS, SUITS } from '../../src/engine/types';
import { hasKey, t } from '../../src/i18n/cs';
import { typo } from '../../src/i18n/format';
import { setupRound, winNextHand } from './fixtures/registry';

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
      'tourist',
      'marias',
      'court',
      'notary',
      'nouveau_riche',
      'debtor',
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
    expect(t('decks.court.desc', DECKS.find((d) => d.id === 'court')!.params)).toContain('×1,5');
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

  it('Turistický: Postupka i Barva ze 4 karet, cíle ×1,2', () => {
    expect(modsDiff('tourist')).toEqual({ fourCardStraightFlush: true, targetMult: 1.2 });
    const g = newGame('tourist');
    expect(g.blindTarget('small')).toBe(300);
    expect(g.blindTarget('boss')).toBe(600);
    const cards = setupRound(g, '2H 7H 9H KH 3S');
    expect(g.preview(cards.slice(0, 4).map((c) => c.id)).hand?.type).toBe('flush');
    const run = setupRound(g, '5C 6D 7S 8H KD');
    expect(g.preview(run.slice(0, 4).map((c) => c.id)).hand?.type).toBe('straight');
  });

  it('Mariášový: 32 karet 7–A ve 4 barvách, Postupka A-2-3-4-5 nejde', () => {
    const g = newGame('marias');
    expect(g.state.deck).toHaveLength(32);
    const expected = SUITS.flatMap((s) => RANKS.filter((r) => r >= 7).map((r) => `${r}${s}`));
    expect(composition(g.state.deck)).toEqual([...expected].sort());
    expect(g.state.deck.some((c) => c.rank < 7)).toBe(false);
    expect(modsDiff('marias')).toEqual({});
  });

  it('Obrázkový: 32 karet J–A, každá 2×; 7 karet v ruce; cíle ×1,5', () => {
    const g = newGame('court');
    expect(g.state.deck).toHaveLength(32);
    const counts = new Map<string, number>();
    for (const c of g.state.deck)
      counts.set(`${c.rank}${c.suit}`, (counts.get(`${c.rank}${c.suit}`) ?? 0) + 1);
    expect(counts.size).toBe(16);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(g.state.deck.every((c) => c.rank >= 11)).toBe(true);
    expect(modsDiff('court')).toEqual({ handSize: 7, targetMult: 1.5 });
    expect(g.blindTarget('small')).toBe(380);
    g.dispatch({ type: 'selectBlind' });
    expect(g.state.round!.hand).toHaveLength(7);
  });

  it('Notářský: −1 slot spotřebky, ~25 % karet s náhodnou pečetí, deterministicky podle seedu', () => {
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
    expect(sealed / total).toBeGreaterThan(0.2);
    expect(sealed / total).toBeLessThan(0.3);
    expect([...kinds].sort()).toEqual(Object.keys(reg.seals).sort());
  });

  it('Zbohatlík: odměny a úrok ×2, nevyužitá ruka o 1 Kč víc, 2 ruce', () => {
    expect(modsDiff('nouveau_riche')).toEqual({
      hands: 2,
      blindRewardMult: 2,
      interestMult: 2,
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
    expect(r.interest).toBe(2);
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
