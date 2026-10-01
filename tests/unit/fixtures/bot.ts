/**
 * Jednoduchý deterministický „bot“ pro testy celého runu (determinismus, save/load): v každé fázi sestaví seznam
 * kandidátních akcí v pevném pořadí a provede **první platnou** (neplatné akce stav nemění, takže zkoušení je
 * bezpečné a zároveň prověří odmítání). Hraje rozumně dost na to, aby prošel Večerkami, obálkami, šéfy a patry.
 * Není to simulační bot (`src/engine/sim`), jen testovací pomůcka.
 */
import { compareCards } from '../../../src/engine/cards/cards';
import type { Game } from '../../../src/engine/run/game';
import type { Action, ActionResult, Card, GameEvent } from '../../../src/engine/types';

/** Všechny podmnožiny velikosti 1–`max` (v pořadí ruky). */
function subsets(ids: readonly number[], max: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, cur: number[]): void => {
    if (cur.length > 0) out.push([...cur]);
    if (cur.length === max) return;
    for (let i = start; i < ids.length; i++) {
      cur.push(ids[i]!);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

/** Výběr s nejvyšším náhledem čipy × mult (náhled je dotaz bez vedlejších účinků); při shodě první nalezený. */
export function bestHand(game: Game): number[] {
  const hand = game.state.round!.hand;
  const max = game.modifiers().maxSelect;
  let best: number[] = hand.slice(0, Math.min(max, hand.length));
  let bestValue = -1;
  for (const ids of subsets(hand, max)) {
    const p = game.preview(ids);
    if (p.hidden || !p.hand) continue;
    const value = p.chips * p.mult;
    if (value > bestValue) {
      bestValue = value;
      best = ids;
    }
  }
  return best;
}

/** `n` karet s nejnižší hodnotou (při shodě podle id). */
function lowest(game: Game, n: number): number[] {
  const cards = game.state.round!.hand.map((id) => game.card(id)!) as Card[];
  return cards
    .sort((a, b) => a.rank - b.rank || a.id - b.id)
    .slice(0, n)
    .map((c) => c.id);
}

function sortedBy<T>(items: readonly T[], key: (x: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** Kandidátní akce v pořadí priority pro aktuální fázi. */
export function botCandidates(game: Game): Action[] {
  const s = game.state;
  const out: Action[] = [];
  switch (s.phase) {
    case 'blind_select': {
      // Žolíky srovná podle id (jednorázově — pak už jsou srovnaní).
      const sorted = sortedBy(s.jokers, (j) => j.defId);
      if (sorted.some((j, i) => j !== s.jokers[i]))
        out.push({ type: 'reorderJokers', uids: sorted.map((j) => j.uid) });
      // Velkou útratu v sudých patrech přeskočí (štítky), jinak hraje.
      if (s.blinds[s.blindIndex]?.kind === 'big' && s.ante % 2 === 0) out.push({ type: 'skipBlind' });
      out.push({ type: 'selectBlind' });
      return out;
    }
    case 'round': {
      const r = s.round!;
      // Ruku seřadí podle hodnoty, když seřazená není (stejné řazení jako engine — jinak by třídil pořád dokola).
      const enh = game._core.enhancements();
      const sorted = [...r.hand].sort((x, y) => compareCards(game.card(x)!, game.card(y)!, 'rank', enh));
      if (sorted.some((id, i) => id !== r.hand[i])) out.push({ type: 'sortHand', by: 'rank' });
      for (const c of s.consumables) {
        const def = game.registry.consumables[c.defId];
        out.push({
          type: 'useConsumable',
          uid: c.uid,
          targetIds: def?.target ? r.hand.slice(0, def.target.min) : [],
        });
      }
      if (r.handsPlayed === 0 && r.discardsUsed === 0 && r.discardsLeft > 0)
        out.push({ type: 'discard', cardIds: lowest(game, 2) });
      out.push({ type: 'play', cardIds: bestHand(game) });
      return out;
    }
    case 'round_end': {
      // Plné sloty: prodá nejlevnějšího prodejného žolíka (uvolní místo pro nákup).
      if (s.jokers.length >= game.modifiers().jokerSlots) {
        const sellable = s.jokers.filter((j) => !j.stickers.includes('eternal'));
        const cheapest = sellable.sort(
          (a, b) => game.sellValue(a.uid) - game.sellValue(b.uid) || a.uid - b.uid,
        )[0];
        if (cheapest) out.push({ type: 'sellJoker', uid: cheapest.uid });
      }
      out.push({ type: 'cashOut' });
      return out;
    }
    case 'shop': {
      const shop = s.shop!;
      shop.vouchers.forEach((v, i) => {
        if (!v.sold) out.push({ type: 'buyVoucher', slot: i });
      });
      shop.items.forEach((it, i) => {
        if (it.sold) return;
        out.push({ type: 'buy', slot: i });
        // Spotřebka bez volného slotu se rovnou použije.
        if (it.kind === 'consumable') out.push({ type: 'buyAndUse', slot: i });
      });
      shop.boosters.forEach((b, i) => {
        if (!b.sold && s.money >= b.price + 4) out.push({ type: 'buyBooster', slot: i });
      });
      if (shop.rerollsThisShop === 0 && s.money >= shop.rerollCost + 6) out.push({ type: 'reroll' });
      out.push({ type: 'leaveShop' });
      return out;
    }
    case 'booster': {
      const b = s.booster!;
      b.options.forEach((o, i) => {
        if (o.kind === 'consumable') {
          const def = game.registry.consumables[o.consumable.defId];
          out.push({
            type: 'pickBooster',
            index: i,
            targetIds: def?.target ? b.hand.slice(0, def.target.min) : [],
          });
          out.push({ type: 'pickBooster', index: i, keep: true });
        } else {
          out.push({ type: 'pickBooster', index: i });
        }
      });
      out.push({ type: 'skipBooster' });
      return out;
    }
    case 'victory':
      return [{ type: 'continueEndless' }];
    default:
      return [];
  }
}

export interface BotStep {
  action: Action;
  result: Extract<ActionResult, { ok: true }>;
}

/** Provede první platnou kandidátní akci. Vrací null na konci runu; když neprojde žádná akce, vyhodí výjimku. */
export function botStep(game: Game): BotStep | null {
  const candidates = botCandidates(game);
  if (candidates.length === 0) return null;
  for (const action of candidates) {
    const result = game.dispatch(action);
    if (result.ok) return { action, result };
  }
  throw new Error(`bot uvázl ve fázi ${game.state.phase}`);
}

export interface BotRun {
  actions: Action[];
  events: GameEvent[];
  steps: number;
}

/**
 * Hraje bota, dokud run neskončí nebo nedojde `maxSteps` akcí. `between` se zavolá po každé akci a smí vrátit
 * náhradní hru (např. uloženou a znovu načtenou) — pokračuje se s ní.
 */
export function runBot(
  game: Game,
  opts: { maxSteps?: number; between?: (game: Game, step: number) => Game } = {},
): BotRun & { game: Game } {
  const max = opts.maxSteps ?? 5000;
  const run: BotRun & { game: Game } = { actions: [], events: [], steps: 0, game };
  while (run.steps < max) {
    const step = botStep(run.game);
    if (!step) break;
    run.steps++;
    run.actions.push(step.action);
    run.events.push(...step.result.events);
    if (opts.between) run.game = opts.between(run.game, run.steps);
  }
  return run;
}
