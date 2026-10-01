/**
 * Texty: kupóny — klíče `vouchers.<id>.name|desc|flavor` (definice v src/content/vouchers.ts, docs/DESIGN.md kap. 6).
 * Čísla jen přes `{param}` z `VoucherDef.params`; flavor bez uvozovek. Pevná čísla (1 slot, 1 ruka…) mají tvar
 * slova napsaný rovnou — při změně čísla v obsahu zkontroluj i tvar.
 */
import type { TextTree } from '../cs';

export const vouchers = {
  second_shelf: {
    name: 'Druhý regál',
    desc: '+{slots} kartový slot ve Večerce (žolíci, spotřebky, hrací karty).',
    flavor: 'Konečně je kam dát chipsy.',
  },
  checkout_shelf: {
    name: 'Regál u pokladny',
    desc: '+{slots} slot na obálku ve Večerce.',
    flavor: 'Impulzivní nákupy na dosah ruky.',
  },
  loyalty_card: {
    name: 'Věrnostní karta',
    desc: 'Zboží ve Večerce je o {pct} % levnější (přehození ne).',
    flavor: 'Sbíráte body? – Ne. – Tak je máte.',
  },
  gold_loyalty: {
    name: 'Zlatá věrnostní',
    desc: 'Zboží ve Večerce je celkem o {pct} % levnější (přehození ne).',
    flavor: 'Platinová by byla moc nápadná.',
  },
  counter_buddy: {
    name: 'Kamarád za pultem',
    desc: 'Každé přehození je o {discount|money} levnější (začíná na {cost|money}).',
    flavor: 'Pro tebe to přehodím.',
  },
  manager_inlaw: {
    name: 'Švagr vedoucí',
    desc: 'Cena přehození v téže Večerce neroste.',
    flavor: 'Rodina je rodina.',
  },
  late_hours: {
    name: 'Prodloužená otvíračka',
    desc: '+{hands} ruka v každém kole.',
    flavor: 'Otevřeno do posledního hosta.',
  },
  nonstop: {
    name: 'Nonstop',
    desc: '+{hands} ruka v každém kole a +{money|money} navíc za každou nevyužitou ruku.',
    flavor: 'Zavíráme? To slovo neznáme.',
  },
  dumpster: {
    name: 'Kontejner před domem',
    desc: '+{discards} zahození v každém kole.',
    flavor: 'Vyhodit můžeš cokoli. Kromě gauče.',
  },
  recycling_yard: {
    name: 'Sběrný dvůr',
    desc: '+{discards} zahození v každém kole a +{money|money} za každé nevyužité zahození.',
    flavor: 'Třídit se vyplácí.',
  },
  bigger_table: {
    name: 'Větší stůl',
    desc: '+{cards} karta v ruce.',
    flavor: 'Ze sklepa, po dědovi.',
  },
  folding_table: {
    name: 'Rozkládací stůl',
    desc: '+{cards} karta v ruce; v kole Šéfa ještě +{bossCards} navíc.',
    flavor: 'Když přijde šéf, rozkládá se až do předsíně.',
  },
  savings_account: {
    name: 'Spořicí účet',
    desc: 'Strop úroku se zvedne na {cap|money} za kolo.',
    flavor: 'Úrok skoro jako za první republiky.',
  },
  building_savings: {
    name: 'Stavební spoření',
    desc: 'Strop úroku se zvedne na {cap|money} za kolo.',
    flavor: 'Se státní podporou, bez stavby.',
  },
  narrow_rack: {
    name: 'Úzký věšák',
    desc: '+{slots} slot žolíka, ale −{cards} karta v ruce.',
    flavor: 'Vejde se tam ještě jeden žolík. Kabát ne.',
  },
  proper_rack: {
    name: 'Pořádný věšák',
    desc: '+{cards} karta v ruce (vyrovná postih Úzkého věšáku).',
    flavor: 'Konečně i na bundu.',
  },
  tear_calendar: {
    name: 'Trhací kalendář',
    desc: 'Pranostiky a babské rady se ve Večerce objevují častěji: váha každé stoupne z {from} na {to} (žolíci mají {joker}).',
    flavor: 'Každý den jedna moudrost.',
  },
  grandmas_pantry: {
    name: 'Babiččina spíž',
    desc: '+{slots} slot spotřebky; ve Večerce se objevují i úřední razítka (váha {stamps}) a pranostiky s babskými radami ještě častěji (váha {from} → {to}).',
    flavor: 'Zavařeniny na příštích dvacet let.',
  },
  card_stall: {
    name: 'Stánek s kartami',
    desc: 'Ve Večerce se objevují i hrací karty (váha {weight}, žolíci mají {joker}).',
    flavor: 'Z druhé ruky, jako nové.',
  },
  fortune_teller: {
    name: 'Kartářka',
    desc: 'Hrací karty ve Večerce mají {enhancePct} % šanci na vylepšení a {sealPct} % šanci na pečeť.',
    flavor: 'Vyložila mi budoucnost. Je v ní Barva.',
  },
  polish: {
    name: 'Leštěnka',
    desc: 'Lesklá, holografická a duhová edice se objevují {mult}× častěji.',
    flavor: 'Lesk jako nedělní boty.',
  },
  holo_foil: {
    name: 'Hologramová fólie',
    desc: 'Lesklá, holografická a duhová edice se objevují celkem {mult}× častěji (místo {base}×).',
    flavor: 'Duha v každém balení.',
  },
  official_strike: {
    name: 'Úřední škrt',
    desc: 'Patro se hned sníží o {antes}, ale cíle všech útrat jsou do konce runu {targetMult|x} (nabízí se od patra {minAnte}).',
    flavor: 'Patro škrtnuto. Razítko, podpis.',
  },
  amnesty: {
    name: 'Amnestie',
    desc: 'Patro se hned sníží o {antes}, ale ve Večerce stojí do konce runu všechno o {priceAdd|money} víc (nabízí se od patra {minAnte}).',
    flavor: 'Na co se zapomene, to se nestalo.',
  },
} satisfies TextTree;
