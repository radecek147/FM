/**
 * Texty: Úřední razítka (vzácná a silná) — klíče `consumables.<id>.name|desc|flavor`.
 * Definice v src/content/razitka.ts; `{param}` dosadí UI z `params`. Názvy a flavory podle docs/DESIGN.md kap. 5.4.
 */
import type { TextTree } from '../cs';

/** Šance edic u Hromadného vyřízení a Kontroly totožnosti. */
const EDITION_ODDS = 'lesklá {foil} %, holografická {holo} %, duhová {poly} %';

export const razitka = {
  notarized: {
    name: 'Ověřeno notářem',
    desc: 'Vybraná karta dostane zlatou pečeť (+{money|money} pokaždé, když skóruje).',
    flavor: 'Za ověření podpisu se platí zvlášť.',
  },
  duty_stamp: {
    name: 'Kolek',
    desc: 'Vybraná karta dostane červenou pečeť (aktivuje se {retriggers}× navíc).',
    flavor: 'Bez kolku to neplatí. S kolkem to platí dvakrát.',
  },
  blue_form: {
    name: 'Modrý formulář',
    desc: 'Vybraná karta dostane modrou pečeť (když zůstane v ruce na konci kola, vytvoří pranostiku poslední zahrané kombinace).',
    flavor: 'Vyplňte modrou propiskou, hůlkovým písmem.',
  },
  registered_mail: {
    name: 'Doporučeně',
    desc: 'Vybraná karta dostane fialovou pečeť (při zahození vytvoří náhodnou babskou radu).',
    flavor: 'S dodejkou. Vyzvednout do 15 dnů.',
  },
  exemption: {
    name: 'Výjimka z vyhlášky',
    desc: 'Vytvoří náhodného legendárního žolíka (potřebuje volný slot).',
    flavor: 'Výjimečně, jen pro vás, a nikomu to neříkejte.',
  },
  buyback: {
    name: 'Zpětný odběr',
    desc: 'Zničí náhodnou polovinu karet v ruce (zaokrouhleno nahoru); za každou zničenou kartu {money|money}.',
    flavor: 'Vykupujeme staré karty. Platíme hotově.',
  },
  certified_copy: {
    name: 'Ověřená kopie',
    desc: 'Zkopíruje žolíka nejvíc vlevo i s jeho stavem (kopie bez negativní edice); všichni ostatní žolíci kromě přibitých se zničí.',
    flavor: 'Kopie souhlasí s originálem. Originály skartovány.',
  },
  bulk_processing: {
    name: 'Hromadné vyřízení',
    desc: `Každý tvůj žolík bez edice dostane náhodnou edici (${EDITION_ODDS}); trvale −{handSize|plural:karta,karty,karet} v ruce.`,
    flavor: 'Vyřízeno hromadně, stížnosti individuálně.',
  },
  office_hours: {
    name: 'Úřední hodiny',
    desc: 'Všechny kombinace +{levels|plural:úroveň,úrovně,úrovní}; trvale −{hands|plural:ruka,ruce,rukou} v každém kole.',
    flavor: 'Po–St 8–11, Čt zavřeno, Pá dle nálady.',
  },
  id_check: {
    name: 'Kontrola totožnosti',
    desc: `Vybraná karta bez edice dostane náhodnou edici (${EDITION_ODDS}).`,
    flavor: 'Občanku, prosím. To na té fotce jste vy?',
  },
  merge_files: {
    name: 'Sloučení spisů',
    desc: 'Pravá ze dvou vybraných karet se zničí; levá od ní převezme vylepšení, pečeť a edici (jen to, co sama nemá).',
    flavor: 'Dva spisy, jedna složka, nula přehlednosti.',
  },
  tax_return: {
    name: 'Daňové přiznání',
    desc: 'Vytvoří náhodného epického žolíka (potřebuje volný slot); peníze klesnou na nulu (dluh zůstává).',
    flavor: 'Přiznání je polehčující okolnost.',
  },
  occupancy_permit: {
    name: 'Kolaudace',
    desc: 'Trvale +{jokerSlots|plural:slot,sloty,slotů} žolíka a −{consumableSlots|plural:slot,sloty,slotů} spotřebky (jen když máš aspoň {minSlots|plural:slot,sloty,slotů} spotřebek).',
    flavor: 'Stavba je hotová, chybí jen schody.',
  },
  appeal: {
    name: 'Odvolání',
    desc: 'Jen v kole se šéfovským pravidlem: vypne ho do konce kola. Stojí {cost|money} (smí jít do dluhu, ale jen do limitu).',
    flavor: 'Odvolání má odkladný účinek. Za pět korun.',
  },
  expropriation: {
    name: 'Vyvlastnění',
    desc: 'Zničí tvého žolíka nejvíc vpravo, který není přibitý, a dá {mult}× jeho prodejní cenu.',
    flavor: 'Ve veřejném zájmu, samozřejmě.',
  },
  fine_waiver: {
    name: 'Prominutí pokut',
    desc: 'Odstraní všechny nálepky ze všech tvých žolíků (zvětralí znovu fungují).',
    flavor: 'Amnestie na všechno kromě parkování.',
  },
} satisfies TextTree;
