/**
 * Textové popisy obsahu pro UI (tooltipy, detail, sbírka, aria-label) — vše přes `t()` ze src/i18n.
 *
 * Konvence klíčů viz src/engine/content-types.ts: `jokers.<id>.name|desc|flavor`, `bosses.<id>.name|rule|intro|
 * defeat|death`, `consumables.<id>…`, `vouchers.<id>…`, `tags.<id>…`, `decks.<id>…`, `stakes.<id>…`,
 * `challenges.<id>…`, `boosters.<id>.name|desc`, `enhancements.<id>…`, `seals.<id>…`, `editions.<id>…`,
 * `hands.<type>.name|desc`. `{param}` v popisku dosadí `params` definice (u žolíků navíc `describe(self)`);
 * pravděpodobnosti (`chance`, `*Chance`) se násobí `Modifiers.probabilityMult`, když ho volající předá.
 * Flavor a další nepovinné texty vrací `null`, když klíč chybí (bez varování v konzoli).
 */
import type {
  BoosterDef,
  ChallengeDef,
  ConsumableDef,
  ContentRegistry,
  DeckDef,
  JokerDef,
  JokerRarity,
  StakeDef,
  TagDef,
  VoucherDef,
  BossDef,
} from '../engine/content-types';
import type {
  BlindKind,
  Card,
  ConsumableKind,
  HandType,
  JokerInstance,
  Modifiers,
  StickerId,
} from '../engine/types';
import { PERISH_ROUNDS, RENTAL_FEE } from '../engine/constants';
import { registry as defaultRegistry } from '../content';
import { hasKey, t } from '../i18n/cs';
import type { I18nParams } from '../i18n/cs';

export interface DescribeOptions {
  registry?: ContentRegistry;
  /** Aktuální modifikátory runu — kvůli `probabilityMult` v popiscích „{chance} z {odds}“. */
  mods?: Partial<Pick<Modifiers, 'probabilityMult'>>;
}

/** Společné texty položky obsahu. */
export interface ContentTexts {
  name: string;
  /** Mechanika (jedna přesná věta s čísly). */
  desc: string;
  /** Hláška (bez uvozovek), nebo null. */
  flavor: string | null;
}

export interface JokerTexts extends ContentTexts {
  rarityId: JokerRarity;
  /** Název vzácnosti („Vzácný“). */
  rarity: string;
  /** Edice instance (název + efekt), nebo null. */
  edition: ContentTexts | null;
  /** Řádky nálepek (přibitý, zvětrávající se zbývajícími koly, zapůjčený). */
  stickers: string[];
}

export interface ConsumableTexts extends ContentTexts {
  kindId: ConsumableKind;
  /** Typ spotřebky („Babská rada“). */
  kind: string;
}

export interface VoucherTexts extends ContentTexts {
  tier: 1 | 2;
  /** „Základní kupón“ / „Vylepšený kupón“. */
  tierLabel: string;
  /** „Vyžaduje kupón …“, nebo null. */
  requires: string | null;
}

export interface BossTexts extends ContentTexts {
  /** Pravidlo šéfa (= `desc`). */
  rule: string;
  intro: string | null;
  defeat: string | null;
  death: string | null;
}

export interface ChallengeTexts extends ContentTexts {
  rules: string[];
}

// ─────────────────────────── Pomocné ───────────────────────────

function reg(opts?: DescribeOptions): ContentRegistry {
  return opts?.registry ?? defaultRegistry();
}

/** Text, nebo null, když klíč chybí (bez varování). */
export function optionalText(key: string, params?: I18nParams): string | null {
  return hasKey(key) ? t(key, params) : null;
}

/** První písmeno velké (titulky tooltipů, aria-label). */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toLocaleUpperCase('cs') + text.slice(1);
}

const isChanceKey = (key: string): boolean => key === 'chance' || key.endsWith('Chance');

/** Parametry popisku: `params` (+ dynamické hodnoty), pravděpodobnosti × `probabilityMult`. */
export function describeParams(
  params: Record<string, number | string> | undefined,
  extra?: Record<string, number | string>,
  mods?: DescribeOptions['mods'],
): Record<string, number | string> {
  const out: Record<string, number | string> = { ...(params ?? {}), ...(extra ?? {}) };
  const pm = mods?.probabilityMult;
  if (pm !== undefined && pm !== 1 && Number.isFinite(pm)) {
    for (const [k, v] of Object.entries(out)) if (isChanceKey(k) && typeof v === 'number') out[k] = v * pm;
  }
  return out;
}

function baseTexts(ns: string, id: string, params: I18nParams, descField = 'desc'): ContentTexts {
  return {
    name: t(`${ns}.${id}.name`),
    desc: t(`${ns}.${id}.${descField}`, params),
    flavor: optionalText(`${ns}.${id}.flavor`, params),
  };
}

function resolve<T extends { id: string }>(
  table: Readonly<Record<string, T>>,
  defOrId: T | string,
): { id: string; def: T | undefined } {
  if (typeof defOrId === 'string') return { id: defOrId, def: table[defOrId] };
  return { id: defOrId.id, def: defOrId };
}

// ─────────────────────────── Žolíci ───────────────────────────

/** Instance pro náhled žolíka bez runu (sbírka, galerie): počáteční stav, bez edice a nálepek. */
export function previewJokerInstance(def: JokerDef): JokerInstance {
  let state: JokerInstance['state'] = {};
  try {
    state = def.initState?.() ?? {};
  } catch {
    state = {};
  }
  return { uid: 0, defId: def.id, edition: null, state, sellBonus: 0, stickers: [], debuffed: false };
}

function dynamicParams(def: JokerDef, inst: JokerInstance): Record<string, number | string> {
  if (!def.describe) return {};
  try {
    return def.describe(inst);
  } catch (err) {
    console.warn(`[describe] Žolík ${def.id}: describe() selhalo`, err);
    return {};
  }
}

/** Texty nálepky (`Přibitý: Nejde prodat ani zničit.`); u zvětrávajícího se zbývajícími koly. */
export function stickerText(id: StickerId, inst?: Pick<JokerInstance, 'perishRounds'>): string {
  const name = t(`art.stickers.${id}.name`);
  let desc: string;
  if (id === 'perishable') {
    const left = inst?.perishRounds;
    desc =
      left === undefined
        ? t('art.stickers.perishable.desc', { rounds: PERISH_ROUNDS })
        : left <= 0
          ? t('art.stickers.perishable.perished')
          : t('art.stickers.perishable.left', { n: left });
  } else if (id === 'rental') {
    desc = t('art.stickers.rental.desc', { fee: RENTAL_FEE });
  } else {
    desc = t(`art.stickers.${id}.desc`);
  }
  return t('art.tooltip.edition', { name, desc });
}

/**
 * Texty žolíka: název, mechanika s čísly (`params` + `describe(self)` instance, nebo počátečního stavu),
 * flavor, vzácnost, edice a nálepky instance.
 */
export function jokerTexts(
  defOrId: JokerDef | string,
  inst?: JokerInstance,
  opts?: DescribeOptions,
): JokerTexts {
  const { id, def } = resolve(reg(opts).jokers, defOrId);
  const self = inst ?? (def ? previewJokerInstance(def) : undefined);
  const params = describeParams(def?.params, def && self ? dynamicParams(def, self) : undefined, opts?.mods);
  const rarityId = def?.rarity ?? 'common';
  return {
    ...baseTexts('jokers', id, params),
    rarityId,
    rarity: t(`art.rarity.${rarityId}`),
    edition: inst?.edition ? editionTexts(inst.edition, opts) : null,
    stickers: (inst?.stickers ?? []).map((s) => stickerText(s, inst)),
  };
}

// ─────────────────────────── Spotřebky, kupóny, štítky ───────────────────────────

export function consumableTexts(defOrId: ConsumableDef | string, opts?: DescribeOptions): ConsumableTexts {
  const { id, def } = resolve(reg(opts).consumables, defOrId);
  const params = describeParams(
    def?.params,
    def?.hand ? { hand: t(`hands.${def.hand}.name`) } : undefined,
    opts?.mods,
  );
  const kindId = def?.kind ?? 'pranostika';
  return { ...baseTexts('consumables', id, params), kindId, kind: t(`art.consumableKind.${kindId}`) };
}

export function voucherTexts(defOrId: VoucherDef | string, opts?: DescribeOptions): VoucherTexts {
  const r = reg(opts);
  const { id, def } = resolve(r.vouchers, defOrId);
  const tier = def?.tier ?? 1;
  return {
    ...baseTexts('vouchers', id, describeParams(def?.params, undefined, opts?.mods)),
    tier,
    tierLabel: t(tier === 2 ? 'art.voucher.tier2' : 'art.voucher.tier1'),
    requires: def?.requires ? t('art.voucher.requires', { name: t(`vouchers.${def.requires}.name`) }) : null,
  };
}

export function tagTexts(defOrId: TagDef | string, opts?: DescribeOptions): ContentTexts {
  const { id, def } = resolve(reg(opts).tags, defOrId);
  return baseTexts('tags', id, describeParams(def?.params, undefined, opts?.mods));
}

/** Obálka: vlastní text `boosters.<id>`, jinak složený název („Tlustá obálka · Žolíci“) a „Vyber 1 z 3.“. */
export function boosterTexts(defOrId: BoosterDef | string, opts?: DescribeOptions): ContentTexts {
  const { id, def } = resolve(reg(opts).boosters, defOrId);
  const params = { picks: def?.picks ?? 1, options: def?.options ?? 1 };
  const name =
    optionalText(`boosters.${id}.name`) ??
    (def
      ? t('art.booster.name', {
          size: t(`art.booster.size.${def.size}`),
          kind: t(`art.booster.kind.${def.kind}`),
        })
      : t(`boosters.${id}.name`));
  return {
    name,
    desc: optionalText(`boosters.${id}.desc`, params) ?? t('art.booster.desc', params),
    flavor: optionalText(`boosters.${id}.flavor`),
  };
}

// ─────────────────────────── Šéfové a útraty ───────────────────────────

export function bossTexts(defOrId: BossDef | string, opts?: DescribeOptions): BossTexts {
  const { id } = resolve(reg(opts).bosses, defOrId);
  const rule = t(`bosses.${id}.rule`);
  return {
    name: t(`bosses.${id}.name`),
    desc: rule,
    rule,
    flavor: optionalText(`bosses.${id}.flavor`) ?? optionalText(`bosses.${id}.intro`),
    intro: optionalText(`bosses.${id}.intro`),
    defeat: optionalText(`bosses.${id}.defeat`),
    death: optionalText(`bosses.${id}.death`),
  };
}

/** Název útraty: Malá / Velká útrata, u šéfa jeho jméno. */
export function blindName(kind: BlindKind, bossId: string | null = null): string {
  if (kind === 'boss' && bossId) return t(`bosses.${bossId}.name`);
  return t(`art.blind.${kind}`);
}

// ─────────────────────────── Balíčky, obtížnosti, výzvy ───────────────────────────

export function deckTexts(defOrId: DeckDef | string, opts?: DescribeOptions): ContentTexts {
  const { id, def } = resolve(reg(opts).decks, defOrId);
  return baseTexts('decks', id, describeParams(def?.params, undefined, opts?.mods));
}

export function stakeTexts(defOrId: StakeDef | string, opts?: DescribeOptions): ContentTexts {
  const { id, def } = resolve(reg(opts).stakes, defOrId);
  return baseTexts('stakes', id, describeParams(def?.params, undefined, opts?.mods));
}

export function challengeTexts(defOrId: ChallengeDef | string, opts?: DescribeOptions): ChallengeTexts {
  const { id, def } = resolve(reg(opts).challenges, defOrId);
  const rules = (def?.ruleKeys ?? []).map((key) =>
    hasKey(key) ? t(key) : t(`challenges.${id}.rules.${key}`),
  );
  return { ...baseTexts('challenges', id, {}), rules };
}

// ─────────────────────────── Úpravy karet, kombinace ───────────────────────────

export function enhancementTexts(id: string, opts?: DescribeOptions): ContentTexts {
  return baseTexts(
    'enhancements',
    id,
    describeParams(reg(opts).enhancements[id]?.params, undefined, opts?.mods),
  );
}

export function sealTexts(id: string, opts?: DescribeOptions): ContentTexts {
  return baseTexts('seals', id, describeParams(reg(opts).seals[id]?.params, undefined, opts?.mods));
}

export function editionTexts(id: string, opts?: DescribeOptions): ContentTexts {
  return baseTexts('editions', id, describeParams(reg(opts).editions[id]?.params, undefined, opts?.mods));
}

export function handTexts(type: HandType): { name: string; desc: string } {
  return { name: t(`hands.${type}.name`), desc: t(`hands.${type}.desc`) };
}

/** Druhy obsahu pro obecné `contentTexts`. */
export type ContentKind =
  | 'joker'
  | 'consumable'
  | 'voucher'
  | 'tag'
  | 'booster'
  | 'boss'
  | 'deck'
  | 'stake'
  | 'challenge'
  | 'enhancement'
  | 'seal'
  | 'edition';

/** Obecné texty podle druhu a id (tooltipy, sbírka). */
export function contentTexts(kind: ContentKind, id: string, opts?: DescribeOptions): ContentTexts {
  switch (kind) {
    case 'joker':
      return jokerTexts(id, undefined, opts);
    case 'consumable':
      return consumableTexts(id, opts);
    case 'voucher':
      return voucherTexts(id, opts);
    case 'tag':
      return tagTexts(id, opts);
    case 'booster':
      return boosterTexts(id, opts);
    case 'boss':
      return bossTexts(id, opts);
    case 'deck':
      return deckTexts(id, opts);
    case 'stake':
      return stakeTexts(id, opts);
    case 'challenge':
      return challengeTexts(id, opts);
    case 'enhancement':
      return enhancementTexts(id, opts);
    case 'seal':
      return sealTexts(id, opts);
    case 'edition':
      return editionTexts(id, opts);
  }
}

// ─────────────────────────── Hrací karty ───────────────────────────

type CardNameInput = Pick<Card, 'suit' | 'rank' | 'enhancement'> & { faceDown?: boolean };

/** Nemá karta hodnotu ani barvu (kamenná)? */
export function isRanklessCard(
  card: Pick<Card, 'enhancement'>,
  r: ContentRegistry = defaultRegistry(),
): boolean {
  return card.enhancement !== null && r.enhancements[card.enhancement]?.noRankSuit === true;
}

/**
 * Název hrací karty malými písmeny: „srdcová dáma“, „pikové eso“, „křížový kluk“, „kamenná karta“;
 * karta lícem dolů neprozradí, co je zač („karta lícem dolů“).
 */
export function cardName(card: CardNameInput, r: ContentRegistry = defaultRegistry()): string {
  if (card.faceDown) return t('art.cardName.faceDown');
  if (isRanklessCard(card, r)) return t('art.cardName.stone');
  const gender = t(`art.cardName.gender.${card.rank}`);
  return t('art.cardName.pattern', {
    suit: t(`art.cardName.suit.${card.suit}.${gender}`),
    rank: t(`art.cardName.rank.${card.rank}`),
  });
}

/**
 * Přístupný popis hrací karty: název + vylepšení, edice, pečeť a stav (`Srdcová dáma, Prémiová, Lesklá,
 * Červená pečeť, mimo provoz`). Karta lícem dolů neprozradí nic.
 */
export function cardLabel(
  card: CardNameInput & Pick<Card, 'seal' | 'edition'> & { debuffed?: boolean },
  r: ContentRegistry = defaultRegistry(),
): string {
  const name = capitalize(cardName(card, r));
  if (card.faceDown) return name;
  const extras: string[] = [];
  if (card.enhancement && !isRanklessCard(card, r)) extras.push(t(`enhancements.${card.enhancement}.name`));
  if (card.edition) extras.push(t(`editions.${card.edition}.name`));
  if (card.seal) extras.push(t(`seals.${card.seal}.name`));
  if (card.debuffed) extras.push(t('art.card.debuffed'));
  return extras.length === 0 ? name : t('art.card.withExtras', { name, extras: extras.join(', ') });
}
