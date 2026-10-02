/**
 * Laboratoř buildu pro boty (docs/DESIGN.md kap. 12.2): přesné skóre „typických rukou“ bota se zvolenou sestavou
 * žolíků nebo se zvýšenou úrovní kombinace. Slouží k ocenění žolíků (mezní hodnota ve skutečném skórování místo
 * tabulky vzácností), pranostik a pořadí žolíků.
 *
 * Typická ruka = náhodná ruka z **veřejného složení** balíčku (ne z pořadí — to bot nezná) o `handSize + LAB_EXTRA`
 * kartách (rezerva za zahazování), z níž bot vybere tah svým odhadem; skóruje se na syntetickém kole bez šéfa
 * (žádná pravidla útraty) čistou funkcí enginu `scoreHand` nad kopií stavu. Vzorky i RNG skórování jsou seedované
 * seedem runu a otiskem balíčku, ne stavem RNG hry — bot nevidí budoucí hody.
 *
 * Výsledky jsou čisté funkce vstupu, takže je smí sdílet paměť (`MEMO`) napříč rozhodnutími i runy: klíč obsahuje
 * otisk celého stavu, ze kterého se počítá (bez žolíků) a sestavu žolíků. Determinismus to neporuší.
 */
import type { Rng } from '../content-types';
import { GameCore } from '../effects/core';
import { cyrb128, rngFromState } from '../rng/rng';
import { Game } from '../run/game';
import { scoreHand } from '../scoring/score';
import type { HandType, JokerInstance, RoundState, RunState } from '../types';
import { HAND_TYPES } from '../types';
import { cardValue, planCandidates, RNG_STREAM_NAMES, type CardValue, type EvalEnv } from './hand-eval';

/** Počet typických rukou (přesně skórovaných). */
export const LAB_SAMPLES = 8;
/** Karet navíc nad velikost ruky (náhrada za zahazování — bot si z větší hromádky vybere lepší tah). */
export const LAB_EXTRA = 3;
/** Strop paměti výsledků (při překročení se vymaže celá). */
const MEMO_MAX = 20000;
const MEMO = new Map<string, readonly number[]>();

export interface LabSample {
  /** Karty v ruce (tah + držené). */
  hand: number[];
  /** Zahraný tah. */
  play: number[];
  type: HandType | null;
  /** Kolikátá ruka kola (0 = první) — žolíci na první/poslední ruku se tak průměrují. */
  handsPlayed: number;
}

export interface BuildLab {
  readonly samples: readonly LabSample[];
  /** Podíl kombinace mezi typickými tahy (0–1). */
  readonly typeShare: Readonly<Partial<Record<HandType, number>>>;
  /** Skóre typických rukou se současnými žolíky. */
  readonly base: number;
  /**
   * Součet skóre typických rukou se sestavou `jokers` (v tomto pořadí; instance se kopírují), volitelně se
   * zvýšenou úrovní kombinace `levelUp` o `levels`.
   */
  score(jokers: readonly Readonly<JokerInstance>[], levelUp?: HandType, levels?: number): number;
}

/** Otisk balíčku (seed vzorků): složení karet včetně úprav. */
function deckKey(s: Readonly<RunState>): string {
  let h = '';
  for (const c of s.deck) h += `${c.id}.${c.rank}${c.suit}${c.enhancement ?? ''}${c.seal ?? ''}${c.edition ?? ''};`;
  return cyrb128(h).join('.');
}

function jokersKey(jokers: readonly Readonly<JokerInstance>[]): string {
  return JSON.stringify(jokers.map((j) => [j.defId, j.edition, j.state, j.debuffed, j.stickers, j.perishRounds]));
}

/** Syntetický stav kola bez šéfa (šablona; ruka a žolíci se doplní pro každý vzorek). */
function templateState(game: Game): RunState {
  const st = JSON.parse(JSON.stringify(game.state)) as RunState;
  const mods = game.modifiers();
  st.phase = 'round';
  st.shop = null;
  st.booster = null;
  st.gameOver = null;
  for (const c of st.deck) {
    c.debuffed = false;
    c.faceDown = false;
  }
  for (const j of st.jokers) j.debuffed = j.perishRounds === 0;
  const round: RoundState = {
    blind: 'small',
    bossId: null,
    bossDisabled: false,
    target: Number.MAX_SAFE_INTEGER,
    score: 0,
    handsLeft: Math.max(1, mods.hands),
    discardsLeft: Math.max(0, mods.discards),
    drawPile: [],
    hand: [],
    discardPile: [],
    playedPile: [],
    handsPlayed: 0,
    discardsUsed: 0,
    handTypesPlayed: [],
    handSizeDelta: 0,
    jokerDebuffs: [],
    cleansedCards: [],
    ruleJokerDebuffs: [],
    flags: {},
  };
  st.round = round;
  return st;
}

/**
 * Laboratoř pro stav `game`. `pickPlay` vybere tah z hromádky karet (stejně jako bot v kole); `seedKey` určuje
 * vzorky (stejný klíč ⇒ stejné typické ruce, i napříč rozhodnutími ve Večerce).
 */
export function makeLab(
  game: Game,
  env: EvalEnv,
  filler: (cards: readonly CardValue[]) => CardValue[],
  samples = LAB_SAMPLES,
): BuildLab {
  const s = game.state;
  const template = templateState(game);
  const realJokers = template.jokers;
  template.jokers = [];
  const templateJson = JSON.stringify(template);
  const tplKey = cyrb128(templateJson).join('.');
  const evalGame = Game.fromState(JSON.parse(templateJson) as RunState, game.registry);
  const evalEnv: EvalEnv = { ...env, blocked: undefined, hiddenPad: false };
  const mods = game.modifiers();
  const handSize = Math.max(1, mods.handSize);
  const hands = Math.max(1, mods.hands);
  const rng: Rng = rngFromState(cyrb128(`${s.seed}:lab:${s.ante}:${s.blindIndex}:${deckKey(s)}`));
  const ids = s.deck.map((c) => c.id);
  const list: LabSample[] = [];
  const counts: Partial<Record<HandType, number>> = {};
  for (let k = 0; k < samples && ids.length > 0; k++) {
    const take = Math.min(ids.length, handSize + LAB_EXTRA);
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(rng.next() * (ids.length - i));
      const tmp = ids[i]!;
      ids[i] = ids[j]!;
      ids[j] = tmp;
    }
    const pile = ids.slice(0, take);
    const cards = pile.map((id) => cardValue(evalGame.card(id)!, evalEnv));
    const best = planCandidates(evalGame, cards, evalEnv, filler(cards))[0];
    if (!best) continue;
    const rest = pile.filter((id) => !best.ids.includes(id));
    const hand = [...best.ids, ...rest.slice(0, Math.max(0, handSize - best.ids.length))];
    list.push({ hand, play: best.ids, type: best.type, handsPlayed: k % hands });
    if (best.type) counts[best.type] = (counts[best.type] ?? 0) + 1;
  }
  const typeShare: Partial<Record<HandType, number>> = {};
  for (const t of HAND_TYPES) if (counts[t]) typeShare[t] = counts[t]! / Math.max(1, list.length);
  const sampleKey = list.map((x) => `${x.play.join(',')}/${x.hand.length}`).join('|');
  const deckIds = s.deck.map((c) => c.id);

  const scoreOne = (sample: LabSample, k: number, jokersJson: string, levelUp?: HandType, levels = 1): number => {
    const st = JSON.parse(templateJson) as RunState;
    st.jokers = JSON.parse(jokersJson) as JokerInstance[];
    const round = st.round!;
    const inHand = new Set(sample.hand);
    round.hand = [...sample.hand];
    round.drawPile = deckIds.filter((id) => !inHand.has(id));
    round.handsPlayed = sample.handsPlayed;
    round.handsLeft = Math.max(1, hands - sample.handsPlayed);
    if (levelUp && st.handLevels[levelUp]) st.handLevels[levelUp].level += levels;
    const seed = cyrb128(`${s.seed}:labrng:${k}`);
    for (const name of RNG_STREAM_NAMES) st.rng[name] = [(seed[0]! | 1) >>> 0, seed[1]!, seed[2]!, seed[3]!];
    try {
      const res = scoreHand(new GameCore(st, game.registry), sample.play);
      return res.blockedReason ? 0 : Math.max(0, res.score);
    } catch {
      return 0;
    }
  };

  /** Skóre jednotlivých vzorků (paměť podle otisku stavu, vzorků, sestavy a úrovně). */
  const perSample = (jokers: readonly Readonly<JokerInstance>[], levelUp?: HandType, levels = 1): readonly number[] => {
    // Dočasné vypnutí (šéf, kolo) se do laboratoře nepřenáší — jen zvětralí žolíci zůstanou mimo provoz.
    const norm = jokers.map((j) => ({ ...j, debuffed: j.perishRounds === 0 }));
    const jokersJson = JSON.stringify(norm);
    const key = `${tplKey}|${sampleKey}|${jokersKey(norm)}|${levelUp ? `${levelUp}+${levels}` : ''}`;
    const hit = MEMO.get(key);
    if (hit) return hit;
    const base = levelUp ? perSample(jokers) : null;
    const out = list.map((sample, k) =>
      base && sample.type !== levelUp ? base[k]! : scoreOne(sample, k, jokersJson, levelUp, levels),
    );
    if (MEMO.size >= MEMO_MAX) MEMO.clear();
    MEMO.set(key, out);
    return out;
  };

  const score = (jokers: readonly Readonly<JokerInstance>[], levelUp?: HandType, levels = 1): number =>
    perSample(jokers, levelUp, levels).reduce((a, b) => a + b, 0);

  const base = score(realJokers);
  return { samples: list, typeShare, base, score };
}
