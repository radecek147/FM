/**
 * Texty žolíků (vzácní, fáze 7): `jokers.<id>.name|desc|flavor` + vlastní hlášky (`jokers.<id>.<klíč>`).
 * `{param}` dosadí UI z `params` definice a z `describe(self)` (src/content/jokers/rare2.ts).
 * Flavor bez uvozovek — UI ho vysází kurzívou v „…“.
 */
import type { TextTree } from '../../cs';

export const jokersRare2 = {
  // ── ze zásobníku DESIGN 4.9 ──
  office_connection: {
    name: 'Známý na úřadě',
    desc: 'Cíl šéfa je o {pct} % nižší a po každém přeskočení útraty přelosuje šéfa patra.',
    flavor: 'Nic neslibuju. Ale švagrová dělá na podatelně.',
    rerolled: 'Vyřízeno bokem: šéf přelosován.',
  },
  chronicler: {
    name: 'Kronikář',
    desc: 'Za každou kombinaci, kterou od jeho koupě zahraješ poprvé, trvale +{mult} mult (teď +{current} mult).',
    flavor: 'Zapsal to do obecní kroniky. Krasopisně, s datem a s chybou.',
  },
  chimney_sweep: {
    name: 'Kominík',
    desc: 'Každá skórující piková, křížová nebo šťastná karta: {chance} {odds|z}, že dá +{mult} mult.',
    flavor: 'Kdo ho potká, chytí se za knoflík. Kdo ho nepotká, chytí se za hlavu.',
  },
  glassblower: {
    name: 'Sklář',
    desc: 'Při získání přidá do balíčku {cards|plural:skleněnou kartu,skleněné karty,skleněných karet}; každou zničenou skleněnou kartu hned vyfoukne do balíčku znovu.',
    flavor: 'Střepy přinášejí štěstí. Hlavně sklářům.',
    blown: 'Vyfouknuto znovu!',
  },
  notary_public: {
    name: 'Notář',
    desc: 'První ruka Malé a Velké útraty dá ještě před skórováním první skórující kartě bez pečeti zlatou pečeť.',
    flavor: 'Podpis ověří za minutu, poplatek naúčtuje za hodinu. Na šéfy nemá úřední hodiny.',
    certified: 'Ověřeno notářem.',
  },
  witch: {
    name: 'Čarodějnice',
    desc: 'Po porážce šéfa vytvoří náhodné úřední razítko (potřebuje volný slot).',
    flavor: 'Na filipojakubskou noc se pálí. Zbytek roku razítkuje.',
    brewed: 'Čarodějnice uvařila razítko.',
  },
  water_goblin: {
    name: 'Vodník',
    desc: 'Každá zahozená srdcová karta mu trvale přidá +{mult} mult (teď +{current} mult).',
    flavor: 'Co hodíš do rybníka, to on schová pod hrníček.',
  },
  will_o_wisp: {
    name: 'Bludička',
    desc: 'V kole se šéfem dá každá ruka {xmult|x} mult.',
    flavor: 'Svítí jen v té největší tmě. Kam vede, to už neřekne.',
  },
  noon_witch: {
    name: 'Polednice',
    desc: 'Druhá ruka kola dá {xmult|x} mult.',
    flavor: 'Kdo v poledne zlobí, toho si odnese. Kdo hraje, tomu zdvojnásobí mult.',
  },
  klekanice: {
    name: 'Klekánice',
    desc: '{xmult|x} mult, pokud ti po zahrání v ruce nezůstala žádná figura.',
    flavor: 'Po klekání mají být všichni doma. Králové, dámy i kluci.',
  },
  parish_priest: {
    name: 'Pan farář',
    desc: '+{mult} mult za každou kartu v balíčku, která má vylepšení, pečeť nebo edici.',
    flavor: 'Zná každou ovečku jménem. Hlavně ty, co mají na sobě něco blyštivého.',
  },
  seer: {
    name: 'Vědma',
    desc: 'Když jediná ruka dosáhne celého cíle Malé útraty, vytvoří pranostiku její kombinace (potřebuje volný slot).',
    flavor: 'Vidím budoucnost: zítra bude pršet a ty zahraješ Dvojici.',
    foreseen: 'Vědma to viděla předem.',
  },
  court_painter: {
    name: 'Dvorní malíř',
    desc: 'Po první ruce kola namaluje první skórující kartu, která není figura, natrvalo jako náhodnou figuru stejné barvy.',
    flavor: 'Namaluje tě jako krále. Za příplatek i s koněm.',
    painted: 'Portrét hotov. Podobnost čistě náhodná.',
  },
  colorblind_uncle: {
    name: 'Barvoslepý strýc',
    desc: 'Srdcové a kárové karty se počítají jako jedna barva, pikové a křížové taky.',
    flavor: 'Na semaforu jezdí podle pořadí, ne podle barvy.',
  },
  trodden_path: {
    name: 'Vyšlapaná pěšina',
    desc: 'V celé Postupce smí jedna hodnota chybět (třeba trojka, čtyřka, šestka, sedmička a osmička).',
    flavor: 'Jedna zkratka přes louku se toleruje. Dvě už jsou nová silnice.',
  },

  // ── vlastní: úřady, historie, internet a memy, Hradec vs. Brno ──
  war_loot: {
    name: 'Válečná kořist',
    desc: 'Na konci kola +{money|money} za každého šéfa poraženého od jeho koupě (teď +{current|money}).',
    flavor: 'Žižka nikdy neprohrál bitvu. Kořist počítal po vozech.',
  },
  anonymous_commenter: {
    name: 'Anonymní diskutér',
    desc: 'Každá zahraná karta, která neskóruje, dá +{mult} mult.',
    flavor: 'Nečetl jsem to, ale nesouhlasím.',
  },
  viral_video: {
    name: 'Virální video',
    desc: 'První ruka kola dá +{chips|plural:čip,čipy,čipů}, každá další ruka v kole polovinu předchozí.',
    flavor: 'Včera milion zhlédnutí, dnes trapárna.',
  },
  carbon_paper: {
    name: 'Kopírák',
    desc: 'Kopíruje schopnost nejpravějšího běžného nebo vzácného žolíka, kterého jde kopírovat.',
    flavor: 'Průklep je skoro jako originál. Jen trochu modřejší.',
  },
  defenestration: {
    name: 'Defenestrace',
    desc: 'Každé zahození, ve kterém je aspoň jedna figura, dá {money|money}.',
    flavor: 'Námitky se v Praze tradičně vyřizují oknem.',
    thrown: 'Z okna!',
  },
  brno_native: {
    name: 'Brňák',
    desc: '{xmult|x} mult, pokud stojí v řadě žolíků úplně vlevo.',
    flavor: 'Hradec? To je ta vesnice u Brna?',
  },
  social_bubble: {
    name: 'Sociální bublina',
    desc: 'Když mají všechny skórující karty stejnou barvu nebo stejnou hodnotu, každá dá +{chips|plural:čip,čipy,čipů}.',
    flavor: 'Všichni stejní, všichni souhlasí. Kdo nesouhlasí, ten tu není.',
  },
} satisfies TextTree;
