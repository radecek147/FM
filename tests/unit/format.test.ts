import { describe, expect, it } from 'vitest';
import {
  MINUS,
  NBSP,
  formatChips,
  formatFrom,
  formatMoney,
  formatMult,
  formatNumber,
  formatSigned,
  formatXMult,
  interpolate,
  plural,
  pluralize,
  typo,
  vocalizesZ,
} from '../../src/i18n/format';

const KARTA = ['karta', 'karty', 'karet'] as const;

describe('plural', () => {
  it.each([
    [0, 'karet'],
    [1, 'karta'],
    [2, 'karty'],
    [4, 'karty'],
    [5, 'karet'],
    [11, 'karet'],
    [21, 'karet'],
    [22, 'karet'],
    [100, 'karet'],
    [-1, 'karta'],
    [-3, 'karty'],
    [1.5, 'karet'],
    [Number.NaN, 'karet'],
    [Infinity, 'karet'],
  ])('plural(%s) → %s', (n, expected) => {
    expect(plural(n, ...KARTA)).toBe(expected);
  });

  it('pluralize spojí číslo a slovo nezlomitelnou mezerou', () => {
    expect(pluralize(1, KARTA)).toBe(`1${NBSP}karta`);
    expect(pluralize(3, KARTA)).toBe(`3${NBSP}karty`);
    expect(pluralize(5, KARTA)).toBe(`5${NBSP}karet`);
    expect(pluralize(1500, KARTA)).toBe(`1${NBSP}500${NBSP}karet`);
    expect(pluralize(-1, ['ruka', 'ruce', 'rukou'])).toBe(`${MINUS}1${NBSP}ruka`);
  });
});

describe('formatNumber', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, `1${NBSP}000`],
    [12345, `12${NBSP}345`],
    [1340000, `1${NBSP}340${NBSP}000`],
    [-5, `${MINUS}5`],
    [-1234567, `${MINUS}1${NBSP}234${NBSP}567`],
    [1.5, '1,5'],
    [393.75, '393,75'],
    [2.05, '2,05'],
    [1.999, '2'],
    [0.1 + 0.2, '0,3'],
    [1234.5, `1${NBSP}234,5`],
    [-0.001, '0'],
    [-0, '0'],
    [999_999_999_999_999, `999${NBSP}999${NBSP}999${NBSP}999${NBSP}999`],
    [1e15, '1e15'],
    [1.234e16, '1,23e16'],
    [1.2e20, '1,2e20'],
    [-1.234e16, `${MINUS}1,23e16`],
    [Infinity, '∞'],
    [-Infinity, `${MINUS}∞`],
    // Přetečení v nekonečném režimu: engine použije Number.MAX_VALUE, UI ukáže „nekonečno“ (DESIGN 1.3).
    [Number.MAX_VALUE, '∞'],
    [-Number.MAX_VALUE, `${MINUS}∞`],
    [1.7e308, '1,7e308'],
    [Number.NaN, '0'],
  ])('formatNumber(%s) → %j', (n, expected) => {
    expect(formatNumber(n)).toBe(expected);
  });

  it('nepoužívá obyčejnou mezeru ani desetinnou tečku', () => {
    for (const n of [1000, 1340000, 1.5, 12345.67]) {
      expect(formatNumber(n)).not.toMatch(/[ .]/);
    }
  });
});

describe('formátování herních hodnot', () => {
  it('formatXMult', () => {
    expect(formatXMult(1.5)).toBe('×1,5');
    expect(formatXMult(2)).toBe('×2');
    expect(formatXMult(1.25)).toBe('×1,25');
    expect(formatXMult(3000)).toBe(`×3${NBSP}000`);
  });

  it('formatMoney', () => {
    expect(formatMoney(5)).toBe(`5${NBSP}Kč`);
    expect(formatMoney(-3)).toBe(`${MINUS}3${NBSP}Kč`);
    expect(formatMoney(0)).toBe(`0${NBSP}Kč`);
    expect(formatMoney(1250)).toBe(`1${NBSP}250${NBSP}Kč`);
    expect(formatMoney(2.5)).toBe(`2,5${NBSP}Kč`);
  });

  it('formatSigned, formatMult, formatChips', () => {
    expect(formatSigned(5)).toBe('+5');
    expect(formatSigned(-5)).toBe(`${MINUS}5`);
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(0.001)).toBe('0');
    expect(formatMult(4)).toBe('+4');
    expect(formatMult(1.5)).toBe('+1,5');
    expect(formatChips(30)).toBe('+30');
    expect(formatChips(1500)).toBe(`+1${NBSP}500`);
  });
});

describe('typo', () => {
  it('za jednopísmennými předložkami a spojkami dá NBSP', () => {
    expect(typo('Jdu k babičce a s dědou')).toBe(`Jdu k${NBSP}babičce a${NBSP}s${NBSP}dědou`);
    expect(typo('V lese i u rybníka')).toBe(`V${NBSP}lese i${NBSP}u${NBSP}rybníka`);
    expect(typo('Z hospody o půlnoci')).toBe(`Z${NBSP}hospody o${NBSP}půlnoci`);
    expect(typo('Karta v ruce')).toBe(`Karta v${NBSP}ruce`);
  });

  it('nemění písmena uvnitř nebo na konci slov', () => {
    expect(typo('Pivo je zlato')).toBe('Pivo je zlato');
    expect(typo('Hraje se o')).toBe('Hraje se o');
    expect(typo('Vysoká karta')).toBe('Vysoká karta');
  });

  it('spojí číslo s následujícím slovem nebo jednotkou', () => {
    expect(typo('Máš 5 Kč a 3 karty')).toBe(`Máš 5${NBSP}Kč a${NBSP}3${NBSP}karty`);
    expect(typo('Sleva 10 %')).toBe(`Sleva 10${NBSP}%`);
  });

  it('trojtečka a české uvozovky', () => {
    expect(typo('Míchám karty...')).toBe('Míchám karty…');
    expect(typo('Řekl "ahoj" a šel')).toBe(`Řekl „ahoj“ a${NBSP}šel`);
    expect(typo('"a teď" ne')).toBe(`„a${NBSP}teď“ ne`);
  });

  it('nezlomitelná mezera před větnou pomlčkou, rozsahy beze změny', () => {
    expect(typo('Šéfa ne – ten si tě najde sám.')).toBe(`Šéfa ne${NBSP}– ten si tě najde sám.`);
    expect(typo('Po–St 8–11')).toBe('Po–St 8–11');
  });

  it('je idempotentní', () => {
    const s = 'Hospodský roguelike se žolíky... "a v lese" 5 Kč – a dost';
    expect(typo(typo(s))).toBe(typo(s));
  });
});

describe('interpolate', () => {
  it('dosadí parametry a čísla formátuje česky', () => {
    expect(interpolate('Dosáhni aspoň {target} bodů', { target: 1340000 })).toBe(
      `Dosáhni aspoň 1${NBSP}340${NBSP}000 bodů`,
    );
    expect(interpolate('×{xmult} mult', { xmult: 1.5 })).toBe('×1,5 mult');
    expect(interpolate('Ahoj, {name}!', { name: 'Venco' })).toBe('Ahoj, Venco!');
  });

  it('plural filtr', () => {
    const tpl = 'Zbývá {n|plural:karta,karty,karet}';
    expect(interpolate(tpl, { n: 1 })).toBe(`Zbývá 1${NBSP}karta`);
    expect(interpolate(tpl, { n: 3 })).toBe(`Zbývá 3${NBSP}karty`);
    expect(interpolate(tpl, { n: 0 })).toBe(`Zbývá 0${NBSP}karet`);
    expect(interpolate(tpl, { n: 22 })).toBe(`Zbývá 22${NBSP}karet`);
    expect(interpolate(tpl, { n: '4' })).toBe(`Zbývá 4${NBSP}karty`);
  });

  it('další filtry: word, money, signed, x, raw', () => {
    expect(interpolate('{n} {n|word:ruka,ruce,rukou}', { n: 2 })).toBe('2 ruce');
    expect(interpolate('{m|money}', { m: -3 })).toBe(`${MINUS}3${NBSP}Kč`);
    expect(interpolate('{v|signed} mult', { v: 4 })).toBe('+4 mult');
    expect(interpolate('{v|x} mult', { v: 2.5 })).toBe('×2,5 mult');
    expect(interpolate('{v|raw}', { v: 1.5 })).toBe('1.5');
  });

  it('chybějící parametr nechá zástupný symbol', () => {
    expect(interpolate('Cíl {target}', {})).toBe('Cíl {target}');
    expect(interpolate('Cíl {target}')).toBe('Cíl {target}');
    expect(interpolate('{toString}', {})).toBe('{toString}');
  });
});

describe('předložka z / ze před číslem', () => {
  it('vokalizuje podle prvního čteného slova', () => {
    const ze = [2, 3, 4, 6, 7, 12, 13, 14, 16, 17, 20, 34, 47, 62, 78, 100, 101, 150, 200, 700, 2000, 100000];
    const z = [0, 1, 5, 8, 9, 10, 11, 15, 18, 19, 52, 85, 96, 500, 1000, 1500, 5000, 1.5, -2];
    for (const n of ze) expect(vocalizesZ(n), String(n)).toBe(true);
    for (const n of z) expect(vocalizesZ(n), String(n)).toBe(false);
  });

  it('formatFrom a filtr z', () => {
    expect(formatFrom(2)).toBe(`ze${NBSP}2`);
    expect(formatFrom(5)).toBe(`z${NBSP}5`);
    expect(interpolate('{chance} {odds|z}', { chance: 1, odds: 3 })).toBe(`1 ze${NBSP}3`);
    expect(interpolate('{n} {total|z}', { n: 12, total: 52 })).toBe(`12 z${NBSP}52`);
    expect(interpolate('{n} {total|z}', { n: 12, total: 78 })).toBe(`12 ze${NBSP}78`);
  });
});
