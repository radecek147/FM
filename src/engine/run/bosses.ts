/** Losování šéfů: šéf patra, pravidlo šéfa ve Velké útratě (Imperial), přelosování. */
import type { BossDef } from '../content-types';
import { FINAL_ANTE } from '../constants';
import type { GameCore } from '../effects/core';
import type { BlindSlot } from '../types';

/** Má patro finálového šéfa? (patro 8 a každé další 8. patro nekonečného režimu) */
export function isFinalAnte(ante: number): boolean {
  return ante >= FINAL_ANTE && ante % FINAL_ANTE === 0;
}

/** Má šéf nějaké pravidlo (hook)? Šéfové, kteří jen zvyšují cíl, se do Velké útraty nelosují. */
export function bossHasRule(boss: BossDef): boolean {
  return Object.values(boss.hooks).some((fn) => typeof fn === 'function');
}

/** Platí šéf pro dané patro? (finálový jen ve finálovém patře, běžný od `minAnte`) */
export function bossFitsAnte(boss: BossDef, ante: number): boolean {
  return isFinalAnte(ante) ? boss.final === true : !boss.final && (boss.minAnte ?? 1) <= ante;
}

/** Má aktuální obtížnost pravidlo „Šéf i ve Velké“? (`StakeDef.bigBlindBoss` na kterékoli úrovni ≤ zvolené) */
export function stakeBigBlindBoss(core: GameCore): boolean {
  return Object.values(core.registry.stakes).some((st) => st.level <= core.state.stake && st.bigBlindBoss);
}

/**
 * Vylosuje šéfa patra (stream `boss`). Preferuje šéfy, kteří v runu ještě nebyli; vylosovaného zapíše
 * do `bossesSeen`. Když pro patro žádný nesedí, vezme libovolného běžného. Bez šéfů v registru vrací null.
 */
export function pickBossId(core: GameCore, exclude: readonly string[] = []): string | null {
  const s = core.state;
  const all = Object.values(core.registry.bosses);
  let pool = all.filter((b) => bossFitsAnte(b, s.ante));
  if (pool.length === 0) pool = all.filter((b) => !b.final);
  if (pool.length === 0) return null;
  const notExcluded = pool.filter((b) => !exclude.includes(b.id));
  if (notExcluded.length > 0) pool = notExcluded;
  const unseen = pool.filter((b) => !s.bossesSeen.includes(b.id));
  const ids = (unseen.length > 0 ? unseen : pool).map((b) => b.id).sort();
  const id = core.rng('boss').pick(ids);
  if (!s.bossesSeen.includes(id)) s.bossesSeen.push(id);
  return id;
}

/**
 * Vylosuje pravidlo šéfa pro Velkou útratu (Imperial, DESIGN kap. 10): běžný šéf s pravidlem, `minAnte ≤ patro`,
 * jiný než šéf patra. Nezapisuje se do `bossesSeen`. Vrací null, když žádný nesedí.
 */
export function pickBigBlindBossId(core: GameCore, anteBossId: string | null): string | null {
  const s = core.state;
  const ids = Object.values(core.registry.bosses)
    .filter((b) => !b.final && (b.minAnte ?? 1) <= s.ante && bossHasRule(b) && b.id !== anteBossId)
    .map((b) => b.id)
    .sort();
  return ids.length > 0 ? core.rng('boss').pick(ids) : null;
}

/** Slot šéfa, který jde ještě změnit (útrata šéfa nezačala ani neskončila), jinak null. */
function changeableBossSlot(core: GameCore): BlindSlot | null {
  const s = core.state;
  const slot = s.blinds.find((b) => b.kind === 'boss');
  if (!slot || (slot.status !== 'upcoming' && slot.status !== 'current')) return null;
  if (s.round?.blind === 'boss') return null;
  return slot;
}

/** Po změně šéfa patra zajistí, že pravidlo Velké útraty (Imperial) není stejný šéf. */
function fixBigBlindBoss(core: GameCore, bossId: string | null): void {
  const big = core.state.blinds.find((b) => b.kind === 'big');
  if (!big || !big.bossId || big.bossId !== bossId || big.status !== 'upcoming') return;
  big.bossId = pickBigBlindBossId(core, bossId);
}

/**
 * Přelosuje šéfa aktuálního patra (jiný než dosavadní, pokud to jde). Emituje `bossRerolled`.
 * Vrací nové id, nebo null, když už přelosovat nejde (kolo šéfa běží nebo skončilo).
 */
export function rerollBossSlot(core: GameCore): string | null {
  const slot = changeableBossSlot(core);
  if (!slot) return null;
  const id = pickBossId(core, slot.bossId ? [slot.bossId] : []);
  slot.bossId = id;
  if (id) core.emit({ type: 'bossRerolled', bossId: id });
  fixBigBlindBoss(core, id);
  return id;
}

/** Po změně patra (`changeAnte`) přelosuje šéfa, který pro nové patro neplatí (finálový × běžný, `minAnte`). */
export function revalidateBoss(core: GameCore): void {
  const slot = changeableBossSlot(core);
  if (!slot) return;
  const current = slot.bossId ? core.registry.bosses[slot.bossId] : undefined;
  if (current && bossFitsAnte(current, core.state.ante)) return;
  if (!current && Object.keys(core.registry.bosses).length === 0) return;
  rerollBossSlot(core);
}
