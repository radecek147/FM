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
  challenges: { label: 'Výzvy', hint: 'Runy se zvláštními pravidly. Pro ty, kterým normální hra nestačí.' },
  daily: { label: 'Denní run', hint: 'Stejné karty pro celou republiku. Kdo prohraje, platí rundu.' },
  collection: { label: 'Sbírka', hint: 'Všichni žolíci, šéfové a pranostiky, které ti prošly rukama.' },
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
  },
  seed: {
    title: 'Seed',
    label: 'Seed runu',
    placeholder: 'prázdné = náhodný',
    random: 'Náhodný',
    randomLabel: 'Vylosovat náhodný seed',
    hint: 'Stejný seed rozdá stejné karty. Pošli ho kamarádovi a porovnejte, kdo to pokazil víc.',
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
  volumeHint: 'Zvuky a hudba přijdou ve fázi 9. Nastavení si ale pamatujeme už teď.',
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
  keys: {
    key: 'Klávesa',
    action: 'Co udělá',
    items: {
      select: { key: '1–8', action: 'Vybrat nebo odznačit kartu na dané pozici v ruce' },
      play: { key: 'Enter', action: 'Zahrát vybrané karty' },
      discard: { key: 'X', action: 'Zahodit vybrané karty' },
      sort: { key: 'S / B', action: 'Seřadit ruku podle hodnoty / podle barvy' },
      skip: { key: 'Mezerník', action: 'Přeskočit běžící animaci' },
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
    confirmMessage: 'Import nahradí tvůj profil, nastavení i rozehranou hru tím, co je v souboru.',
    confirm: 'Nahrát',
    errors: {
      invalidJson: 'Tohle není JSON. Spíš nákupní seznam.',
      invalidFormat: 'Soubor nevypadá jako uložení Karbanu.',
      wrongKind: 'Tohle uložení neobsahuje rozehranou hru ani profil.',
      tooNew: 'Uložení je z novější verze hry. Nejdřív aktualizuj, pak nahrávej.',
      migrationFailed: 'Staré uložení se nepodařilo převést na novou verzi.',
      unknownContent: 'Uložení počítá s balíčkem nebo silou piva, které tu nemáme.',
      readFailed: 'Soubor se nepodařilo přečíst.',
    },
  },
  reset: {
    label: 'Smazat profil',
    hint: 'Smaže profil, nastavení i rozehranou hru. Nevratně.',
    confirm1Title: 'Smazat profil?',
    confirm1Message: 'Přijdeš o všechno: statistiky, odemčené věci i rozehraný run.',
    confirm1: 'Smazat',
    confirm2Title: 'Fakt jako fakt?',
    confirm2Message: 'Tohle už nevrátí ani Teta z poradny. Opravdu smazat úplně všechno?',
    confirm2: 'Ano, smazat všechno',
    done: 'Profil smazán. Čistý stůl, čistá hlava.',
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
      'Číslice jsme podle něj překreslili, aby se pětka nepletla s písmenem S. I upravené písmo je pod OFL 1.1.',
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
