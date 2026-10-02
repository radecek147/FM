/**
 * Úřední razítka (vzácná a silná, většinou s cenou) — docs/DESIGN.md kap. 5.4. Texty v src/i18n/cs/razitka.ts
 * (`consumables.<id>.name|desc|flavor`). Návod: docs/CONTENT-GUIDE.md.
 *
 * Razítka bez platného cíle mají `canUse` false (UI pak tlačítko Použít vypne). Náhoda jen přes `ctx.rng`.
 */
import type { BaseCtx, ConsumableDef, Rng } from '../engine/content-types';
import type { Card, EditionId, JokerInstance } from '../engine/types';
import { EDITIONS, SEALS } from './modifiers';

/** Cena razítka ve Večerce (DESIGN 5.4). */
export const RAZITKO_COST = 6;

/**
 * Šance edic u Hromadného vyřízení a Kontroly totožnosti (v %): lesklá / holografická / duhová. Vlastní rozdělení —
 * 50 / 35 / 15 by bylo 1:1 převzaté číslo (CONTENT-GUIDE 13, DESIGN příloha A).
 */
const EDITION_ROLL: readonly { item: EditionId; weight: number }[] = [
  { item: 'foil', weight: 55 },
  { item: 'holo', weight: 30 },
  { item: 'poly', weight: 15 },
];
const EDITION_PARAMS = Object.fromEntries(EDITION_ROLL.map((e) => [e.item, e.weight]));

/** Zpětný odběr: Kč za každou zničenou kartu. */
const BUYBACK_MONEY = 4;
/** Hromadné vyřízení: trvalá ztráta karet v ruce. */
const BULK_HAND_SIZE_LOSS = 1;
/** Úřední hodiny: úrovně pro všechny kombinace a trvalá ztráta rukou. */
const OFFICE_LEVELS = 2;
const OFFICE_HANDS_LOSS = 1;
/** Kolaudace: +sloty žolíků, −sloty spotřebek, minimum slotů spotřebek pro použití. */
const PERMIT_JOKER_SLOTS = 1;
const PERMIT_CONSUMABLE_SLOTS = 1;
const PERMIT_MIN_CONSUMABLE_SLOTS = 2;
/** Odvolání: cena (smí jít do dluhu, ale jen do dluhového limitu). */
const APPEAL_COST = 5;
/** Vyvlastnění: násobek prodejní ceny. */
const EXPROPRIATION_MULT = 3;

/** Výjimka z vyhlášky: váha v razítkové obálce (ostatní razítka 1; DESIGN 2.9). */
const EXEMPTION_WEIGHT = 0.25;

// ─────────────────────────── Pomocníci ───────────────────────────

/** Hodnota parametru pečetě ze src/content/modifiers.ts (jediný zdroj čísla pro popisek). */
function sealParam(id: string, key: string): number | string {
  const value = SEALS.find((s) => s.id === id)?.params?.[key];
  if (value === undefined) throw new Error(`Seal ${id} has no param ${key}`);
  return value;
}

/** Kolik slotů žolíků dává edice (negativní +1). */
function editionSlots(edition: EditionId | null): number {
  return edition ? (EDITIONS.find((e) => e.id === edition)?.extraSlots ?? 0) : 0;
}

/** Karty, se kterými razítko pracuje: ruka v kole, nebo ruka otevřené obálky. */
function handIds(ctx: BaseCtx): readonly number[] {
  const s = ctx.state;
  if (s.phase === 'booster' && s.booster) return s.booster.hand;
  if (s.phase === 'round' && s.round) return s.round.hand;
  return [];
}

/** Cíle v pořadí karet v ruce zleva doprava (DESIGN 5.1: levá / pravá karta). */
function inHandOrder(ctx: BaseCtx, targets: readonly Card[]): Card[] {
  const order = handIds(ctx);
  return [...targets].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

function rollEdition(rng: Rng): EditionId {
  return rng.weighted(EDITION_ROLL);
}

function isEternal(j: JokerInstance): boolean {
  return j.stickers.includes('eternal');
}

function hasJokerRoom(ctx: BaseCtx): boolean {
  return ctx.state.jokers.length < ctx.api.jokerSlots();
}

/** Razítko, které dá jedné vybrané kartě pečeť. */
function sealStamp(
  id: string,
  seal: string,
  params: Record<string, number | string>,
  art: ConsumableDef['art'],
): ConsumableDef {
  return {
    id,
    kind: 'razitko',
    cost: RAZITKO_COST,
    target: { min: 1, max: 1 },
    params,
    use: (ctx) => {
      for (const card of ctx.targets) ctx.api.modifyCard(card.id, { seal });
    },
    art,
  };
}

// ─────────────────────────── Razítka ───────────────────────────

export const RAZITKA: ConsumableDef[] = [
  // 1 — Ověřeno notářem: zlatá pečeť
  sealStamp(
    'notarized',
    'gold',
    { money: sealParam('gold', 'money') },
    { icon: 'quill-ink', bg: '#3b3226', fg: '#f6ecd2', accent: '#d4a72c', pattern: 'stripes', prop: 'coins' },
  ),
  // 2 — Kolek: červená pečeť
  sealStamp(
    'duty_stamp',
    'red',
    { retriggers: sealParam('red', 'retriggers') },
    { icon: 'post-stamp', bg: '#5a1f1f', fg: '#fff0e6', accent: '#e05252', pattern: 'grid', prop: 'cycle' },
  ),
  // 3 — Modrý formulář: modrá pečeť
  sealStamp(
    'blue_form',
    'blue',
    {},
    {
      icon: 'scroll-unfurled',
      bg: '#1e3a6b',
      fg: '#eaf2ff',
      accent: '#6ea8ff',
      pattern: 'grid',
      prop: 'fluffy-cloud',
    },
  ),
  // 4 — Doporučeně: fialová pečeť
  sealStamp(
    'registered_mail',
    'purple',
    {},
    {
      icon: 'contract',
      bg: '#46225e',
      fg: '#f7ecff',
      accent: '#c084fc',
      pattern: 'stripes',
      prop: 'crystal-ball',
    },
  ),

  // 5 — Výjimka z vyhlášky: legendární žolík (potřebuje slot a legendárního žolíka v poolu)
  {
    id: 'exemption',
    kind: 'razitko',
    cost: RAZITKO_COST,
    weight: EXEMPTION_WEIGHT,
    canUse: (ctx) => hasJokerRoom(ctx) && ctx.api.availableJokers({ rarity: 'legendary' }).length > 0,
    use: (ctx) => {
      ctx.api.createJoker({ rarity: 'legendary' });
    },
    art: {
      icon: 'imperial-crown',
      bg: '#2a1f3d',
      fg: '#fff3c4',
      accent: '#f5c542',
      pattern: 'rays',
      prop: 'stamper',
    },
  },

  // 6 — Zpětný odběr: zničí polovinu ruky (nahoru, náhodně), za každou kartu Kč
  {
    id: 'buyback',
    kind: 'razitko',
    cost: RAZITKO_COST,
    params: { money: BUYBACK_MONEY },
    canUse: (ctx) => handIds(ctx).length > 0,
    use: (ctx) => {
      const ids = [...handIds(ctx)];
      const victims = ctx.rng.shuffle(ids).slice(0, Math.ceil(ids.length / 2));
      for (const id of victims) ctx.api.destroyCard(id, 'buyback');
      ctx.api.addMoney(victims.length * BUYBACK_MONEY, 'buyback');
    },
    art: {
      icon: 'take-my-money',
      bg: '#2f4a2a',
      fg: '#eefbe6',
      accent: '#9be36a',
      pattern: 'checker',
      prop: 'card-discard',
    },
  },

  // 7 — Ověřená kopie: zkopíruje žolíka nejvíc vlevo, ostatní (kromě přibitých) zničí
  {
    id: 'certified_copy',
    kind: 'razitko',
    cost: RAZITKO_COST,
    canUse: (ctx) => {
      const [first, ...others] = ctx.state.jokers;
      if (!first) return false;
      // Po zničení ostatních musí zbýt slot pro kopii (zničená negativní edice si slot odnese).
      const kept = 1 + others.filter(isEternal).length;
      const lostSlots = others.filter((j) => !isEternal(j)).reduce((n, j) => n + editionSlots(j.edition), 0);
      return kept < ctx.api.jokerSlots() - lostSlots;
    },
    use: (ctx) => {
      const [first, ...others] = ctx.state.jokers;
      if (!first) return;
      for (const j of others) if (!isEternal(j)) ctx.api.destroyJoker(j.uid, 'certified_copy');
      // Kopie bez negativní edice; místo pohlídal `canUse`, sloty z pasivních efektů zničených žolíků ji nezastaví.
      const edition = first.edition === 'negative' ? null : first.edition;
      ctx.api.copyJoker(first.uid, { edition, ignoreSlots: true });
    },
    art: {
      icon: 'stamper',
      bg: '#3d3a33',
      fg: '#fbf6e9',
      accent: '#d94141',
      pattern: 'dots',
      prop: 'card-joker',
    },
  },

  // 8 — Hromadné vyřízení: žolíci bez edice dostanou edici; trvale −1 karta v ruce
  {
    id: 'bulk_processing',
    kind: 'razitko',
    cost: RAZITKO_COST,
    params: { ...EDITION_PARAMS, handSize: BULK_HAND_SIZE_LOSS },
    canUse: (ctx) => ctx.mods.handSize > BULK_HAND_SIZE_LOSS && ctx.state.jokers.some((j) => !j.edition),
    use: (ctx) => {
      for (const j of ctx.state.jokers) if (!j.edition) ctx.api.setJokerEdition(j.uid, rollEdition(ctx.rng));
      ctx.api.addPermanentModifier({ handSize: -BULK_HAND_SIZE_LOSS });
    },
    art: {
      icon: 'factory',
      bg: '#3a3f4a',
      fg: '#eef2f7',
      accent: '#f0c75e',
      pattern: 'zigzag',
      prop: 'sparkles',
    },
  },

  // 9 — Úřední hodiny: všechny kombinace +2 úrovně; trvale −1 ruka
  {
    id: 'office_hours',
    kind: 'razitko',
    cost: RAZITKO_COST,
    params: { levels: OFFICE_LEVELS, hands: OFFICE_HANDS_LOSS },
    canUse: (ctx) => ctx.mods.hands > OFFICE_HANDS_LOSS,
    use: (ctx) => {
      ctx.api.levelUpAll(OFFICE_LEVELS);
      ctx.api.addPermanentModifier({ hands: -OFFICE_HANDS_LOSS });
    },
    art: {
      icon: 'alarm-clock',
      bg: '#4a3a26',
      fg: '#fff4e0',
      accent: '#e8a33d',
      pattern: 'grid',
      prop: 'stamper',
    },
  },

  // 10 — Kontrola totožnosti: karta bez edice dostane náhodnou edici
  {
    id: 'id_check',
    kind: 'razitko',
    cost: RAZITKO_COST,
    target: { min: 1, max: 1 },
    params: EDITION_PARAMS,
    canUse: (ctx) => ctx.targets.every((c) => !c.edition),
    use: (ctx) => {
      for (const card of ctx.targets) ctx.api.modifyCard(card.id, { edition: rollEdition(ctx.rng) });
    },
    art: {
      icon: 'magnifying-glass',
      bg: '#26404a',
      fg: '#e9f8ff',
      accent: '#7dd3fc',
      pattern: 'dots',
      prop: 'sparkles',
    },
  },

  // 11 — Sloučení spisů: pravá karta se zničí, levá převezme, co jí chybí
  {
    id: 'merge_files',
    kind: 'razitko',
    cost: RAZITKO_COST,
    target: { min: 2, max: 2 },
    use: (ctx) => {
      const [left, right] = inHandOrder(ctx, ctx.targets);
      if (!left || !right) return;
      ctx.api.modifyCard(left.id, {
        enhancement: left.enhancement ?? right.enhancement,
        seal: left.seal ?? right.seal,
        edition: left.edition ?? right.edition,
      });
      ctx.api.destroyCard(right.id, 'merge_files');
    },
    art: { icon: 'papers', bg: '#4a4436', fg: '#fffaf0', accent: '#c9a96e', pattern: 'stripes' },
  },

  // 12 — Daňové přiznání: epický žolík; peníze na 0 Kč (dluh zůstává)
  {
    id: 'tax_return',
    kind: 'razitko',
    cost: RAZITKO_COST,
    canUse: (ctx) => hasJokerRoom(ctx) && ctx.api.availableJokers({ rarity: 'epic' }).length > 0,
    use: (ctx) => {
      ctx.api.createJoker({ rarity: 'epic' });
      if (ctx.state.money > 0) ctx.api.setMoney(0, 'tax_return');
    },
    art: {
      icon: 'bank',
      bg: '#2b3440',
      fg: '#eef3f8',
      accent: '#9fb3c8',
      pattern: 'checker',
      prop: 'money-stack',
    },
  },

  // 13 — Kolaudace: trvale +1 slot žolíka, −1 slot spotřebky (jen při aspoň 2 slotech spotřebek)
  {
    id: 'occupancy_permit',
    kind: 'razitko',
    cost: RAZITKO_COST,
    params: {
      jokerSlots: PERMIT_JOKER_SLOTS,
      consumableSlots: PERMIT_CONSUMABLE_SLOTS,
      minSlots: PERMIT_MIN_CONSUMABLE_SLOTS,
    },
    // Aspoň 2 sloty spotřebek a ostatní spotřebky se po ubrání slotu vejdou (sloty se nesmí přeplnit, např. při
    // „Koupit a použít“ s plnými sloty). Razítko použité ze slotu svůj slot uvolní, i s případnou negativní edicí.
    canUse: (ctx) => {
      const slots = ctx.mods.consumableSlots;
      const inSlots = ctx.state.consumables.some((c) => c.uid === ctx.self.uid);
      const others = ctx.state.consumables.length - (inSlots ? 1 : 0);
      const after = slots - (inSlots ? editionSlots(ctx.self.edition) : 0) - PERMIT_CONSUMABLE_SLOTS;
      return slots >= PERMIT_MIN_CONSUMABLE_SLOTS && others <= after;
    },
    use: (ctx) => {
      ctx.api.addPermanentModifier({
        jokerSlots: PERMIT_JOKER_SLOTS,
        consumableSlots: -PERMIT_CONSUMABLE_SLOTS,
      });
    },
    art: {
      icon: 'house',
      bg: '#3f4f3a',
      fg: '#f4fbe9',
      accent: '#d9b86c',
      pattern: 'checker',
      prop: 'ladder',
    },
  },

  // 14 — Odvolání: v kole se šéfovským pravidlem ho vypne; stojí 5 Kč (i do dluhu, do limitu)
  {
    id: 'appeal',
    kind: 'razitko',
    cost: RAZITKO_COST,
    params: { cost: APPEAL_COST },
    canUse: (ctx) => {
      const s = ctx.state;
      return (
        s.phase === 'round' &&
        !!s.round?.bossId &&
        !s.round.bossDisabled &&
        s.money - APPEAL_COST >= -ctx.mods.debtLimit
      );
    },
    use: (ctx) => {
      ctx.api.addMoney(-APPEAL_COST, 'appeal');
      ctx.api.disableBoss();
    },
    art: { icon: 'gavel', bg: '#4a2a22', fg: '#fff1ea', accent: '#e07a5f', pattern: 'rays' },
  },

  // 15 — Vyvlastnění: zničí žolíka nejvíc vpravo (ne přibitého) za 3× prodejní cenu
  {
    id: 'expropriation',
    kind: 'razitko',
    cost: RAZITKO_COST,
    params: { mult: EXPROPRIATION_MULT },
    canUse: (ctx) => ctx.state.jokers.some((j) => !isEternal(j)),
    use: (ctx) => {
      const target = [...ctx.state.jokers].reverse().find((j) => !isEternal(j));
      if (!target) return;
      const payout = ctx.api.sellValue(target) * EXPROPRIATION_MULT;
      ctx.api.destroyJoker(target.uid, 'expropriation');
      ctx.api.addMoney(payout, 'expropriation');
    },
    art: { icon: 'traffic-cone', bg: '#5a3a1a', fg: '#fff3e0', accent: '#f59e0b', pattern: 'stripes' },
  },

  // 16 — Prominutí pokut: odstraní všechny nálepky ze všech žolíků
  {
    id: 'fine_waiver',
    kind: 'razitko',
    cost: RAZITKO_COST,
    canUse: (ctx) => ctx.state.jokers.some((j) => j.stickers.length > 0),
    use: (ctx) => {
      for (const j of ctx.state.jokers) if (j.stickers.length > 0) ctx.api.removeJokerStickers(j.uid);
    },
    art: {
      icon: 'padlock-open',
      bg: '#2a4a46',
      fg: '#e9fffb',
      accent: '#5eead4',
      pattern: 'waves',
      prop: 'stamper',
    },
  },
];
