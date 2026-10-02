/**
 * Texty: Pranostiky (zvyšují úroveň kombinací) — klíče `consumables.<id>.name|desc|flavor`.
 * Definice v src/content/pranostiky.ts; `{levels}`, `{chips}`, `{mult}` dosadí UI z `params`
 * (přírůstek za úroveň z tabulky kombinací). Názvy a flavory podle docs/DESIGN.md kap. 5.2.
 */
import type { TextTree } from '../cs';

/** Společný konec popisku: přírůstek za úroveň. */
const PER_LEVEL =
  '+{levels|plural:úroveň,úrovně,úrovní} (+{chips|plural:čip,čipy,čipů} a +{mult} mult za úroveň).';

export const pranostiky = {
  hen_step: {
    name: 'Slepičí krok',
    desc: `Vysoká karta ${PER_LEVEL}`,
    flavor: 'Na Nový rok o slepičí krok. A o kartu výš.',
  },
  philip_jacob: {
    name: 'Filip a Jakub',
    desc: `Dvojice ${PER_LEVEL}`,
    flavor: 'Na Filipa a Jakuba se pálí čarodějnice. Ve dvou to jde líp.',
  },
  snakes_scorpions: {
    name: 'Hadi a štíři',
    desc: `Dvě dvojice ${PER_LEVEL}`,
    flavor: 'Na svatého Jiří lezou hadi a štíři. Po párech.',
  },
  three_kings: {
    name: 'Tři králové',
    desc: `Trojice ${PER_LEVEL}`,
    flavor: 'Na Tři krále o krok dále.',
  },
  saint_anne: {
    name: 'Svatá Anna',
    desc: `Postupka ${PER_LEVEL}`,
    flavor: 'Svatá Anna, chladna zrána – a karty pěkně za sebou.',
  },
  medard_drop: {
    name: 'Medardova kápě',
    desc: `Barva ${PER_LEVEL}`,
    flavor: 'Medard kápne a čtyřicet dní je všechno jedné barvy.',
  },
  martin_horse: {
    name: 'Martin na koni',
    desc: `Full house ${PER_LEVEL}`,
    flavor: 'Martin přijel na bílém koni a chalupa je plná.',
  },
  ice_saints: {
    name: 'Ledoví muži',
    desc: `Čtveřice ${PER_LEVEL}`,
    flavor: 'Pankrác, Servác, Bonifác – a Žofie, aby jich byla čtveřice.',
  },
  march_april_may: {
    name: 'Březen, duben, máj',
    desc: `Postupka v barvě ${PER_LEVEL}`,
    flavor: 'Březen, za kamna vlezem; duben, ještě tam budem; máj – postupka v barvě.',
  },
  saint_wenceslas: {
    name: 'Svatý Václav',
    desc: `Královská postupka ${PER_LEVEL}`,
    flavor: 'Na svatého Václava sklizeň bývá hotová. I ta královská.',
  },
  candlemas: {
    name: 'Na Hromnice',
    desc: `Pětice ${PER_LEVEL}`,
    flavor: 'Na Hromnice o hodinu více. A o kartu taky.',
  },
  catherine_ice: {
    name: 'Kateřina na ledě',
    desc: `Barevný full house ${PER_LEVEL}`,
    flavor: 'Kateřina na ledě, Vánoce na blátě, plný dům v jedné barvě.',
  },
  lucy_night: {
    name: 'Lucie noci upije',
    desc: `Barevná pětice ${PER_LEVEL}`,
    flavor: 'Nejdelší noc v roce. Dost času poskládat pět stejných.',
  },
} satisfies TextTree;
