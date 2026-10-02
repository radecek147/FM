/**
 * Texty žolíků (běžní, fáze 7): `jokers.<id>.name|desc|flavor` + vlastní hlášky (`jokers.<id>.<klíč>`).
 * `{param}` dosadí UI z `params` definice a z `describe(self)` (src/content/jokers/common2.ts).
 * Flavor bez uvozovek — UI ho vysází kurzívou v „…“.
 */
import type { TextTree } from '../../cs';

export const jokersCommon2 = {
  // ── ze zásobníku DESIGN 4.9 ──
  helpline_aunt: {
    name: 'Teta z poradny',
    desc: 'Po použití babské rady {chance} {odds|z}, že vznikne další náhodná babská rada (potřebuje volný slot).',
    flavor: 'Poradí ti, i když se neptáš. Hlavně když se neptáš.',
    advice: 'Teta přidala ještě jednu radu.',
  },
  weekend_cottager: {
    name: 'Chatař',
    desc: '+{mult} mult za každý prázdný slot spotřebky.',
    flavor: 'Na chatě nemá signál ani zásoby. A je mu tam nejlíp.',
  },
  shooting_gallery: {
    name: 'Střelec z pouti',
    desc: 'Každá skórující desítka nebo figura dá +{mult} mult.',
    flavor: 'Za desítku růže z krepáku, za figuru medvěd větší než ty.',
  },
  tobacconist: {
    name: 'Trafikant',
    desc: 'Při vstupu do Večerky {chance} {odds|z}, že ti dá náhodnou pranostiku (potřebuje volný slot).',
    flavor: 'Noviny, losy, cigarety. Předpověď počasí dostaneš zadarmo, ať chceš, nebo ne.',
    forecast: 'Trafikant přihodil pranostiku.',
  },
  ticket_inspector: {
    name: 'Revizor',
    desc: '+{chips|plural:čip,čipy,čipů}, pokud mezi zahranými kartami není žádná figura.',
    flavor: 'Jízdenky, prosím. Králové, dámy a kluci vystoupí na příští.',
  },
  doorman: {
    name: 'Vrátný',
    desc: 'Každá figura držená v ruce dá +{mult} mult.',
    flavor: 'Pana ředitele pozdraví, paní hlavní účetní taky. Tebe dál nepustí.',
  },
  goldsmith: {
    name: 'Zlatník',
    desc: 'Na konci kola promění náhodnou kartu bez vylepšení drženou v ruce na zlatou.',
    flavor: 'Pozlatí ti cokoli. Nejvíc účet.',
    gilded: 'Pozlaceno!',
  },
  paver: {
    name: 'Dlaždič',
    desc: 'Každé zahození promění první zahozenou kartu bez vylepšení na kamennou; každá skórující kamenná karta dá +{mult} mult.',
    flavor: 'Kostku ke kostce. Za tři roky to přijdou zase rozkopat.',
    paved: 'Vydlážděno!',
  },
  postman: {
    name: 'Pošťák',
    desc: 'Za každou otevřenou obálku dostaneš {money|money}.',
    flavor: 'Nikdo nebyl doma, tak nechal lísteček. Vyzvednout zítra od osmi do devíti.',
    delivered: 'Doručeno: +{money|money}.',
  },
  grocer: {
    name: 'Hokynář',
    desc: '+{mult} mult za každého jiného běžného žolíka (jiní Hokynáři se nepočítají).',
    flavor: 'Má všechno, co se běžně shání. Neběžné až ve čtvrtek.',
  },
  grill_dad: {
    name: 'Táta u grilu',
    desc: '+{chips|plural:čip,čipy,čipů}, pokud se v tomto kole zahazovalo právě {discards}×.',
    flavor: 'Maso se otáčí jen jednou. A radit mu nebudeš.',
  },
  teacher: {
    name: 'Učitelka',
    desc: '+{mult} mult, pokud mají všechny skórující karty sudou hodnotu (dvojky, čtyřky, šestky, osmičky a desítky).',
    flavor: 'Samé sudé? Jednička s hvězdičkou. Lichá jde do žákovské.',
  },
  hejkal: {
    name: 'Hejkal',
    desc: '{chance} {odds|z}, že zahraná ruka dostane +{mult} mult.',
    flavor: 'Hejká po lese, až se ozvěna stydí. Občas se trefí do noty.',
  },
  tram_driver: {
    name: 'Tramvaják',
    desc: '+{mult} mult, pokud to není první ruka kola a v kole už se zahazovalo.',
    flavor: 'Ukončete výstup a nástup. Kdo zahazoval, ten jede dál.',
  },
  punter: {
    name: 'Sázkař',
    desc: 'Na konci kola {chance} {odds|z}, že vyhraje {money|money}.',
    flavor: 'Má systém. Systém má jeho výplatu.',
  },

  // ── vlastní ──
  pavlac_gossip: {
    name: 'Drbna z pavlače',
    desc: '{xmult|x} mult, pokud je zahraná kombinace stejná jako v minulé ruce.',
    flavor: 'Zase Dvojice? To už ví celý dům. Zítra celá ulice.',
  },
  round_for_everyone: {
    name: 'Rundu všem',
    desc: '{xmult|x} mult, pokud zahraješ {cards|plural:kartu,karty,karet} a všechny skórují.',
    flavor: 'Hospodský, rundu pro všech pět! Platí ten, kdo to řekl nahlas.',
  },
  pickled_cheese: {
    name: 'Nakládaný hermelín',
    desc: '+{chips|plural:čip,čipy,čipů} za každou kartu drženou v ruce.',
    flavor: 'Čím déle leží, tím víc voní. Celý lokál to ocení.',
  },
  thirteenth_salary: {
    name: 'Třináctý plat',
    desc: 'Po porážce šéfa dostaneš v odměnách navíc {money|money}.',
    flavor: 'Prémie za splnění plánu. Plán zněl: porazit šéfa.',
  },
  temp_worker: {
    name: 'Brigádník',
    desc: 'Na konci kola +{money|money} za každou ruku zahranou v tomto kole.',
    flavor: 'Placený od kusu. Kusů je hodně, kvalita se dořeší.',
  },
  fisherman: {
    name: 'Rybář',
    desc: 'Po každém zahození {chance} {odds|z}, že něco chytí: náhodnou babskou radu (potřebuje volný slot).',
    flavor: 'Největší kapr mu zase utekl. Domů nese aspoň dobrou radu.',
    catch: 'Zabralo! Rybář přinesl babskou radu.',
  },
  garbage_man: {
    name: 'Popelář',
    desc: 'Každá zahozená karta s hodnotou nejvýš {rank} mu trvale přidá +{chips|plural:čip,čipy,čipů} (teď +{current|plural:čip,čipy,čipů}).',
    flavor: 'Ve čtvrtek v šest ráno odveze všechno. Hlavně tvůj spánek.',
  },
  jukebox: {
    name: 'Hrací automat',
    desc: 'Skórující karty s nejvyšší hodnotou skórují ještě {retriggers}×.',
    flavor: 'Za pětikorunu hraje pořád stejnou písničku. Celou noc.',
  },
  tool_shed: {
    name: 'Kůlna',
    desc: '+{slots|plural:slot,sloty,slotů} spotřebky.',
    flavor: 'Vejde se tam všechno. Hlavně to, co pak nikdy nenajdeš.',
  },
  replacement_bus: {
    name: 'Náhradní autobus',
    desc: 'Každé z prvních {max} zahození v kole zvětší do konce kola ruku o {cards|plural:kartu,karty,karet}.',
    flavor: 'Pojede to o hodinu déle, ale vejde se celá vesnice i s kozou.',
  },
  pig_slaughter: {
    name: 'Zabijačka',
    desc: 'Na konci kola zničí nejnižší kartu bez vylepšení drženou v ruce a dá za ni {money|money}.',
    flavor: 'Z prasete se využije všechno kromě kvičení. Z dvojky taky.',
    feast: 'Zabijačka! Jitrnice pro celý dům.',
  },
  derby_fans: {
    name: 'Městské derby',
    desc: '+{mult} mult, pokud mezi skórujícími kartami je červená i černá barva.',
    flavor: 'Půlka hospody fandí červeným, půlka černým. Hospodský fandí tržbě.',
  },
  pub_quiz: {
    name: 'Hospodský kvíz',
    desc: '+{chips|plural:čip,čipy,čipů} za každou různou hodnotu mezi skórujícími kartami.',
    flavor: 'Hlavní cena: sud piva. Cena útěchy: taky sud piva.',
  },
  scrap_yard: {
    name: 'Sběrna surovin',
    desc: 'Za každou zničenou hrací kartu trvale +{mult} mult, nejvýš +{max} mult (teď +{current} mult).',
    flavor: 'Za kilo karet dvacet haléřů a pochvala do žákovské.',
  },
} satisfies TextTree;
