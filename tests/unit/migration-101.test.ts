/**
 * Migrace uložení po 1.0.1 (docs/DECISIONS.md 2026-10-03): run v1 → v2 a profil v1 → v2 přemapují nahrazené kupóny
 * a štítky na nástupce (`src/engine/save/renames.ts`), nic se neztratí a načtený run jde hrát se skutečným obsahem.
 */
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/content/index';
import { createProfile, deserializeProfile, PROFILE_VERSION } from '../../src/engine/meta/profile';
import { Game } from '../../src/engine/run/game';
import { RUN_STATE_VERSION } from '../../src/engine/run/init';
import { TAG_RENAMES_V2, VOUCHER_RENAMES_V2 } from '../../src/engine/save/renames';
import { deserializeRun, SAVE_FORMAT, serializeRun } from '../../src/engine/save/save';
import type { RunState } from '../../src/engine/types';

const reg = buildRegistry();
const NOW = '2026-10-03T12:00:00.000Z';

/** Uložení runu ve formátu v1 se starými id (jako ho zapsala verze 1.0). */
function v1RunSave(): string {
  const g = Game.newRun({ seed: 'MIGRACE1', deckId: 'pub', stake: 1 }, reg);
  const data = JSON.parse(JSON.stringify(g.state)) as RunState & Record<string, unknown>;
  data.version = 1;
  data.money = 10;
  data.vouchers = ['yellow_price', 'polish', 'late_hours'];
  data.anteVouchers = ['tear_calendar'];
  data.unlockedPool = { jokers: null, vouchers: ['second_shelf', 'savings_account'], boosters: null };
  data.blinds[0]!.skipTagId = 'term_deposit';
  data.blinds[1]!.skipTagId = 'kiosk_calendar';
  data.tags = [
    { uid: 900, defId: 'term_deposit', state: {} },
    { uid: 901, defId: 'dental_xray', state: {} },
    { uid: 902, defId: 'boss_flu', state: {} },
    { uid: 903, defId: 'official_letter', state: {} },
  ];
  return JSON.stringify({ format: SAVE_FORMAT, kind: 'run', version: 1, savedAt: NOW, data });
}

describe('migrace runu v1 → v2 (1.0.1)', () => {
  it('verze uložení runu je 2 a každé staré id má nástupce v registru', () => {
    expect(RUN_STATE_VERSION).toBe(2);
    for (const [from, to] of Object.entries(VOUCHER_RENAMES_V2)) {
      expect(reg.vouchers[from], from).toBeUndefined();
      expect(reg.vouchers[to], to).toBeDefined();
      // Nástupce je na stejném místě páru (stupeň zůstává).
      expect(reg.vouchers[to]!.tier, to).toBe(
        Object.keys(VOUCHER_RENAMES_V2).indexOf(from) % 2 === 0 ? 1 : 2,
      );
    }
    for (const [from, to] of Object.entries(TAG_RENAMES_V2)) {
      expect(reg.tags[from], from).toBeUndefined();
      expect(reg.tags[to], to).toBeDefined();
    }
  });

  it('kupóny, nabídka, pool a štítky dostanou nová id; Termínovaný vklad se vyplatí, Rentgen je Vyleštěné příbory', () => {
    const run = deserializeRun(v1RunSave());
    expect(run.version).toBe(2);
    expect(run.vouchers).toEqual(['loyalty_card', 'spring_cleaning', 'late_hours']);
    expect(run.anteVouchers).toEqual(['complaints_book']);
    expect(run.unlockedPool.vouchers).toEqual(['second_shelf', 'deposit_bottle']);
    expect(run.blinds.map((b) => b.skipTagId)).toEqual(['fair_raffle', 'harvest_festival', null]);
    expect(run.tags.map((t) => t.defId)).toEqual(['polished_cutlery', 'boss_flu']);
    expect(run.money).toBe(10 + 15);
  });

  it('migrovaný run jde hrát se skutečným obsahem a znovu uložit (efekty nových kupónů platí)', () => {
    const game = Game.fromState(deserializeRun(v1RunSave()), reg);
    expect(game.modifiers().freePurchaseEvery).toBe(5);
    expect(game.dispatch({ type: 'skipBlind' }).ok).toBe(true);
    expect(game.dispatch({ type: 'selectBlind' }).ok).toBe(true);
    const again = deserializeRun(serializeRun(game.state));
    expect(again.version).toBe(RUN_STATE_VERSION);
    expect(JSON.stringify(again)).toBe(JSON.stringify(game.state));
  });

  it('uložení v1 bez starých id projde beze změny (kromě verze)', () => {
    const g = Game.newRun({ seed: 'MIGRACE2', deckId: 'pub', stake: 1 }, reg);
    const env = JSON.parse(serializeRun(g.state)) as { version: number; data: RunState };
    env.version = 1;
    env.data.version = 1;
    const run = deserializeRun(env);
    expect({ ...run, version: 1 }).toEqual({ ...g.state, version: 1 });
  });
});

describe('migrace profilu v1 → v2 (1.0.1)', () => {
  function v1Profile(): string {
    const p = createProfile(NOW) as unknown as Record<string, unknown> & ReturnType<typeof createProfile>;
    p.version = 1;
    p.unlocks.vouchers = ['relabeled_price', 'checkout_shelf'];
    p.discovered.vouchers = ['yellow_price', 'second_shelf', 'loyalty_card'];
    p.discovered.tags = ['term_deposit', 'coat_change', 'dental_xray'];
    p.unseen = ['vouchers:polish', 'tags:cottage_marias', 'jokers:beer_mat'];
    p.stats.voucherRuns = { yellow_price: 2, loyalty_card: 1, nonstop: 3 };
    p.current = {
      no: 4,
      seed: 'ABCDEFGH',
      deckId: 'pub',
      stake: 1,
      challengeId: null,
      daily: false,
      mode: 'normal',
      seeded: false,
      official: false,
      counted: true,
      startedAt: NOW,
      outcome: null,
      cause: null,
      maxAnte: 2,
      endless: false,
      bestHand: 100,
      bestHandType: 'pair',
      jokers: [],
      handsPlayed: 3,
      roundsWon: 1,
      // Zbytek počítadel doplní normalizace profilu.
      counters: { vouchersBought: ['tear_calendar'] } as never,
    };
    return JSON.stringify({ format: SAVE_FORMAT, kind: 'profile', version: 1, savedAt: NOW, data: p });
  }

  it('odemčení, objevy, „Nové“, statistiky kupónů i rozehraný run dostanou nová id; nic se neztratí', () => {
    expect(PROFILE_VERSION).toBe(2);
    const p = deserializeProfile(v1Profile());
    expect(p.version).toBe(2);
    expect(p.unlocks.vouchers).toEqual(['regular_customer', 'checkout_shelf']);
    expect(p.discovered.vouchers).toEqual(['loyalty_card', 'second_shelf']);
    expect(p.discovered.tags).toEqual(['fair_raffle', 'coat_change', 'paper_drive']);
    expect(p.unseen).toEqual(['vouchers:spring_cleaning', 'tags:mushroom_hunt', 'jokers:beer_mat']);
    expect(p.stats.voucherRuns).toEqual({ loyalty_card: 3, nonstop: 3 });
    expect(p.current?.counters.vouchersBought).toEqual(['complaints_book']);
    expect(p.current?.seed).toBe('ABCDEFGH');
  });

  it('profil v2 se načte beze změn', () => {
    const p = deserializeProfile(v1Profile());
    const again = deserializeProfile(
      JSON.stringify({ format: SAVE_FORMAT, kind: 'profile', version: 2, savedAt: NOW, data: p }),
    );
    expect(again).toEqual(p);
  });
});
