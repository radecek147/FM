/**
 * Sbírka (codex, DESIGN 11.4): záložky Žolíci · Pranostiky · Babské rady · Razítka · Kupóny · Štítky · Šéfové ·
 * Balíčky · Síla piva · Vylepšení, pečetě a edice · Kombinace · Výzvy · Achievementy.
 *
 * Stav položky z profilu (`collectionState`): **neodemčeno** (silueta + podmínka odemčení s průběhem) →
 * **odemčeno, neobjeveno** (silueta + „???“) → **objeveno** (plná karta; detail s mechanikou, flavorem,
 * vzácností, cenou a statistikou použití). Balíčky, síly piva a výzvy ukazují název i zamčené (jsou to režimy, ne
 * tajemství); žolíci a kupóny zamčení jen „Zamčeno“. Štítek „Nové“ (`Profile.unseen`) zmizí po otevření detailu
 * nebo při odchodu ze záložky. Žolíky jde filtrovat podle vzácnosti a zaměření (`JokerTag`), všechno řadit podle
 * pořadí, názvu a četnosti použití (žolíci i podle vzácnosti); počítadlo „Objeveno x / y“.
 *
 * Výkon: vykresluje se jen otevřená záložka (líně při přepnutí). Klávesnice: šipky v záložkách, Tab a šipky
 * v mřížce, Enter / mezerník otevře detail, Esc zavře detail / vrátí do menu.
 */
import '../styles/cards.css';
import '../styles/meta.css';
import type { Card, ContentRegistry, JokerRarity, JokerTag } from '../../engine';
import type { AchievementDef, CollectionCategory, CollectionState, Profile } from '../../engine/meta';
import { achievementList, achievementProgress, collectionState, isUnseen } from '../../engine/meta';
import { hasKey, t } from '../../i18n/cs';
import { formatMoney, formatNumber } from '../../i18n/format';
import type { App, ScreenFactory } from '../app';
import { iconElement } from '../art/icons';
import { backButton } from '../components/button';
import { createCardView } from '../components/card';
import { createConsumableCard, createContentCard } from '../components/consumableCard';
import { createJokerCard, previewJoker } from '../components/jokerCard';
import { isModalOpen, openModal } from '../components/modal';
import { createTabs } from '../components/tabs';
import {
  boosterTexts,
  bossTexts,
  challengeTexts,
  consumableTexts,
  deckTexts,
  editionTexts,
  enhancementTexts,
  jokerTexts,
  sealTexts,
  stakeTexts,
  tagTexts,
  voucherTexts,
  type ContentTexts,
} from '../describe';
import { h } from '../dom';
import { formatDateTime, stakeName, unlockInfo, type UnlockInfo } from '../metaText';

// ─────────────────────────── Model ───────────────────────────

export const COLLECTION_TABS = [
  'jokers',
  'pranostiky',
  'rady',
  'razitka',
  'vouchers',
  'boosters',
  'tags',
  'bosses',
  'decks',
  'stakes',
  'mods',
  'hands',
  'challenges',
  'achievements',
] as const;

export type CollectionTab = (typeof COLLECTION_TABS)[number];

export type SortMode = 'order' | 'rarity' | 'name' | 'usage';

const RARITIES: readonly JokerRarity[] = ['common', 'rare', 'epic', 'legendary'];
const JOKER_TAGS: readonly JokerTag[] = [
  'chips',
  'mult',
  'xmult',
  'economy',
  'scaling',
  'retrigger',
  'hand',
  'suit',
  'face',
  'rank',
  'discard',
  'utility',
  'consumable',
  'deck',
  'copy',
];
const CONSUMABLE_TABS: Partial<Record<CollectionTab, 'pranostika' | 'rada' | 'razitko'>> = {
  pranostiky: 'pranostika',
  rady: 'rada',
  razitka: 'razitko',
};

/** Obsah detailu položky. */
export interface EntryDetail {
  title: string;
  /** Druh a vzácnost / úroveň („Žolík · Vzácný“). */
  kind: string;
  desc: string | null;
  /** Další řádky popisu (pravidla výzvy). */
  lines?: string[];
  flavor: string | null;
  facts: { label: string; value: string }[];
  /** Statistika použití (řádky), prázdné = bez záznamu. */
  stats: string[] | null;
  /** Podmínka odemčení (zamčená položka). */
  condition: UnlockInfo | null;
  /** Poznámka místo popisu (neobjeveno, skrytý achievement). */
  note: string | null;
}

/** Položka sbírky. */
export interface CollectionEntry {
  id: string;
  /** Kategorie profilu (stav, štítek „Nové“). */
  category: CollectionCategory;
  state: CollectionState;
  /** Zobrazený název („???“ / „Zamčeno“ u neobjevených a zamčených). */
  name: string;
  /** Pořadí v obsahu. */
  order: number;
  rarity?: JokerRarity;
  tags?: readonly JokerTag[];
  /** Četnost použití pro řazení (null = kategorie ji nesleduje). */
  usage: number | null;
  /** Podskupina v záložce (vylepšení / pečetě / edice, běžní / finální šéfové). */
  group?: string;
  isNew: boolean;
  /** Obrázek dlaždice (dekorativní). */
  art(): Element;
  detail(): EntryDetail;
}

const rarityRank = (r: JokerRarity | undefined): number => (r ? RARITIES.indexOf(r) : 0);

function plainCard(patch: Partial<Card>): Card {
  return {
    id: 0,
    suit: 'S',
    rank: 13,
    enhancement: null,
    seal: null,
    edition: null,
    bonusChips: 0,
    debuffed: false,
    faceDown: false,
    ...patch,
  };
}

function iconTile(icon: string, extra?: string): HTMLElement {
  return h(
    'span',
    { class: 'codex-icon' },
    iconElement(icon),
    extra ? h('span', { class: 'codex-icon__extra' }, extra) : null,
  );
}

function textsDetail(
  tx: ContentTexts,
  kind: string,
  extra: Partial<EntryDetail> = {},
): Omit<EntryDetail, 'title'> & { title: string } {
  return {
    title: tx.name,
    kind,
    desc: tx.desc,
    flavor: tx.flavor,
    facts: [],
    stats: null,
    condition: null,
    note: null,
    ...extra,
  };
}

/** Detail neobjevené / zamčené položky. */
function hiddenDetail(
  entry: Pick<CollectionEntry, 'state' | 'name'>,
  kind: string,
  condition: UnlockInfo | null,
): EntryDetail {
  return {
    title: entry.name,
    kind,
    desc: null,
    flavor: null,
    facts: [],
    stats: null,
    condition: entry.state === 'locked' ? condition : null,
    note: entry.state === 'unknown' ? t('meta.collection.unknownHint') : null,
  };
}

const usageLines = (lines: (string | null)[]): string[] => lines.filter((l): l is string => l !== null);

/** Položky záložky (čistě z profilu a registru). */
export function collectionEntries(
  tab: CollectionTab,
  profile: Readonly<Profile>,
  registry: ContentRegistry,
  nowIso: string = new Date().toISOString(),
): CollectionEntry[] {
  const s = profile.stats;
  const isNew = (category: CollectionCategory, id: string): boolean => isUnseen(profile, category, id);
  const hiddenName = (state: CollectionState): string =>
    state === 'locked' ? t('meta.collection.locked') : t('meta.collection.unknownName');

  switch (tab) {
    case 'jokers':
      return Object.values(registry.jokers).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'jokers', def.id);
        const known = state === 'discovered';
        const name = known ? jokerTexts(def.id, undefined, { registry }).name : hiddenName(state);
        const kind = t('art.kind.joker');
        return {
          id: def.id,
          category: 'jokers',
          state,
          name,
          order,
          rarity: def.rarity,
          tags: def.tags,
          usage: s.jokerRounds[def.id] ?? 0,
          isNew: isNew('jokers', def.id),
          art: () => createJokerCard(previewJoker(def.id, registry), { tooltip: false, registry }),
          detail: () => {
            if (!known)
              return hiddenDetail({ state, name }, kind, unlockInfo(profile, registry, 'jokers', def.id));
            const tx = jokerTexts(def.id, undefined, { registry });
            return textsDetail(tx, `${kind} · ${tx.rarity}`, {
              facts: [{ label: t('meta.collection.detail.price'), value: formatMoney(def.cost) }],
              stats: usageLines([
                t('meta.collection.usage.jokerRounds', { n: s.jokerRounds[def.id] ?? 0 }),
                t('meta.collection.usage.jokerBuys', { n: s.jokerBuys[def.id] ?? 0 }),
              ]),
            });
          },
        };
      });

    case 'pranostiky':
    case 'rady':
    case 'razitka': {
      const want = CONSUMABLE_TABS[tab];
      return Object.values(registry.consumables)
        .filter((def) => def.kind === want)
        .map((def, order): CollectionEntry => {
          const state = collectionState(profile, registry, 'consumables', def.id);
          const known = state === 'discovered';
          const tx = consumableTexts(def.id, { registry });
          const name = known ? tx.name : hiddenName(state);
          return {
            id: def.id,
            category: 'consumables',
            state,
            name,
            order,
            usage: s.consumableUses[def.id] ?? 0,
            isNew: isNew('consumables', def.id),
            art: () => createConsumableCard({ defId: def.id }, { tooltip: false, registry }),
            detail: () =>
              known
                ? textsDetail(tx, tx.kind, {
                    facts: [{ label: t('meta.collection.detail.price'), value: formatMoney(def.cost) }],
                    stats: [t('meta.collection.usage.consumableUses', { n: s.consumableUses[def.id] ?? 0 })],
                  })
                : hiddenDetail({ state, name }, tx.kind, null),
          };
        });
    }

    case 'vouchers':
      return Object.values(registry.vouchers).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'vouchers', def.id);
        const known = state === 'discovered';
        const tx = voucherTexts(def.id, { registry });
        const name = known ? tx.name : hiddenName(state);
        return {
          id: def.id,
          category: 'vouchers',
          state,
          name,
          order,
          usage: s.voucherRuns[def.id] ?? 0,
          isNew: isNew('vouchers', def.id),
          art: () => createContentCard('voucher', def.id, { tooltip: false, registry }),
          detail: () =>
            known
              ? textsDetail(tx, `${t('art.kind.voucher')} · ${tx.tierLabel}`, {
                  lines: tx.requires ? [tx.requires] : [],
                  facts: [{ label: t('meta.collection.detail.price'), value: formatMoney(def.cost) }],
                  stats: [t('meta.collection.usage.voucherRuns', { n: s.voucherRuns[def.id] ?? 0 })],
                })
              : hiddenDetail(
                  { state, name },
                  `${t('art.kind.voucher')} · ${tx.tierLabel}`,
                  unlockInfo(profile, registry, 'vouchers', def.id),
                ),
        };
      });

    case 'boosters':
      return Object.values(registry.boosters).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'boosters', def.id);
        const known = state === 'discovered';
        const tx = boosterTexts(def.id, { registry });
        const name = known ? tx.name : hiddenName(state);
        return {
          id: def.id,
          category: 'boosters',
          state,
          name,
          order,
          usage: null,
          isNew: isNew('boosters', def.id),
          art: () => createContentCard('booster', def.id, { tooltip: false, registry }),
          detail: () =>
            known
              ? textsDetail(tx, t('art.kind.booster'), {
                  facts: [{ label: t('meta.collection.detail.price'), value: formatMoney(def.cost) }],
                })
              : hiddenDetail({ state, name }, t('art.kind.booster'), null),
        };
      });

    case 'tags':
      return Object.values(registry.tags).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'tags', def.id);
        const known = state === 'discovered';
        const tx = tagTexts(def.id, { registry });
        const name = known ? tx.name : hiddenName(state);
        return {
          id: def.id,
          category: 'tags',
          state,
          name,
          order,
          usage: null,
          isNew: isNew('tags', def.id),
          art: () => createContentCard('tag', def.id, { tooltip: false, registry }),
          detail: () =>
            known
              ? textsDetail(tx, t('art.kind.tag'))
              : hiddenDetail({ state, name }, t('art.kind.tag'), null),
        };
      });

    case 'bosses':
      return Object.values(registry.bosses).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'bosses', def.id);
        const known = state === 'discovered';
        const tx = bossTexts(def.id, { registry });
        const name = known ? tx.name : hiddenName(state);
        const bs = s.bosses[def.id];
        const kind = def.final ? t('meta.collection.detail.finalBoss') : t('art.kind.boss');
        return {
          id: def.id,
          category: 'bosses',
          state,
          name,
          order,
          usage: (bs?.defeated ?? 0) + (bs?.lostTo ?? 0),
          group: def.final ? 'finalBosses' : 'bosses',
          isNew: isNew('bosses', def.id),
          art: () => createContentCard('boss', def.id, { tooltip: false, registry }),
          detail: () =>
            known
              ? textsDetail(tx, kind, {
                  flavor: tx.intro ?? tx.flavor,
                  facts:
                    !def.final && (def.minAnte ?? 1) > 1
                      ? [
                          {
                            label: t('art.kind.boss'),
                            value: t('meta.collection.detail.bossAnte', { ante: def.minAnte ?? 1 }),
                          },
                        ]
                      : [],
                  stats: [
                    t('meta.collection.usage.bossDefeated', { n: bs?.defeated ?? 0 }),
                    t('meta.collection.usage.bossLostTo', { n: bs?.lostTo ?? 0 }),
                  ],
                })
              : hiddenDetail({ state, name }, kind, null),
        };
      });

    case 'decks':
      return Object.values(registry.decks).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'decks', def.id);
        const tx = deckTexts(def.id, { registry });
        const ds = s.byDeck[def.id];
        return {
          id: def.id,
          category: 'decks',
          state,
          name: tx.name,
          order,
          usage: ds?.played ?? 0,
          isNew: isNew('decks', def.id),
          art: () => createContentCard('deck', def.id, { tooltip: false, registry }),
          detail: () =>
            textsDetail(tx, t('art.kind.deck'), {
              condition: state === 'locked' ? unlockInfo(profile, registry, 'decks', def.id) : null,
              stats:
                state === 'locked'
                  ? null
                  : usageLines([
                      t('meta.collection.usage.deckPlayed', { n: ds?.played ?? 0, won: ds?.won ?? 0 }),
                      (ds?.bestStake ?? 0) > 0
                        ? t('meta.collection.usage.deckBestStake', {
                            stake: stakeName(registry, ds?.bestStake ?? 0),
                          })
                        : null,
                    ]),
            }),
        };
      });

    case 'stakes':
      return Object.values(registry.stakes)
        .sort((a, b) => a.level - b.level)
        .map((def, order): CollectionEntry => {
          const state = collectionState(profile, registry, 'stakes', def.id);
          const tx = stakeTexts(def.id, { registry });
          const ws = s.byStake[String(def.level)];
          return {
            id: def.id,
            category: 'stakes',
            state,
            name: tx.name,
            order,
            usage: ws?.played ?? 0,
            isNew: isNew('stakes', def.id),
            art: () => createContentCard('stake', def.id, { tooltip: false, registry }),
            detail: () =>
              textsDetail(
                tx,
                `${t('art.kind.stake')} · ${t('meta.collection.detail.stakeLevel', { level: def.level })}`,
                {
                  condition:
                    state === 'locked'
                      ? {
                          text: t('meta.collection.stakeCondition', {
                            stake: stakeName(registry, def.level - 1),
                          }),
                          progress: 0,
                          target: 1,
                          met: false,
                          progressText: null,
                        }
                      : null,
                  stats:
                    state === 'locked'
                      ? null
                      : [t('meta.collection.usage.stakePlayed', { n: ws?.played ?? 0, won: ws?.won ?? 0 })],
                },
              ),
          };
        });

    case 'mods': {
      const out: CollectionEntry[] = [];
      const add = (
        category: 'enhancements' | 'seals' | 'editions',
        ids: string[],
        texts: (id: string) => ContentTexts,
        art: (id: string) => Element,
      ): void => {
        const kind = t(`meta.collection.groups.${category}`);
        ids.forEach((id) => {
          const state = collectionState(profile, registry, category, id);
          const known = state === 'discovered';
          const tx = texts(id);
          const name = known ? tx.name : hiddenName(state);
          out.push({
            id,
            category,
            state,
            name,
            order: out.length,
            usage: null,
            group: category,
            isNew: isNew(category, id),
            art: () => art(id),
            detail: () => (known ? textsDetail(tx, kind) : hiddenDetail({ state, name }, kind, null)),
          });
        });
      };
      add(
        'enhancements',
        Object.keys(registry.enhancements),
        (id) => enhancementTexts(id, { registry }),
        (id) => createContentCard('enhancement', id, { tooltip: false, registry }),
      );
      add(
        'seals',
        Object.keys(registry.seals),
        (id) => sealTexts(id, { registry }),
        (id) => createContentCard('seal', id, { tooltip: false, registry }),
      );
      add(
        'editions',
        Object.keys(registry.editions),
        (id) => editionTexts(id, { registry }),
        (id) => createCardView(plainCard({ edition: id }), { tooltip: false, registry }),
      );
      return out;
    }

    case 'hands':
      return Object.values(registry.handTypes).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'hands', def.type);
        const known = state === 'discovered';
        const name = known ? t(`hands.${def.type}.name`) : hiddenName(state);
        const level = s.records.handLevels[def.type] ?? 1;
        const kind = def.secret ? t('meta.collection.detail.secret') : t('art.kind.hand');
        return {
          id: def.type,
          category: 'hands',
          state,
          name,
          order,
          usage: s.handTypes[def.type] ?? 0,
          isNew: isNew('hands', def.type),
          art: () => (known ? iconTile('poker-hand', formatNumber(level)) : iconTile('help')),
          detail: () =>
            known
              ? {
                  title: name,
                  kind,
                  desc: t(`hands.${def.type}.desc`),
                  flavor: null,
                  facts: [
                    {
                      label: t('art.kind.hand'),
                      value: t('meta.collection.detail.base', { chips: def.baseChips, mult: def.baseMult }),
                    },
                    {
                      label: t('meta.collection.detail.stats'),
                      value: t('meta.collection.detail.perLevel', {
                        chips: def.chipsPerLevel,
                        mult: def.multPerLevel,
                      }),
                    },
                  ],
                  stats: [
                    t('meta.collection.usage.handPlayed', { n: s.handTypes[def.type] ?? 0 }),
                    t('meta.collection.detail.level', { level }),
                  ],
                  condition: null,
                  note: null,
                }
              : hiddenDetail({ state, name }, kind, null),
        };
      });

    case 'challenges':
      return Object.values(registry.challenges).map((def, order): CollectionEntry => {
        const state = collectionState(profile, registry, 'challenges', def.id);
        const tx = challengeTexts(def.id, { registry });
        const cs = s.challenges[def.id];
        return {
          id: def.id,
          category: 'challenges',
          state,
          name: tx.name,
          order,
          usage: cs?.attempts ?? 0,
          isNew: isNew('challenges', def.id),
          art: () => createContentCard('challenge', def.id, { tooltip: false, registry }),
          detail: () =>
            textsDetail(tx, t('art.kind.challenge'), {
              lines: tx.rules,
              condition: state === 'locked' ? unlockInfo(profile, registry, 'challenges', def.id) : null,
              stats:
                state === 'locked'
                  ? null
                  : usageLines([
                      t('meta.collection.usage.challengeAttempts', {
                        n: cs?.attempts ?? 0,
                        completed: cs?.completed ?? 0,
                      }),
                      (cs?.bestAnte ?? 0) > 0
                        ? t('meta.collection.usage.challengeBestAnte', { ante: cs?.bestAnte ?? 0 })
                        : null,
                    ]),
            }),
        };
      });

    case 'achievements': {
      const ctx = { registry, nowIso };
      return achievementList(registry).map((def, order): CollectionEntry => {
        const earnedAt = profile.achievements.unlocked[def.id];
        const state: CollectionState = earnedAt !== undefined ? 'discovered' : 'locked';
        const secret = def.hidden === true && state !== 'discovered';
        const name = secret ? t('meta.collection.unknownName') : achievementText(def, 'name');
        return {
          id: def.id,
          category: 'achievements',
          state,
          name,
          order,
          usage: null,
          group: def.category,
          isNew: isNew('achievements', def.id),
          art: () => iconTile(secret ? 'help' : (def.icon ?? 'trophy')),
          detail: () => {
            const kind = t(`meta.collection.achievementCategories.${def.category}`);
            if (secret) {
              const hint = achievementOptional(def, 'hint');
              return {
                title: name,
                kind,
                desc: null,
                flavor: null,
                facts: [],
                stats: null,
                condition: null,
                note: hint ?? t('meta.collection.hiddenAchievement'),
              };
            }
            const progress = state === 'discovered' ? null : achievementProgress(profile, ctx, def.id);
            return {
              title: name,
              kind,
              desc: achievementText(def, 'desc'),
              flavor: achievementOptional(def, 'flavor'),
              facts: [],
              stats:
                state === 'discovered' && earnedAt
                  ? [t('meta.collection.detail.earnedAt', { date: formatDateTime(earnedAt) })]
                  : [t('meta.collection.detail.notEarned')],
              condition:
                progress && progress.target > 1
                  ? {
                      text: achievementText(def, 'desc'),
                      progress: progress.progress,
                      target: progress.target,
                      met: false,
                      progressText: t('meta.collection.progress', {
                        progress: progress.progress,
                        target: progress.target,
                      }),
                    }
                  : null,
              note: null,
            };
          },
        };
      });
    }
  }
}

/** Parametry textů achievementu (`AchievementDef.params`, jsou-li). */
function achievementParams(def: AchievementDef): Record<string, number | string> {
  const p = (def as { params?: Record<string, number | string> }).params;
  return p ?? {};
}

function achievementText(def: AchievementDef, field: 'name' | 'desc'): string {
  const key = `achievements.${def.id}.${field}`;
  return hasKey(key) ? t(key, achievementParams(def)) : field === 'name' ? def.id : '';
}

function achievementOptional(def: AchievementDef, field: 'flavor' | 'hint'): string | null {
  const key = `achievements.${def.id}.${field}`;
  return hasKey(key) ? t(key, achievementParams(def)) : null;
}

/** Kategorie profilu, které záložka zobrazuje (štítek „Nové“ na záložce). */
function tabUnseen(tab: CollectionTab, profile: Readonly<Profile>, registry: ContentRegistry): number {
  const count = (prefix: string, keep: (id: string) => boolean = () => true): number =>
    profile.unseen.filter((k) => k.startsWith(`${prefix}:`) && keep(k.slice(prefix.length + 1))).length;
  const kind = CONSUMABLE_TABS[tab];
  if (kind) return count('consumables', (id) => registry.consumables[id]?.kind === kind);
  if (tab === 'mods') return count('enhancements') + count('seals') + count('editions');
  return count(tab);
}

/** Filtr a řazení položek (pořadí skupin zůstává). */
export function arrangeEntries(
  entries: readonly CollectionEntry[],
  opts: { sort: SortMode; rarity?: JokerRarity | null; tag?: JokerTag | null },
): CollectionEntry[] {
  const list = entries.filter(
    (e) => (!opts.rarity || e.rarity === opts.rarity) && (!opts.tag || (e.tags ?? []).includes(opts.tag)),
  );
  const unknownLast = (e: CollectionEntry): number => (e.state === 'discovered' ? 0 : 1);
  const cmp: Record<SortMode, (a: CollectionEntry, b: CollectionEntry) => number> = {
    order: (a, b) => a.order - b.order,
    rarity: (a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.order - b.order,
    name: (a, b) =>
      unknownLast(a) - unknownLast(b) || a.name.localeCompare(b.name, 'cs') || a.order - b.order,
    usage: (a, b) => (b.usage ?? 0) - (a.usage ?? 0) || a.order - b.order,
  };
  return list.sort(cmp[opts.sort]);
}

/** Řazení, která záložka nabízí. */
function sortModes(tab: CollectionTab): SortMode[] {
  if (tab === 'mods') return [];
  if (tab === 'jokers') return ['order', 'rarity', 'name', 'usage'];
  if (tab === 'tags' || tab === 'achievements') return ['order', 'name'];
  return ['order', 'name', 'usage'];
}

// ─────────────────────────── Vykreslení ───────────────────────────

function stateLabel(entry: CollectionEntry): string {
  if (entry.category === 'achievements')
    return t(
      entry.state === 'discovered' ? 'meta.collection.states.earned' : 'meta.collection.states.notEarned',
    );
  return t(`meta.collection.states.${entry.state}`);
}

function tile(
  entry: CollectionEntry,
  onOpen: (entry: CollectionEntry, el: HTMLElement) => void,
): HTMLElement {
  const silhouette = entry.state !== 'discovered';
  const el = h(
    'button',
    {
      type: 'button',
      class: ['codex-item', `is-${entry.state}`, entry.isNew ? 'is-new' : ''],
      'aria-label': t('meta.collection.itemLabel', { name: entry.name, state: stateLabel(entry) }),
      'aria-haspopup': 'dialog',
      'data-testid': `codex-item-${entry.id}`,
      'data-state': entry.state,
      'data-category': entry.category,
      'data-id': entry.id,
    },
    h(
      'span',
      { class: ['codex-item__art', silhouette ? 'is-silhouette' : ''], 'aria-hidden': 'true' },
      entry.art(),
    ),
    h('span', { class: 'codex-item__name', 'aria-hidden': 'true' }, entry.name),
    entry.isNew
      ? h('span', { class: 'codex-item__new', 'aria-hidden': 'true' }, t('meta.collection.newBadge'))
      : null,
  );
  el.addEventListener('click', () => onOpen(entry, el));
  return el;
}

/** Detail položky jako obsah dialogu. */
function detailBody(entry: CollectionEntry): HTMLElement {
  const d = entry.detail();
  const silhouette = entry.state !== 'discovered';
  const condition = d.condition;
  return h(
    'div',
    {
      class: ['codex-detail', `is-${entry.state}`],
      'data-testid': 'codex-detail-body',
      'data-category': entry.category,
    },
    h(
      'div',
      { class: ['codex-detail__art', silhouette ? 'is-silhouette' : ''], 'aria-hidden': 'true' },
      entry.art(),
      // Silueta v dialogu na papíře je jen šedý obdélník — zámek (neodemčeno) nebo otazník (neobjeveno) přes ni.
      silhouette && entry.category !== 'achievements'
        ? iconElement(entry.state === 'locked' ? 'padlock' : 'help', { className: 'codex-detail__mark' })
        : null,
    ),
    h(
      'div',
      { class: 'codex-detail__text' },
      h('p', { class: 'codex-detail__kind' }, d.kind),
      d.desc ? h('p', { class: 'codex-detail__desc', 'data-testid': 'codex-detail-desc' }, d.desc) : null,
      d.lines && d.lines.length > 0
        ? h(
            'ul',
            { class: 'codex-detail__lines' },
            d.lines.map((l) => h('li', null, l)),
          )
        : null,
      d.note ? h('p', { class: 'codex-detail__note', 'data-testid': 'codex-detail-note' }, d.note) : null,
      d.flavor
        ? h('p', { class: 'codex-detail__flavor' }, t('meta.collection.detail.flavor', { text: d.flavor }))
        : null,
      d.facts.length > 0
        ? h(
            'dl',
            { class: 'codex-detail__facts' },
            d.facts.map((f) =>
              h('div', { class: 'codex-detail__fact' }, h('dt', null, f.label), h('dd', null, f.value)),
            ),
          )
        : null,
      condition
        ? h(
            'div',
            { class: 'codex-detail__condition', 'data-testid': 'codex-detail-condition' },
            h('h3', { class: 'codex-detail__heading' }, t('meta.collection.detail.condition')),
            h('p', null, condition.text),
            condition.progressText
              ? h(
                  'div',
                  { class: 'codex-progress' },
                  h('progress', {
                    class: 'codex-progress__bar',
                    max: String(condition.target),
                    value: String(condition.progress),
                    'aria-label': t('meta.collection.detail.progress'),
                  }),
                  h('span', { class: 'codex-progress__text' }, condition.progressText),
                )
              : null,
          )
        : null,
      d.stats
        ? h(
            'div',
            { class: 'codex-detail__stats' },
            h('h3', { class: 'codex-detail__heading' }, t('meta.collection.detail.stats')),
            d.stats.length > 0
              ? h(
                  'ul',
                  null,
                  d.stats.map((l) => h('li', null, l)),
                )
              : h('p', null, t('meta.collection.usage.none')),
          )
        : null,
    ),
  );
}

/** Šipky v mřížce: ← / → o položku, ↑ / ↓ o řádek (podle polohy na obrazovce), Home / End. */
function wireGridKeys(container: HTMLElement): void {
  container.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const items = [...container.querySelectorAll<HTMLElement>('.codex-item')];
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowLeft') next = Math.max(0, idx - 1);
    else if (e.key === 'ArrowRight') next = Math.min(items.length - 1, idx + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else {
      // Nejbližší položka v řádku nad / pod (layout se čte jen na stisk klávesy).
      const cur = items[idx]!.getBoundingClientRect();
      const down = e.key === 'ArrowDown';
      let best = -1;
      let bestScore = Infinity;
      items.forEach((it, i) => {
        if (i === idx) return;
        const r = it.getBoundingClientRect();
        const dy = down ? r.top - cur.top : cur.top - r.top;
        if (dy <= 1) return;
        const score = dy * 1000 + Math.abs(r.left - cur.left);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best < 0) return;
      next = best;
    }
    e.preventDefault();
    items[next]?.focus();
  });
}

function selectControl(
  id: string,
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const select = h(
    'select',
    {
      id,
      class: 'codex-select__input',
      'data-testid': id,
      onChange: () => onChange(select.value),
    },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)),
  );
  return h(
    'div',
    { class: 'codex-select' },
    h('label', { for: id, class: 'codex-select__label' }, label),
    select,
  );
}

interface TabView {
  sort: SortMode;
  rarity: JokerRarity | null;
  tag: JokerTag | null;
}

export const collectionScreen: ScreenFactory = (app: App, params) => {
  const registry = app.registry;
  const initial =
    typeof params?.tab === 'string' && (COLLECTION_TABS as readonly string[]).includes(params.tab)
      ? (params.tab as CollectionTab)
      : 'jokers';
  const views = new Map<CollectionTab, TabView>();
  const view = (tab: CollectionTab): TabView => {
    let v = views.get(tab);
    if (!v) {
      v = { sort: 'order', rarity: null, tag: null };
      views.set(tab, v);
    }
    return v;
  };
  /** Položky otevřené záložky (kvůli štítku „Nové“ při odchodu). */
  let shown: CollectionEntry[] = [];

  const badge = (tab: CollectionTab): { badge: string | null; badgeLabel?: string } => {
    const n = tabUnseen(tab, app.profile, registry);
    return n > 0
      ? {
          badge: formatNumber(n),
          badgeLabel: `${t(`meta.collection.tabs.${tab}`)}, ${t('meta.collection.newCount', { n })}`,
        }
      : { badge: null };
  };

  /** Sundá štítek „Nové“ položkám, které hráč v záložce viděl. */
  const markShownSeen = (): void => {
    const byCategory = new Map<CollectionCategory, string[]>();
    for (const e of shown) {
      if (!e.isNew) continue;
      const list = byCategory.get(e.category) ?? [];
      list.push(e.id);
      byCategory.set(e.category, list);
    }
    for (const [category, ids] of byCategory) app.profiles.markSeen(category, ids);
  };

  const openDetail = (entry: CollectionEntry, el: HTMLElement): void => {
    if (entry.isNew) {
      app.profiles.markSeen(entry.category, [entry.id]);
      entry.isNew = false;
      el.classList.remove('is-new');
      el.querySelector('.codex-item__new')?.remove();
      const tab = tabs.current as CollectionTab;
      const b = badge(tab);
      tabs.setBadge(tab, b.badge, b.badgeLabel);
    }
    openModal<void>({
      title: entry.detail().title,
      size: 'medium',
      className: 'modal--codex',
      testId: 'codex-detail',
      body: () => detailBody(entry),
      actions: [
        {
          label: t('meta.collection.detail.close'),
          variant: 'paper',
          autofocus: true,
          testId: 'codex-detail-close',
        },
      ],
    });
  };

  const renderGrid = (tab: CollectionTab, entries: CollectionEntry[], host: HTMLElement): void => {
    const v = view(tab);
    const arranged = arrangeEntries(entries, v);
    if (entries.length === 0) {
      host.replaceChildren(
        h('p', { class: 'codex-empty', 'data-testid': 'codex-empty' }, t('meta.collection.empty')),
      );
      return;
    }
    if (arranged.length === 0) {
      host.replaceChildren(
        h('p', { class: 'codex-empty', 'data-testid': 'codex-empty' }, t('meta.collection.emptyFilter')),
      );
      return;
    }
    const groups = new Map<string, CollectionEntry[]>();
    for (const e of arranged) {
      const g = e.group ?? '';
      const list = groups.get(g) ?? [];
      list.push(e);
      groups.set(g, list);
    }
    // Nadpis skupiny: vylepšení / pečetě / edice, běžní / finální šéfové a kategorie achievementů (bez nadpisu
    // by mezery mezi skupinami achievementů vypadaly jako chyba rozvržení).
    const groupTitle = (g: string): string | undefined => {
      if (!g) return undefined;
      if (tab === 'mods' || tab === 'bosses') return t(`meta.collection.groups.${g}`);
      if (tab === 'achievements') return t(`meta.collection.achievementCategories.${g}`);
      return undefined;
    };
    host.replaceChildren(
      ...[...groups].map(([g, list]) =>
        h(
          'section',
          { class: 'codex-group', 'aria-label': groupTitle(g) },
          groupTitle(g) ? h('h2', { class: 'codex-group__title' }, groupTitle(g)) : null,
          h(
            'div',
            { class: ['codex-grid', `codex-grid--${tab}`], role: 'list' },
            list.map((e) => h('div', { class: 'codex-grid__cell', role: 'listitem' }, tile(e, openDetail))),
          ),
        ),
      ),
    );
  };

  const renderTab = (tab: CollectionTab, panel: HTMLElement): void => {
    const entries = collectionEntries(tab, app.profile, registry);
    shown = entries;
    const v = view(tab);
    const discovered = entries.filter((e) => e.state === 'discovered').length;
    const gridHost = h('div', { class: 'codex-grids' });
    wireGridKeys(gridHost);
    const controls: HTMLElement[] = [];
    if (tab === 'jokers') {
      controls.push(
        selectControl(
          'codex-filter-rarity',
          t('meta.collection.filters.rarity'),
          [
            { value: '', label: t('meta.collection.filters.all') },
            ...RARITIES.map((r) => ({ value: r, label: t(`art.rarity.${r}`) })),
          ],
          v.rarity ?? '',
          (val) => {
            v.rarity = (val || null) as JokerRarity | null;
            renderGrid(tab, entries, gridHost);
          },
        ),
        selectControl(
          'codex-filter-tag',
          t('meta.collection.filters.tag'),
          [
            { value: '', label: t('meta.collection.filters.all') },
            ...JOKER_TAGS.map((tag) => ({ value: tag, label: t(`meta.collection.tags.${tag}`) })),
          ],
          v.tag ?? '',
          (val) => {
            v.tag = (val || null) as JokerTag | null;
            renderGrid(tab, entries, gridHost);
          },
        ),
      );
    }
    const modes = sortModes(tab);
    if (modes.length > 1) {
      controls.push(
        selectControl(
          'codex-sort',
          t('meta.collection.filters.sort'),
          modes.map((m) => ({ value: m, label: t(`meta.collection.sort.${m}`) })),
          v.sort,
          (val) => {
            v.sort = val as SortMode;
            renderGrid(tab, entries, gridHost);
          },
        ),
      );
    }
    panel.replaceChildren(
      h(
        'div',
        { class: 'codex-toolbar' },
        // `aria-label` na <p> čtečky ignorují (axe: aria-prohibited-attr) — celé znění je ve skrytém textu.
        h(
          'p',
          { class: 'codex-count' },
          h(
            'span',
            { 'aria-hidden': 'true', 'data-testid': 'codex-count' },
            t('meta.collection.count', { n: discovered, total: entries.length }),
          ),
          h(
            'span',
            { class: 'visually-hidden', 'data-testid': 'codex-count-label' },
            t('meta.collection.countLabel', { n: discovered, total: entries.length }),
          ),
        ),
        controls.length > 0
          ? h(
              'div',
              { class: 'codex-controls', role: 'group', 'aria-label': t('meta.collection.filters.label') },
              controls,
            )
          : null,
      ),
      gridHost,
    );
    renderGrid(tab, entries, gridHost);
  };

  const tabs = createTabs({
    label: t('meta.collection.tabsLabel'),
    idPrefix: 'codex',
    tabs: COLLECTION_TABS.map((id) => ({ id, label: t(`meta.collection.tabs.${id}`), ...badge(id) })),
    initial,
    onChange: (id, panel, previous) => {
      if (previous) {
        markShownSeen();
        const b = badge(previous as CollectionTab);
        tabs.setBadge(previous, b.badge, b.badgeLabel);
      }
      renderTab(id as CollectionTab, panel);
    },
  });

  const el = h(
    'main',
    { class: 'screen codex', 'aria-labelledby': 'codex-title', 'data-testid': 'collection' },
    h(
      'header',
      { class: 'screen-header' },
      backButton(() => app.go('menu'), t('common.backToMenu')),
      h(
        'div',
        { class: 'screen-header__titles' },
        h('h1', { id: 'codex-title', class: 'screen-title' }, t('meta.collection.title')),
        h('p', { class: 'screen-subtitle' }, t('meta.collection.subtitle')),
      ),
    ),
    tabs.el,
  );

  return {
    el,
    onKey(e) {
      if (e.key === 'Escape' && !isModalOpen()) {
        app.go('menu');
        return true;
      }
      return false;
    },
    dispose() {
      markShownSeen();
    },
  };
};
