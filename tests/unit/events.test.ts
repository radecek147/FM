import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/engine/events';
import type { GameEvent } from '../../src/engine/types';

describe('EventBus', () => {
  it('on: posluchač dostane jen události svého typu', () => {
    const bus = new EventBus();
    const got: GameEvent[] = [];
    bus.on('shopEntered', (e) => got.push(e));
    bus.emit({ type: 'shopLeft' });
    bus.emit({ type: 'shopEntered' });
    expect(got).toEqual([{ type: 'shopEntered' }]);
  });

  it('posluchač dostane typovanou událost se všemi daty', () => {
    const bus = new EventBus();
    let money = 0;
    bus.on('moneyChanged', (e) => {
      money = e.money;
    });
    bus.emit({ type: 'moneyChanged', delta: 3, money: 7, reason: 'interest' });
    expect(money).toBe(7);
  });

  it('off: funkce vrácená z on() posluchače odhlásí', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.on('shopEntered', () => count++);
    bus.emit({ type: 'shopEntered' });
    off();
    bus.emit({ type: 'shopEntered' });
    off(); // opakované odhlášení nevadí
    expect(count).toBe(1);
  });

  it('onAny dostane všechny události a jde odhlásit', () => {
    const bus = new EventBus();
    const types: string[] = [];
    const off = bus.onAny((e) => types.push(e.type));
    bus.emit({ type: 'shopEntered' });
    bus.emit({ type: 'victory', ante: 8 });
    off();
    bus.emit({ type: 'shopLeft' });
    expect(types).toEqual(['shopEntered', 'victory']);
  });

  it('pořadí: typoví posluchači v pořadí registrace, pak onAny', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.onAny(() => order.push('any1'));
    bus.on('shopEntered', () => order.push('typed1'));
    bus.onAny(() => order.push('any2'));
    bus.on('shopEntered', () => order.push('typed2'));
    bus.emit({ type: 'shopEntered' });
    expect(order).toEqual(['typed1', 'typed2', 'any1', 'any2']);
  });

  it('události se doručují v pořadí emitování', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onAny((e) => seen.push(e.type));
    bus.emit({ type: 'runStarted', seed: 'X' });
    bus.emit({ type: 'anteChanged', ante: 1 });
    bus.emit({ type: 'shopEntered' });
    expect(seen).toEqual(['runStarted', 'anteChanged', 'shopEntered']);
  });

  it('odhlášení během emitu neovlivní právě probíhající doručení', () => {
    const bus = new EventBus();
    const log: string[] = [];
    let offY: () => void = () => {};
    bus.on('shopLeft', () => {
      log.push('x');
      offY(); // odhlásí „y“ uprostřed doručování
    });
    offY = bus.on('shopLeft', () => log.push('y'));
    bus.emit({ type: 'shopLeft' }); // y ještě dostane tuto událost (iteruje se nad kopií)
    bus.emit({ type: 'shopLeft' }); // tady už je odhlášený
    expect(log).toEqual(['x', 'y', 'x']);
  });

  it('clear odhlásí všechny posluchače', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on('shopEntered', () => count++);
    bus.onAny(() => count++);
    bus.clear();
    bus.emit({ type: 'shopEntered' });
    expect(count).toBe(0);
  });

  it('funguje i s vlastním typem událostí', () => {
    type Ev = { type: 'ping'; n: number } | { type: 'pong' };
    const bus = new EventBus<Ev>();
    let sum = 0;
    bus.on('ping', (e) => {
      sum += e.n;
    });
    bus.emit({ type: 'ping', n: 2 });
    bus.emit({ type: 'pong' });
    bus.emit({ type: 'ping', n: 3 });
    expect(sum).toBe(5);
  });
});
