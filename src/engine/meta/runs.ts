/**
 * Sledování runů v profilu: začátek runu, zpracování každé události (statistiky, objevy, rekordy, odemčení,
 * achievementy), konec runu (historie, výsledek, denní run).
 *
 * Pravidla započítání (DESIGN 11.3, 11.6, 11.7):
 *  - **seedovaný run** (seed zadaný hráčem) jde jen do historie — ne do statistik, objevů, odemykání ani
 *    achievementů (kromě těch s `allowSeeded`, „Semínko zaseto“);
 *  - **denní run** se počítá celý jen jako oficiální pokus (první run dne s dnešním seedem); další pokusy a ručně
 *    zadaný `DEN-…` jsou „mimo soutěž“ a počítají se jako seedované;
 *  - **výzvy** se počítají do počítadel, rekordů, objevů a achievementů, ale výsledek mají ve vlastní statistice
 *    (`stats.challenges`), ne v souhrnu runů, balíčků a sil piva.
 *
 * Funkce mutují předaný profil (jediná instance u volajícího, stejně jako engine mutuje `RunState`) a vracejí
 * oznámení pro UI. `run` je stav **po celé akci** (události se zpracovávají po `dispatch`).
 */
import { MSG } from '../constants';
import type { BoosterOption, Card, ConsumableInstance, GameEvent, JokerInstance, RunState } from '../types';
import { HAND_TYPES } from '../types';
import { evaluateAchievements, resolveMods } from './achievements';
import { dailyDateKey, dailyKeyFromSeed } from './daily';
import { HISTORY_LIMIT, emptyRunCounters } from './profile';
import { addUnseen, maxStakeFor, maxStakeLevel, refreshUnlocks, unlockedByDiscovery } from './unlocks';
import type {
  ChallengeStats,
  CurrentRunMeta,
  DiscoveryCategory,
  HistoryEntry,
  MetaCtx,
  MetaNotice,
  Profile,
  RunMode,
  RunOutcome,
} from './types';

/** Důvod `moneyChanged` u platby ve Večerce (`Game.pay`). */
const MONEY_PURCHASE = 'purchase';

/** Kontext začátku runu: navíc, jestli seed zadal hráč. */
export interface StartRunCtx extends MetaCtx {
  /** Seed zadal hráč (nový run z pole seedu, z historie, ručně zadaný `DEN-…`). */
  seeded?: boolean;
}

/** Patří meta údaje k tomuto runu? */
export function currentMatches(cur: Readonly<CurrentRunMeta> | null, run: Readonly<RunState>): boolean {
  return (
    !!cur &&
    cur.seed === run.seed &&
    cur.deckId === run.deckId &&
    cur.stake === run.stake &&
    cur.challengeId === run.challengeId &&
    cur.daily === run.daily
  );
}

function runMode(run: Readonly<RunState>): RunMode {
  return run.challengeId ? 'challenge' : run.daily ? 'daily' : 'normal';
}

function challengeStats(profile: Profile, id: string): ChallengeStats {
  return (profile.stats.challenges[id] ??= { attempts: 0, completed: 0, bestAnte: 0 });
}

function inc(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Přenese do meta údajů průběh runu (patro, nejlepší ruka, žolíci…). */
function syncCurrent(cur: CurrentRunMeta, run: Readonly<RunState>): void {
  cur.maxAnte = Math.max(cur.maxAnte, run.ante);
  cur.endless = cur.endless || run.endless;
  if (run.stats.bestHandScore > cur.bestHand) {
    cur.bestHand = run.stats.bestHandScore;
    cur.bestHandType = run.stats.bestHandType;
  }
  cur.jokers = run.jokers.map((j) => j.defId);
  cur.handsPlayed = run.stats.handsPlayed;
  cur.roundsWon = run.stats.roundsWon;
  if (run.jokers.length > 0) cur.counters.hadJoker = true;
}

function createCurrent(
  profile: Profile,
  run: Readonly<RunState>,
  ctx: MetaCtx,
  seeded: boolean,
  resume: boolean,
): CurrentRunMeta {
  const mode = runMode(run);
  let official = false;
  if (mode === 'daily' && !seeded) {
    const key = dailyKeyFromSeed(run.seed);
    if (key && key === dailyDateKey(ctx.nowIso)) {
      const rec = profile.daily[key];
      official = !rec || (resume && rec.status === 'playing' && rec.seed === run.seed);
    }
  }
  const cur: CurrentRunMeta = {
    no: profile.nextRunNo++,
    seed: run.seed,
    deckId: run.deckId,
    stake: run.stake,
    challengeId: run.challengeId,
    daily: run.daily,
    mode,
    seeded,
    official,
    counted: !seeded && (mode !== 'daily' || official),
    startedAt: ctx.nowIso,
    outcome: null,
    cause: null,
    maxAnte: run.ante,
    endless: run.endless,
    bestHand: 0,
    bestHandType: null,
    jokers: [],
    handsPlayed: 0,
    roundsWon: 0,
    counters: emptyRunCounters(),
  };
  syncCurrent(cur, run);
  return cur;
}

// ─────────────────────────── Objevy a rekordy ───────────────────────────

/** Zapíše do sbírky všechno, co se hráči v runu právě ukazuje (DESIGN 11.4). */
function discover(profile: Profile, run: Readonly<RunState>, ctx: MetaCtx, notices: MetaNotice[]): void {
  const reg = ctx.registry;
  const add = (cat: DiscoveryCategory, id: string | null | undefined, known: boolean): void => {
    if (!id || !known) return;
    const list = profile.discovered[cat];
    if (list.includes(id)) return;
    list.push(id);
    addUnseen(profile, `${cat}:${id}`);
    if (cat === 'jokers' && unlockedByDiscovery(reg, id))
      notices.push({ kind: 'unlock', category: 'jokers', id });
  };
  const edition = (e: string | null): void => add('editions', e, !!e && !!reg.editions[e]);
  const joker = (j: JokerInstance): void => {
    add('jokers', j.defId, !!reg.jokers[j.defId]);
    edition(j.edition);
  };
  const consumable = (c: ConsumableInstance): void => {
    add('consumables', c.defId, !!reg.consumables[c.defId]);
    edition(c.edition);
  };
  const card = (c: Card): void => {
    add('enhancements', c.enhancement, !!c.enhancement && !!reg.enhancements[c.enhancement]);
    add('seals', c.seal, !!c.seal && !!reg.seals[c.seal]);
    edition(c.edition);
  };
  const option = (o: BoosterOption): void => {
    if (o.kind === 'joker') joker(o.joker);
    else if (o.kind === 'consumable') consumable(o.consumable);
    else card(o.card);
  };

  add('decks', run.deckId, !!reg.decks[run.deckId]);
  run.jokers.forEach(joker);
  run.consumables.forEach(consumable);
  for (const v of run.vouchers) add('vouchers', v, !!reg.vouchers[v]);
  for (const t of run.tags) add('tags', t.defId, !!reg.tags[t.defId]);
  run.deck.forEach(card);
  for (const t of HAND_TYPES) {
    if ((run.handLevels[t]?.played ?? 0) > 0 || run.discoveredHands.includes(t)) add('hands', t, true);
  }
  if (run.shop) {
    for (const it of run.shop.items) option(it);
    for (const b of run.shop.boosters) add('boosters', b.boosterId, !!reg.boosters[b.boosterId]);
    for (const v of run.shop.vouchers) add('vouchers', v.voucherId, !!reg.vouchers[v.voucherId]);
  }
  if (run.booster) {
    add('boosters', run.booster.boosterId, !!reg.boosters[run.booster.boosterId]);
    for (const o of run.booster.options) option(o);
  }
  if (run.phase === 'blind_select') {
    for (const b of run.blinds) {
      add('bosses', b.bossId, !!b.bossId && !!reg.bosses[b.bossId]);
      add('tags', b.skipTagId, !!b.skipTagId && !!reg.tags[b.skipTagId]);
    }
  }
  const boss = run.round?.bossId;
  add('bosses', boss, !!boss && !!reg.bosses[boss]);
}

/** Rekordy profilu ze stavu runu (maximum v jednom okamžiku). */
function updateRecords(profile: Profile, run: Readonly<RunState>): void {
  const r = profile.stats.records;
  r.maxMoney = Math.max(r.maxMoney, run.stats.maxMoney, run.money);
  r.maxJokers = Math.max(r.maxJokers, run.jokers.length);
  r.maxSealedCards = Math.max(r.maxSealedCards, run.deck.filter((c) => c.seal).length);
  r.maxVouchers = Math.max(r.maxVouchers, run.vouchers.length);
  r.highestAnte = Math.max(r.highestAnte, run.ante);
  if (run.endless) r.highestEndlessAnte = Math.max(r.highestEndlessAnte, run.ante);
  for (const t of HAND_TYPES) {
    const level = run.handLevels[t]?.level ?? 1;
    if (level > (r.handLevels[t] ?? 1)) r.handLevels[t] = level;
  }
}

// ─────────────────────────── Výsledek runu ───────────────────────────

/** Odemkne další sílu piva pro balíček po výhře (DESIGN 10: výhra na N → N + 1). */
function unlockNextStake(profile: Profile, cur: CurrentRunMeta, ctx: MetaCtx, notices: MetaNotice[]): void {
  const reg = ctx.registry;
  const top = maxStakeLevel(reg);
  const unlocked = maxStakeFor(profile, reg, cur.deckId);
  if (cur.stake < unlocked || unlocked >= top) return;
  const next = Math.min(top, cur.stake + 1);
  const firstAnywhere = !Object.keys(reg.decks).some((d) => maxStakeFor(profile, reg, d) >= next);
  profile.unlocks.stakes[cur.deckId] = next;
  notices.push({ kind: 'stake', deckId: cur.deckId, stake: next });
  if (firstAnywhere) {
    const stake = Object.values(reg.stakes).find((s) => s.level === next);
    if (stake) addUnseen(profile, `stakes:${stake.id}`);
  }
}

/** Zapíše výsledek započítaného runu do statistik (jednou za run). */
function recordOutcome(
  profile: Profile,
  cur: CurrentRunMeta,
  outcome: RunOutcome,
  run: Readonly<RunState> | null,
  ctx: MetaCtx,
): MetaNotice[] {
  const notices: MetaNotice[] = [];
  const s = profile.stats;
  if (cur.mode === 'challenge') {
    if (outcome === 'won' && cur.challengeId) challengeStats(profile, cur.challengeId).completed++;
    return notices;
  }
  s.runs.played++;
  const deck = (s.byDeck[cur.deckId] ??= { played: 0, won: 0, bestStake: 0 });
  const stake = (s.byStake[String(cur.stake)] ??= { played: 0, won: 0 });
  deck.played++;
  stake.played++;
  if (outcome === 'won') {
    s.runs.won++;
    s.runs.currentStreak++;
    s.runs.bestStreak = Math.max(s.runs.bestStreak, s.runs.currentStreak);
    deck.won++;
    deck.bestStake = Math.max(deck.bestStake, cur.stake);
    stake.won++;
    const hands = run ? run.stats.handsPlayed : cur.handsPlayed;
    if (!s.fastestWin || hands < s.fastestWin.hands)
      s.fastestWin = { hands, seed: cur.seed, deckId: cur.deckId, stake: cur.stake };
    // Sílu piva odemyká jen hlavní hra (ne denní run s balíčkem a silou ze seedu).
    if (cur.mode === 'normal') unlockNextStake(profile, cur, ctx, notices);
    return notices;
  }
  s.runs.currentStreak = 0;
  if (outcome === 'lost') {
    s.runs.lost++;
    const cause = cur.cause;
    if (cause) {
      inc(s.losses, cause);
      if (ctx.registry.bosses[cause]) (s.bosses[cause] ??= { defeated: 0, lostTo: 0 }).lostTo++;
    }
  } else {
    s.runs.abandoned++;
  }
  return notices;
}

/** Zpracuje událost započítaného runu: počítadla, statistiky, výsledek. */
function countEvent(
  profile: Profile,
  cur: CurrentRunMeta,
  event: GameEvent,
  run: Readonly<RunState>,
  ctx: MetaCtx,
  notices: MetaNotice[],
): void {
  const s = profile.stats;
  const t = s.totals;
  const c = cur.counters;
  switch (event.type) {
    case 'handPlayed': {
      const r = event.result;
      t.handsPlayed++;
      t.cardsPlayed += r.playedIds.length;
      s.handTypes[r.hand.type] = (s.handTypes[r.hand.type] ?? 0) + 1;
      if (!s.bestHand || r.score > s.bestHand.score)
        s.bestHand = { score: r.score, handType: r.hand.type, seed: run.seed, deckId: run.deckId };
      const glass = r.steps.filter((st) => st.message === MSG.glassBreak).length;
      t.glassBroken += glass;
      c.glassBroken += glass;
      break;
    }
    case 'cardsDiscarded':
      if (!event.forced) {
        t.discards++;
        t.cardsDiscarded += event.cardIds.length;
      }
      break;
    case 'moneyChanged':
      if (event.delta > 0) t.moneyEarned += event.delta;
      else if (event.reason === MONEY_PURCHASE && event.delta < 0) {
        // Utraceno = každá platba ve Večerce (zboží, obálky, kupóny, přehození) — jako `RunStats.moneySpent`.
        t.moneySpent -= event.delta;
        c.shopSpent -= event.delta;
        c.maxShopSpent = Math.max(c.maxShopSpent, c.shopSpent);
      }
      break;
    case 'itemBought': {
      if (event.kind === 'joker') {
        t.jokersBought++;
        inc(s.jokerBuys, event.defId);
      } else if (event.kind === 'voucher') {
        t.vouchersBought++;
        if (!c.vouchersBought.includes(event.defId)) {
          c.vouchersBought.push(event.defId);
          inc(s.voucherRuns, event.defId);
        }
      }
      break;
    }
    case 'shopRerolled':
      t.rerolls++;
      c.shopRerolls++;
      c.maxShopRerolls = Math.max(c.maxShopRerolls, c.shopRerolls);
      break;
    case 'shopEntered':
      t.shopsEntered++;
      c.shopSpent = 0;
      c.shopRerolls = 0;
      break;
    case 'shopLeft':
      c.leftShopBroke = run.money <= 0;
      break;
    case 'jokerSold':
      t.jokersSold++;
      break;
    case 'consumableUsed': {
      t.consumablesUsed++;
      inc(s.consumableUses, event.defId);
      const kind = ctx.registry.consumables[event.defId]?.kind;
      if (kind) {
        c.consumablesUsed[kind]++;
        if (kind === 'pranostika') t.pranostikyUsed++;
        else if (kind === 'rada') t.radyUsed++;
        else t.razitkaUsed++;
      }
      break;
    }
    case 'boosterOpened':
      t.boostersOpened++;
      break;
    case 'blindSkipped':
      t.blindsSkipped++;
      break;
    case 'roundWon': {
      t.roundsWon++;
      if (run.round && run.round.handsPlayed === 1) {
        t.firstHandRoundWins++;
        c.firstHandRoundWins++;
        if (event.blind === 'boss') c.bossesFirstHand++;
      }
      c.minRoundEndMoney = Math.min(c.minRoundEndMoney ?? run.money, run.money);
      s.records.minRoundEndMoney = Math.min(s.records.minRoundEndMoney ?? run.money, run.money);
      s.records.bestRoundScore = Math.max(s.records.bestRoundScore, event.score);
      if (c.leftShopBroke) {
        c.brokeRoundWon = true;
        c.leftShopBroke = false;
      }
      for (const j of run.jokers) inc(s.jokerRounds, j.defId);
      break;
    }
    case 'roundRewards': {
      const m = resolveMods(ctx.mods, run, ctx.registry);
      const maxInterest = Math.floor(m.interestCap * m.interestMult);
      if (event.interest > 0 && event.interest >= maxInterest) {
        c.interestStreak++;
        c.maxInterestStreak = Math.max(c.maxInterestStreak, c.interestStreak);
      } else {
        c.interestStreak = 0;
      }
      break;
    }
    case 'bossDefeated':
      t.bossesDefeated++;
      (s.bosses[event.bossId] ??= { defeated: 0, lostTo: 0 }).defeated++;
      break;
    case 'cardAdded':
      t.cardsAdded++;
      break;
    case 'cardDestroyed':
      t.cardsDestroyed++;
      break;
    case 'gameOver':
      if (cur.outcome === null) {
        cur.outcome = 'lost';
        cur.cause = event.info.cause;
        notices.push(...recordOutcome(profile, cur, 'lost', run, ctx));
      }
      break;
    case 'victory':
      if (cur.outcome === null) {
        cur.outcome = 'won';
        notices.push(...recordOutcome(profile, cur, 'won', run, ctx));
      }
      break;
    default:
      break;
  }
}

/** Objevy, rekordy, odemčení a achievementy po změně (jen započítaný run). */
function afterChange(
  profile: Profile,
  run: Readonly<RunState>,
  ctx: MetaCtx,
  cur: CurrentRunMeta,
  event: GameEvent | undefined,
  notices: MetaNotice[],
): void {
  discover(profile, run, ctx, notices);
  updateRecords(profile, run);
  // Odemčení může záviset na achievementu a naopak — pár kol, dokud se něco mění.
  for (let i = 0; i < 4; i++) {
    const unlocks = refreshUnlocks(profile, ctx.registry, run);
    const achievements = evaluateAchievements(profile, ctx, { run, event, current: cur });
    notices.push(...unlocks, ...achievements);
    if (unlocks.length === 0 && achievements.length === 0) break;
  }
}

function beginRun(
  profile: Profile,
  run: Readonly<RunState>,
  ctx: MetaCtx,
  seeded: boolean,
  resume: boolean,
): MetaNotice[] {
  const cur = createCurrent(profile, run, ctx, seeded, resume);
  profile.current = cur;
  if (cur.official) {
    const key = dailyKeyFromSeed(run.seed);
    if (key && !profile.daily[key]) {
      profile.daily[key] = {
        seed: run.seed,
        deckId: run.deckId,
        stake: run.stake,
        status: 'playing',
        outcome: null,
        ante: run.ante,
        bestHand: 0,
        startedAt: ctx.nowIso,
        finishedAt: null,
      };
    }
  }
  if (!cur.counted) return evaluateAchievements(profile, ctx, { run, current: cur, seededOnly: true });
  if (cur.mode === 'challenge' && cur.challengeId && !resume)
    challengeStats(profile, cur.challengeId).attempts++;
  const notices: MetaNotice[] = [];
  afterChange(profile, run, ctx, cur, undefined, notices);
  return notices;
}

function historyEntry(cur: CurrentRunMeta, outcome: RunOutcome, nowIso: string): HistoryEntry {
  return {
    no: cur.no,
    startedAt: cur.startedAt,
    finishedAt: nowIso,
    seed: cur.seed,
    deckId: cur.deckId,
    stake: cur.stake,
    mode: cur.mode,
    challengeId: cur.challengeId,
    seeded: cur.seeded,
    official: cur.official,
    outcome,
    ante: cur.maxAnte,
    endless: cur.endless,
    cause: outcome === 'lost' ? cur.cause : null,
    bestHand: cur.bestHand,
    bestHandType: cur.bestHandType,
    jokers: [...cur.jokers],
    handsPlayed: cur.handsPlayed,
    roundsWon: cur.roundsWon,
  };
}

/** Uzavře rozehraný run: výsledek, výzva, denní run, historie. `run` = jeho stav (null = už není k dispozici). */
function closeCurrent(profile: Profile, run: Readonly<RunState> | null, ctx: MetaCtx): MetaNotice[] {
  const cur = profile.current;
  if (!cur) return [];
  if (run) syncCurrent(cur, run);
  const notices: MetaNotice[] = [];
  if (cur.outcome === null) {
    const outcome: RunOutcome =
      run?.phase === 'game_over' ? 'lost' : run?.phase === 'victory' ? 'won' : 'abandoned';
    cur.outcome = outcome;
    if (outcome === 'lost') cur.cause = run?.gameOver?.cause ?? null;
    if (cur.counted) notices.push(...recordOutcome(profile, cur, outcome, run, ctx));
  }
  const outcome = cur.outcome;
  if (cur.counted && cur.mode === 'challenge' && cur.challengeId) {
    const cs = challengeStats(profile, cur.challengeId);
    cs.bestAnte = Math.max(cs.bestAnte, cur.maxAnte);
  }
  if (cur.official) {
    const key = dailyKeyFromSeed(cur.seed);
    const rec = key ? profile.daily[key] : undefined;
    if (rec && rec.status === 'playing') {
      rec.status = 'finished';
      rec.outcome = outcome;
      rec.ante = Math.max(rec.ante, cur.maxAnte);
      rec.bestHand = Math.max(rec.bestHand, cur.bestHand);
      rec.finishedAt = ctx.nowIso;
    }
  }
  profile.history.unshift(historyEntry(cur, outcome, ctx.nowIso));
  if (profile.history.length > HISTORY_LIMIT) profile.history.length = HISTORY_LIMIT;
  profile.current = null;
  if (cur.counted) {
    for (let i = 0; i < 4; i++) {
      const unlocks = refreshUnlocks(profile, ctx.registry, run ?? undefined);
      const achievements = evaluateAchievements(profile, ctx, { run: run ?? undefined, current: cur });
      notices.push(...unlocks, ...achievements);
      if (unlocks.length === 0 && achievements.length === 0) break;
    }
  }
  return notices;
}

// ─────────────────────────── Veřejné API ───────────────────────────

/**
 * Začátek nového runu (hned po `Game.newRun`). Předchozí neuzavřený run se zapíše jako opuštěný. Určí druh runu
 * (`ctx.seeded` = seed zadal hráč), zabere oficiální denní pokus, u výzvy přičte pokus.
 */
export function startRun(profile: Profile, run: Readonly<RunState>, ctx: StartRunCtx): MetaNotice[] {
  const notices = closeCurrent(profile, null, ctx);
  return notices.concat(beginRun(profile, run, ctx, ctx.seeded === true, false));
}

/**
 * Pokračování runu z uložení. Patří-li `profile.current` k tomuto runu, nedělá nic; jinak (profil importovaný,
 * ztracený zápis) uzavře cizí run jako opuštěný a tento zaeviduje jako nezadaný seed (denní run je oficiální jen
 * tehdy, když je dnešní pokus v profilu rozehraný se stejným seedem).
 */
export function resumeRun(profile: Profile, run: Readonly<RunState>, ctx: MetaCtx): MetaNotice[] {
  if (currentMatches(profile.current, run)) return [];
  const notices = closeCurrent(profile, null, ctx);
  return notices.concat(beginRun(profile, run, ctx, false, true));
}

/**
 * Zpracuje jednu událost runu (UI volá po každé akci pro všechny `ActionResult.events`). Aktualizuje meta údaje
 * runu, a je-li run započítaný, i statistiky, objevy, rekordy, odemčení a achievementy. Výhra (`victory`)
 * a prohra (`gameOver`) se do statistik zapíšou hned; historii zapíše až `finishRun`.
 */
export function applyRunEvent(
  profile: Profile,
  event: GameEvent,
  run: Readonly<RunState>,
  ctx: MetaCtx,
): MetaNotice[] {
  const notices: MetaNotice[] = [];
  if (!currentMatches(profile.current, run)) notices.push(...resumeRun(profile, run, ctx));
  const cur = profile.current!;
  syncCurrent(cur, run);
  if (!cur.counted) {
    if (event.type === 'victory' && cur.outcome === null) cur.outcome = 'won';
    if (event.type === 'gameOver' && cur.outcome === null) {
      cur.outcome = 'lost';
      cur.cause = event.info.cause;
    }
    notices.push(...evaluateAchievements(profile, ctx, { run, event, current: cur, seededOnly: true }));
    return notices;
  }
  countEvent(profile, cur, event, run, ctx, notices);
  afterChange(profile, run, ctx, cur, event, notices);
  return notices;
}

/** Zpracuje všechny události jedné akce v pořadí. */
export function applyRunEvents(
  profile: Profile,
  events: readonly GameEvent[],
  run: Readonly<RunState>,
  ctx: MetaCtx,
): MetaNotice[] {
  const notices: MetaNotice[] = [];
  for (const e of events) notices.push(...applyRunEvent(profile, e, run, ctx));
  return notices;
}

/**
 * Konec runu: prohra (po pitvě), výhra (odchod z výherní obrazovky / konec nekonečného režimu) nebo opuštění
 * (nová hra přes rozehraný run). Výsledek podle fáze runu (`game_over` = prohra, `victory` nebo už zapsaná výhra =
 * výhra, jinak opuštění), zápis do historie (všechny druhy runů), denní run, statistika výzvy. Bez rozehraného
 * runu v profilu nedělá nic (už uzavřený run se nezapíše dvakrát).
 */
export function finishRun(profile: Profile, run: Readonly<RunState>, ctx: MetaCtx): MetaNotice[] {
  if (!profile.current) return [];
  const notices = currentMatches(profile.current, run) ? [] : resumeRun(profile, run, ctx);
  return notices.concat(closeCurrent(profile, run, ctx));
}

/**
 * Přepočet mimo run (po dokončení tutoriálu, importu profilu, při startu aplikace): odemčení a achievementy jen ze
 * stavu profilu.
 */
export function refreshMeta(profile: Profile, ctx: MetaCtx): MetaNotice[] {
  const notices: MetaNotice[] = [];
  for (let i = 0; i < 4; i++) {
    const unlocks = refreshUnlocks(profile, ctx.registry);
    const achievements = evaluateAchievements(profile, ctx);
    notices.push(...unlocks, ...achievements);
    if (unlocks.length === 0 && achievements.length === 0) break;
  }
  return notices;
}
