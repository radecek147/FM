/**
 * Texty žolíků (epičtí, fáze 7): `jokers.<id>.name|desc|flavor`.
 * `{param}` dosadí UI z `params` definice a z `describe(self)` (src/content/jokers/epic2.ts).
 * Flavor bez uvozovek — UI ho vysází kurzívou v „…“.
 */
import type { TextTree } from '../../cs';

export const jokersEpic2 = {
  // ── ze zásobníku DESIGN 4.9 ──
  beer_sommelier: {
    name: 'Pivní sommelier',
    desc: '{base|x} mult a navíc +{xmult|x} za každou různou kombinaci zahranou v tomto kole (včetně této ruky).',
    flavor: 'Nejdřív ležák, pak polotmavé, nakonec řezané. Po čtvrtém už hodnotí jen pěnu.',
  },
  archivist: {
    name: 'Archivář',
    desc: 'Při získání bez edice dostane duhovou; kopíruje schopnost žolíka nalevo od sebe.',
    flavor: 'Opis souhlasí s originálem. Kde je originál, ví jen on a regál číslo čtyřicet sedm.',
  },
  fair_magician: {
    name: 'Kouzelník z pouti',
    desc: 'Skórují všechny zahrané karty a každá skórující karta dá {xmult|x} mult; {chance} {odds|z}, že po ruce jedna zahraná karta zmizí v klobouku (zničí se).',
    flavor: 'Z klobouku vytáhne králíka, z rukávu eso a z tvé peněženky stovku.',
    vanished: 'Abraka… dabra… a karta je fuč!',
  },
  tour_guide: {
    name: 'Turistický průvodce',
    desc: 'Postupka i Barva stačí ze čtyř karet a ruka, která obsahuje Postupku nebo Barvu, dá +{chips|plural:čip,čipy,čipů}; když má jen {cards|plural:kartu,karty,karet}, chce průvodce spropitné {tip|money}.',
    flavor: 'Značky mají čtyři barvy a jemu to stačí. Pátá cesta stejně vede do hospody.',
    tip: 'Spropitné pro průvodce. Dobrovolné, ale povinné.',
  },

  // ── vlastní ──
  spartakiada: {
    name: 'Spartakiáda',
    desc: 'V první ruce kola skóruje každá skórující karta ještě {retriggers}×.',
    flavor: 'Tisíc párů trenýrek, jeden pohyb. A pak ještě dvakrát, pro televizi.',
  },
  voucher_privatization: {
    name: 'Kupónová privatizace',
    desc: 'Na konci kola +{money|money} za každých {pct} % cíle, o které skóre kola cíl překročilo (nejvýš {max|money}).',
    flavor: 'Za knížku kupónů slibovali desetinásobek. Fond je mezitím někde u moře.',
  },
  spa_guest: {
    name: 'Lázeňský host',
    desc: 'Za každé kolo, ve kterém se nezahazovalo, trvale +{xmult|x} mult (teď {current|x}).',
    flavor: 'Kolonáda, oplatka, pramen. Hlavně nic nevyhazovat, pan doktor říkal klid.',
  },
  brass_band: {
    name: 'Dechovka',
    desc: 'Každá skórující karta skóruje ještě {retriggers}× za každou další skórující kartu stejné hodnoty.',
    flavor: 'Hrají pořád tutéž polku. Na třetí sloce už zpívá celá náves.',
  },
  charles_bridge: {
    name: 'Karlův most',
    desc: '{xmult|x} mult, pokud držíš v ruce kartu stejné hodnoty jako některá skórující karta.',
    flavor: 'Jedna je na Malé Straně, druhá na Starém Městě. Spojuje je most a tisíc turistů.',
  },
  d1_motorway: {
    name: 'Dálnice D1',
    desc: '{xmult|x} mult; v ruce máš o {cards|plural:kartu,karty,karet} méně.',
    flavor: 'Zúžení do jednoho pruhu, ale pak se jede! Teda, pak se zase stojí.',
  },
  exchange_office: {
    name: 'Směnárna',
    desc: '{base|x} mult a navíc +{xmult|x} za každých {chips|plural:čip,čipy,čipů}, které ruka v tu chvíli má (nejvýš {max|x}).',
    flavor: 'Nula procent provize, kurz drobným písmem. Čipy dáš všechny, mult dostaneš trochu.',
  },
  new_years_eve: {
    name: 'Silvestr',
    desc: 'Po každé porážce šéfa trvale +{xmult|x} mult (teď {current|x}).',
    flavor: 'Půlnoc, ohňostroj, předsevzetí. Do Tří králů vydrží jen ta kocovina.',
  },
} satisfies TextTree;
