/**
 * Společný start runu z meta obrazovek (výzvy, denní run): potvrzení, že se přepíše rozehraná hra, založení runu
 * přes profil (`app.profiles.newRun` — pool obsahu podle druhu runu, zápis do profilu) a přechod na hru.
 */
import { t } from '../i18n/cs';
import type { App } from './app';
import { confirmModal } from './components/modal';
import { toast } from './components/toast';
import { GameController } from './controller';
import type { NewRunRequest } from './profile';

/** Je rozehraný run (v paměti, nebo v úložišti), který by nový run přepsal? */
export function runInProgress(app: App): boolean {
  if (app.controller && app.controller.state.phase !== 'game_over') return true;
  return GameController.hasSavedRun(app.store);
}

/** Zeptá se, jestli zahodit rozehraný run (bez rozehraného runu rovnou true). */
export async function confirmOverwrite(app: App): Promise<boolean> {
  if (!runInProgress(app)) return true;
  return confirmModal({
    title: t('newGame.overwrite.title'),
    message: t('newGame.overwrite.message'),
    confirmLabel: t('newGame.overwrite.confirm'),
    danger: true,
    testId: 'overwrite-confirm',
  });
}

/**
 * Založí run (po potvrzení přepsání rozehraného) a přejde na hru. Chybu oznámí hláškou `failedKey`.
 * Vrací true, když se run založil.
 */
export async function startRunFlow(app: App, req: NewRunRequest, failedKey: string): Promise<boolean> {
  if (!(await confirmOverwrite(app))) return false;
  try {
    app.controller = app.profiles.newRun(req);
  } catch (err) {
    console.error('[run] Nepodařilo se založit run', err);
    toast(t(failedKey), { kind: 'error' });
    return false;
  }
  app.go('game');
  return true;
}
