/**
 * Texty šéfů (běžní šéfové 1–13): `bosses.<id>.name|rule|intro|defeat|death` + vlastní hlášky
 * (`bosses.<id>.<klíč>`). Čísla v `rule` jsou jen přes `{param}` z `params` v src/content/bosses/a.ts (dosadí je
 * `bossTexts` v UI i textový režim `npm run simulate -- --play`), u čísla se slovem s `|plural:`.
 * `intro` se ukáže při příchodu, `death` v pitvě, když na šéfovi run skončí.
 */
import type { TextTree } from '../../cs';

export const bossesA = {
  tax_audit: {
    name: 'Kontrola z finančáku',
    rule: 'Každá zahraná ruka stojí {fee|money}.',
    intro: 'Dobrý den, finanční úřad. Účtenky máte?',
    defeat: 'Tentokrát bez pokuty. Tentokrát.',
    death: 'Doklady k tomu nemáte, že?',
  },
  track_closure: {
    name: 'Výluka na trati',
    rule: 'Každá druhá líznutá karta přijde lícem dolů.',
    intro: 'Polovina karet jede náhradní autobusovou dopravou.',
    defeat: 'Provoz obnoven. Zpoždění neuvedeno.',
    death: 'Náhradní doprava nejela.',
  },
  inventory: {
    name: 'Inventura',
    rule: 'Figury (J, Q, K) jsou mimo provoz.',
    intro: 'Zavřeno z důvodu inventury. Figury se přepočítávají.',
    defeat: 'Inventura sedí. Až na jednoho kluka.',
    death: 'Manko se strhává ze mzdy.',
  },
  drilling_neighbor: {
    name: 'Soused s vrtačkou',
    rule: 'Kombinace, která už v tomto kole byla zahrána, neskóruje.',
    intro: 'Sobota, osm ráno. Vrrrrr.',
    defeat: 'Konečně ticho. Do pondělí.',
    death: 'Prohráno na plné obrátky.',
    blocked: 'Vrrrr! Tahle kombinace už tu dneska byla.',
  },
  lunch_break: {
    name: 'Polední pauza',
    rule: 'Máš jen {hands|plural:ruku,ruce,rukou}.',
    intro: 'Je polední pauza. Máte na to jeden pokus.',
    defeat: 'Hotovo? Tak to se divím.',
    death: 'Přijďte po obědě. Zítra.',
  },
  superstitious_granny: {
    name: 'Pověrčivá babka',
    rule: 'Na začátku kola se vylosuje barva; karty té barvy jsou mimo provoz.',
    intro: 'Počkej, nejdřív se kouknu do snáře.',
    defeat: 'Tak to byla holt náhoda.',
    death: 'Já to říkala. Bylo to v kávové sedlině.',
    /** Hláška po vylosování barvy (`api.message`, klíč podle `Suit`). */
    omen: {
      S: 'Dneska ne, dneska je špatný den na piky.',
      H: 'Dneska ne, dneska je špatný den na srdce.',
      D: 'Dneska ne, dneska je špatný den na káry.',
      C: 'Dneska ne, dneska je špatný den na kříže.',
    },
  },
  black_cat: {
    name: 'Černá kočka',
    rule:
      'Po každé zahrané ruce vyřadí z provozu ' +
      '{cards|plural:náhodnou kartu,náhodné karty,náhodných karet} v ruce, a to do konce kola.',
    intro: 'Přeběhla ti přes cestu. Zleva doprava.',
    defeat: 'Kočka odešla. Smůla zůstala u ní.',
    death: 'Sedm let smůly a tohle byl teprve první den.',
  },
  elbe_fog: {
    name: 'Mlha nad Labem',
    rule: 'Karty s hodnotou {min}–{max} se lížou lícem dolů.',
    intro: 'Viditelnost pod sto metrů, malé karty v mlze.',
    defeat: 'Mlha se zvedla. Byly to dvojky.',
    death: 'V mlze se ztratily karty i naděje.',
  },
  parking_fee: {
    name: 'Parkovné',
    rule: 'Každé zahození stojí {fee|money}.',
    intro: 'Modrá zóna. Zahazovat jen s parkovací kartou.',
    defeat: 'Za stěračem tentokrát nic.',
    death: 'Odtaženo na náklady provozovatele.',
  },
  studio_flat: {
    name: 'Garsonka 1+kk',
    rule: '−{handSize|plural:karta,karty,karet} v ruce a vybrat jde nejvýš {select|plural:kartu,karty,karet}.',
    intro: 'Vítej v bytě, kde se kuchyni říká roh.',
    defeat: 'Stěhuješ se? Nech tu klíče.',
    death: 'Výpověď z nájmu. Na vyklizení máš do pondělí.',
  },
  village_drought: {
    name: 'Sucho v obci',
    rule: '{discards} zahození, ale +{hands|plural:ruka,ruce,rukou}.',
    intro: 'Zákaz zalévání i zahazování.',
    defeat: 'Prší! Tedy aspoň kape.',
    death: 'Uschlo všechno, i naděje na postup.',
  },
  pickpocket: {
    name: 'Kapsář v tramvaji',
    rule: 'Po každé zahrané ruce se z ruky zahodí karta s nejvyšší hodnotou (při shodě ta nejvíc vlevo).',
    intro: 'Pozor, ve voze se pohybují kapsáři.',
    defeat: 'Chytili ho na konečné.',
    death: 'Peněženka pryč, run taky. Zůstala jen jízdenka.',
  },
  bailiff: {
    name: 'Exekutor',
    rule: 'Na začátku kola vyřadí z provozu tvého žolíka s nejvyšší prodejní cenou (při shodě toho nejvíc vlevo).',
    intro: 'Tohle je zabavené. A tohle taky.',
    defeat: 'Exekuce zastavena pro nemajetnost exekutora.',
    death: 'Exekuce dokončena. Zabaven byl i tenhle run.',
  },
} satisfies TextTree;
