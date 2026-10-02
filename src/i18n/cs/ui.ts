/**
 * Texty obrazovek mimo hru: společné popisky, hlavní menu, nová hra, nastavení, titulky.
 * Hráči tykáme. Typografii (NBSP, uvozovky) doplní `t()`, čísla dosazuj přes `{param}`.
 * Vlastní jména (autoři ikon, písma, nástroje) nejsou texty k překladu — drží je UI jako data.
 */

/** Společné popisky tlačítek a ovládacích prvků. */
export const common = {
  back: 'Zpět',
  backToMenu: 'Zpět do menu',
  confirm: 'Potvrdit',
  cancel: 'Zrušit',
  close: 'Zavřít',
  yes: 'Ano',
  no: 'Ne',
  ok: 'Rozumím',
  on: 'Zapnuto',
  off: 'Vypnuto',
  loading: 'Chvilku strpení, hostinský hledá klíče…',
  notifications: 'Oznámení',
  dismiss: 'Zavřít oznámení',
  /** Stejné oznámení vícekrát po sobě — počet na štítku místo dalšího oznámení. */
  repeated: '×{n}',
  /** Dočasná herní obrazovka, než ji nahradí plnohodnotná. */
  placeholder: {
    game: 'Stůl se teprve staví. Rozehraný run čeká ve fázi „{phase}“.',
    gallery: 'Galerie obrázků se teprve maluje.',
  },
};

/** Hlavní menu. */
export const menu = {
  label: 'Hlavní menu',
  newGame: { label: 'Nová hra', hint: 'Zamíchat, rozdat a jde se na to.' },
  continue: {
    label: 'Pokračovat',
    hint: 'Dohraj rozehranou hru. Karty ještě nevychladly.',
    none: 'Nemáš rozehranou hru. Tak hurá do nové!',
    failed: 'Rozehranou hru se nepodařilo načíst. Asi ji někdo polil pivem.',
  },
  challenges: {
    label: 'Výzvy',
    hint: 'Runy se zvláštními pravidly. Pro ty, kterým normální hra nestačí.',
    /** Cedulka s počtem nově odemčených výzev. */
    badge: '{n}',
    labelNew: 'Výzvy – {n|plural:nová výzva,nové výzvy,nových výzev}',
  },
  daily: {
    label: 'Denní run',
    hint: 'Stejné karty pro celou republiku. Kdo prohraje, platí rundu.',
    /** Cedulka, dokud čeká dnešní oficiální pokus. Přístupné názvy s cedulkou ji obsahují (WCAG 2.5.3). */
    badge: 'Dnes',
    labelOpen: 'Denní run – Dnes (oficiální pokus ještě čeká)',
  },
  collection: {
    label: 'Sbírka',
    hint: 'Všichni žolíci, šéfové a pranostiky, které ti prošly rukama.',
    /** Cedulka s počtem novinek (štítek „Nové“). */
    badge: '{n}',
    labelNew: 'Sbírka – {n|plural:novinka,novinky,novinek}',
  },
  stats: { label: 'Statistiky', hint: 'Čísla, kterými se můžeš chlubit. Nebo je radši nikomu neukazuj.' },
  settings: { label: 'Nastavení', hint: 'Hlasitost, rychlost a další šroubky.' },
  credits: { label: 'Titulky', hint: 'Kdo za to všechno může a odkud jsou ikony.' },
  comingSoon: 'Už brzy – ve fázi {phase}',
  comingSoonBadge: 'Už brzy',
  tipNext: 'Další rada od Štamgasta',
};

/** Obrazovka nové hry: balíček, síla piva, seed. */
export const newGame = {
  title: 'Nová hra',
  subtitle: 'Vyber balíček, sílu piva a klidně i seed. Pak už se jen rozdává.',
  deck: {
    title: 'Balíček',
    label: 'Výběr balíčku',
    count: '{n|plural:balíček,balíčky,balíčků}',
    /** Počet odemčených z celkového počtu. */
    unlockedCount: 'odemčeno {n} z {total}',
    locked: 'Zamčeno',
    lockedLabel: '{name}, zamčeno',
    condition: 'Jak odemknout: {text}',
    progress: '({progress})',
    /** Tácek s nejsilnější silou piva, na které hráč s balíčkem vyhrál (DESIGN 9). */
    coaster: '{level}°',
    coasterLabel: 'Nejsilnější výhra: {stake}',
  },
  stake: {
    title: 'Síla piva',
    label: 'Výběr síly piva',
    level: 'Úroveň {level}',
    optionLabel: '{name}, úroveň {level}',
    heading: '{name} · úroveň {level}',
    coaster: '{level}°',
    rules: 'Co na tomhle stole platí',
    newRule: 'nově',
    lockedLabel: '{name}, úroveň {level}, zamčeno',
    locked: 'Zamčeno',
    lockedHint: 'Síla piva {stake} je pro balíček {deck} zatím zamčená. {condition}',
    challengeNote: 'Výzvy a denní run mají sílu piva danou předem.',
  },
  seed: {
    title: 'Seed',
    label: 'Seed runu',
    placeholder: 'prázdné = náhodný',
    random: 'Náhodný',
    randomLabel: 'Vylosovat náhodný seed',
    hint: 'Stejný seed rozdá stejné karty. Pošli ho kamarádovi a porovnejte, kdo to pokazil víc.',
    /** Run se zadaným seedem (DESIGN 11.6). */
    seededNote:
      'Run se zadaným seedem se nepočítá do odemykání, statistik ani achievementů – jen do historie. Zato se hraje s celým obsahem, přesně jako u kamaráda.',
    dailyNote:
      'Denní run z {date} mimo soutěž: balíček {deck} a sílu piva {stake} určuje seed. Do statistik se nepočítá.',
    errors: {
      invalidChars: 'Seed smí mít jen písmena a číslice bez I, O, 0 a 1 – ať se nepletou.',
      tooShort: 'Seed je moc krátký – potřebuje přesně {n|plural:znak,znaky,znaků}.',
      tooLong: 'Seed je moc dlouhý – stačí přesně {n|plural:znak,znaky,znaků}.',
      invalidDate: 'Takový den v kalendáři nenajdeš. Denní seed má tvar DEN-RRRRMMDD.',
      reserved: 'Tenhle tvar si hra nechává pro sebe. Zadej {n|plural:znak,znaky,znaků}, nebo DEN-RRRRMMDD.',
    },
  },
  start: 'Rozdat karty',
  overwrite: {
    title: 'Zahodit rozehranou hru?',
    message: 'Máš rozehraný run. Nová hra ho přepíše – a karty už se nevrátí.',
    confirm: 'Rozdat nové',
  },
  failed: 'Hru se nepodařilo založit. Karty se rozsypaly pod stůl.',
};

/** Nastavení (docs/DESIGN.md 13.4). */
export const settings = {
  title: 'Nastavení',
  subtitle: 'Šroubky, páčky a knoflíky. Na nic jiného nesahej.',
  sections: {
    sound: 'Zvuk',
    game: 'Hra',
    display: 'Zobrazení',
    keys: 'Klávesové zkratky',
    save: 'Uložení a profil',
  },
  sfxVolume: 'Hlasitost efektů',
  musicVolume: 'Hlasitost hudby',
  volumeHint: 'V menu hraje valčík, u stolu polka. Když přijde šéf, kapela přidá do kroku.',
  mute: 'Ztlumit všechno',
  muteHint:
    'Klávesa M ztlumí nebo zase pustí zvuk kdykoli – i uprostřed kola. Hlasitosti zůstanou, jak jsou.',
  muteOn: 'Zvuk vypnutý. Ticho jako v čítárně. Klávesa M ho zase pustí.',
  muteOff: 'Zvuk zapnutý. Kapela zase hraje.',
  percent: '{value} %',
  speed: 'Rychlost hry',
  speedValue: '{value}×',
  animations: 'Animace',
  animationsHint: 'Bez animací je hra rychlejší, ale míň parádní.',
  screenShake: 'Třesení obrazovky',
  screenShakeHint: 'Při velkém skóre se zatřese stůl. Pivo drž pevně.',
  fullscreen: 'Celá obrazovka',
  fullscreenHint: 'Nic než stůl a karty.',
  fullscreenUnsupported: 'Tenhle prohlížeč celou obrazovku neumí.',
  fullscreenFailed: 'Celou obrazovku se nepodařilo zapnout. Prohlížeč řekl ne.',
  colorblind: 'Barvoslepý režim',
  colorblindHint: 'Čtyřbarevný balíček: piky černé, srdce červená, káry modré, kříže zelené.',
  uiScale: 'Velikost rozhraní',
  tutorial: 'Rady Štamgasta',
  tutorialHint: 'Štamgast tě provede prvním runem. Jde vypnout a kdykoli zase zapnout.',
  tutorialRestart: 'Zapnout tutoriál znovu',
  tutorialRestartHint: 'Štamgast začne od první rady – i když už to všechno jednou zaznělo.',
  tutorialRestarted: 'Štamgast je zpátky u stolu. Rady se ukážou ve hře.',
  keys: {
    key: 'Klávesa',
    action: 'Co udělá',
    items: {
      select: { key: '1–8', action: 'Vybrat nebo odznačit kartu na dané pozici v ruce' },
      play: { key: 'Enter', action: 'Zahrát vybrané karty' },
      discard: { key: 'X', action: 'Zahodit vybrané karty' },
      sort: { key: 'S / B', action: 'Seřadit ruku podle hodnoty / podle barvy' },
      move: {
        key: 'Shift + ← / →',
        action: 'Posunout vybranou kartu v ruce doleva / doprava (myší nebo prstem ji přetáhneš)',
      },
      skip: { key: 'Mezerník', action: 'Přeskočit běžící animaci' },
      mute: { key: 'M', action: 'Ztlumit nebo zase pustit zvuk (kdekoli ve hře)' },
      menu: { key: 'Esc', action: 'Menu nebo zavřít dialog' },
      focus: { key: 'Tab', action: 'Přejít na další tlačítko' },
    },
  },
  export: {
    label: 'Exportovat uložení',
    hint: 'Stáhne soubor JSON s profilem, nastavením a rozehranou hrou.',
    done: 'Uložení staženo. Schovej ho líp než účtenky.',
    filename: 'karban-ulozeni-{date}.json',
  },
  import: {
    label: 'Importovat uložení',
    hint: 'Nahraje dřív exportovaný soubor. Současné uložení se přepíše.',
    fileLabel: 'Soubor s uložením',
    done: 'Uložení nahráno. Vítej zpátky u stolu.',
    confirmTitle: 'Přepsat současné uložení?',
    confirmMessage:
      'Import nahradí tvůj profil, nastavení i rozehranou hru tím, co je v souboru. Současný profil předtím schováme do zálohy.',
    confirm: 'Nahrát',
    /** Co je v souboru (věta před potvrzením importu). */
    summary: {
      text: 'V souboru: {items}.',
      profile:
        'profil ({runs|plural:odehraný run,odehrané runy,odehraných runů}, {achievements|plural:achievement,achievementy,achievementů})',
      profileShort: 'profil',
      run: 'rozehraná hra ({deck}, patro {ante})',
      runShort: 'rozehraná hra',
      settingsOnly: 'jen nastavení',
    },
    errors: {
      invalidJson: 'Tohle není JSON. Spíš nákupní seznam.',
      invalidFormat: 'Soubor nevypadá jako uložení Karbanu. Spíš jako recept na guláš.',
      wrongKind: 'Tohle uložení neobsahuje rozehranou hru ani profil.',
      tooNew: 'Uložení je z novější verze hry. Nejdřív aktualizuj, pak nahrávej.',
      migrationFailed: 'Staré uložení se nepodařilo převést na novou verzi. Pamatuje ještě korunové pivo.',
      unknownContent: 'Uložení počítá s balíčkem nebo silou piva, které tu nečepujeme.',
      readFailed: 'Soubor se nepodařilo přečíst. Písmo jako od doktora.',
      backupFailed:
        'Současný profil se nepodařilo zazálohovat (prohlížeč asi nemá místo), tak jsme nic nepřepsali. Nejdřív si udělej export uložení.',
    },
  },
  reset: {
    label: 'Smazat profil',
    hint: 'Začneš od nuly: profil, nastavení i rozehraná hra zmizí. Profil předtím schováme do zálohy v prohlížeči – dostaneš se k ní přes export uložení.',
    confirm1Title: 'Smazat profil?',
    confirm1Message:
      'Přijdeš o statistiky, odemčené věci, achievementy i rozehraný run. Profil pro jistotu schováme do zálohy.',
    confirm1: 'Smazat',
    confirm2Title: 'Fakt jako fakt?',
    confirm2Message:
      'Ve hře už ho nevrátí ani Teta z poradny – záloha zůstane jen v exportu uložení. Opravdu začít od nuly?',
    confirm2: 'Ano, začít od nuly',
    done: 'Profil smazán, záloha schovaná. Čistý stůl, čistá hlava.',
    backupFailed:
      'Profil se nepodařilo zazálohovat (prohlížeč asi nemá místo), tak zůstává, jak byl. Nejdřív si udělej export uložení.',
  },
};

/** Titulky. */
export const credits = {
  title: 'Titulky',
  rollLabel: 'Titulky hry Karban',
  pause: 'Zastavit titulky',
  resume: 'Pustit titulky',
  game: {
    title: 'Hra',
    made: 'Námět, pravidla, kód, texty a obrázky',
    authors: 'Autoři projektu Karban',
  },
  tools: {
    title: 'Nástroje',
    text: 'Postaveno v prohlížeči bez frameworku, s poctivým TypeScriptem. Pomáhali:',
  },
  font: {
    title: 'Písmo',
    license: 'Licence SIL Open Font License 1.1',
    digits:
      'Číslice a písmeno Z jsme podle něj překreslili, aby se pětka nepletla s písmenem S a zet s dvojkou. I upravené písmo je pod OFL 1.1.',
  },
  icons: {
    title: 'Ikony',
    text: 'Ikony pocházejí z game-icons.net a jsou pod licencí CC BY 3.0. Přebarvili jsme je a poskládali do obrázků karet.',
    authors: 'Autoři ikon',
    count: '{n|plural:ikona,ikony,ikon}',
  },
  sound: {
    title: 'Zvuk',
    text: 'Zvuky i hudba se syntetizují přímo v prohlížeči. Žádný mikrofon nebyl zneužit.',
  },
  inspiration: {
    title: 'Inspirace',
    text: 'Inspirováno hrou Balatro. Mechaniky jsme obdivovali, texty, obrázky i čísla jsme si vymysleli sami.',
  },
  thanks: {
    title: 'Poděkování',
    items: [
      'Paní hostinské za trpělivost a za to, že nezhasla dřív.',
      'Štamgastům za rady, o které nikdo nežádal.',
      'Sousedovi s vrtačkou za rytmus při ladění animací.',
      'Babičce za pranostiky. Všechny se vyplnily, jen jinak.',
      'Panu starostovi, že tu hru zatím nezakázal.',
      'Tobě, že čteš titulky až do konce. Teď už fakt běž hrát.',
    ],
  },
  end: 'Zavíračka! Kdo tu ještě sedí, platí rundu.',
};
