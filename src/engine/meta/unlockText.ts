/**
 * Text podmínky odemčení pro sbírku a toasty (DESIGN 11.3–11.4). Engine texty nezná — vrací i18n klíče
 * a parametry, UI z nich složí větu:
 *
 *   const spec = unlockTextFor(registry, 'jokers', 'carousel');
 *   const key = spec.itemKey && hasKey(spec.itemKey) ? spec.itemKey : spec.key;
 *   t(key, { ...spec.params, ...mapValues(spec.refs, (k) => t(k)) });
 *
 * `itemKey` (`meta.unlock.items.<kategorie>.<id>`) je volitelný text konkrétní položky — hezčí věta než obecná
 * šablona (skloňování názvů balíčků, kombinací). Obecné šablony jsou `meta.unlock.cond.*` podle typu podmínky.
 * `refs` jsou parametry, které jsou samy textem (název balíčku, šéfa, kombinace…): hodnota je i18n klíč.
 */
import type { ContentRegistry, UnlockCondition } from '../content-types';
import { CUSTOM_UNLOCK_PARAMS, unlockConditionFor, unlockedByDiscovery } from './unlocks';
import type { UnlockCategory } from './types';

/** Prefix textů odemykání v i18n (`src/i18n/cs/meta.ts`). */
export const UNLOCK_TEXT_PREFIX = 'meta.unlock';

export interface UnlockTextSpec {
  /** Text konkrétní položky (má přednost, pokud v i18n existuje), jinak null. */
  itemKey: string | null;
  /** Obecný text podle typu podmínky (vždy existuje pro podmínky obsahu — hlídá test). */
  key: string;
  /** Čísla a řetězce do šablony. */
  params: Record<string, number | string>;
  /** Parametr → i18n klíč textu, který se do šablony dosadí přeložený (název balíčku, šéfa…). */
  refs: Record<string, string>;
}

/** Klíč textu podmínky konkrétní položky. */
export function unlockItemKey(category: UnlockCategory, id: string): string {
  return `${UNLOCK_TEXT_PREFIX}.items.${category}.${id}`;
}

/** I18n klíč názvu síly piva dané úrovně, nebo null (neznámá úroveň). */
function stakeNameKey(registry: ContentRegistry, level: number): string | null {
  const stake = Object.values(registry.stakes).find((s) => s.level === level);
  return stake ? `stakes.${stake.id}.name` : null;
}

/**
 * Klíče a parametry textu podmínky. `subject` = položka, jejíž podmínka to je (přidá `itemKey`; tier 2 kupónu
 * podle něj pozná svůj tier 1).
 */
export function unlockText(
  registry: ContentRegistry,
  cond: UnlockCondition,
  subject?: { category: UnlockCategory; id: string },
): UnlockTextSpec {
  const params: Record<string, number | string> = {};
  const refs: Record<string, string> = {};
  let key: string;
  switch (cond.type) {
    case 'winRun': {
      if (cond.deck) refs.deck = `decks.${cond.deck}.name`;
      if (cond.stake !== undefined) {
        const stake = stakeNameKey(registry, cond.stake);
        if (stake) refs.stake = stake;
        else params.stake = cond.stake;
      }
      const withStake = cond.stake !== undefined;
      key = cond.deck ? (withStake ? 'winRunDeckStake' : 'winRunDeck') : withStake ? 'winRunStake' : 'winRun';
      break;
    }
    case 'reachAnte':
      params.ante = cond.ante;
      key = 'reachAnte';
      break;
    case 'playHand': {
      refs.hand = `hands.${cond.hand}.name`;
      const count = cond.count ?? 1;
      params.count = count;
      key = count > 1 ? 'playHandCount' : 'playHand';
      break;
    }
    case 'scoreInHand':
      params.score = cond.atLeast;
      key = 'scoreInHand';
      break;
    case 'haveMoney':
      params.money = cond.atLeast;
      key = 'haveMoney';
      break;
    case 'winsTotal':
      params.count = cond.count;
      key = 'winsTotal';
      break;
    case 'runsTotal':
      params.count = cond.count;
      key = 'runsTotal';
      break;
    case 'discover':
      params.count = cond.count;
      key = `discover.${cond.category}`;
      break;
    case 'stat':
      params.count = cond.atLeast;
      key = `stat.${cond.stat}`;
      break;
    case 'roundEndMoney':
      params.money = cond.atMost;
      key = cond.atMost === 0 ? 'roundEndMoneyZero' : cond.atMost === -1 ? 'roundEndMoneyDebt' : 'roundEndMoney';
      break;
    case 'handLevel':
      params.level = cond.level;
      if (cond.hand) refs.hand = `hands.${cond.hand}.name`;
      key = cond.hand ? 'handLevelHand' : 'handLevel';
      break;
    case 'beatBoss': {
      const count = cond.count ?? 1;
      params.count = count;
      if (cond.boss) refs.boss = `bosses.${cond.boss}.name`;
      key = cond.boss ? (count > 1 ? 'beatBossIdCount' : 'beatBossId') : 'beatBoss';
      break;
    }
    case 'useConsumable':
      params.count = cond.count ?? 1;
      if (cond.id) {
        refs.consumable = `consumables.${cond.id}.name`;
        key = 'useConsumableId';
      } else {
        key = `useConsumable.${cond.kind ?? 'any'}`;
      }
      break;
    case 'winChallenge':
      params.count = cond.count ?? 1;
      if (cond.challenge) refs.challenge = `challenges.${cond.challenge}.name`;
      key = cond.challenge ? 'winChallenge' : 'winChallengeCount';
      break;
    case 'achievement':
      refs.achievement = `achievements.${cond.id}.name`;
      key = 'achievement';
      break;
    case 'custom': {
      const known = CUSTOM_UNLOCK_PARAMS[cond.id];
      if (!known) {
        key = 'unknown';
        break;
      }
      Object.assign(params, known);
      key = `custom.${cond.id}`;
      if (cond.id === 'voucherTier1TwoRuns' && subject?.category === 'vouchers') {
        const requires = registry.vouchers[subject.id]?.requires;
        if (requires) refs.voucher = `vouchers.${requires}.name`;
        else key = 'custom.voucherTier1Wins';
      } else if (cond.id === 'voucherTier1TwoRuns') {
        key = 'custom.voucherTier1Wins';
      }
      break;
    }
  }
  return {
    itemKey: subject ? unlockItemKey(subject.category, subject.id) : null,
    key: `${UNLOCK_TEXT_PREFIX}.cond.${key}`,
    params,
    refs,
  };
}

/**
 * Text odemčení položky podle její platné podmínky (`unlockConditionFor`): podmínka, nebo „odemkne se objevením“
 * (legendární žolík bez podmínky), nebo „odemčeno od začátku“.
 */
export function unlockTextFor(registry: ContentRegistry, category: UnlockCategory, id: string): UnlockTextSpec {
  const cond = unlockConditionFor(registry, category, id);
  if (cond) return unlockText(registry, cond, { category, id });
  const key = category === 'jokers' && unlockedByDiscovery(registry, id) ? 'byDiscovery' : 'fromStart';
  return { itemKey: null, key: `${UNLOCK_TEXT_PREFIX}.${key}`, params: {}, refs: {} };
}
