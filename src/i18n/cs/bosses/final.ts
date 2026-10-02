/**
 * Texty šéfů (fináloví šéfové F1–F5, docs/DESIGN.md kap. 8.3): `bosses.<id>.name|rule|intro|defeat|death`.
 * `rule` = pravidlo (čísla jen přes `{param}` z `params` v src/content/bosses/final.ts, u čísla se slovem
 * s `|plural:`), `intro` = hláška při příchodu, `defeat` = při porážce, `death` = hláška pitvy (DESIGN příloha C).
 * Hlášky bez uvozovek.
 */
import type { TextTree } from '../../cs';

export const bossesFinal = {
  mayor: {
    name: 'Pan starosta',
    rule: 'Ruka se započítá, jen když má vyšší skóre než předchozí ruka v tomto kole (první vždy).',
    intro: 'Slibuji, že každá další ruka bude lepší než ta předchozí!',
    defeat: 'Volby prohrál. Funkci si nechal v jiném výboru.',
    death: 'Sliby chyby.',
  },
  regional_office: {
    name: 'Krajský úřad',
    rule: 'Po každé zahrané ruce se náhodný fungující žolík vypne do konce kola.',
    intro: 'Vaše žolíky prověříme. Jednoho po druhém.',
    defeat: 'Kontrola skončila bez nálezu. A bez oběda.',
    death: 'Vaše žádost byla zamítnuta. Odvolání není přípustné.',
  },
  noise_barrier: {
    name: 'Protihluková stěna',
    rule: 'Žádné zvláštní pravidlo, jen vyšší cíl: {target}× základ patra.',
    intro: 'Čtyři metry betonu. A ani jeden strom.',
    defeat: 'Zeď padla. Sousedi děkují.',
    death: 'Hlavou zeď neprorazíš.',
  },
  great_flood: {
    name: 'Velká voda',
    rule: 'Každá zahraná ruka zmenší velikost ruky o {cards|plural:kartu,karty,karet} (do konce kola).',
    intro: 'Voda stoupá! Karty do vyšších pater!',
    defeat: 'Voda opadla. Bláto zůstalo.',
    death: 'Topíš se v kartách.',
  },
  white_lady: {
    name: 'Bílá paní',
    rule: 'Po každé zahrané ruce i zahození se všechny karty v ruce otočí lícem dolů a zamíchají.',
    intro: 'O půlnoci se zjevuje na zámku. A otáčí karty.',
    defeat: 'Zmizela. Klíče od sklepa taky.',
    death: 'Strašidelně slabý výkon.',
  },
} satisfies TextTree;
