/**
 * Příkazy textového režimu (`npm run simulate -- --play`): převod řádku typu „h 1 3 5“ na akci enginu.
 * Bez textů — výpis a hlášky dělá scripts/simulate.ts přes src/i18n. Pozice karet, slotů a nabídky jsou
 * číslované od 1 tak, jak je výpis ukazuje.
 */
import type { Game } from '../run/game';
import type { Action, RunState } from '../types';

export type PlayCommand =
  | { kind: 'action'; action: Action }
  /** Náhled kombinace bez zahrání („n 1 3 5“). */
  | { kind: 'preview'; cardIds: number[] }
  | { kind: 'help' }
  | { kind: 'quit' }
  | { kind: 'show' }
  /** Zbývající karty v dobíracím balíčku. */
  | { kind: 'deck' }
  | { kind: 'error'; reason: 'unknown' | 'args' | 'phase' };

/** Položka nabídky Večerky v pořadí výpisu: nejdřív kartové sloty, pak kupóny (obálky mají vlastní „o N“). */
export type ShopOffer = { kind: 'item'; slot: number } | { kind: 'voucher'; slot: number };

export function shopOffers(state: Readonly<RunState>): ShopOffer[] {
  const shop = state.shop;
  if (!shop) return [];
  return [
    ...shop.items.map((_, slot): ShopOffer => ({ kind: 'item', slot })),
    ...shop.vouchers.map((_, slot): ShopOffer => ({ kind: 'voucher', slot })),
  ];
}

const ERR_ARGS: PlayCommand = { kind: 'error', reason: 'args' };
const ERR_PHASE: PlayCommand = { kind: 'error', reason: 'phase' };

/** Kladná celá čísla z tokenů (pozice od 1), jinak null. */
function positions(tokens: readonly string[]): number[] | null {
  const out: number[] = [];
  for (const t of tokens) {
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    if (n < 1) return null;
    out.push(n);
  }
  return out;
}

/** Pozice → id karet v `pool` (ruka kola nebo obálky); mimo rozsah → null. */
function cardIdsAt(pool: readonly number[], pos: readonly number[]): number[] | null {
  const ids: number[] = [];
  for (const p of pos) {
    const id = pool[p - 1];
    if (id === undefined) return null;
    ids.push(id);
  }
  return ids;
}

/** Karty, na které jde mířit spotřebkou (ruka kola nebo ruka otevřené obálky). */
function targetPool(state: Readonly<RunState>): readonly number[] {
  if (state.phase === 'booster' && state.booster) return state.booster.hand;
  return state.round?.hand ?? [];
}

/** Jedno číslo (pozice od 1) a nepovinné cíle za ním. */
function indexAndTargets(state: Readonly<RunState>, args: readonly string[]): [number, number[]] | null {
  const nums = positions(args);
  if (!nums || nums.length === 0) return null;
  const targets = cardIdsAt(targetPool(state), nums.slice(1));
  if (!targets) return null;
  return [nums[0]! - 1, targets];
}

export function parsePlayCommand(game: Game, line: string): PlayCommand {
  const tokens = line.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const s = game.state;
  const [cmd, ...args] = tokens;
  const action = (a: Action): PlayCommand => ({ kind: 'action', action: a });
  switch (cmd) {
    case undefined:
      return { kind: 'show' };
    case '?':
    case 'help':
    case 'napoveda':
    case 'nápověda':
      return { kind: 'help' };
    case 'q':
    case 'konec':
      return { kind: 'quit' };
    case 'l':
      return s.round ? { kind: 'deck' } : ERR_PHASE;
    case 'h':
    case 'z':
    case 'n': {
      if (s.phase !== 'round' || !s.round) return ERR_PHASE;
      const pos = positions(args);
      const ids = pos && pos.length > 0 ? cardIdsAt(s.round.hand, pos) : null;
      if (!ids) return ERR_ARGS;
      if (cmd === 'n') return { kind: 'preview', cardIds: ids };
      return action({ type: cmd === 'h' ? 'play' : 'discard', cardIds: ids });
    }
    case 's':
    case 'b':
      if (args.length > 0) return ERR_ARGS;
      return action({ type: 'sortHand', by: cmd === 's' ? 'rank' : 'suit' });
    case 'v':
      return s.phase === 'blind_select' ? action({ type: 'selectBlind' }) : ERR_PHASE;
    case 'p':
      if (s.phase === 'blind_select') return action({ type: 'skipBlind' });
      if (s.phase === 'booster') return action({ type: 'skipBooster' });
      return ERR_PHASE;
    case 'd':
      if (s.phase === 'round_end') return action({ type: 'cashOut' });
      if (s.phase === 'shop') return action({ type: 'leaveShop' });
      if (s.phase === 'victory') return action({ type: 'continueEndless' });
      return ERR_PHASE;
    case 'r':
      return s.phase === 'shop' ? action({ type: 'reroll' }) : ERR_PHASE;
    case 'k': {
      const parsed = indexAndTargets(s, args);
      if (!parsed) return ERR_ARGS;
      const [index, targets] = parsed;
      if (s.phase === 'booster') {
        return action(
          targets.length > 0
            ? { type: 'pickBooster', index, targetIds: targets }
            : { type: 'pickBooster', index },
        );
      }
      if (s.phase !== 'shop') return ERR_PHASE;
      const offer = shopOffers(s)[index];
      if (!offer || targets.length > 0) return ERR_ARGS;
      return action(
        offer.kind === 'item' ? { type: 'buy', slot: offer.slot } : { type: 'buyVoucher', slot: offer.slot },
      );
    }
    case 'ku': {
      if (s.phase !== 'shop') return ERR_PHASE;
      const nums = positions(args);
      const offer = nums && nums.length === 1 ? shopOffers(s)[nums[0]! - 1] : undefined;
      if (!offer || offer.kind !== 'item') return ERR_ARGS;
      return action({ type: 'buyAndUse', slot: offer.slot });
    }
    case 'ul': {
      if (s.phase !== 'booster') return ERR_PHASE;
      const nums = positions(args);
      if (!nums || nums.length !== 1) return ERR_ARGS;
      return action({ type: 'pickBooster', index: nums[0]! - 1, keep: true });
    }
    case 'o': {
      if (s.phase !== 'shop') return ERR_PHASE;
      const nums = positions(args);
      if (!nums || nums.length !== 1) return ERR_ARGS;
      return action({ type: 'buyBooster', slot: nums[0]! - 1 });
    }
    case 'u': {
      const parsed = indexAndTargets(s, args);
      if (!parsed) return ERR_ARGS;
      const [index, targets] = parsed;
      const c = s.consumables[index];
      if (!c) return ERR_ARGS;
      return action(
        targets.length > 0
          ? { type: 'useConsumable', uid: c.uid, targetIds: targets }
          : { type: 'useConsumable', uid: c.uid },
      );
    }
    case 'pz':
    case 'ps': {
      const nums = positions(args);
      if (!nums || nums.length !== 1) return ERR_ARGS;
      const list = cmd === 'pz' ? s.jokers : s.consumables;
      const item = list[nums[0]! - 1];
      if (!item) return ERR_ARGS;
      return action(
        cmd === 'pz' ? { type: 'sellJoker', uid: item.uid } : { type: 'sellConsumable', uid: item.uid },
      );
    }
    case 'm': {
      const nums = positions(args);
      if (!nums || nums.length !== 2) return ERR_ARGS;
      const [from, to] = [nums[0]! - 1, nums[1]! - 1];
      if (from >= s.jokers.length || to >= s.jokers.length) return ERR_ARGS;
      const uids = s.jokers.map((j) => j.uid);
      const [moved] = uids.splice(from, 1);
      uids.splice(to, 0, moved!);
      return action({ type: 'reorderJokers', uids });
    }
    default:
      return { kind: 'error', reason: 'unknown' };
  }
}
