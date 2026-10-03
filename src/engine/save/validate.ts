/**
 * Hloubková kontrola uloženého runu (po `deserializeRun`, který ověří obálku, verzi a typy polí nejvyšší úrovně).
 * Hledá to, na čem by hra spadla nebo uvízla až uprostřed hraní:
 *  - tvar vnořených objektů (karty, žolíci, spotřebky, štítky, útraty, `round`, Večerka, obálka, statistiky),
 *  - konzistenci id karet: ruka, dobírací balíček, odhozené a zahrané karty i ruka obálky odkazují jen na karty
 *    balíčku runu a žádná karta není ve dvou hromádkách naráz; id karet i uid žolíků a spotřebek jsou unikátní,
 *  - fázi s jejími daty (kolo bez `round`, Večerka bez nabídky, obálka bez obálky, výběr útraty bez útraty),
 *  - s registrem obsahu i existenci id obsahu (balíček, síla piva, výzva, žolíci, spotřebky, štítky, kupóny,
 *    šéfové, obálky, vylepšení, pečetě, edice).
 *
 * Výsledek je seznam nálezů: `corrupt` = run nejde hrát (import ho odmítne, autosave se nenačte a zazálohuje);
 * `unknownContent` = obsah, který registr nezná (engine ho snese — neznámý žolík nic nedělá —, ale import ho odmítne,
 * aby hráč nenahrál run z jiné verze hry s chybějícím obsahem). Prázdný seznam = v pořádku.
 *
 * Samostatný modul, bez DOM a bez hodin; nic nemění.
 */
import type { ContentRegistry } from '../content-types';
import { RNG_STREAMS } from '../rng/rng';
import type { RunPhase } from '../types';
import { BLIND_KINDS, RANKS, SUITS } from '../types';

export type RunStateIssueKind = 'corrupt' | 'unknownContent';

export interface RunStateIssue {
  kind: RunStateIssueKind;
  /** Cesta k vadnému poli (např. `round.hand[2]`) — do konzole a testů, hráči se neukazuje. */
  path: string;
}

/** Nejvýš tolik nálezů — poškozený run jich může mít tisíce a stačí vědět, že je vadný. */
const MAX_ISSUES = 20;

const RUN_PHASES: readonly RunPhase[] = [
  'blind_select',
  'round',
  'round_end',
  'shop',
  'booster',
  'game_over',
  'victory',
];
const BLIND_STATUSES = ['upcoming', 'current', 'defeated', 'skipped'];
/** Fáze, ve kterých engine čte rozehrané kolo (`round`): hraní, rozpis odměn (Vyúčtovat) a výhra (nekonečný režim). */
const ROUND_PHASES: readonly RunPhase[] = ['round', 'round_end', 'victory'];
const STAT_NUMBERS = [
  'handsPlayed',
  'discardsUsed',
  'cardsPlayed',
  'cardsDiscarded',
  'bestHandScore',
  'moneyEarned',
  'moneySpent',
  'jokersBought',
  'jokersSold',
  'consumablesUsed',
  'rerolls',
  'shopsEntered',
  'blindsSkipped',
  'bossesDefeated',
  'roundsWon',
  'minMoney',
  'maxMoney',
];
const ROUND_NUMBERS = ['target', 'score', 'handsLeft', 'discardsLeft', 'handsPlayed', 'discardsUsed'];
const ROUND_PILES = ['drawPile', 'hand', 'discardPile', 'playedPile'] as const;

type Rec = Record<string, unknown>;

function isRecord(x: unknown): x is Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isId(x: unknown): x is number {
  return isFiniteNumber(x) && Number.isInteger(x);
}

function isStringOrNull(x: unknown): x is string | null {
  return x === null || typeof x === 'string';
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function isIdArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.every(isId);
}

class Collector {
  readonly issues: RunStateIssue[] = [];

  constructor(private readonly registry: ContentRegistry | undefined) {}

  get full(): boolean {
    return this.issues.length >= MAX_ISSUES;
  }

  corrupt(path: string): void {
    if (!this.full) this.issues.push({ kind: 'corrupt', path });
  }

  /** Ověří, že id obsahu zná registr (bez registru nic). `null` = žádný obsah (bez edice…). */
  known(table: keyof ContentRegistry, id: unknown, path: string): void {
    if (!this.registry || id === null || id === undefined || this.full) return;
    const map = this.registry[table] as Record<string, unknown> | undefined;
    if (typeof id !== 'string' || !map || !Object.prototype.hasOwnProperty.call(map, id))
      this.issues.push({ kind: 'unknownContent', path });
  }
}

/** Hrací karta (balíček runu, zboží, možnost obálky). Vrací id karty, nebo null, když karta není platná. */
function checkCard(c: Collector, card: unknown, path: string): number | null {
  if (!isRecord(card)) {
    c.corrupt(path);
    return null;
  }
  let ok = true;
  const bad = (field: string): void => {
    ok = false;
    c.corrupt(`${path}.${field}`);
  };
  if (!isId(card.id)) bad('id');
  if (!SUITS.includes(card.suit as never)) bad('suit');
  if (!RANKS.includes(card.rank as never)) bad('rank');
  for (const field of ['enhancement', 'seal', 'edition'] as const)
    if (!isStringOrNull(card[field])) bad(field);
  if (!isFiniteNumber(card.bonusChips)) bad('bonusChips');
  if (card.debuffed !== undefined && typeof card.debuffed !== 'boolean') bad('debuffed');
  if (card.faceDown !== undefined && typeof card.faceDown !== 'boolean') bad('faceDown');
  c.known('enhancements', card.enhancement, `${path}.enhancement`);
  c.known('seals', card.seal, `${path}.seal`);
  c.known('editions', card.edition, `${path}.edition`);
  return ok ? (card.id as number) : null;
}

/** Instance žolíka. Vrací uid, nebo null. */
function checkJoker(c: Collector, j: unknown, path: string): number | null {
  if (!isRecord(j)) {
    c.corrupt(path);
    return null;
  }
  let ok = true;
  const bad = (field: string): void => {
    ok = false;
    c.corrupt(`${path}.${field}`);
  };
  if (!isId(j.uid)) bad('uid');
  if (typeof j.defId !== 'string') bad('defId');
  if (!isStringOrNull(j.edition)) bad('edition');
  // Hooky čtou `self.state.x` a engine `stickers.includes(…)` — bez nich by hra spadla.
  if (!isRecord(j.state)) bad('state');
  if (!isStringArray(j.stickers)) bad('stickers');
  if (j.sellBonus !== undefined && !isFiniteNumber(j.sellBonus)) bad('sellBonus');
  if (j.perishRounds !== undefined && !isFiniteNumber(j.perishRounds)) bad('perishRounds');
  if (j.debuffed !== undefined && typeof j.debuffed !== 'boolean') bad('debuffed');
  c.known('jokers', j.defId, `${path}.defId`);
  c.known('editions', j.edition, `${path}.edition`);
  return ok ? (j.uid as number) : null;
}

/** Instance spotřebky. Vrací uid, nebo null. */
function checkConsumable(c: Collector, x: unknown, path: string): number | null {
  if (!isRecord(x)) {
    c.corrupt(path);
    return null;
  }
  let ok = true;
  if (!isId(x.uid)) {
    ok = false;
    c.corrupt(`${path}.uid`);
  }
  if (typeof x.defId !== 'string') {
    ok = false;
    c.corrupt(`${path}.defId`);
  }
  if (x.edition !== undefined && !isStringOrNull(x.edition)) {
    ok = false;
    c.corrupt(`${path}.edition`);
  }
  c.known('consumables', x.defId, `${path}.defId`);
  c.known('editions', x.edition, `${path}.edition`);
  return ok ? (x.uid as number) : null;
}

/** Pole instancí s unikátním uid/id (duplicita = poškozený run: akce by trefila jinou instanci). */
function checkList(
  c: Collector,
  list: unknown,
  path: string,
  check: (c: Collector, item: unknown, path: string) => number | null,
): number[] {
  if (!Array.isArray(list)) {
    c.corrupt(path);
    return [];
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  list.forEach((item, i) => {
    const id = check(c, item, `${path}[${i}]`);
    if (id === null) return;
    if (seen.has(id)) c.corrupt(`${path}[${i}]`);
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

/** Zboží Večerky nebo možnost obálky: žolík, spotřebka, nebo hrací karta. */
function checkOffer(c: Collector, item: unknown, path: string, priced: boolean): void {
  if (!isRecord(item)) {
    c.corrupt(path);
    return;
  }
  if (priced) {
    if (!isFiniteNumber(item.price)) c.corrupt(`${path}.price`);
    if (typeof item.sold !== 'boolean') c.corrupt(`${path}.sold`);
  }
  if (item.kind === 'joker') checkJoker(c, item.joker, `${path}.joker`);
  else if (item.kind === 'consumable') checkConsumable(c, item.consumable, `${path}.consumable`);
  else if (item.kind === 'card') checkCard(c, item.card, `${path}.card`);
  else c.corrupt(`${path}.kind`);
}

function checkRound(c: Collector, round: Rec, deckIds: ReadonlySet<number>): void {
  if (!BLIND_KINDS.includes(round.blind as never)) c.corrupt('round.blind');
  if (!isStringOrNull(round.bossId)) c.corrupt('round.bossId');
  c.known('bosses', round.bossId, 'round.bossId');
  if (typeof round.bossDisabled !== 'boolean') c.corrupt('round.bossDisabled');
  for (const field of ROUND_NUMBERS) if (!isFiniteNumber(round[field])) c.corrupt(`round.${field}`);
  if (round.handSizeDelta !== undefined && !isFiniteNumber(round.handSizeDelta))
    c.corrupt('round.handSizeDelta');
  if (!isStringArray(round.handTypesPlayed)) c.corrupt('round.handTypesPlayed');
  if (!isIdArray(round.jokerDebuffs)) c.corrupt('round.jokerDebuffs');
  for (const field of ['cleansedCards', 'ruleJokerDebuffs'])
    if (round[field] !== undefined && !isIdArray(round[field])) c.corrupt(`round.${field}`);
  if (!isRecord(round.flags)) c.corrupt('round.flags');
  // Hromádky: jen karty balíčku runu, každá nejvýš jednou (karta nemůže být v ruce a zároveň v balíčku).
  const placed = new Set<number>();
  for (const pile of ROUND_PILES) {
    const ids = round[pile];
    if (!Array.isArray(ids)) {
      c.corrupt(`round.${pile}`);
      continue;
    }
    ids.forEach((id, i) => {
      if (!isId(id) || !deckIds.has(id) || placed.has(id)) c.corrupt(`round.${pile}[${i}]`);
      else placed.add(id);
    });
  }
}

function checkShop(c: Collector, shop: Rec): void {
  for (const field of ['rerollCost', 'rerollsThisShop', 'paidRerolls', 'freeRerolls'])
    if (!isFiniteNumber(shop[field])) c.corrupt(`shop.${field}`);
  if (!Array.isArray(shop.items)) c.corrupt('shop.items');
  else shop.items.forEach((item, i) => checkOffer(c, item, `shop.items[${i}]`, true));
  const priced = (list: unknown, path: string, idField: string, table: keyof ContentRegistry): void => {
    if (!Array.isArray(list)) {
      c.corrupt(path);
      return;
    }
    list.forEach((x, i) => {
      const p = `${path}[${i}]`;
      if (
        !isRecord(x) ||
        typeof x[idField] !== 'string' ||
        !isFiniteNumber(x.price) ||
        typeof x.sold !== 'boolean'
      ) {
        c.corrupt(p);
        return;
      }
      c.known(table, x[idField], `${p}.${idField}`);
    });
  };
  priced(shop.boosters, 'shop.boosters', 'boosterId', 'boosters');
  priced(shop.vouchers, 'shop.vouchers', 'voucherId', 'vouchers');
}

function checkBooster(c: Collector, booster: Rec, deckIds: ReadonlySet<number>): void {
  if (typeof booster.boosterId !== 'string') c.corrupt('booster.boosterId');
  c.known('boosters', booster.boosterId, 'booster.boosterId');
  if (!isFiniteNumber(booster.picksLeft)) c.corrupt('booster.picksLeft');
  if (booster.returnTo !== 'shop' && booster.returnTo !== 'blind_select') c.corrupt('booster.returnTo');
  if (!Array.isArray(booster.options)) c.corrupt('booster.options');
  else booster.options.forEach((opt, i) => checkOffer(c, opt, `booster.options[${i}]`, false));
  if (!Array.isArray(booster.hand)) {
    c.corrupt('booster.hand');
    return;
  }
  const seen = new Set<number>();
  booster.hand.forEach((id, i) => {
    if (!isId(id) || !deckIds.has(id) || seen.has(id)) c.corrupt(`booster.hand[${i}]`);
    else seen.add(id);
  });
}

function checkStats(c: Collector, stats: unknown): void {
  if (!isRecord(stats)) {
    c.corrupt('stats');
    return;
  }
  // Starší uložení může pole nemít (engine si ho doplní); co tam je, musí být číslo.
  for (const field of STAT_NUMBERS)
    if (stats[field] !== undefined && !isFiniteNumber(stats[field])) c.corrupt(`stats.${field}`);
  for (const field of ['handTypeCounts', 'jokerRoundCounts'])
    if (stats[field] !== undefined && !isRecord(stats[field])) c.corrupt(`stats.${field}`);
}

/**
 * Zkontroluje uložený run (data po `deserializeRun`, nebo cokoli jiného) a vrátí nálezy (prázdné = v pořádku).
 * S registrem navíc hlásí neznámý obsah (`unknownContent`).
 */
export function validateRunState(data: unknown, registry?: ContentRegistry): RunStateIssue[] {
  const c = new Collector(registry);
  if (!isRecord(data)) {
    c.corrupt('(root)');
    return c.issues;
  }
  const d = data;

  // Základ runu.
  if (typeof d.seed !== 'string' || d.seed === '') c.corrupt('seed');
  if (!isRecord(d.rng)) c.corrupt('rng');
  else
    for (const stream of RNG_STREAMS) {
      const st = d.rng[stream];
      if (!Array.isArray(st) || st.length !== 4 || !st.every(isFiniteNumber)) c.corrupt(`rng.${stream}`);
    }
  if (typeof d.deckId !== 'string') c.corrupt('deckId');
  c.known('decks', d.deckId, 'deckId');
  if (!isFiniteNumber(d.stake)) c.corrupt('stake');
  else if (registry && !Object.values(registry.stakes).some((s) => s.level === d.stake))
    c.issues.push({ kind: 'unknownContent', path: 'stake' });
  if (!isStringOrNull(d.challengeId)) c.corrupt('challengeId');
  c.known('challenges', d.challengeId, 'challengeId');
  if (typeof d.daily !== 'boolean') c.corrupt('daily');
  if (typeof d.endless !== 'boolean') c.corrupt('endless');
  if (!isFiniteNumber(d.ante) || d.ante < 1) c.corrupt('ante');
  if (!isFiniteNumber(d.money)) c.corrupt('money');
  if (!isId(d.nextUid)) c.corrupt('nextUid');
  if (!RUN_PHASES.includes(d.phase as RunPhase)) c.corrupt('phase');
  if (d.handSort !== undefined && d.handSort !== null && d.handSort !== 'rank' && d.handSort !== 'suit')
    c.corrupt('handSort');

  // Útraty patra.
  if (!Array.isArray(d.blinds)) c.corrupt('blinds');
  else
    d.blinds.forEach((b, i) => {
      const p = `blinds[${i}]`;
      if (
        !isRecord(b) ||
        !BLIND_KINDS.includes(b.kind as never) ||
        !isStringOrNull(b.bossId) ||
        !isStringOrNull(b.skipTagId) ||
        !BLIND_STATUSES.includes(b.status as string)
      ) {
        c.corrupt(p);
        return;
      }
      c.known('bosses', b.bossId, `${p}.bossId`);
      c.known('tags', b.skipTagId, `${p}.skipTagId`);
    });
  if (!isId(d.blindIndex) || d.blindIndex < 0) c.corrupt('blindIndex');

  // Karty, žolíci, spotřebky, štítky.
  const deckIds = new Set(checkList(c, d.deck, 'deck', checkCard));
  checkList(c, d.jokers, 'jokers', checkJoker);
  checkList(c, d.consumables, 'consumables', checkConsumable);
  checkList(c, d.tags, 'tags', (col, tag, path) => {
    if (!isRecord(tag) || !isId(tag.uid) || typeof tag.defId !== 'string' || !isRecord(tag.state)) {
      col.corrupt(path);
      return null;
    }
    col.known('tags', tag.defId, `${path}.defId`);
    return tag.uid;
  });

  // Kombinace, kupóny a ostatní seznamy.
  if (!isRecord(d.handLevels)) c.corrupt('handLevels');
  else
    for (const [type, hl] of Object.entries(d.handLevels))
      if (!isRecord(hl) || !isFiniteNumber(hl.level) || !isFiniteNumber(hl.played))
        c.corrupt(`handLevels.${type}`);
  for (const field of ['discoveredHands', 'vouchers', 'anteVouchers', 'bannedJokers', 'bossesSeen'])
    if (!isStringArray(d[field])) c.corrupt(field);
  if (isStringArray(d.vouchers)) d.vouchers.forEach((v, i) => c.known('vouchers', v, `vouchers[${i}]`));
  if (isStringArray(d.anteVouchers))
    d.anteVouchers.forEach((v, i) => c.known('vouchers', v, `anteVouchers[${i}]`));
  if (!isRecord(d.extraModifiers)) c.corrupt('extraModifiers');
  if (!isRecord(d.flags)) c.corrupt('flags');
  if (!isStringOrNull(d.lastConsumable)) c.corrupt('lastConsumable');
  if (!isRecord(d.unlockedPool)) c.corrupt('unlockedPool');
  else
    for (const field of ['jokers', 'vouchers', 'boosters'])
      if (d.unlockedPool[field] !== null && !isStringArray(d.unlockedPool[field]))
        c.corrupt(`unlockedPool.${field}`);
  checkStats(c, d.stats);
  if (d.rewards !== null) {
    const r = d.rewards;
    if (!isRecord(r) || !isFiniteNumber(r.total) || !Array.isArray(r.extra)) c.corrupt('rewards');
    else
      r.extra.forEach((e, i) => {
        if (!isRecord(e) || typeof e.source !== 'string' || !isFiniteNumber(e.amount))
          c.corrupt(`rewards.extra[${i}]`);
      });
  }
  if (d.gameOver !== null && !isRecord(d.gameOver)) c.corrupt('gameOver');

  // Kolo, Večerka, obálka.
  if (d.round !== null) {
    if (isRecord(d.round)) checkRound(c, d.round, deckIds);
    else c.corrupt('round');
  }
  if (d.shop !== null) {
    if (isRecord(d.shop)) checkShop(c, d.shop);
    else c.corrupt('shop');
  }
  if (d.booster !== null) {
    if (isRecord(d.booster)) checkBooster(c, d.booster, deckIds);
    else c.corrupt('booster');
  }

  // Fáze musí mít svá data — jinak by hra uvízla (akce fáze by končily „wrongPhase“).
  const phase = d.phase as RunPhase;
  if (ROUND_PHASES.includes(phase) && !isRecord(d.round)) c.corrupt('round');
  if (phase === 'shop' && !isRecord(d.shop)) c.corrupt('shop');
  if (phase === 'booster') {
    if (!isRecord(d.booster)) c.corrupt('booster');
    else if (d.booster.returnTo === 'shop' && !isRecord(d.shop)) c.corrupt('shop');
  }
  if (
    phase === 'blind_select' &&
    Array.isArray(d.blinds) &&
    isId(d.blindIndex) &&
    !isRecord(d.blinds[d.blindIndex])
  )
    c.corrupt('blindIndex');
  return c.issues;
}

/** Jde run hrát (žádný nález `corrupt`)? Neznámý obsah hraní nebrání. */
export function isPlayableRunState(data: unknown): boolean {
  return !validateRunState(data).some((i) => i.kind === 'corrupt');
}
