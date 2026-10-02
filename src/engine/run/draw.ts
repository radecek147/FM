/** Lízání karet a debuffy od šéfa. */
import type { GameCore } from '../effects/core';
import type { Card } from '../types';

/**
 * Je karta debuffnutá pravidlem kola — aktivním šéfem nebo pravidlem výzvy (`ChallengeDef.isCardDebuffed`, platí
 * ve všech útratách a vypnutí šéfa ho neruší)? Karty vrácené do provozu (`cleanseCard`) do konce kola ne.
 */
export function bossDebuffs(core: GameCore, card: Card): boolean {
  const round = core.state.round;
  if (!round) return false;
  const boss = core.activeBoss();
  const challengeRule = core.challenge()?.isCardDebuffed;
  if (!boss?.hooks.isCardDebuffed && !challengeRule) return false;
  if (round.cleansedCards?.includes(card.id)) return false;
  if (challengeRule?.(core.challengeCtx(), card)) return true;
  return boss?.hooks.isCardDebuffed?.(core.bossCtx(), card) ?? false;
}

/** Přepočítá debuffy všech karet balíčku (začátek kola, vypnutí šéfa). */
export function refreshDebuffs(core: GameCore): void {
  for (const c of core.state.deck) c.debuffed = core.state.round ? bossDebuffs(core, c) : false;
}

/**
 * Po hooku šéfa, který mohl změnit `round.flags` (`onRoundStart`, `afterHandPlayed`, `onDiscard`, `onDraw`):
 * přepočítá debuffy celého balíčku, má-li aktivní šéf `isCardDebuffed`. Dočasné debuffy z efektů (Černá kočka)
 * se ukládají do `round.flags` a `isCardDebuffed` je čte (DESIGN příloha B) — bez přepočtu by platily jen pro
 * karty líznuté až potom, ne pro karty, které už jsou v ruce.
 */
export function refreshBossDebuffs(core: GameCore): void {
  if (core.activeBoss()?.hooks.isCardDebuffed || core.challenge()?.isCardDebuffed) refreshDebuffs(core);
}

/**
 * Debuffy žolíků podle pravidla šéfa (`BossHooks.isJokerDebuffed`; Jednooký hejtman, Výpadek proudu) nebo výzvy
 * (`ChallengeDef.isJokerDebuffed`; Večer při svíčkách — platí i po vypnutí šéfa): přepočítá, kteří
 * žolíci mají být mimo provoz, a rozdíl promítne přes `api.setJokerDebuffed`. Žolíky vypnuté pravidlem eviduje
 * `RoundState.ruleJokerDebuffs` (podmnožina `jokerDebuffs`): žolíka, kterého už vypnulo něco jiného (Krajský úřad),
 * si pravidlo nepřivlastní, a jiné dočasné debuffy přepočet nezruší. Bez aktivního šéfa s pravidlem (vypnutý šéf,
 * jiné kolo) vrátí do provozu všechny žolíky, které pravidlo vypnulo. Ruce a zahození se nepřepočítávají — pasivní
 * efekty žolíků na ně platí podle stavu na začátku kola (jako u Exekutora).
 */
export function refreshBossJokerDebuffs(core: GameCore): void {
  const s = core.state;
  const round = s.round;
  if (!round) return;
  const rule = core.activeBoss()?.hooks.isJokerDebuffed;
  const challengeRule = core.challenge()?.isJokerDebuffed;
  const owned = round.ruleJokerDebuffs ?? [];
  if (!rule && !challengeRule && owned.length === 0) return;
  const want = new Set<number>();
  if (rule || challengeRule) {
    const ctx = rule ? core.bossCtx() : null;
    const cctx = challengeRule ? core.challengeCtx() : null;
    s.jokers.forEach((j, index) => {
      if ((cctx && challengeRule?.(cctx, j, index)) || (ctx && rule?.(ctx, j, index))) want.add(j.uid);
    });
  }
  const live = new Set(s.jokers.map((j) => j.uid));
  const next: number[] = [];
  for (const uid of owned) {
    if (!live.has(uid)) continue;
    if (want.has(uid)) {
      // Debuff mezitím zrušil jiný efekt — pravidlo platí dál.
      if (!round.jokerDebuffs.includes(uid)) core.api.setJokerDebuffed(uid, true);
      next.push(uid);
    } else {
      core.api.setJokerDebuffed(uid, false);
    }
  }
  for (const uid of want) {
    if (next.includes(uid) || round.jokerDebuffs.includes(uid)) continue;
    core.api.setJokerDebuffed(uid, true);
    next.push(uid);
  }
  if (next.length > 0 || round.ruleJokerDebuffs) round.ruleJokerDebuffs = next;
}

/** Dobere až `n` karet z vršku dobíracího balíčku do ruky. Vrací id líznutých karet. */
export function drawCards(core: GameCore, n: number): number[] {
  const round = core.state.round;
  if (!round || n <= 0) return [];
  const boss = core.activeBoss();
  const drawn: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = round.drawPile.pop();
    if (id === undefined) break;
    round.hand.push(id);
    const card = core.mustCard(id);
    card.debuffed = bossDebuffs(core, card);
    if (boss?.hooks.isDrawnFaceDown) {
      card.faceDown = boss.hooks.isDrawnFaceDown(core.bossCtx(), card, {
        drawIndex: i,
        handsPlayed: round.handsPlayed,
      });
    }
    drawn.push(id);
  }
  if (drawn.length > 0) {
    core.emit({ type: 'cardsDrawn', cardIds: drawn });
    if (boss?.hooks.onDraw) {
      boss.hooks.onDraw(Object.assign(core.bossCtx(), { drawn: drawn.map((id) => core.mustCard(id)) }));
      // Hook mohl změnit stav, na kterém závisí `passive` šéfa.
      core.invalidate();
      refreshBossDebuffs(core);
    }
  }
  return drawn;
}

/** Dobere ruku do plné velikosti (Modifiers.handSize). */
export function fillHand(core: GameCore): number[] {
  const round = core.state.round;
  if (!round) return [];
  const missing = core.mods().handSize - round.hand.length;
  return drawCards(core, missing);
}
