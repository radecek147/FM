/**
 * Texty: obálky (boostery) — klíče `boosters.<id>.name|desc` (definice v src/content/boosters.ts).
 * `{picks}` a `{options}` dosadí UI z definice obálky. Název „Velikost · Druh“ podle docs/DESIGN.md kap. 2.9
 * (velikosti: Obálka / Tlustá obálka / Krabice od bot). Popis „Nabídne N …, vybereš M.“ — tvar slova přes
 * `|plural:` a bez předložky „z/ze“ před číslem (správně by bylo „1 ze 3“, ale „1 z 5“).
 */
import type { TextTree } from '../cs';

const PICK = 'vybereš {picks}.';
const HAND_NOTE = 'Ruka dole slouží jen k výběru cílů, karty se pak vrátí do balíčku.';

const DESC = {
  pranostika: `Nabídne {options|plural:pranostiku,pranostiky,pranostik}, ${PICK} Vybranou použij hned, nebo si ji nech do slotu.`,
  rada: `Nabídne {options|plural:babskou radu,babské rady,babských rad}, ${PICK} ${HAND_NOTE}`,
  razitko: `Nabídne {options|plural:úřední razítko,úřední razítka,úředních razítek}, ${PICK} ${HAND_NOTE}`,
  joker: `Nabídne {options|plural:žolíka,žolíky,žolíků}, ${PICK} Žolík potřebuje volný slot (negativní ne).`,
  card: `Nabídne {options|plural:hrací kartu,hrací karty,hracích karet}, ${PICK} Vybraná karta se přidá do balíčku.`,
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
