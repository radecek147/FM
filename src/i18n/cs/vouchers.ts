/**
 * Texty: kupóny — klíče `vouchers.<id>.name|desc|flavor` (definice v src/content/vouchers.ts, docs/DESIGN.md kap. 6).
 * Čísla jen přes `{param}` z `VoucherDef.params`, u čísla se slovem s `|plural:` (tvar sedí i po změně čísla);
 * flavor bez uvozovek.
 */
import type { TextTree } from '../cs';

export const vouchers = {
  second_shelf: {
    name: 'Druhý regál',
    desc: '+{slots|plural:kartový slot,kartové sloty,kartových slotů} ve Večerce (žolíci, spotřebky, hrací karty).',
    flavor: 'Konečně je kam dát chipsy.',
  },
  checkout_shelf: {
    name: 'Regál u pokladny',
    desc: '+{slots|plural:slot,sloty,slotů} na obálky ve Večerce.',
    flavor: 'Impulzivní nákupy na dosah ruky.',
  },
  yellow_price: {
    name: 'Žlutá cenovka',
    desc: 'Zboží ve Večerce je o {pct} % levnější (přehození ne).',
    flavor: 'Žlutá barva, menší číslo. Víc vědět nepotřebuješ.',
  },
  relabeled_price: {
    name: 'Přelepená cenovka',
    desc: 'Zboží ve Večerce je celkem o {pct} % levnější (přehození ne).',
    flavor: 'Pod novou cenovkou stará, pod ní ještě starší. Archeologie slev.',
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
    desc: '+{hands|plural:ruka,ruce,rukou} v každém kole.',
    flavor: 'Otevřeno do posledního hosta.',
  },
  nonstop: {
    name: 'Nonstop',
    desc: '+{hands|plural:ruka,ruce,rukou} v každém kole a +{money|money} navíc za každou nevyužitou ruku.',
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
    desc: '+{cards|plural:karta,karty,karet} v ruce.',
    flavor: 'Ze sklepa, po dědovi.',
  },
  folding_table: {
    name: 'Rozkládací stůl',
    desc: '+{cards|plural:karta,karty,karet} v ruce; v kole se šéfem ještě +{bossCards|plural:karta,karty,karet} navíc.',
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
    desc: '+{slots|plural:slot,sloty,slotů} žolíka, ale −{cards|plural:karta,karty,karet} v ruce.',
    flavor: 'Vejde se tam ještě jeden žolík. Kabát ne.',
  },
  proper_rack: {
    name: 'Pořádný věšák',
    desc: '+{cards|plural:karta,karty,karet} v ruce (vyrovná postih Úzkého věšáku).',
    flavor: 'Konečně i na bundu.',
  },
  tear_calendar: {
    name: 'Trhací kalendář',
    desc: 'Pranostiky a babské rady se ve Večerce objevují častěji (váha každé {from} → {to}, žolíci mají {joker}).',
    flavor: 'Každý den jedna moudrost.',
  },
  grandmas_pantry: {
    name: 'Babiččina spíž',
    desc: '+{slots|plural:slot,sloty,slotů} spotřebky; ve Večerce se objevují i úřední razítka (váha {stamps}) a pranostiky s babskými radami ještě častěji (váha {from} → {to}).',
    flavor: 'Zavařeniny na příštích dvacet let.',
  },
  card_stall: {
    name: 'Stánek s kartami',
    desc: 'Ve Večerce se objevují i hrací karty (váha {weight}, žolíci mají {joker}).',
    flavor: 'Z druhé ruky, jako nové.',
  },
  collectors_fair: {
    name: 'Sběratelská burza',
    desc: 'Hrací karty ve Večerce mají {enhancePct}% šanci na vylepšení a {sealPct}% šanci na pečeť.',
    flavor: 'Tahle je ještě s pečetí z první republiky. Pro tebe za pade.',
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
