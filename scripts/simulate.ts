/**
 * npm run simulate -- --runs 500 --stake 1 [--deck pub] [--bot all|max,flush,…] [--seed-prefix A] [--json [soubor]]
 * npm run simulate -- --play [--seed SEED] [--deck pub] [--stake 1] [--script "v;h 1 2 3;d"]
 *
 * Headless simulace runů boty (src/engine/sim, docs/DESIGN.md kap. 12) a textový hratelný režim v terminálu.
 * Run `i` sady má seed `SIM-<prefix>-<i>`, takže výsledek je pro stejné parametry deterministický (doba běhu
 * se vypisuje jen v textovém výstupu, `--json` ji neobsahuje). Všechny texty jdou přes src/i18n.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { registry as contentRegistry, validateRegistry } from '../src/content/index';
import type { ContentRegistry } from '../src/engine/content-types';
import { FINAL_ANTE, MAX_STAKE } from '../src/engine/constants';
import { generateSeed } from '../src/engine/rng/rng';
import { Game } from '../src/engine/run/game';
import {
  BOT_NAMES,
  createBot,
  parsePlayCommand,
  resolveBotName,
  shopOffers,
  simSeed,
  simulateMany,
  summarizeRuns,
  WIN_RATE_TARGETS,
  type BotName,
  type SimSummary,
} from '../src/engine/sim/index';
import type { BlindKind, BoosterOption, Card, GameEvent, ShopItem } from '../src/engine/types';
import { hasKey, t, tList } from '../src/i18n/cs';
import { formatSigned } from '../src/i18n/format';

// ─────────────────────────── Volby ───────────────────────────

export interface SimOptions {
  runs: number;
  stake: number;
  deck: string;
  bots: BotName[];
  seedPrefix: string;
  maxActions: number | undefined;
  /** `null` = textový výstup; `'-'` = JSON na stdout; jinak cesta k souboru. */
  json: string | null;
}

export interface PlayOptions {
  seed: string;
  deck: string;
  stake: number;
  /** Neinteraktivní příkazy (oddělené středníkem); null = interaktivně ze stdin. */
  script: string[] | null;
}

export type CliOptions =
  { mode: 'sim'; sim: SimOptions } | { mode: 'play'; play: PlayOptions } | { mode: 'help' };

export class CliError extends Error {}

function positiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new CliError(t('cli.errors.positiveInt', { name, value: raw }));
  return n;
}

/**
 * Rozebere argumenty. `--json` smí stát samo nebo s `-` (JSON na stdout) i s cestou k souboru (`--json out.json`,
 * `--json=out.json`); `--strategy` je starší název `--bot` (DESIGN 12.3).
 */
export function parseCli(argv: readonly string[], reg: ContentRegistry = contentRegistry()): CliOptions {
  const args = [...argv];
  let json: string | null = null;
  const ji = args.findIndex((a) => a === '--json' || a.startsWith('--json='));
  if (ji >= 0) {
    const arg = args[ji]!;
    if (arg !== '--json') {
      json = arg.slice('--json='.length) || '-';
      args.splice(ji, 1);
    } else {
      // Další argument je cesta, pokud není volbou („-“ samo = stdout).
      const next = args[ji + 1];
      const hasValue = next !== undefined && (next === '-' || !next.startsWith('-'));
      json = hasValue ? next : '-';
      args.splice(ji, hasValue ? 2 : 1);
    }
  }
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        runs: { type: 'string', default: '500' },
        stake: { type: 'string', default: '1' },
        deck: { type: 'string', default: 'pub' },
        bot: { type: 'string' },
        strategy: { type: 'string' },
        'seed-prefix': { type: 'string', default: 'A' },
        'max-actions': { type: 'string' },
        play: { type: 'boolean', default: false },
        seed: { type: 'string' },
        script: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    }));
  } catch (e) {
    throw new CliError(t('cli.errors.args', { message: (e as Error).message }));
  }
  if (values.help) return { mode: 'help' };
  const stake = positiveInt('stake', values.stake);
  if (stake > MAX_STAKE) throw new CliError(t('cli.errors.stake', { max: MAX_STAKE }));
  if (!Object.values(reg.stakes).some((s) => s.level === stake))
    throw new CliError(t('cli.errors.unknownStake', { stake }));
  if (!reg.decks[values.deck])
    throw new CliError(
      t('cli.errors.unknownDeck', { deck: values.deck, list: Object.keys(reg.decks).sort().join(', ') }),
    );
  if (values.play) {
    const script =
      values.script === undefined
        ? null
        : values.script
            .split(';')
            .map((c) => c.trim())
            .filter((c, i, all) => c !== '' || i < all.length - 1);
    return {
      mode: 'play',
      play: { seed: values.seed ?? generateSeed(Math.random), deck: values.deck, stake, script },
    };
  }
  const botArg = (values.bot ?? values.strategy ?? 'all').trim();
  const bots: BotName[] = [];
  for (const raw of botArg.toLowerCase() === 'all' ? BOT_NAMES : botArg.split(',')) {
    const name = resolveBotName(raw);
    if (!name) throw new CliError(t('cli.errors.unknownBot', { bot: raw, list: BOT_NAMES.join(', ') }));
    if (!bots.includes(name)) bots.push(name);
  }
  return {
    mode: 'sim',
    sim: {
      runs: positiveInt('runs', values.runs),
      stake,
      deck: values.deck,
      bots,
      seedPrefix: values['seed-prefix'],
      maxActions: values['max-actions'] ? positiveInt('max-actions', values['max-actions']) : undefined,
      json,
    },
  };
}

// ─────────────────────────── Pomocné texty ───────────────────────────

/** Text obsahu podle klíče, nebo id (testovací obsah texty nemá). */
function nameOf(
  prefix: string,
  id: string,
  field = 'name',
  params?: Record<string, number | string>,
): string {
  const key = `${prefix}.${id}.${field}`;
  return hasKey(key) ? t(key, params) : id;
}

/** Pravidlo šéfa s dosazenými čísly z `BossDef.params` (texty je mají jen přes `{param}`). */
function bossRuleText(bossId: string): string {
  return nameOf('bosses', bossId, 'rule', contentRegistry().bosses[bossId]?.params);
}

function stakeName(reg: ContentRegistry, level: number): string {
  const def = Object.values(reg.stakes).find((s) => s.level === level);
  return def ? nameOf('stakes', def.id) : String(level);
}

function causeName(cause: string): string {
  if (cause === 'small' || cause === 'big' || cause === 'boss') return t(`cli.blind.${cause}`);
  if (cause === 'actionLimit') return t('cli.sim.actionLimit');
  return nameOf('bosses', cause);
}

/** Zaokrouhlení pro výpis (formátuje až `t()` — čísla musí zůstat čísly kvůli filtrům `|money` apod.). */
const n1 = (x: number): number => Math.round(x * 10) / 10;
const n0 = (x: number): number => Math.round(x);

/** Boti „rozumné strategie“, podle kterých se měří cíl % výher (DESIGN 12.1). */
const REASONABLE_BOTS: readonly string[] = ['max', 'flush', 'pairs'];

// ─────────────────────────── Simulace ───────────────────────────

export interface SimReport {
  options: SimOptions;
  summaries: Record<string, SimSummary>;
}

/** Odehraje sady runů všech zvolených botů (stejné seedy pro všechny boty). */
export function runSimulation(opts: SimOptions, reg: ContentRegistry = contentRegistry()): SimReport {
  const summaries: Record<string, SimSummary> = {};
  for (const name of opts.bots) {
    const results = simulateMany(reg, {
      runs: opts.runs,
      seedPrefix: opts.seedPrefix,
      deckId: opts.deck,
      stake: opts.stake,
      bot: createBot(name),
      maxActions: opts.maxActions,
    });
    summaries[name] = summarizeRuns(results);
  }
  return { options: opts, summaries };
}

/**
 * Strojový výstup (deterministický — bez doby běhu a bez cíle výstupu: stejné parametry = stejné bajty, ať jde
 * JSON do souboru, nebo na stdout).
 */
export function reportJson(report: SimReport): string {
  const { json: _target, ...options } = report.options;
  return JSON.stringify({ ...report, options }, null, 2);
}

function anteList(counts: readonly number[], runs: number, skipZero = false): string {
  const items: string[] = [];
  counts.forEach((count, i) => {
    if ((i < FINAL_ANTE && !skipZero) || count > 0)
      items.push(t('cli.sim.anteItem', { ante: i + 1, pct: n1((100 * count) / Math.max(1, runs)) }));
  });
  return items.join(' · ');
}

/** Textový výstup podle DESIGN 12.3. */
export function reportText(report: SimReport, reg: ContentRegistry = contentRegistry()): string[] {
  const o = report.options;
  const sName = stakeName(reg, o.stake);
  const lines: string[] = [
    t('cli.sim.title'),
    t('cli.sim.params', {
      runs: o.runs,
      stake: o.stake,
      stakeName: sName,
      deck: nameOf('decks', o.deck),
      first: simSeed(o.seedPrefix, 1),
      last: simSeed(o.seedPrefix, o.runs),
    }),
    t('cli.sim.content', {
      jokers: Object.keys(reg.jokers).length,
      bosses: Object.keys(reg.bosses).length,
      consumables: Object.keys(reg.consumables).length,
      boosters: Object.keys(reg.boosters).length,
    }),
  ];
  for (const [id, s] of Object.entries(report.summaries)) {
    lines.push('');
    lines.push(t('cli.sim.bot', { id, name: nameOf('cli.bots', id), desc: nameOf('cli.bots', id, 'desc') }));
    const losses = s.runs - s.wins;
    const indent = (text: string) => `  ${text}`;
    lines.push(indent(t('cli.sim.wins', { wins: s.wins, runs: s.runs, rate: n1(s.winRate) })));
    lines.push(indent(t('cli.sim.reached', { list: anteList(s.reachedAnte, s.runs) })));
    if (losses > 0) {
      lines.push(indent(t('cli.sim.losses', { list: anteList(s.lostAtAnte, s.runs, true) })));
      const top = s.causes[0]!;
      lines.push(
        indent(t('cli.sim.topCause', { cause: causeName(top.cause), pct: n1((100 * top.count) / losses) })),
      );
      const causes = s.causes
        .map((c) => t('cli.sim.causeItem', { cause: causeName(c.cause), pct: n1((100 * c.count) / losses) }))
        .join(' · ');
      lines.push(indent(t('cli.sim.causes', { list: causes })));
    } else {
      lines.push(indent(t('cli.sim.noLoss')));
    }
    lines.push(
      indent(
        t('cli.sim.score', {
          avg: n0(s.avgBestHand),
          median: n0(s.medianBestHand),
          loss: n0(s.avgLossScore),
          ratio: n0(100 * s.avgLossRatio),
        }),
      ),
    );
    const st = s.strength;
    if (st.reached > 0)
      lines.push(
        indent(
          t('cli.sim.strength', {
            reached: st.reached,
            median: n0(st.medianBest8),
            p90: n0(st.p90Best8),
            wMedian: n0(st.winnersMedianBest8),
            wP90: n0(st.winnersP90Best8),
            ratio: n0(100 * st.medianFinalRatio),
          }),
        ),
      );
    lines.push(indent(t('cli.sim.money', { earned: n1(s.avgMoneyEarned), spent: n1(s.avgMoneySpent) })));
    const shops = Object.entries(s.avgShopMoney)
      .map(([ante, money]) => t('cli.sim.shopItem', { ante: Number(ante), money: n1(money) }))
      .join(' · ');
    if (shops) lines.push(indent(t('cli.sim.shopMoney', { list: shops })));
    lines.push(
      indent(
        t('cli.sim.length', { rounds: n1(s.avgRoundsWon), hands: n1(s.avgHands), actions: n1(s.avgActions) }),
      ),
    );
    const strong = s.jokers.filter((j) => j.runs >= Math.max(3, Math.ceil(s.runs * 0.02))).slice(0, 5);
    if (s.jokers.length === 0) lines.push(indent(t('cli.sim.jokersNone')));
    else if (strong.length > 0) {
      lines.push(indent(t('cli.sim.jokersTitle')));
      for (const j of strong) {
        lines.push(
          indent(
            `  ${t('cli.sim.jokerLine', {
              name: nameOf('jokers', j.id),
              runs: j.runs,
              with: n1(j.winRateWith),
              without: n1(j.winRateWithout),
              delta: formatSigned(n1(j.delta)),
            })}`,
          ),
        );
      }
    }
    lines.push(indent(t('cli.sim.invalid', { n: s.invalidActions })));
  }
  const all = Object.entries(report.summaries);
  const target = WIN_RATE_TARGETS[o.stake];
  const reasonable = all.filter(([id]) => REASONABLE_BOTS.includes(id));
  if (all.length > 1 || (target && reasonable.length > 0)) {
    lines.push('');
    lines.push(t('cli.sim.summary'));
    for (const [id, s] of all)
      lines.push(
        `  ${t('cli.sim.summaryLine', { id, rate: n1(s.winRate), ante: n1(s.avgAnte), best: n0(s.avgBestHand) })}`,
      );
    const best = reasonable.sort((a, b) => b[1].winRate - a[1].winRate)[0];
    if (target && best)
      lines.push(
        `  ${t('cli.sim.bestReasonable', {
          bots: REASONABLE_BOTS.join(', '),
          id: best[0],
          rate: n1(best[1].winRate),
          stake: o.stake,
          min: target[0],
          max: target[1],
        })}`,
      );
  }
  if (Object.keys(reg.jokers).length === 0) {
    lines.push('');
    lines.push(t('cli.sim.calibration'));
  }
  return lines;
}

// ─────────────────────────── Textový režim ───────────────────────────

function cardLabel(card: Readonly<Card>): string {
  if (card.faceDown) return t('cli.play.card.hidden');
  let out = `${t(`ranks.${card.rank}.short`)}${t(`suits.${card.suit}.symbol`)}`;
  const extras: string[] = [];
  if (card.enhancement) extras.push(nameOf('enhancements', card.enhancement));
  if (card.seal) extras.push(nameOf('seals', card.seal));
  if (card.edition) extras.push(nameOf('editions', card.edition));
  if (card.debuffed) extras.push(t('cli.play.card.debuffed'));
  if (extras.length > 0) out += `[${extras.join(', ')}]`;
  return out;
}

function numbered(game: Game, ids: readonly number[]): string {
  return ids.map((id, i) => `${i + 1}) ${game.card(id) ? cardLabel(game.card(id)!) : '?'}`).join('  ');
}

function plainCards(game: Game, ids: readonly number[]): string {
  return ids.map((id) => (game.card(id) ? cardLabel(game.card(id)!) : '?')).join(' ');
}

function blindName(kind: BlindKind): string {
  return t(`cli.blind.${kind}`);
}

function bossRule(bossId: string): string {
  return t('cli.play.round.boss', { boss: nameOf('bosses', bossId), rule: bossRuleText(bossId) });
}

function itemName(item: ShopItem | BoosterOption): string {
  if (item.kind === 'joker') return `${nameOf('jokers', item.joker.defId)} (${t('cli.play.kinds.joker')})`;
  if (item.kind === 'card') return `${cardLabel(item.card)} (${t('cli.play.kinds.card')})`;
  return `${nameOf('consumables', item.consumable.defId)} (${t(`cli.play.kinds.${item.consumableKind}`)})`;
}

/** Záhlaví výpisu: „Patro x/8“, v nekonečném režimu (patro 9+) bez „/8“. */
const header = (game: Game, what: string): string =>
  game.state.ante > FINAL_ANTE
    ? t('cli.play.headerEndless', { ante: game.state.ante, what })
    : t('cli.play.header', { ante: game.state.ante, final: FINAL_ANTE, what });

/** Statistika runu pro pitvu i výhru. */
function runStats(game: Game): string {
  const st = game.state.stats;
  return t('cli.play.gameOver.stats', {
    rounds: st.roundsWon,
    best: st.bestHandScore,
    hand: st.bestHandType ? t(`hands.${st.bestHandType}.name`) : t('cli.play.gameOver.noHand'),
  });
}

/** Hláška pitvy podle příčiny (DESIGN 1.2, příloha C): šéf `bosses.<id>.death`, jinak Malá/Velká útrata. */
function deathLine(cause: string, blind: BlindKind): string | null {
  const bossKey = `bosses.${cause}.death`;
  if (hasKey(bossKey)) return t(bossKey);
  const kind = cause === 'small' || cause === 'big' ? cause : blind;
  return kind === 'boss' ? null : t(`cli.play.gameOver.death.${kind}`);
}

/** Výpis stavu podle fáze. */
export function renderState(game: Game): string[] {
  const s = game.state;
  const mods = game.modifiers();
  const lines: string[] = [];
  const owned = (): void => {
    const none = t('cli.play.owned.none');
    const jokers = s.jokers.map((j, i) => `${i + 1}) ${nameOf('jokers', j.defId)}`).join('  ') || none;
    const cons =
      s.consumables.map((c, i) => `${i + 1}) ${nameOf('consumables', c.defId)}`).join('  ') || none;
    lines.push(t('cli.play.owned.jokers', { n: s.jokers.length, max: mods.jokerSlots, list: jokers }));
    lines.push(
      t('cli.play.owned.consumables', { n: s.consumables.length, max: mods.consumableSlots, list: cons }),
    );
    // Štítky za přeskočení se hromadí a čekají na svou chvíli (DESIGN 7) — hráč je musí vidět.
    if (s.tags.length > 0)
      lines.push(t('cli.play.owned.tags', { list: s.tags.map((tg) => nameOf('tags', tg.defId)).join(', ') }));
  };
  switch (s.phase) {
    case 'blind_select': {
      lines.push(header(game, t('cli.play.blindSelect.title')));
      lines.push(t('cli.play.shop.money', { money: s.money }));
      for (const b of s.blinds) {
        const status = b.status === 'upcoming' ? '' : ` [${t(`cli.play.blindSelect.${b.status}`)}]`;
        // Stejné číslo jako rozpis odměn (balíček Zbohatlík ×2, obtížnost bez odměny za Malou…).
        const reward = game.blindReward(b.kind, b.bossId);
        const extra = b.skipTagId
          ? t('cli.play.blindSelect.skipTag', { tag: nameOf('tags', b.skipTagId) })
          : '';
        lines.push(
          `  ${t('cli.play.blindSelect.line', {
            blind: blindName(b.kind),
            target: game.blindTarget(b.kind, b.bossId),
            reward,
            extra,
          })}${status}`,
        );
        if (b.bossId)
          lines.push(
            `    ${t('cli.play.blindSelect.boss', { boss: nameOf('bosses', b.bossId), rule: bossRuleText(b.bossId) })}`,
          );
      }
      owned();
      lines.push(t('cli.play.blindSelect.hint'));
      break;
    }
    case 'round': {
      const r = s.round!;
      lines.push(header(game, blindName(r.blind)));
      if (r.bossId && !r.bossDisabled) lines.push(bossRule(r.bossId));
      lines.push(t('cli.play.round.target', { target: r.target, score: r.score }));
      lines.push(
        t('cli.play.round.status', {
          hands: r.handsLeft,
          discards: r.discardsLeft,
          money: s.money,
          left: r.drawPile.length,
          total: s.deck.length,
        }),
      );
      if (s.jokers.length > 0 || s.consumables.length > 0 || s.tags.length > 0) owned();
      lines.push(t('cli.play.round.hand', { cards: numbered(game, r.hand) }));
      const best = game.preview(r.hand.filter((id) => !game.card(id)?.faceDown));
      if (best.hand)
        lines.push(
          t('cli.play.round.best', {
            hand: t(`hands.${best.hand.type}.name`),
            cards: plainCards(game, best.hand.scoringIds),
          }),
        );
      lines.push(t('cli.play.round.hint'));
      break;
    }
    case 'round_end': {
      const rw = s.rewards;
      lines.push(header(game, t('cli.play.roundEnd.title')));
      if (rw) {
        lines.push(t('cli.play.roundEnd.blind', { n: rw.blindReward }));
        lines.push(t('cli.play.roundEnd.hands', { n: rw.unusedHands }));
        if (rw.unusedDiscards) lines.push(t('cli.play.roundEnd.discards', { n: rw.unusedDiscards }));
        lines.push(t('cli.play.roundEnd.interest', { n: rw.interest }));
        const extra = rw.extra.reduce((a, e) => a + e.amount, 0);
        if (rw.extra.length > 0) lines.push(t('cli.play.roundEnd.extra', { n: extra }));
        lines.push(t('cli.play.roundEnd.total', { n: rw.total }));
      }
      lines.push(t('cli.play.roundEnd.hint'));
      break;
    }
    case 'shop': {
      const shop = s.shop!;
      lines.push(header(game, t('cli.play.shop.title')));
      lines.push(t('cli.play.shop.money', { money: s.money }));
      const offers = shopOffers(s);
      // Prázdný stav (DESIGN 2.5.1): nic v nabídce, nebo je všechno koupené.
      const allSold =
        offers.every((o) => (o.kind === 'item' ? shop.items[o.slot]! : shop.vouchers[o.slot]!).sold) &&
        shop.boosters.every((b) => b.sold);
      if (allSold) lines.push(t('cli.play.shop.empty'));
      if (offers.length > 0 && !allSold) {
        lines.push(t('cli.play.shop.offers'));
        offers.forEach((o, i) => {
          const entry = o.kind === 'item' ? shop.items[o.slot]! : shop.vouchers[o.slot]!;
          const name =
            o.kind === 'item'
              ? itemName(shop.items[o.slot]!)
              : `${nameOf('vouchers', shop.vouchers[o.slot]!.voucherId)} (${t('cli.play.kinds.voucher')})`;
          const key = entry.sold ? 'cli.play.shop.sold' : 'cli.play.shop.item';
          lines.push(`  ${t(key, { n: i + 1, name, price: entry.price })}`);
        });
      }
      if (shop.boosters.length > 0 && !allSold) {
        lines.push(t('cli.play.shop.boosters'));
        shop.boosters.forEach((b, i) => {
          const key = b.sold ? 'cli.play.shop.sold' : 'cli.play.shop.item';
          lines.push(`  ${t(key, { n: i + 1, name: nameOf('boosters', b.boosterId), price: b.price })}`);
        });
      }
      lines.push(t('cli.play.shop.reroll', { cost: shop.rerollCost }));
      owned();
      lines.push(t('cli.play.shop.hint'));
      break;
    }
    case 'booster': {
      const b = s.booster!;
      lines.push(header(game, t('cli.play.booster.title', { name: nameOf('boosters', b.boosterId) })));
      lines.push(t('cli.play.booster.picks', { n: b.picksLeft }));
      b.options.forEach((opt, i) => lines.push(`  ${i + 1}) ${itemName(opt)}`));
      if (b.hand.length > 0) lines.push(t('cli.play.booster.hand', { cards: numbered(game, b.hand) }));
      owned();
      lines.push(t('cli.play.booster.hint'));
      break;
    }
    case 'game_over': {
      const go = s.gameOver!;
      lines.push(header(game, t('cli.play.gameOver.title')));
      lines.push(
        t('cli.play.gameOver.line', {
          ante: go.ante,
          blind: blindName(go.blind),
          score: go.score,
          target: go.target,
        }),
      );
      lines.push(t('cli.play.gameOver.cause', { cause: causeName(go.cause) }));
      const death = deathLine(go.cause, go.blind);
      if (death) lines.push(death);
      lines.push(runStats(game));
      break;
    }
    case 'victory':
      lines.push(header(game, t('cli.play.victory.title')));
      lines.push(t('cli.play.victory.line'));
      lines.push(runStats(game));
      lines.push(t('cli.play.victory.hint'));
      break;
  }
  return lines;
}

/** Události akce jako české řádky (jen ty, které hráč v terminálu potřebuje vidět). */
export function renderEvents(game: Game, events: readonly GameEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'handPlayed': {
        const hand = t(`hands.${e.result.hand.type}.name`);
        const cards = plainCards(game, e.result.playedIds);
        if (e.result.blockedReason) {
          const reason = e.result.blockedReason;
          out.push(
            t('cli.play.events.blocked', { cards, hand, reason: hasKey(reason) ? t(reason) : reason }),
          );
        } else {
          out.push(
            t('cli.play.events.played', {
              cards,
              hand,
              level: game.state.handLevels[e.result.hand.type]?.level ?? 1,
              chips: e.result.chips,
              mult: e.result.mult,
              score: e.result.score,
              round: e.roundScore,
            }),
          );
        }
        break;
      }
      case 'cardsDiscarded':
        if (!e.forced) out.push(t('cli.play.events.discarded', { cards: plainCards(game, e.cardIds) }));
        break;
      case 'roundWon':
        out.push(t('cli.play.events.roundWon', { score: e.score, target: e.target }));
        break;
      case 'cashedOut':
        out.push(t('cli.play.events.cashedOut', { amount: e.amount }));
        break;
      case 'itemBought': {
        const prefix = {
          joker: 'jokers',
          consumable: 'consumables',
          booster: 'boosters',
          voucher: 'vouchers',
          card: '',
        }[e.kind];
        out.push(
          t('cli.play.events.bought', { name: prefix ? nameOf(prefix, e.defId) : e.defId, price: e.price }),
        );
        break;
      }
      case 'jokerSold':
        out.push(t('cli.play.events.sold', { name: nameOf('jokers', e.defId), price: e.price }));
        break;
      case 'consumableSold':
        out.push(t('cli.play.events.sold', { name: nameOf('consumables', e.defId), price: e.price }));
        break;
      case 'consumableUsed':
        out.push(t('cli.play.events.used', { name: nameOf('consumables', e.defId) }));
        break;
      case 'boosterOpened':
        out.push(t('cli.play.events.opened', { name: nameOf('boosters', e.boosterId) }));
        break;
      case 'blindSkipped':
        out.push(
          e.tagId
            ? t('cli.play.events.skippedTag', { tag: nameOf('tags', e.tagId) })
            : t('cli.play.events.skipped'),
        );
        break;
      case 'shopRerolled':
        out.push(t('cli.play.events.rerolled', { cost: e.cost }));
        break;
      case 'voucherRedeemed':
        out.push(t('cli.play.events.voucher', { name: nameOf('vouchers', e.voucherId) }));
        break;
      case 'handLeveled':
        out.push(t('cli.play.events.leveled', { hand: t(`hands.${e.hand}.name`), level: e.level }));
        break;
      case 'jokerAdded':
        out.push(t('cli.play.events.jokerAdded', { name: nameOf('jokers', e.defId) }));
        break;
      case 'endlessStarted':
        out.push(t('cli.play.events.endless'));
        break;
      case 'jokerTriggered':
      case 'message': {
        const key = e.type === 'message' ? e.key : e.message;
        if (hasKey(key)) out.push(t(key, e.type === 'message' ? e.params : undefined));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function deckLine(game: Game): string {
  const r = game.state.round;
  const ids = r ? r.drawPile : [];
  const bySuit = new Map<string, Card[]>();
  for (const id of ids) {
    const c = game.card(id);
    if (!c) continue;
    const list = bySuit.get(c.suit) ?? [];
    list.push(c as Card);
    bySuit.set(c.suit, list);
  }
  const list = ['S', 'H', 'D', 'C']
    .filter((suit) => bySuit.has(suit))
    .map((suit) => {
      const ranks = bySuit
        .get(suit)!
        .sort((a, b) => b.rank - a.rank)
        .map((c) => t(`ranks.${c.rank}.short`));
      return `${t(`suits.${suit}.symbol`)} ${ranks.join(' ')}`;
    })
    .join(' · ');
  return t('cli.play.deck', { n: ids.length, list });
}

/** Jedna hra v terminálu: zpracuje řádek příkazu a vrátí výstup. `done` = run skončil nebo hráč odešel. */
export class PlaySession {
  done = false;

  constructor(readonly game: Game) {}

  intro(opts: PlayOptions): string[] {
    const reg = this.game.registry;
    return [
      t('cli.play.welcome', {
        seed: this.game.state.seed,
        deck: nameOf('decks', opts.deck),
        stake: opts.stake,
        stakeName: stakeName(reg, opts.stake),
      }),
      ...renderState(this.game),
    ];
  }

  input(line: string): string[] {
    const cmd = parsePlayCommand(this.game, line);
    switch (cmd.kind) {
      case 'help':
        return tList('cli.play.help');
      case 'quit':
        this.done = true;
        return [t('cli.play.bye')];
      case 'show':
        return renderState(this.game);
      case 'deck':
        return [deckLine(this.game)];
      case 'error':
        return [t(`cli.play.errors.${cmd.reason}`)];
      case 'preview': {
        const p = this.game.preview(cmd.cardIds);
        if (p.hidden) return [t('cli.play.previewHidden')];
        if (!p.hand) return [t('cli.play.previewNone')];
        return [
          t('cli.play.preview', {
            hand: t(`hands.${p.hand.type}.name`),
            level: p.level,
            chips: p.chips,
            mult: p.mult,
          }),
        ];
      }
      case 'action': {
        const res = this.game.dispatch(cmd.action);
        if (!res.ok) return [t(`errors.${res.error}`)];
        const out = renderEvents(this.game, res.events);
        // Po každé akci celý stav (nová fáze, ruka po dobrání, peníze…); pitva run ukončí.
        out.push(...renderState(this.game));
        if (this.game.state.phase === 'game_over') this.done = true;
        return out;
      }
    }
  }
}

/** Neinteraktivní hra podle seznamu příkazů (testy, `--script`). Vrací celý přepis. */
export function playScript(opts: PlayOptions, reg: ContentRegistry = contentRegistry()): string[] {
  const game = Game.newRun({ seed: opts.seed, deckId: opts.deck, stake: opts.stake }, reg);
  const session = new PlaySession(game);
  const out = session.intro(opts);
  for (const line of opts.script ?? []) {
    if (session.done) break;
    out.push(`${t('cli.play.prompt')} ${line}`);
    out.push(...session.input(line));
  }
  if (!session.done) out.push(t('cli.play.scriptEnd'));
  return out;
}

function playInteractive(opts: PlayOptions, reg: ContentRegistry): void {
  const game = Game.newRun({ seed: opts.seed, deckId: opts.deck, stake: opts.stake }, reg);
  const session = new PlaySession(game);
  const print = (lines: readonly string[]) => {
    if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  };
  print(session.intro(opts));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt(`${t('cli.play.prompt')} `);
  rl.prompt();
  rl.on('line', (line) => {
    print(session.input(line));
    if (session.done) rl.close();
    else rl.prompt();
  });
}

// ─────────────────────────── Vstupní bod ───────────────────────────

function main(): void {
  const reg = contentRegistry();
  const problems = validateRegistry(reg);
  try {
    if (problems.length > 0)
      throw new CliError(`${t('cli.errors.registry')}\n  - ${problems.join('\n  - ')}`);
    const opts = parseCli(process.argv.slice(2), reg);
    if (opts.mode === 'help') {
      console.log(t('cli.usage'));
      return;
    }
    if (opts.mode === 'play') {
      if (opts.play.script) process.stdout.write(`${playScript(opts.play, reg).join('\n')}\n`);
      else playInteractive(opts.play, reg);
      return;
    }
    const started = performance.now();
    const report = runSimulation(opts.sim, reg);
    if (opts.sim.json === '-') {
      process.stdout.write(`${reportJson(report)}\n`);
      return;
    }
    if (opts.sim.json) writeFileSync(opts.sim.json, `${reportJson(report)}\n`);
    const lines = reportText(report, reg);
    lines.push('');
    lines.push(t('cli.sim.duration', { seconds: n1((performance.now() - started) / 1000) }));
    process.stdout.write(`${lines.join('\n')}\n`);
  } catch (e) {
    if (e instanceof CliError) {
      console.error(`${t('cli.errors.prefix')} ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

// Spustit jen jako skript (`tsx scripts/simulate.ts`), ne při importu z testů.
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
