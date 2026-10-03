/**
 * Přejmenovaná a nahrazená id obsahu mezi verzemi uložení (jen řetězce — engine dál neimportuje src/content).
 *
 * 1.0.1 (uložení runu v2, profil v2; docs/DECISIONS.md 2026-10-03 „Odlišení od Balatra a designové opravy po testu
 * 1.0“): pět párů kupónů a šest štítků dostalo vlastní mechaniku a nové id. Staré id se mapuje na nástupce na stejném
 * místě (kupón stejného páru a stupně, štítek na stejné pozici), takže odemčení, objevy, statistiky i rozehraný run
 * zůstanou. Štítek, který hráč drží a čeká na svůj efekt, se převede zvlášť (`HELD_TAG_V2`).
 */

/** Kupóny 1.0 → 1.0.1 (pár i stupeň zůstávají). */
export const VOUCHER_RENAMES_V2: Readonly<Record<string, string>> = Object.freeze({
  yellow_price: 'loyalty_card',
  relabeled_price: 'regular_customer',
  counter_buddy: 'village_newsletter',
  manager_inlaw: 'village_radio',
  savings_account: 'deposit_bottle',
  building_savings: 'bottle_return',
  tear_calendar: 'complaints_book',
  grandmas_pantry: 'complaint_settled',
  polish: 'spring_cleaning',
  holo_foil: 'deep_cleaning',
});

/** Štítky 1.0 → 1.0.1 (nabídka u útrat, objevy ve sbírce). */
export const TAG_RENAMES_V2: Readonly<Record<string, string>> = Object.freeze({
  term_deposit: 'fair_raffle',
  advance_payment: 'in_law_loan',
  kiosk_calendar: 'harvest_festival',
  official_letter: 'moving_day',
  cottage_marias: 'mushroom_hunt',
  dental_xray: 'paper_drive',
});

/**
 * Držené štítky 1.0, které čekaly na efekt: Termínovaný vklad se vyplatí hned (`money`) a zmizí, Rentgen od zubaře
 * („příští žolík ve Večerce“) se změní na Vyleštěné příbory se stejným načasováním. Ostatní odebrané štítky se
 * spotřebovaly hned po získání — držené být nemohou, a kdyby přece, zmizí.
 */
export const HELD_TAG_V2: Readonly<Record<string, { money?: number; to?: string }>> = Object.freeze({
  term_deposit: { money: 15 },
  dental_xray: { to: 'polished_cutlery' },
});

/** Přemapuje seznam id (bez duplicit, pořadí prvního výskytu zůstává). Neplatné položky zahodí. */
export function renameIds(list: unknown, map: Readonly<Record<string, string>>): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const id of list) {
    if (typeof id !== 'string') continue;
    const next = map[id] ?? id;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

/** Přemapuje klíče mapy id → číslo; čísla sloučených klíčů se sečtou. */
export function renameKeys(rec: unknown, map: Readonly<Record<string, string>>): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof rec !== 'object' || rec === null || Array.isArray(rec)) return out;
  for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const key = map[k] ?? k;
    out[key] = (out[key] ?? 0) + v;
  }
  return out;
}
