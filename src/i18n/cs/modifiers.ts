/**
 * Texty úprav hracích karet: vylepšení, pečetě, edice (definice v src/content/modifiers.ts).
 * Klíče `enhancements.<id>|seals.<id>|editions.<id>` → `name`, `desc`, `flavor`.
 * `{param}` v `desc` dosadí UI z `params` definice — čísla se tak nikdy nerozejdou s mechanikou
 * (pravděpodobnosti `{chance} z {odds}` UI navíc vynásobí `Modifiers.probabilityMult`).
 * Názvy a flavory podle docs/DESIGN.md kap. 2.6–2.8.
 */

/** Vylepšení hracích karet (DESIGN 2.7). */
export const enhancements = {
  bonus: {
    name: 'Prémiová',
    desc: '+{chips|plural:čip,čipy,čipů}, když karta skóruje.',
    flavor: 'Třináctý plat pro jednu kartu.',
  },
  mult: {
    name: 'Pálivá',
    desc: '+{mult} mult, když karta skóruje.',
    flavor: 'Opatrně, pálí i v ruce.',
  },
  glass: {
    name: 'Skleněná',
    desc: '{xmult|x} mult, když karta skóruje. Po vyhodnocení ruky {chance} z {odds}, že praskne a zničí se.',
    flavor: 'Křehká jako slib před volbami.',
  },
  steel: {
    name: 'Ocelová',
    desc: '{xmult|x} mult, dokud karta zůstává v ruce.',
    flavor: 'Drží, i když nehraje.',
  },
  stone: {
    name: 'Kamenná',
    desc: '+{chips|plural:čip,čipy,čipů}. Nemá hodnotu ani barvu, ale skóruje vždycky.',
    flavor: 'Těžká, poctivá, bez hodnot.',
  },
  gold: {
    name: 'Zlatá',
    desc: '+{money|money} na konci kola, když karta zůstala v ruce.',
    flavor: 'Kdo šetří, má za tři.',
  },
  lucky: {
    name: 'Šťastná',
    desc: 'Při skórování {multChance} z {multOdds}: +{mult} mult; nezávisle {moneyChance} z {moneyOdds}: +{money|money}.',
    flavor: 'Kominík jí podal ruku.',
  },
  wild: {
    name: 'Divoká',
    desc: 'Patří do všech barev – pro Barvu i pro efekty, které počítají barvy.',
    flavor: 'Hraje za všechny týmy.',
  },
  worn: {
    name: 'Ohmataná',
    desc: 'Po každé ruce, ve které skórovala, trvale +{chips|plural:čip,čipy,čipů}.',
    flavor: 'Tuhle kartu držel v ruce už děda.',
  },
};

/** Pečetě (DESIGN 2.8). V názvu je slovo „pečeť“, aby se nepletly s vylepšeními (Zlatá × Zlatá pečeť). */
export const seals = {
  gold: {
    name: 'Zlatá pečeť',
    desc: '+{money|money} pokaždé, když karta skóruje.',
    flavor: 'Ověřeno, orazítkováno, proplaceno.',
  },
  red: {
    name: 'Červená pečeť',
    desc: 'Karta se aktivuje {retriggers}× navíc – při skórování i v ruce.',
    flavor: 'Opakování je matka moudrosti. I bodování.',
  },
  blue: {
    name: 'Modrá pečeť',
    desc: 'Když karta zůstane v ruce na konci kola, vytvoří pranostiku poslední kombinace zahrané v tomto kole (potřebuje volný slot).',
    flavor: 'Modrý formulář, tři kopie, jedna pranostika.',
  },
  purple: {
    name: 'Fialová pečeť',
    desc: 'Při zahození vytvoří náhodnou babskou radu (potřebuje volný slot).',
    flavor: 'Doporučeně, do vlastních rukou babičky.',
  },
};

/** Edice žolíků, hracích karet a spotřebek (DESIGN 2.6). */
export const editions = {
  foil: {
    name: 'Lesklá',
    desc: '+{chips|plural:čip,čipy,čipů}.',
    flavor: 'Naleštěno na sváteční návštěvu.',
  },
  holo: {
    name: 'Holografická',
    desc: '+{mult} mult.',
    flavor: 'Jako ochranný prvek na bankovce. Jen víc vydělá.',
  },
  poly: {
    name: 'Duhová',
    desc: '{xmult|x} mult.',
    flavor: 'Po dešti vždycky vyjde. Po pátém pivu taky.',
  },
  negative: {
    name: 'Negativní',
    desc: '+{slots|plural:slot,sloty,slotů} pro svůj druh (žolíka nebo spotřebku) – přinese si vlastní místo.',
    flavor: 'Jako negativ ze starého alba – je tam, a přitom nikde.',
  },
};
