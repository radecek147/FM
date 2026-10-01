/**
 * Texty: obálky (boostery) — klíče `boosters.<id>.name|desc` (definice v src/content/boosters.ts).
 * `{picks}` a `{options}` dosadí UI z definice obálky. Název „Velikost · Druh“ podle docs/DESIGN.md kap. 2.9
 * (velikosti: Obálka / Tlustá obálka / Krabice od bot). Genitiv plurálu po „z“ se s počtem nemění.
 */
import type { TextTree } from '../cs';

const DESC = {
  pranostika: 'Vyber {picks} z {options} pranostik. Vybranou použij hned, nebo si ji nech do slotu.',
  rada: 'Vyber {picks} z {options} babských rad. Ruka dole slouží jen k výběru cílů, karty se pak vrátí do balíčku.',
  razitko:
    'Vyber {picks} z {options} úředních razítek. Ruka dole slouží jen k výběru cílů, karty se pak vrátí do balíčku.',
  joker: 'Vyber {picks} z {options} žolíků. Žolík potřebuje volný slot (negativní ne).',
  card: 'Vyber {picks} z {options} hracích karet. Vybraná karta se přidá do balíčku.',
} as const;

export const boosters = {
  pranostika_normal: { name: 'Obálka · Pranostiky', desc: DESC.pranostika },
  pranostika_jumbo: { name: 'Tlustá obálka · Pranostiky', desc: DESC.pranostika },
  pranostika_mega: { name: 'Krabice od bot · Pranostiky', desc: DESC.pranostika },
  rada_normal: { name: 'Obálka · Babské rady', desc: DESC.rada },
  rada_jumbo: { name: 'Tlustá obálka · Babské rady', desc: DESC.rada },
  rada_mega: { name: 'Krabice od bot · Babské rady', desc: DESC.rada },
  razitko_normal: { name: 'Obálka · Razítka', desc: DESC.razitko },
  razitko_jumbo: { name: 'Tlustá obálka · Razítka', desc: DESC.razitko },
  razitko_mega: { name: 'Krabice od bot · Razítka', desc: DESC.razitko },
  joker_normal: { name: 'Obálka · Žolíci', desc: DESC.joker },
  joker_jumbo: { name: 'Tlustá obálka · Žolíci', desc: DESC.joker },
  joker_mega: { name: 'Krabice od bot · Žolíci', desc: DESC.joker },
  card_normal: { name: 'Obálka · Hrací karty', desc: DESC.card },
  card_jumbo: { name: 'Tlustá obálka · Hrací karty', desc: DESC.card },
  card_mega: { name: 'Krabice od bot · Hrací karty', desc: DESC.card },
} satisfies TextTree;
