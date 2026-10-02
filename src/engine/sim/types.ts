/** Typy headless simulace: boti, výsledek runu, souhrn sady runů (docs/DESIGN.md kap. 12). */
import type { Game } from '../run/game';
import type { Action, BlindKind, HandType } from '../types';

/** Boti podle DESIGN 12.2 (`--bot` / `--strategy`). */
export type BotName = 'max' | 'flush' | 'pairs' | 'econ' | 'random' | 'nojoker';

/**
 * Bot = rozhodovací funkce nad veřejným stavem hry. Nesmí měnit stav (jen vrací akci, kterou provede runner)
 * a nesmí mít stav mimo `RunState`: stejný stav ⇒ stejná akce. Náhodu bere jen z RNG rozhodnutí seedovaného
 * seedem runu, svým jménem a otiskem stavu (`decisionRng`), takže simulace je deterministická, instanci lze sdílet
 * mezi runy (i prokládanými) a run uložený a načtený uprostřed simulace pokračuje stejně.
 */
export interface Bot {
  readonly name: string;
  decide(game: Game): Action;
}

export interface SimulateRunOptions {
  seed: string;
  deckId: string;
  stake: number;
  bot: Bot;
  /** Pojistka proti zacyklení bota (výchozí `DEFAULT_MAX_ACTIONS`). */
  maxActions?: number;
  challengeId?: string | null;
}

/** Peníze při vstupu do Večerky (DESIGN 12.1: ekonomika). */
export interface ShopMoneySample {
  ante: number;
  money: number;
}

/** Výsledek jednoho runu. Jen čísla a id — texty dělá až výstup (scripts/simulate.ts přes src/i18n). */
export interface RunResult {
  seed: string;
  bot: string;
  deckId: string;
  stake: number;
  won: boolean;
  /** Patro, ve kterém run skončil (u výhry patro finálního šéfa). */
  ante: number;
  /** Útrata, ve které run skončil. */
  blind: BlindKind;
  /** Příčina prohry pro „pitvu“ (id šéfa, `small`, `big`), `actionLimit` při zacyklení, u výhry null. */
  cause: string | null;
  /** Skóre a cíl posledního kola. */
  score: number;
  target: number;
  roundsWon: number;
  handsPlayed: number;
  discardsUsed: number;
  bestHand: number;
  bestHandType: HandType | null;
  moneyEarned: number;
  moneySpent: number;
  finalMoney: number;
  jokersBought: number;
  jokersSold: number;
  consumablesUsed: number;
  rerolls: number;
  blindsSkipped: number;
  /** Počet akcí poslaných do `dispatch` (včetně neplatných). */
  actions: number;
  /** Akce, které engine odmítl (kód chyby → počet). Rozumný bot má 0. */
  invalidActions: number;
  invalidByCode: Record<string, number>;
  /** Žolíci, kteří byli ve slotu na konci aspoň jednoho kola (seřazeno podle id). */
  jokerIds: string[];
  /** Kolik kol byl který žolík ve slotu (`RunStats.jokerRoundCounts`). */
  jokerRounds: Record<string, number>;
  shopMoney: ShopMoneySample[];
  /** Šéfové, se kterými se run utkal v útratě Šéf (id v pořadí pater; Velká útrata na Imperialu se nepočítá). */
  bosses: string[];
  /** Štítky získané přeskočením útrat (id v pořadí). */
  skipTags: string[];
}

/** Letalita šéfa (DESIGN 12.1): kolik runů se s ním utkalo v útratě Šéf a kolik na něm skončilo. */
export interface BossStat {
  id: string;
  encounters: number;
  deaths: number;
  /** % proher při setkání (0–100). */
  lethality: number;
}

/** Síla žolíka v simulaci: % výher runů, kde byl ve slotu, proti runům bez něj (DESIGN 4.3, pravidlo 4). */
export interface JokerStat {
  id: string;
  runs: number;
  wins: number;
  winRateWith: number;
  winRateWithout: number;
  /** Rozdíl v procentních bodech. */
  delta: number;
}

/** Souhrn sady runů jednoho bota (DESIGN 12.3). Procenta jsou 0–100. */
export interface SimSummary {
  bot: string;
  runs: number;
  wins: number;
  winRate: number;
  /** `reachedAnte[a - 1]` = kolik runů dosáhlo patra a (1…FINAL_ANTE). */
  reachedAnte: number[];
  /** `lostAtAnte[a - 1]` = kolik runů prohrálo v patře a (nekonečný režim se počítá do posledního). */
  lostAtAnte: number[];
  /** Příčiny proher seřazené podle četnosti (při shodě podle id). */
  causes: { cause: string; count: number }[];
  topCause: string | null;
  avgAnte: number;
  avgBestHand: number;
  medianBestHand: number;
  /** Průměrné skóre posledního kola a jeho poměr k cíli (jen prohry). */
  avgLossScore: number;
  avgLossRatio: number;
  avgRoundsWon: number;
  avgHands: number;
  avgActions: number;
  avgMoneyEarned: number;
  avgMoneySpent: number;
  /** Průměrné peníze při vstupu do Večerky podle patra (klíč = patro). */
  avgShopMoney: Record<number, number>;
  jokers: JokerStat[];
  /** Letalita šéfů seřazená od nejsmrtelnějšího (při shodě podle počtu setkání a id). */
  bosses: BossStat[];
  /** Kolik útrat bot přeskočil (průměr na run) a které štítky bral (id → počet). */
  avgSkips: number;
  skipTags: Record<string, number>;
  invalidActions: number;
}
