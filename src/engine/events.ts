/** Typovaný event bus. Engine emituje, UI a meta vrstva poslouchají. */
import type { GameEvent, GameEventType } from './types';

export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
type Listener<E> = (event: E) => void;

export class EventBus<E extends { type: string } = GameEvent> {
  private listeners = new Map<string, Set<Listener<E>>>();
  private anyListeners = new Set<Listener<E>>();

  on<T extends E['type']>(type: T, listener: Listener<Extract<E, { type: T }>>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<E>);
    return () => set.delete(listener as Listener<E>);
  }

  onAny(listener: Listener<E>): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  emit(event: E): void {
    const set = this.listeners.get(event.type);
    if (set) for (const l of [...set]) l(event);
    for (const l of [...this.anyListeners]) l(event);
  }

  clear(): void {
    this.listeners.clear();
    this.anyListeners.clear();
  }
}
