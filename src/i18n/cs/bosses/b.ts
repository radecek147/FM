/**
 * Texty šéfů (běžní šéfové 14–25, docs/DESIGN.md kap. 8.2): `bosses.<id>.name|rule|intro|defeat|death`.
 * `rule` = pravidlo (čísla zatím napsaná rovnou — UI `bossTexts` `params` šéfů nedosazuje; musí sedět s `params`
 * v src/content/bosses/b.ts, hlídá test), `intro` = hláška při příchodu,
 * `defeat` = při porážce, `death` = hláška pitvy, když na šéfovi run skončí. Hlášky bez uvozovek.
 */
import type { TextTree } from '../../cs';

export const bossesB = {
  new_decree: {
    name: 'Nová vyhláška',
    rule: 'Všechny kombinace se v tomto kole počítají na úrovni 1.',
    intro: 'Na základě nové vyhlášky se úrovně ruší.',
    defeat: 'Vyhláška zrušena soudem.',
    death: 'Neznalost vyhlášky neomlouvá.',
  },
  binder_tower: {
    name: 'Šanon na šanonu',
    rule: 'Žádné zvláštní pravidlo, jen vyšší cíl: 3× základ patra místo 2×.',
    intro: 'Podklady k útratě: tři šanony a jeden pořadač.',
    defeat: 'Spis uzavřen a uložen do sklepa.',
    death: 'Založeno ad acta. I s tebou.',
  },
  regional_derby: {
    name: 'Krajské derby',
    rule: 'Ruka s červenými (♥ ♦) i černými (♠ ♣) kartami má poloviční základní čipy i mult (divoké a kamenné karty stranu nevolí).',
    intro: 'Hradec, nebo Brno? Vyber si stranu!',
    defeat: 'Remíza. Slaví obě strany.',
    death: 'Prohrané derby se v hospodě probírá ještě deset let.',
  },
  pig_slaughter: {
    name: 'Zabijačka',
    rule: 'Po každé zahrané ruce se natrvalo zničí 1 náhodná skórující karta.',
    intro: 'Dneska se dělá ovar. Z tvých karet.',
    defeat: 'Tlačenka hotová, karty přežily.',
    death: 'Z balíčku zbyly jen škvarky.',
  },
  white_mountain: {
    name: 'Bílá hora',
    rule: 'Vylepšení hracích karet v tomto kole nefungují.',
    intro: 'Bitva je prohraná, vylepšení jdou do exilu.',
    defeat: 'Tentokrát to dopadlo líp.',
    death: 'Bitva na Bílé hoře trvala dvě hodiny. Tahle o něco déle.',
  },
  normalization: {
    name: 'Normalizace',
    rule: 'Každá skórující karta dává právě 5 čipů (vylepšení a edice fungují).',
    intro: 'Všichni jsme si rovni. Po pěti čipech.',
    defeat: 'Uvolnění! Karty smí být zase různé.',
    death: 'Kádrový posudek: nevyhovuje.',
  },
  one_eyed_hetman: {
    name: 'Jednooký hejtman',
    rule: 'Žolíci v pravé polovině řady nefungují; při lichém počtu prostřední funguje.',
    intro: 'Na jedno oko nevidí, na druhé nepočítá s tvými žolíky.',
    defeat: 'Hejtman se stáhl na Tábor.',
    death: 'Hejtmanovi stačilo jedno oko.',
  },
  mother_in_law: {
    name: 'Tchyně na návštěvě',
    rule: 'Každé zahození ti navíc zahodí 1 náhodnou kartu z ruky (dobírá se normálně).',
    intro: 'Já jen na kafe. A trochu ti to tu uklidím.',
    defeat: 'Už jede domů. Bábovku nechala.',
    death: 'Já ti to říkala. Ale ty nikdy neposloucháš.',
  },
  influencer: {
    name: 'Influencerka Nikča',
    rule: 'Tvoje nejčastěji hraná kombinace v runu má v tomto kole poloviční základní čipy i mult.',
    intro: 'Tohle pořád hraješ? Cringe.',
    defeat: 'Odsledováno. Potichu.',
    death: 'Tohle už nezachrání ani filtr.',
  },
  hangover: {
    name: 'Kocovina',
    rule: 'V tomto kole máš o 1 ruku méně.',
    intro: 'Proč tak řveš? A proč je tu tolik karet?',
    defeat: 'Okurková voda zabrala.',
    death: 'Už nikdy nepiju. Do pátku.',
  },
  blackout: {
    name: 'Výpadek proudu',
    rule: 'Žolíci nefungují v první ruce kola (ani při zahazování před ní).',
    intro: 'Vypadly pojistky, žolíci sedí potmě.',
    defeat: 'Elektrikář dorazil. Za čtyři hodiny, ale dorazil.',
    death: 'Potmě se špatně počítá. A ještě hůř vyhrává.',
  },
  even_days: {
    name: 'Sudé dny',
    rule: 'Liché karty (A, 3, 5, 7, 9) jsou mimo provoz; figury nejsou liché ani sudé.',
    intro: 'Smogová regulace: dnes hrají jen sudé.',
    defeat: 'Regulace odvolána, liché zpátky v provozu.',
    death: 'Dnes nebyl tvůj den. Ani sudý, ani lichý.',
  },
} satisfies TextTree;
