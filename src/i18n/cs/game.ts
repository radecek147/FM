/**
 * Texty herní obrazovky (src/ui/screens/game/**, src/ui/present.ts): levý panel, řada žolíků a spotřebek,
 * ruka, stůl, výběr útraty, konec kola, Večerka, obálka, pitva, výhra, Info o runu, pauza a hlášky animací.
 * Klíče `game.*`. Hráči tykáme (rodově neutrálně), čísla dosazuj přes `{param}` — formátuje `format.ts`.
 */

/**
 * Hlášky pitvy podle příčiny (DESIGN příloha C); šéfové mají vlastní `bosses.<id>.death`. Malá a Velká útrata mají
 * víc variant — vybírá je `blindDeathQuote` (src/i18n/death.ts) deterministicky podle seedu runu. Sdílí je i `cli.ts`.
 */
export const DEATH_QUOTES = {
  small: [
    '„Na Malé útratě? To se stává. Málokomu.“',
    '„Malá útrata, velká ostuda. Hospodský už to píše do kroniky.“',
    '„Tohle měla být rozcvička. Rozcvička vyhrála.“',
    '„Štamgast u okna odložil noviny. Tohle si nenechá ujít ani příště.“',
    '„Pivo ještě ani nestihlo vychladnout.“',
    '„Malá útrata stála víc než celý večer. Účet, prosím.“',
    '„Takhle rychle se odchází jen z třídních schůzek.“',
    '„Ještě jedno kolo a domů. Tak teda rovnou domů.“',
  ],
  big: [
    '„Velká útrata, velké zklamání.“',
    '„Malou ještě ano, Velkou už ne. Jako polévka a řízek.“',
    '„Na Velké útratě se láme chleba. Dneska ten tvůj.“',
    '„Do šéfa chybělo jedno kolo. A jedna pořádná ruka.“',
    '„Účet byl moc velký. Peněženka plakala, štamgasti tleskali.“',
    '„Nejdražší pivo je to, které se nedopije.“',
    '„Tady končí legrace a začíná účtování.“',
    '„Větší sousto, než se dalo spolknout. Příště menší lžíci.“',
  ],
  /** Šéf bez vlastní hlášky (obsah ji zatím nemá). */
  boss: '„Šéf byl silnější. Tentokrát.“',
};

export const game = {
  label: 'Herní stůl',
  noGame: 'Žádná rozehraná hra. Stůl je uklizený a hostinský zívá.',

  /** Levý panel. */
  sidebar: {
    label: 'Přehled kola',
    phase: {
      round: 'Kolo běží',
      blind_select: 'Vyber útratu',
      shop: 'Večerka',
      booster: 'Otevřená obálka',
      round_end: 'Kolo vyhráno',
      game_over: 'Konec runu',
      victory: 'Výhra',
    },
    nextBoss: 'Na konci patra čeká: {name}',
    noRule: 'Bez zvláštního pravidla.',
    bossDisabled: 'Pravidlo šéfa dnes neplatí.',
    tags: 'Štítky',
    handBlocked: 'Neskóruje: {reason}',
    /** Pan starosta: laťka pro příští ruku a varování z odhadu náhledu. */
    scoreToBeat: 'Překonej: {score}',
    belowBeat: 'Odhad {estimate} nepřekoná {score} – nezapočítá se.',
    blindBeaten: 'Poraženo! Vyzvedni si odměnu.',
    bossBeaten: 'Šéf poražen! Vyzvedni si odměnu.',
    target: 'Dosáhni aspoň',
    targetNone: 'Cíl se ukáže po výběru útraty.',
    reward: 'Odměna {n|money}',
    noReward: 'Bez odměny',
    roundScore: 'Skóre kola',
    hand: 'Kombinace',
    handNone: 'Vyber karty',
    handHidden: 'Lícem dolů – překvapení',
    handNothing: 'Z toho nic nesložíš',
    level: 'úr. {level}',
    levelLabel: 'úroveň {level}',
    chips: 'Čipy',
    mult: 'Mult',
    times: '×',
    unknown: '?',
    hands: 'Ruce',
    discards: 'Zahození',
    money: 'Peníze',
    ante: 'Patro',
    anteValue: '{ante}/{final}',
    endless: 'nekonečný režim',
    round: 'Kolo',
    runInfo: 'Info o runu',
    settings: 'Nastavení',
    menu: 'Menu',
    menuLabel: 'Pauza a menu (Esc)',
  },

  /** Řada žolíků a spotřebek nahoře. */
  rows: {
    jokers: 'Žolíci',
    consumables: 'Spotřebky',
    count: '{n}/{max}',
    jokersLabel: 'Řada žolíků, {n} {max|z}',
    consumablesLabel: 'Spotřebky, {n} {max|z}',
    jokersEmpty: 'Žádní žolíci. Zatím.',
    consumablesEmpty: 'Prázdná kapsa.',
    dragHint: 'Pořadí žolíků změníš tažením nebo v detailu žolíka.',
  },

  /** Detail žolíka (klik v řadě). */
  joker: {
    sell: 'Prodat za {price|money}',
    cannotSell: 'Přibitého žolíka prodat nejde.',
    moveLeft: 'Posunout doleva',
    moveRight: 'Posunout doprava',
    position: 'Pozice {n} {max|z}',
    orderHint: 'Žolíci se vyhodnocují zleva doprava. +mult patří doleva, ×mult doprava.',
    sold: 'Prodáno za {price|money}. Večerka si nechala zbytek.',
  },

  /** Detail spotřebky (klik ve slotu). */
  consumable: {
    use: 'Použít',
    sell: 'Prodat za {price|money}',
    targetsExact: 'Vyber v ruce {n|plural:kartu,karty,karet} jako cíl.',
    targetsRange: 'Vyber v ruce {min} až {max|plural:kartu,karty,karet} jako cíle.',
    selected: 'Vybráno: {n|plural:karta,karty,karet}.',
    noTargets: 'Nepotřebuje žádné cíle.',
    cannotUse: 'Teď to použít nejde. Zkontroluj vybrané karty.',
    needsHand: 'Potřebuje cíle v ruce. Ruku máš v kole nebo v obálce babských rad či razítek – tady ne.',
    used: 'Použito: {name}.',
  },

  /** Ruka, stůl a balíček. */
  hand: {
    label: 'Tvoje ruka, {n|plural:karta,karty,karet}',
    empty: 'Ruka je prázdná. Jako peněženka po pouti.',
    play: 'Zahrát',
    discard: 'Zahodit',
    playLabel: 'Zahrát vybrané karty (Enter)',
    discardLabel: 'Zahodit vybrané karty (X)',
    sort: 'Seřadit',
    sortRank: 'Hodnota',
    sortSuit: 'Barva',
    sortRankLabel: 'Řadit ruku podle hodnoty (S)',
    sortSuitLabel: 'Řadit ruku podle barvy (B)',
    sortHint: 'Ruka zůstane seřazená i po dobrání dalších karet. Ruční přesun karty řazení vypne.',
    selected: 'Vybráno {n}/{max}',
    /** Krátká zpětná vazba u tlačítek (šestá karta, Enter / X bez výběru). */
    maxSelected: 'Vybrat jde nejvýš {max|plural:kartu,karty,karet}.',
    selectFirst: 'Nejdřív vyber karty – klávesy 1–8.',
    tableLabel: 'Stůl se zahranými kartami',
    tableHint: 'Vyber až {max|plural:kartu,karty,karet} a zahraj je. Klávesy 1–8 vybírají, Enter hraje.',
    tableHintTouch: 'Ťukni až na {max|plural:kartu,karty,karet} a zahraj je.',
    boosterHint: 'Vyber v ruce cíle pro babskou radu nebo razítko.',
    handSize: 'Ruka: {n|plural:karta,karty,karet}',
    handSizeDelta: 'Ruka: {n|plural:karta,karty,karet} ({delta|signed})',
    handSizeLabel: 'Velikost ruky – dobíráš do {n|plural:karty,karet,karet}.',
    handSizeDown: 'Ruka se zmenšila na {n|plural:kartu,karty,karet}.',
    handSizeUp: 'Ruka se zvětšila na {n|plural:kartu,karty,karet}.',
    handSizeDownBoss: '{name}: ruka se zmenšila na {n|plural:kartu,karty,karet}.',
    handSizeUpBoss: '{name}: ruka se zvětšila na {n|plural:kartu,karty,karet}.',
    reorderHint:
      'Kartu přesuneš tažením myší nebo prstem. Klávesnicí: vyber kartu a posuň ji Shift a šipkou doleva nebo doprava.',
    moved: '{name}: teď {n}. karta zleva {max|z}.',
    moveEdge: 'Dál to nejde, karta už je na kraji. Stůl nenatáhneš.',
  },

  deck: {
    title: 'Balíček',
    label: 'Balíček: zbývá {left} z {total|plural:karty,karet,karet}. Otevřít náhled.',
    count: '{left}/{total}',
    remaining: 'Zbývá {left} z {total|plural:karty,karet,karet}.',
    legend: 'Zašedlé karty už jsou venku – v ruce, na stole nebo v odpadu.',
    legendHidden:
      'Ukazuju jen karty, které v balíčku zbývají. Některé karty jsou lícem dolů, tak ať se tu neprozradí.',
    hidden: 'Lícem dolů ({n})',
    hiddenLabel:
      'Lícem dolů mimo balíček: {n|plural:karta,karty,karet}. Co jsou zač, zjistíš, až je zahraješ.',
    suitCount: '{symbol} {n}',
    stone: 'Bez hodnoty a barvy',
    rankCount: '{rank}: {n}',
    byRank: 'Zbývá podle hodnoty',
  },

  /** Výběr útraty. */
  blinds: {
    title: 'Kam dneska?',
    subtitle: 'Vyber útratu. Malou a Velkou můžeš přeskočit za štítek, šéfa ne.',
    target: 'Cíl',
    reward: 'Odměna',
    rewardValue: '{n|money}',
    noReward: 'bez odměny',
    select: 'Vybrat',
    selectLabel: 'Vybrat útratu {name} (Enter)',
    skip: 'Přeskočit',
    skipTag: 'Za přeskočení štítek: {tag}',
    skipNoTag: 'Za přeskočení nic nedostaneš. Štítky ještě nedovezli.',
    noSkip: 'Tady se nepřeskakuje. Rychlík staví jen na konečné.',
    bossNoRule: 'Šéf zatím nemá žádné zvláštní pravidlo. Užij si to, dokud to jde.',
    extraRule: 'Pravidlo navíc: {rule}',
    bossWeakened: 'Šéf je oslabený: cíl −{pct} %.',
    bossStrengthened: 'Šéf je posílený: cíl +{pct} %.',
    rerollBoss: 'Přelosovat šéfa',
    status: {
      current: 'Na řadě',
      upcoming: 'Čeká',
      defeated: 'Poraženo',
      skipped: 'Přeskočeno',
    },
  },

  /** Plakát příchodu šéfa nad stolem. */
  bossBanner: {
    label: 'Šéf {ante}. patra',
    extraLabel: 'Pravidlo navíc',
  },

  /** Konec kola: rozpis odměn. */
  roundEnd: {
    title: 'Kolo vyhráno!',
    score: 'Skóre {score} z cíle {target}',
    /** Hned po startu nekonečného režimu: výplata za finálového šéfa. */
    endlessTitle: 'Nekonečný režim začíná',
    endlessScore:
      'Nejdřív odměna za finálového šéfa (skóre {score} z cíle {target}). Pak hurá do dalšího patra.',
    blind: 'Odměna za útratu',
    hands: 'Nevyužité ruce ({n})',
    discards: 'Nevyužitá zahození ({n})',
    interest: 'Úrok',
    held: 'Zlaté karty v ruce',
    rental: 'Splátka: {name}',
    rentalReturned: 'Propadá (nesplaceno): {name}',
    tag: 'Štítek: {name}',
    other: 'Ostatní',
    total: 'Celkem',
    amount: '{n|signed} Kč',
    cashOut: 'Vyplatit {n|money}',
    cashOutLabel: 'Vyplatit odměnu a jít do Večerky (Enter)',
  },

  /** Večerka. */
  shop: {
    title: 'Večerka',
    subtitle: 'Otevřeno nonstop, ceny jak v centru.',
    items: 'Zboží',
    boosters: 'Obálky',
    vouchers: 'Kupón',
    buy: 'Koupit za {price|money}',
    buyAndUse: 'Koupit a použít',
    open: 'Otevřít za {price|money}',
    redeem: 'Uplatnit za {price|money}',
    sold: 'Vyprodáno',
    reroll: 'Přehodit za {price|money}',
    rerollFree: 'Přehodit zdarma',
    rerollLabel: 'Přehodit nabídku zboží',
    continue: 'Pokračovat',
    continueLabel: 'Odejít z Večerky k výběru útraty',
    empty: 'Večerka zavřená – inventura',
    emptyHint: 'Přehoď nabídku, třeba něco najdou ve skladu. Nebo přijď po dalším kole.',
    badgeExtra: 'Navíc',
    badgeDiscount: 'Sleva {pct} %',
    badgeEdition: 'Edice zdarma',
    badgeTitle: 'Výhoda ze štítku: {text}',
    cantAfford: 'Na tohle nemáš.',
    noReroll: 'Přehazovat se tu nedá. Co je na pultu, to je na pultu.',
    noRoom: 'Nemáš volný slot.',
    useNeedsHand: 'Potřebuje cíle v ruce, a ve Večerce žádnou ruku nemáš. Kup do slotu a použij v kole.',
    useNotNow: 'Teď by to nic neudělalo. Schovej si to na horší časy.',
  },

  /** Výběr z obálky. */
  booster: {
    pick: 'Vyber {n}',
    take: 'Vzít',
    use: 'Použít',
    keep: 'Nechat si',
    addCard: 'Do balíčku',
    skip: 'Přeskočit',
    skipLabel: 'Přeskočit zbytek obálky',
    noRoom: 'Nemáš volný slot.',
  },

  /** Pitva (konec runu). */
  gameOver: {
    title: 'Pitva',
    subtitle: 'Run skončil v patře {ante} – {blind}.',
    quote: '„{text}“',
    bossRule: '{name}: {rule}',
    score: 'Skóre {score} z cíle {target}',
    stats: 'Statistiky runu',
    rounds: 'Vyhraná kola',
    bestHand: 'Nejlepší ruka',
    bestHandValue: '{score} ({hand})',
    none: 'žádná',
    handsPlayed: 'Zahrané ruce',
    discardsUsed: 'Zahození',
    cardsPlayed: 'Zahrané karty',
    moneyEarned: 'Vyděláno',
    moneySpent: 'Utraceno',
    jokersBought: 'Koupení žolíci',
    bosses: 'Poražení šéfové',
    ante: 'Patro',
    deck: 'Balíček',
    stake: 'Síla piva',
    seed: 'Seed',
    copySeed: 'Kopírovat seed',
    copied: 'Seed zkopírován. Pošli ho dál, ať trpí i ostatní.',
    copyFailed: 'Kopírování nevyšlo. Seed si opiš: {seed}',
    newGame: 'Nová hra',
    menu: 'Hlavní menu',
  },

  /** Výhra. */
  victory: {
    title: 'Výhra!',
    subtitle: 'Šéf {ante}. patra je poražený. Hospoda tleská, výčepní nalévá na účet podniku.',
    creditsLabel: 'Titulky runu',
    starring: 'V hlavní roli: ty a balíček {deck}',
    stake: 'Síla piva: {stake}',
    end: 'Konec',
    endLabel: 'Ukončit run a vrátit se do menu',
    endless: 'Nekonečný režim',
    endlessHint: 'Cíle porostou rychleji než ceny v hospodě.',
    endlessStarted: 'Nekonečný režim: cíle porostou ještě rychleji.',
  },

  /** Info o runu (dialog). */
  runInfo: {
    title: 'Info o runu',
    sections: {
      hands: 'Úrovně kombinací',
      deck: 'Složení balíčku',
      jokers: 'Žolíci',
      tags: 'Štítky',
      boss: 'Šéf {ante}. patra',
      vouchers: 'Kupóny',
      stake: 'Síla piva',
      run: 'Run',
      challenge: 'Výzva',
    },
    columns: {
      hand: 'Kombinace',
      level: 'Úroveň',
      value: 'Čipy × mult',
      played: 'Zahráno',
    },
    bossNone: 'Šéf se ještě nevylosoval.',
    bossTarget: 'Cíl {target}.',
    bossDefeated: 'Poražen. Další šéf čeká o patro výš.',
    bigRule: 'Velká útrata má pravidlo navíc: {rule}',
    secret: '???',
    secretLabel: 'Tajná kombinace, zatím neobjevená',
    value: '{chips} × {mult}',
    none: 'Zatím nic.',
    cards: '{n|plural:karta,karty,karet}',
    modsLine: '{name}: {n}',
    deckName: 'Balíček: {name}',
    challengeName: 'Výzva: {name}',
    seed: 'Seed: {seed}',
    stakeLevel: '{name} (úroveň {level})',
    item: '{name}: {desc}',
    jokerItem: '{n}. {name}: {desc}',
    jokersCount: 'Sloty {n}/{max} · vyhodnocují se shora dolů (zleva doprava v řadě).',
  },

  /** Pauza (Esc). */
  pause: {
    title: 'Pauza',
    hint: 'Run se ukládá po každém tahu. Klidně si dojdi pro pivo.',
    resume: 'Pokračovat',
    settings: 'Nastavení',
    menu: 'Hlavní menu',
  },

  /** Hlášky událostí (oznámení, bubliny). */
  events: {
    skipped: 'Útrata přeskočena.',
    skippedTag: 'Útrata přeskočena. Štítek: {tag}.',
    leveled: '{hand} je teď na úrovni {level}.',
    discovered: 'Objev! {hand} je ve hře.',
    ante: 'Patro {ante}. Cíle rostou, pivo dochází.',
    roundWon: 'Kolo vyhráno!',
    blocked: 'Ruka se nepočítá: {reason}',
    bossArrived: 'Přichází šéf {name}. {rule} {intro}',
    bossDefeated: 'Šéf poražen.',
    bossDefeatedTitle: 'Poraženo: {name}',
    tagTriggered: 'Štítek: {name}',
    scoredLive: '{hand}: {score|plural:bod,body,bodů}. Skóre kola {round}.',
    bigScore: 'To je rána!',
  },

  /** Bubliny při skórování. */
  bubble: {
    chips: '{n|signed}',
    mult: '{n|signed} mult',
    xmult: '{n|x} mult',
    money: '{n|signed} Kč',
    score: '{n}',
    jokerOff: 'Mimo provoz!',
    jokerOn: 'Zase jede!',
  },

  death: DEATH_QUOTES,
};
