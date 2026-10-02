/**
 * Texty výzev (docs/DESIGN.md kap. 11.1) — klíče `challenges.<id>.name|desc|flavor|rules.<klíč>` podle id
 * a `ruleKeys` v src/content/challenges.ts. `{param}` dosadí UI z `params` definice (stejná čísla jako pravidla).
 * `desc` = jedna věta pro kartu výzvy, `rules` = přesný seznam pravidel (v pořadí `ruleKeys`), `flavor` = hláška.
 */
import type { TextTree } from '../cs';

export const challenges = {
  dry_february: {
    name: 'Suchý únor',
    desc: 'Měsíc bez žolíků. Nikde žádný nebude, zato se do kapsy vejdou {slots|plural:spotřebka,spotřebky,spotřebek} navíc.',
    flavor: 'Únor je nejkratší měsíc. Tenhle bude dlouhý.',
    rules: {
      noJokers:
        'Žolíci se neobjevují nikde – ve Večerce, v obálkách ani z efektů. Kupóny, spotřebky a štítky, které pracují se žolíky, se taky nenabízejí.',
      slots: '+{slots|plural:slot,sloty,slotů} spotřebky.',
      targets: 'Cíle všech útrat jsou {mult|x} – v únoru se šetří všude.',
      start: 'Start: kupón Trhací kalendář a {money|money}.',
    },
  },
  greenhouse: {
    name: 'Skleník',
    desc: 'Všechna srdce a káry jsou ze skla – a sklo tu praská jako o závod.',
    flavor: 'Kdo sedí ve skleníku, neměl by hrát karty.',
    rules: {
      glass: 'Všechny ♥ a ♦ v balíčku jsou skleněné.',
      odds: 'Skleněná karta, která skórovala, pak praskne se šancí 1 z {odds}.',
      start: 'Start: {count|plural:babská rada,babské rady,babských rad} Jablko od stromu.',
    },
  },
  quarry: {
    name: 'Kamenolom',
    desc: 'K obvyklému balíčku přibude {stones|plural:kamenná karta,kamenné karty,kamenných karet} a babské rady mají do lomu vstup zakázán.',
    flavor: 'Tady se netěží uhlí. Tady se těží čipy.',
    rules: {
      deck: 'Balíček má {cards|plural:kartu,karty,karet}: obvyklých 52 a {stones|plural:kamennou,kamenné,kamenných}.',
      noRady: 'Babské rady se neobjevují – ve Večerce, v obálkách ani z efektů.',
      start: 'Start: žolík Golem (přibitý).',
    },
  },
  bureaucracy: {
    name: 'Byrokracie',
    desc: 'Každý tah je úřední úkon a každý úkon má svůj kolek. Naštěstí se tu dá žít i na dluh.',
    flavor: 'Žádost podejte ve trojím vyhotovení. Zahrát ji můžete jen jednou.',
    rules: {
      fees: 'Každá zahraná ruka i každé zahození stojí {fee|money}.',
      debt: 'Dluh smí jít až do −{debt|money}; pod tuhle hranici už úřad nic nestrhne.',
      start: 'Start: {money|money}.',
    },
  },
  svejk_anabasis: {
    name: 'Švejkova anabáze',
    desc: 'Vysoké hry se tu nenosí: boduje jen Vysoká karta a Dvojice, zato hned od úrovně {level}.',
    flavor: 'Poslušně hlásím, že do Budějovic se jde přes Dvojici.',
    rules: {
      maxHand: 'Kombinace silnější než Dvojice neskórují (0 bodů), ruka se přesto spotřebuje.',
      levels: 'Vysoká karta a Dvojice začínají na úrovni {level}.',
      start: 'Start: žolík Švejk.',
    },
  },
  express: {
    name: 'Rychlík bez zastávky',
    desc: 'Žádné přeskakování, žádné přehazování – jede se pořád dál, jen s rukou navíc.',
    flavor: 'Příští zastávka: konečná. Vystupovat jen při prohře.',
    rules: {
      noSkip: 'Malou ani Velkou útratu nejde přeskočit (a nemají štítky).',
      noReroll: 'Večerka nemá přehození.',
      hands: '+{hands|plural:ruka,ruce,rukou} v každém kole.',
    },
  },
  straight_to_boss: {
    name: 'Rovnou za ředitelem',
    desc: 'Malé a Velké útraty se přeskakují samy. Štítky dostaneš, ale v každém patře jdeš rovnou za šéfem.',
    flavor: 'S náměstkem se bavit nebudu. Jdu rovnou za ředitelem.',
    rules: {
      autoSkip: 'Malé a Velké útraty se automaticky přeskočí; štítky za přeskočení dostaneš.',
      start: 'Start: {money|money}.',
    },
  },
  minimalist: {
    name: 'Minimalista',
    desc: 'Méně je více: vybrat jde nejvýš {cards|plural:karta,karty,karet}, zato malé kombinace začínají silnější.',
    flavor: 'Tři karty, jedna židle a žádné zbytečnosti.',
    rules: {
      maxSelect: 'Vybrat, zahrát i zahodit jde naráz nejvýš {cards|plural:karta,karty,karet}.',
      levels: 'Vysoká karta, Dvojice a Trojice začínají na úrovni {level}.',
    },
  },
  flat_price: {
    name: 'Jednotná cena',
    desc: 'Všechno za {price|money}: žolík, obálka, kupón i přehození. A prodává se vždycky za {sell|money}.',
    flavor: 'Jako v obchodě „Vše za pětku“. Jen to nejde reklamovat.',
    rules: {
      price:
        'Vše ve Večerce stojí {price|money} – žolíci, spotřebky, hrací karty, obálky, kupóny i přehození. Slevy neplatí.',
      sell: 'Žolíci i spotřebky se prodávají vždy za {sell|money}.',
    },
  },
  costume_rental: {
    name: 'Půjčovna kostýmů',
    desc: 'Každý žolík je jen zapůjčený: pořídíš ho levně, ale nájem platíš každé kolo.',
    flavor: 'Kostým vraťte vyčištěný. Žolíka taky.',
    rules: {
      rental:
        'Všichni žolíci jsou zapůjčení: stojí {buy|money}, na konci každého kola za ně zaplatíš {fee|money} a prodávají se za {sell|money}. Žolíci, kteří se půjčit nedají, se nenabízejí.',
      start: 'Start: {money|money}.',
    },
  },
  lifelong_wedding: {
    name: 'Svatba na doživotí',
    desc: 'Co si pořídíš, to už neprodáš. Ve Štamgastově balíčku a navždy.',
    flavor: 'V dobrém i ve zlém, v Malé i ve Velké útratě.',
    rules: {
      eternal:
        'Všichni žolíci jsou přibití – nejdou prodat ani zničit. Žolíci, kteří přibití být nesmí, se nenabízejí.',
      deck: 'Hraje se se Štamgastovým balíčkem.',
    },
  },
  short_memory: {
    name: 'Krátká paměť',
    desc: 'Na začátku každého patra všechno zapomeneš a úrovně kombinací spadnou na 1. Pranostiky jsou aspoň za babku.',
    flavor: 'Co jsem dělal minulé patro? Nevím. Ale pranostiku si koupím znova.',
    rules: {
      reset: 'Na začátku každého patra se úrovně všech kombinací vrátí na 1.',
      cheap: 'Pranostiky stojí {price|money}.',
    },
  },
  big_bang: {
    name: 'Velký třesk',
    desc: 'Začínáš s legendami, ale cíle všech útrat jsou {mult|x}.',
    flavor: 'Na počátku byl třesk. Pak přišel účet.',
    rules: {
      targets: 'Cíle všech útrat jsou {mult|x}.',
      start:
        'Start: {count|plural:náhodný legendární žolík,náhodní legendární žolíci,náhodných legendárních žolíků} (přibití).',
    },
  },
  candlelight: {
    name: 'Večer při svíčkách',
    desc: 'Žolíci se potmě rozkoukávají: v první ruce kola nefungují. Ruka navíc to aspoň trochu vynahradí.',
    flavor: 'Romantika. Dokud nepřijde vyúčtování za elektřinu.',
    rules: {
      dark: 'Žolíci nefungují v první ruce každého kola (ani při zahazování před ní).',
      hands: '+{hands|plural:ruka,ruce,rukou} v každém kole.',
    },
  },
  four_seasons: {
    name: 'Čtyři roční období',
    desc: 'Každé patro má svou roční dobu a jedna barva v něm vždycky stávkuje.',
    flavor: 'Jaro, léto, podzim, zima. A pořád špatné počasí na karty.',
    rules: {
      seasons: 'Ve všech útratách patra je jedna barva mimo provoz:',
      spring: 'patra 1 a 5 (jaro): ♥',
      summer: 'patra 2 a 6 (léto): ♠',
      autumn: 'patra 3 a 7 (podzim): ♦',
      winter: 'patra 4 a 8 (zima): ♣ – a v nekonečném režimu pořád dokola.',
    },
  },
  christmas_carp: {
    name: 'Vánoční kapr',
    desc: 'Co plave ve vaně, to se nevyhazuje: žádné zahazování, zato ruce a karta navíc.',
    flavor: 'Plave ve vaně od pondělí. Na Štědrý den se rozhodne, kdo koho sní.',
    rules: {
      noDiscards: 'V kole nemáš žádné zahození.',
      hands: '+{hands|plural:ruka,ruce,rukou} v každém kole.',
      handSize: '+{cards|plural:karta,karty,karet} v ruce.',
    },
  },
  marias_party: {
    name: 'Mariáš u Vaňků',
    desc: 'Mariášový balíček a Barva od úrovně {level}. Nové karty ale nikdo nepřinese a cíle jsou {mult|x}.',
    flavor: 'U Vaňků se hraje do rána. Ráno se jde rovnou do práce.',
    rules: {
      levels: 'Barva a Postupka v barvě začínají na úrovni {level}.',
      noCards: 'Obálky s hracími kartami se neobjevují.',
      targets: 'Cíle všech útrat jsou navíc {mult|x} (k cílům Mariášového balíčku).',
    },
  },
  micro_flat: {
    name: 'Malometrážní byt',
    desc: 'Do ruky se vejde jen {cards|plural:karta,karty,karet}, zato na věšáku je místo pro žolíky navíc.',
    flavor: 'Dvacet metrů čtverečních, z toho patnáct pro žolíky.',
    rules: {
      handSize: 'V ruce máš jen {cards|plural:kartu,karty,karet}.',
      hands: '+{hands|plural:ruka,ruce,rukou} v každém kole.',
      slots: '+{slots|plural:slot,sloty,slotů} žolíka.',
    },
  },
  border_casino: {
    name: 'Kasino u hranic',
    desc: 'Všech {cards} karet je šťastných. Jenže kasino nic nevyplácí – peníze jsou jen ze štěstí.',
    flavor: 'Herna nonstop, parkoviště zdarma, štěstí za příplatek.',
    rules: {
      lucky: 'Všech {cards} karet balíčku je šťastných.',
      noIncome: 'Úrok, odměny za útraty ani peníze za nevyužité ruce se nevyplácí.',
    },
  },
  end_of_world: {
    name: 'Konec světa',
    desc: 'Osmým patrem to nekončí: výzvu dokončí až porážka šéfa patra {ante} a cíle jsou {mult|x}.',
    flavor: 'Mayský kalendář měl ještě pár pater v příloze.',
    rules: {
      targets: 'Cíle všech útrat jsou {mult|x}.',
      longer: 'Výzva je dokončená až porážkou šéfa patra {ante}.',
      finals: 'Finálový šéf přijde v patře {firstFinal} i v patře {ante}.',
    },
  },
} satisfies TextTree;
