/**
 * Modal „Hra je otevřená v jiné kartě“ (src/ui/tabGuard.ts): když hru převezme jiná karta prohlížeče, tahle se
 * zablokuje nezavíratelným dialogem (zbytek stránky je `inert`, klávesy se nešíří). „Hrát tady“ hru převezme zpět
 * a znovu načte profil i run z úložiště (`App.reloadFromStorage`) — druhá karta se zablokuje stejně.
 */
import { t } from '../i18n/cs';
import type { App } from './app';
import type { ModalHandle } from './components/modal';
import { closeAllModals, openModal } from './components/modal';
import { h } from './dom';
import type { TabGuard } from './tabGuard';

export function installTabLock(app: App, guard: TabGuard): () => void {
  let modal: ModalHandle<'take'> | null = null;

  const show = (): void => {
    if (modal?.isOpen) return;
    // Rozběhnutá animace (skórování) doběhne hned — karta stejně nesmí nic uložit.
    app.anim.skip();
    modal = openModal<'take'>({
      title: t('app.tabLock.title'),
      dismissible: false,
      size: 'small',
      className: 'modal--tab-lock',
      testId: 'tab-lock',
      body: h(
        'div',
        { class: 'tab-lock' },
        h('p', null, t('app.tabLock.message')),
        h('p', { class: 'tab-lock__hint' }, t('app.tabLock.hint')),
      ),
      actions: [
        {
          label: t('app.tabLock.takeOver'),
          value: 'take',
          variant: 'primary',
          testId: 'tab-lock-take',
          autofocus: true,
        },
      ],
    });
    void modal.closed.then((choice) => {
      modal = null;
      if (choice !== 'take') return;
      guard.claim();
      // Dialogy staré obrazovky (pauza, detail žolíka…) patří stavu, který už neplatí.
      closeAllModals();
      app.reloadFromStorage();
    });
  };

  const offChange = guard.onChange((active) => {
    if (!active) show();
  });
  // Souběh: jiná karta zapsala, i když hraje tahle — aktivní karta uloží svůj stav znovu (má přednost).
  const offForeign = guard.onForeignWrite(() => {
    if (app.controller && app.controller.state.phase !== 'game_over') app.controller.save();
    app.profiles.save();
  });
  if (!guard.active) show();
  return () => {
    offChange();
    offForeign();
  };
}
