/**
 * Herní konstanty enginu — souhrn podle docs/DESIGN.md kap. 2.10 (+ čísla z kap. 2.4–2.9 a 4.6).
 *
 * Pravidla:
 *  - Čísla pravidel mění jen tento soubor (a `BASE_MODIFIERS` v effects/modifiers.ts); při změně uprav
 *    i docs/DESIGN.md, test a zapiš změnu do docs/DECISIONS.md.
 *  - Čísla jednotlivých položek obsahu (cena žolíka, šance skla…) patří do src/content, ne sem.
 */
import type { JokerRarity } from './content-types';
import type { BlindKind } from './types';

// ─────────────────────────── Run a kolo (2.4) ───────────────────────────

/** Startovní peníze (Kč), pokud balíček nebo výzva neříká jinak. */
export const STARTING_MONEY = 5;

/** Odměna za poraženou útratu (Kč) — šéf může mít vlastní `BossDef.reward`. */
export const BLIND_REWARDS: Readonly<Record<BlindKind, number>> = Object.freeze({
  small: 3,
  big: 4,
  boss: 5,
});

/** Násobek základu patra pro cíl útraty — šéf může mít vlastní `BossDef.targetMult`. */
export const BLIND_TARGET_MULT: Readonly<Record<BlindKind, number>> = Object.freeze({
  small: 1,
  big: 1.5,
  boss: 2,
});

/** Patro, jehož šéfa je třeba porazit pro výhru (a perioda finálových šéfů v nekonečném režimu). */
export const FINAL_ANTE = 8;

/** Nejvyšší síla piva (Imperial). */
export const MAX_STAKE = 8;

// ─────────────────────────── Večerka (2.5) ───────────────────────────

/** Váhy vzácností žolíků v obchodě a v Žolíkové obálce (legendární jen z razítka). */
export const RARITY_WEIGHTS: Readonly<Record<JokerRarity, number>> = Object.freeze({
  common: 68,
  rare: 26,
  epic: 6,
  legendary: 0,
});

/** Základní cena hrací karty ve Večerce (Kč). */
export const PLAYING_CARD_BASE_PRICE = 2;
/** Příplatek za vylepšení hrací karty (Kč). */
export const PLAYING_CARD_ENHANCEMENT_PRICE = 1;
/** Příplatek za pečeť hrací karty (Kč). */
export const PLAYING_CARD_SEAL_PRICE = 2;

/**
 * Karetní obálka: šance na vylepšení a pečeť nabízené karty (2.9; obchod má své v `Modifiers`). Vylepšení 35 %,
 * ne 40 % — to by spolu s šancemi edic bylo 1:1 převzaté číslo (DESIGN příloha A).
 */
export const BOOSTER_CARD_ENHANCE_CHANCE = 0.35;
export const BOOSTER_CARD_SEAL_CHANCE = 0.15;

/** Žolík, který se nabídne, když je pool žolíků vyčerpaný (smí se opakovat). */
export const FALLBACK_JOKER_ID = 'beer_mat';

/** Výchozí cena přelosování šéfa (akce `rerollBoss`); v 1.0 ji povoluje jen žolík Známý na úřadě — zdarma. */
export const BOSS_REROLL_COST = 0;

// ─────────────────────────── Nálepky (4.6) ───────────────────────────

/** Zvětrávající žolík: po tolika dokončených kolech ve slotu zvětrá (trvale debuffnutý). */
export const PERISH_ROUNDS = 6;
/** Zapůjčený žolík: cena v obchodě i obálce místo ceny z definice (Kč). */
export const RENTAL_BUY_PRICE = 2;
/** Zapůjčený žolík: poplatek na konci každého kola (Kč). */
export const RENTAL_FEE = 2;
/** Zapůjčený žolík: prodejní cena (Kč). */
export const RENTAL_SELL_PRICE = 1;

// ─────────────────────────── Skórování (3) ───────────────────────────

/** Nejvýš tolik aktivací jedné karty v jedné ruce (pojistka proti nekonečným opakováním). */
export const MAX_ACTIVATIONS_PER_CARD = 10;

// ─────────────────────────── Seed (11.6) ───────────────────────────

/** Znaky seedu — bez zaměnitelných I, O, 0 a 1. */
export const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Délka náhodně generovaného seedu. */
export const SEED_LENGTH = 8;

// ─────────────────────────── i18n klíče hlášek enginu ───────────────────────────

/**
 * Klíče hlášek, které emituje engine a základní obsah (ScoreStep.message, událost `message`,
 * `jokerTriggered.message`). Texty jsou v src/i18n/cs/messages.ts; test hlídá, že každý klíč existuje.
 * Jednotné číslo (`joker.*`, `boss.*`, `tag.*`) = obecné hlášky; množné (`jokers.<id>`) = obsah podle id.
 */
export const MSG = Object.freeze({
  /** Opakovaná aktivace karty (červená pečeť, opakující žolíci). */
  again: 'score.again',
  /** Debuffnutá karta nic nedává. */
  debuffed: 'score.debuffed',
  /** Skleněná karta praskla. */
  glassBreak: 'score.glassBreak',
  /** Šťastná karta: mult. */
  lucky: 'score.lucky',
  /** Šťastná karta: peníze. */
  luckyMoney: 'score.luckyMoney',
  /** Ohmataná karta trvale získala čipy. */
  worn: 'score.worn',
  /** Šéf upravil skóre ruky (`BossHooks.adjustHandScore`). */
  bossAdjusted: 'score.bossAdjusted',
  /** Šéf byl vypnut. */
  bossDisabled: 'boss.disabled',
  /** Žolík zachránil run (`preventGameOver`). */
  jokerSaved: 'joker.saved',
  /** Zvětrávající žolík zvětral. */
  jokerPerished: 'joker.perished',
  /** Zapůjčený žolík se vrátil do půjčovny (nešlo zaplatit poplatek). */
  rentalReturned: 'joker.rentalReturned',
  /** Štítek zachránil prohrané kolo (`TagHooks.onRoundLost`). */
  tagSaved: 'tag.saved',
  /** Výzva zakázala ruku — kombinace je silnější než `ChallengeDef.maxScoringHand` (Švejkova anabáze). */
  challengeHandTooStrong: 'score.challengeHandTooStrong',
} as const);

export type MessageKey = (typeof MSG)[keyof typeof MSG];
