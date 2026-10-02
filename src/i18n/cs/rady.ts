/**
 * Texty: Babské rady (mění hrací karty) — klíče `consumables.<id>.name|desc|flavor`.
 * Definice v src/content/rady.ts; `{param}` dosadí UI z `params` (u vylepšení i čísla vylepšení
 * ze src/content/modifiers.ts). Názvy a flavory podle docs/DESIGN.md kap. 5.3. Flavor bez uvozovek.
 */
import type { TextTree } from '../cs';

export const rady = {
  // ── vylepšení ──
  chamomile: {
    name: 'Heřmánkový čaj',
    desc: 'Až {cards} vybrané karty dostanou vylepšení Prémiová (+{chips|plural:čip,čipy,čipů}, když skórují).',
    flavor: 'Na všechno pomůže heřmánek.',
  },
  chili: {
    name: 'Pálivá paprička',
    desc: 'Až {cards} vybrané karty dostanou vylepšení Pálivá (+{mult} mult, když skórují).',
    flavor: 'Kdo nepálí, nehraje.',
  },
  glass_cabinet: {
    name: 'Babiččina vitrína',
    desc: 'Vybraná karta dostane vylepšení Skleněná ({xmult|x} mult, ale {chance} z {odds}, že po ruce praskne).',
    flavor: 'Na to se nesahá, to je na neděli.',
  },
  cast_iron_pot: {
    name: 'Litinový hrnec',
    desc: 'Vybraná karta dostane vylepšení Ocelová ({xmult|x} mult, dokud zůstává v ruce).',
    flavor: 'Vydrží tři generace a jednu válku.',
  },
  cabbage_stone: {
    name: 'Kámen na zelí',
    desc: 'Až {cards} vybrané karty dostanou vylepšení Kamenná (+{chips|plural:čip,čipy,čipů}, ale bez hodnoty a barvy).',
    flavor: 'Zelí se samo nezatíží.',
  },
  ducat: {
    name: 'Dukát pod polštář',
    desc: 'Vybraná karta dostane vylepšení Zlatá (+{money|money} na konci kola, když zůstane v ruce).',
    flavor: 'Šupina pod talířem nestačila.',
  },
  four_leaf: {
    name: 'Čtyřlístek',
    desc: 'Až {cards} vybrané karty dostanou vylepšení Šťastná ({multChance} z {multOdds}: +{mult} mult; {moneyChance} z {moneyOdds}: +{money|money}).',
    flavor: 'Hledala ho celé léto. U kontejnerů.',
  },
  fern_bloom: {
    name: 'Kvetoucí kapradí',
    desc: 'Až {cards} vybrané karty dostanou vylepšení Divoká (patří do všech barev).',
    flavor: 'Kvete jen o svatojánské noci. Pak je z ní všechno.',
  },
  grandpas_wallet: {
    name: 'Dědova peněženka',
    desc: 'Až {cards} vybrané karty dostanou vylepšení Ohmataná (po každé ruce, ve které skórují, trvale +{chips|plural:čip,čipy,čipů}).',
    flavor: 'Ohmataná od lepších časů.',
  },

  // ── barva a hodnota ──
  grandmas_dye: {
    name: 'Babiččina barva',
    desc: 'Vyber {min}–{max} karty: všechny převezmou barvu té, která je nejvíc vlevo.',
    flavor: 'Pletla jen z jedné vlny.',
  },
  hall_mirror: {
    name: 'Zrcátko v předsíni',
    desc: 'Vyber {cards|plural:kartu,karty,karet}: levá převezme hodnotu pravé (barva, vylepšení, pečeť i edice levé zůstanou).',
    flavor: 'Zrcadlo, zrcadlo, kdo je v ruce nejvyšší?',
  },
  risen_dough: {
    name: 'Kynuté těsto',
    desc: 'Hodnota až {cards} vybraných karet stoupne o {ranks} (z desítky je kluk, eso zůstane esem).',
    flavor: 'Nechat v teple a nekoukat.',
  },

  // ── ničení a kopie ──
  spring_cleaning: {
    name: 'Generální úklid',
    desc: 'Zničí až {cards|plural:vybranou kartu,vybrané karty,vybraných karet} a za každou dá +{money|money}.',
    flavor: 'Co tři roky nepoužiješ, vyhodíš.',
  },
  apple_tree: {
    name: 'Jablko od stromu',
    desc: 'Do balíčku i do ruky přidá kopii vybrané karty – s vylepšením, pečetí i bonusovými čipy, ale bez edice.',
    flavor: 'Jablko nepadá daleko od stromu.',
  },
  nettle_tea: {
    name: 'Kopřivový odvar',
    desc: 'Vyber {cards|plural:kartu,karty,karet}: levá se zničí a pravá od ní trvale převezme její čipy jako bonusové.',
    flavor: 'Pálí, ale čistí krev.',
  },

  // ── peníze a tvorba spotřebek ──
  under_mattress: {
    name: 'Pod slamníkem',
    desc: 'Přidá {pct} % tvých peněz (zaokrouhleno dolů), nejvýš {max|money}; při nule nebo dluhu nic.',
    flavor: 'Banky padají, slamník nikdy.',
  },
  tree_frog: {
    name: 'Rosnička',
    desc: 'Vytvoří pranostiku tvé nejčastěji hrané kombinace (při shodě silnější, bez zahraných rukou Vysoká karta) a k ní {random} náhodnou; potřebuje volný slot.',
    flavor: 'Když leze nahoru, bude hezky.',
  },
  grandmas_recipe: {
    name: 'Babiččin recept',
    desc: 'Vytvoří kopii naposledy použité spotřebky, pokud to byla babská rada nebo pranostika (sebe ani razítko nezopakuje); potřebuje volný slot.',
    flavor: 'Přesně podle receptu. Od oka.',
  },

  // ── žolíci ──
  knock_on_wood: {
    name: 'Zaklepat na dřevo',
    desc: '{chance} z {odds}: náhodný z tvých žolíků bez edice se stane lesklým, nebo holografickým (napůl); jinak dostaneš +{money|money} útěchou.',
    flavor: 'Ťuk, ťuk, ťuk. Hlavně to nezakřiknout.',
  },
  cauldron: {
    name: 'Kouzelný kotlík',
    desc: 'Promění žolíka nejvíc vlevo v náhodného jiného žolíka stejné vzácnosti; edice i nálepka zůstanou (legendárního ani přibitého nepromění).',
    flavor: 'Zamíchat, zaklít, neochutnávat.',
  },

  // ── kolo ──
  cold_compress: {
    name: 'Studený obklad',
    desc: 'Jen v kole: +{discards} zahození v tomto kole.',
    flavor: 'Na bouli i na kocovinu.',
  },
  garlic: {
    name: 'Česnek na krk',
    desc: 'Jen v kole: vrátí do provozu až {cards|plural:vybranou kartu,vybrané karty,vybraných karet} a otočí je lícem nahoru; šéf je do konce kola znovu nevyřadí.',
    flavor: 'Na upíry i na šéfy.',
  },
} satisfies TextTree;
