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
  loyalty_card: {
    name: 'Věrnostní kartička',
    desc: 'Každý {every}. nákup ve Večerce je zdarma – žolík, spotřebka, hrací karta, obálka i kupón (přehození se nepočítá).',
    flavor: 'Za každý nákup razítko. Za plnou kartičku rohlík a nová kartička.',
  },
  regular_customer: {
    name: 'Kmenový zákazník',
    desc: 'Zdarma je už každý {every}. nákup ve Večerce (místo každého {from}.).',
    flavor: 'Paní vedoucí ti schovává čerstvé a zdraví tě jménem. I příjmením.',
  },
  village_newsletter: {
    name: 'Zpravodaj obce',
    desc: 'V každém patře můžeš na výběru útraty {rerolls}× zdarma přelosovat šéfa (nevyužité přelosování propadne).',
    flavor: 'Strana tři: kdo k nám přijede na šéfa. Strana čtyři: jak se mu vyhnout.',
  },
  village_radio: {
    name: 'Obecní rozhlas',
    desc: 'Šéfa jde přelosovat celkem {rerolls}× za patro a jeho cíl je o {pct} % nižší.',
    flavor: 'Vážení spoluobčané, šéf dnes úřaduje jen dopoledne. Hlášení opakovat nebudeme.',
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
  deposit_bottle: {
    name: 'Zálohovaná lahev',
    desc: 'Spotřebky se prodávají za plnou cenu (místo poloviny).',
    flavor: 'Tři koruny za lahev. Za nepoužité razítko taky, když ho vrátíš s účtenkou.',
  },
  bottle_return: {
    name: 'Výkupna',
    desc: 'Žolíci se prodávají za plnou cenu (místo poloviny; žolík na splátky dál za {rental|money}).',
    flavor: 'Výkup barevných kovů, papíru a žolíků. Původ se nezkoumá.',
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
  complaints_book: {
    name: 'Kniha stížností',
    desc: 'Když se kombinace v tomto runu zahraje poprvé, zvýší se o {levels|plural:úroveň,úrovně,úrovní}.',
    flavor: 'Stížnost přijata. Vyřízení do třiceti dnů, úroveň hned.',
    leveled: 'Stížnost přijata – úroveň kombinace o stupeň výš.',
  },
  complaint_settled: {
    name: 'Vyřízená stížnost',
    desc: 'Každé {every}. zahrání téže kombinace v runu jí přidá {levels|plural:úroveň,úrovně,úrovní}.',
    flavor: 'Vyřízeno kladně! Poprvé od roku osmdesát devět.',
    leveled: 'Stížnost vyřízena kladně – úroveň navíc.',
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
  spring_cleaning: {
    name: 'Jarní úklid',
    desc: 'Po porážce šéfa dostane náhodný tvůj žolík bez edice lesklou edici (+{chips|plural:čip,čipy,čipů}).',
    flavor: 'Okna umytá, koberec vyklepaný a žolík se leskne jako nový.',
    cleaned: 'Jarní úklid: jeden žolík se leskne až do kuchyně.',
  },
  deep_cleaning: {
    name: 'Generální úklid',
    desc: 'Po porážce šéfa dostane žolík místo lesklé holografickou edici (+{mult} mult).',
    flavor: 'Vysává se i pod gaučem. Našly se tam tři koruny a jeden žolík.',
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
