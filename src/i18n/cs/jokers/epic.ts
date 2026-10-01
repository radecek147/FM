/** Texty žolíků (epic): `jokers.<id>.name|desc|flavor`. */
import type { TextTree } from '../../cs';

export const jokersEpic = {
  snowman: {
    name: 'Sněhulák',
    desc: '{xmult|x} mult; po každém kole −{decay|x}, při {min|x} roztaje a zničí se (teď {current|x}).',
    flavor: 'Na jaře z něj zbude jen mrkev.',
    melted: 'Sněhulák roztál. Po něm jen mrkev a dva uhlíky.',
  },
  mushroom_picker: {
    name: 'Sběrač hub',
    desc: '{base|x} mult a navíc +{xmult|x} za každou hrací kartu zničenou od jeho koupě (teď {current|x}).',
    flavor: 'Rostou tam, kde něco zmizelo.',
  },
  impersonator: {
    name: 'Napodobitel',
    desc: 'Na začátku každého kola si náhodně vybere jiného tvého žolíka a do konce kola kopíruje jeho schopnost.',
    flavor: 'Umí každého, jen sebe ne.',
  },
  innkeeper: {
    name: 'Hostinský',
    desc: '{xmult|x} mult, dokud se v tomto kole nezahazovalo.',
    flavor: 'U mě se nic nevylévá.',
  },
  grandmas_chest: {
    name: 'Babiččina truhla',
    desc: '{xmult|x} mult za každou spotřebku, kterou držíš ve slotech.',
    flavor: 'Na půdě je všechno, co jednou bude k něčemu.',
  },
} satisfies TextTree;
