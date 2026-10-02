/**
 * Tutoriál „Štamgast“ (DESIGN 13.5): kroky, postup, přeskočení a znovuzapnutí. Stav je v profilu
 * (`Profile.tutorial`), zapnutí rad v nastavení (`Settings.tutorial`). Dokončení dá achievement „Štamgastův žák“
 * (obsah ho pozná podle `profile.tutorial.completed`; UI po dokončení zavolá `refreshMeta`).
 */
import type { Profile } from './types';

/** Kroky v pořadí: výběr a náhled, Zahrát, Zahodit, cíl a Ruce, konec kola a úrok, Večerka, pořadí žolíků, šéf, přeskočení. */
export const TUTORIAL_STEPS = [
  'select',
  'play',
  'discard',
  'goal',
  'roundEnd',
  'shop',
  'jokerOrder',
  'boss',
  'skip',
] as const;

export type TutorialStepId = (typeof TUTORIAL_STEPS)[number];

/** Běží tutoriál (rady zapnuté, nedokončený, nepřeskočený)? */
export function tutorialActive(profile: Readonly<Profile>): boolean {
  const t = profile.tutorial;
  return profile.settings.tutorial && !t.completed && !t.skipped;
}

/** První nedokončený krok v pořadí, nebo null (hotovo / neaktivní). */
export function nextTutorialStep(profile: Readonly<Profile>): TutorialStepId | null {
  if (!tutorialActive(profile)) return null;
  return TUTORIAL_STEPS.find((s) => !profile.tutorial.seen.includes(s)) ?? null;
}

/** Má se teď ukázat bublina kroku? (aktivní tutoriál a krok ještě neviděný) */
export function shouldShowTutorialStep(profile: Readonly<Profile>, step: TutorialStepId): boolean {
  return tutorialActive(profile) && !profile.tutorial.seen.includes(step);
}

/**
 * Označí krok jako hotový (kroky jdou dokončit i mimo pořadí — šéf a přeskočení přijdou, kdy přijdou).
 * Vrací true, když tím tutoriál skončil. Mutuje profil.
 */
export function markTutorialStep(profile: Profile, step: TutorialStepId): boolean {
  const t = profile.tutorial;
  if (t.completed || !TUTORIAL_STEPS.includes(step)) return false;
  if (!t.seen.includes(step)) t.seen.push(step);
  const next = TUTORIAL_STEPS.findIndex((s) => !t.seen.includes(s));
  t.step = next < 0 ? TUTORIAL_STEPS.length : next;
  if (next < 0) {
    t.completed = true;
    return true;
  }
  return false;
}

/** Přeskočí tutoriál (a vypne rady Štamgasta v nastavení). */
export function skipTutorial(profile: Profile): void {
  profile.tutorial.skipped = true;
  profile.settings.tutorial = false;
}

/** Zapne tutoriál znovu od začátku (Nastavení → Rady Štamgasta). Achievement za dokončení zůstává. */
export function restartTutorial(profile: Profile): void {
  profile.tutorial = { step: 0, seen: [], completed: false, skipped: false };
  profile.settings.tutorial = true;
}
