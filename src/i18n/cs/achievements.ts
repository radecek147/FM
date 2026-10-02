/**
 * Texty achievementů (docs/DESIGN.md kap. 11.2) — klíče `achievements.<id>.name|desc|flavor`, skryté navíc `hint`
 * (nápověda ve sbírce místo podmínky, dokud achievement hráč nezíská). `name` = pointa (max 4 slova), `desc` = přesná
 * podmínka, `flavor` = hláška bez uvozovek. Čísla jen přes `{param}` z `AchievementDef.params`
 * (src/content/achievements.ts) — UI je dosadí: `t('achievements.<id>.desc', def.params)`.
 */
import type { TextTree } from '../cs';

export const achievements = {
  // ── postup ──
  first_round: {
    name: 'Rundu platím já',
    desc: 'Vyhraj první kolo.',
    flavor: 'Na zdraví! Teď už jen dalších dvacet tři.',
  },
  first_boss: {
    name: 'Šéf nešéf',
    desc: 'Poraz prvního šéfa.',
    flavor: 'Šéf je taky jen člověk. Akorát s razítkem.',
  },
  halftime: {
    name: 'Poločas v hospodě',
    desc: 'Dosáhni patra {ante}.',
    flavor: 'Polovina za námi, polovina v nás.',
  },
  closing_time: {
    name: 'Zavíračka',
    desc: 'Vyhraj run – poraz šéfa posledního patra.',
    flavor: 'Hospodský zhasíná a ty odcházíš vítězně.',
  },
  one_more: {
    name: 'Ještě jedno!',
    desc: 'Pokračuj po výhře v nekonečném režimu a poraz tam šéfa.',
    flavor: 'Prý už jdeš domů. To bylo před třemi koly.',
  },
  night_watchman: {
    name: 'Ponocný',
    desc: 'Dosáhni patra {ante}.',
    flavor: 'Odbila dvanáctá a ty pořád rozdáváš.',
  },
  rooster_crows: {
    name: 'Kohout už kokrhá',
    desc: 'Dosáhni patra {ante}.',
    flavor: 'Ráno je moudřejší večera. Tohle ráno ne.',
  },
  heat_death: {
    name: 'Tepelná smrt vesmíru',
    desc: 'Získej jednou rukou tolik bodů, že skóre přeteče do nekonečna.',
    hint: 'Některá čísla jsou větší než jiná. Tohle je největší.',
    flavor: 'Fyzici pláčou, kalkulačka se kouří.',
  },

  // ── skóre ──
  score_1k: {
    name: 'Tisícovka na stole',
    desc: 'Získej jednou rukou aspoň {score|plural:bod,body,bodů}.',
    flavor: 'Na tácku je víc čárek než místa.',
  },
  score_10k: {
    name: 'Desetitisícovka',
    desc: 'Získej jednou rukou aspoň {score|plural:bod,body,bodů}.',
    flavor: 'Pivo za čtyřicet, ruka za deset tisíc.',
  },
  score_100k: {
    name: 'Výplata',
    desc: 'Získej jednou rukou aspoň {score|plural:bod,body,bodů}.',
    flavor: 'Přišla rychle. Odejde ještě rychleji.',
  },
  score_1m: {
    name: 'Milionář z paneláku',
    desc: 'Získej jednou rukou aspoň {score|plural:bod,body,bodů}.',
    flavor: 'Výtah pořád nejede, ale skóre jo.',
  },
  score_1g: {
    name: 'Státní rozpočet',
    desc: 'Získej jednou rukou aspoň {score|plural:bod,body,bodů}.',
    flavor: 'Kdyby tak byl i vyrovnaný.',
  },
  scientific_notation: {
    name: 'Vědecký zápis',
    desc: 'Získej jednou rukou víc než {score|plural:bod,body,bodů}.',
    flavor: 'Od teď se body píšou s exponentem a s respektem.',
  },
  safety_margin: {
    name: 'S rezervou',
    desc: 'Dosáhni v jednom kole aspoň {mult}násobku cíle.',
    flavor: 'Kdo šetří, má za tři. Kdo přestřelí, má za deset.',
  },
  five_to_twelve: {
    name: 'Za pět dvanáct',
    desc: 'Vyhraj kolo poslední rukou a přesáhni cíl o méně než {pct} %.',
    flavor: 'Na poslední chvíli, jako daňové přiznání.',
  },

  // ── kombinace ──
  from_adam: {
    name: 'Od Adama',
    desc: 'Zahraj Postupku A-2-3-4-5.',
    flavor: 'Kdo začíná od Adama, nekončí u Evy, ale u pětky.',
  },
  coronation: {
    name: 'Korunovace',
    desc: 'Zahraj Královskou postupku.',
    flavor: 'Svatováclavská koruna by záviděla.',
  },
  five_committee: {
    name: 'Pětičlenná komise',
    desc: 'Zahraj Pětici.',
    hint: 'Kolik stejných karet je moc? O jednu víc.',
    flavor: 'Všichni hlasovali stejně. Podezřelé.',
  },
  color_tv: {
    name: 'Barevná televize',
    desc: 'Zahraj Barevný full house.',
    hint: 'Plný dům – a celý vymalovaný jednou barvou.',
    flavor: 'Konec černobílé éry.',
  },
  like_two_eggs: {
    name: 'Jako vejce vejci',
    desc: 'Zahraj Barevnou pětici.',
    hint: 'Pět dvojčat, totožných do posledního puntíku.',
    flavor: 'Kdo je od sebe rozezná, dostane metál.',
  },
  career_ladder: {
    name: 'Kariérní postup',
    desc: 'Zvyš libovolnou kombinaci na úroveň {level}.',
    flavor: 'Z referenta vedoucím odboru za jeden večer.',
  },
  full_menu: {
    name: 'Celý jídelníček',
    desc: 'V jednom runu zahraj všech {count} základních kombinací.',
    flavor: 'Od polévky po moučník, nic se nevynechává.',
  },
  high_standards: {
    name: 'Vysoké nároky',
    desc: 'Vyhraj kolo, ve kterém zahraješ jen Vysoké karty (aspoň {hands|plural:ruku,ruce,rukou}).',
    flavor: 'Málo, ale s grácií.',
  },
  encyclopedist: {
    name: 'Encyklopedista',
    desc: 'Zahraj všech {count} kombinací včetně tajných (napříč runy).',
    flavor: 'Ottův slovník naučný má nový díl.',
  },

  // ── ekonomika ──
  on_the_tab: {
    name: 'Na sekeru',
    desc: 'Dokonči kolo se záporným zůstatkem.',
    flavor: 'Hospodský má tvoje jméno na tabuli. Křídou a podtržené.',
  },
  stuffed_piggy: {
    name: 'Nadité prasátko',
    desc: 'Měj najednou aspoň {money|money}.',
    flavor: 'Kladívko na prasátko už se chystá.',
  },
  retirement: {
    name: 'Na důchod',
    desc: 'Měj najednou aspoň {money|money}.',
    flavor: 'Tohle už není hraní, to je stavební spoření.',
  },
  compound_interest: {
    name: 'Úroky z úroků',
    desc: 'Získej maximální úrok v {rounds|plural:kole,kolech,kolech} po sobě.',
    flavor: 'Banka se diví, babička ne.',
  },
  to_the_bone: {
    name: 'Na dřeň',
    desc: 'Odejdi z Večerky s prázdnou kapsou a vyhraj další kolo.',
    flavor: 'Utratit všechno a stejně vyhrát. Klasika.',
  },
  shopping_spree: {
    name: 'Nákupní horečka',
    desc: 'Utrať v jedné Večerce aspoň {money|money}.',
    flavor: 'Vezmu všechno. A tašku taky.',
  },
  just_looking: {
    name: 'Ještě se podívám',
    desc: 'Přehoď nabídku v jedné Večerce aspoň {count}×.',
    flavor: 'Prodavačka už volá vedoucího.',
  },
  flea_market: {
    name: 'Bleší trh',
    desc: 'Prodej v jednom runu {count|plural:žolíka,žolíky,žolíků}.',
    flavor: 'Všechno za korunu, Golem za dvě.',
  },

  // ── žolíci ──
  packed_pub: {
    name: 'Plný lokál',
    desc: 'Zaplň všechny sloty žolíků (aspoň {count|plural:slot,sloty,slotů}).',
    flavor: 'K pípě se nedá ani protlačit.',
  },
  showcase: {
    name: 'Celá vitrína',
    desc: 'Měj najednou žolíky s lesklou, holografickou, duhovou i negativní edicí.',
    flavor: 'Babička by je dala za sklo a nikdy nevyndala.',
  },
  out_of_the_mountain: {
    name: 'Vyjeli z hory',
    desc: 'Získej legendárního žolíka.',
    flavor: 'Blaník se otevřel. Asi kvůli tobě.',
  },
  old_czech_legends: {
    name: 'Staré pověsti české',
    desc: 'Objev všechny legendární žolíky.',
    flavor: 'Jirásek by to sepsal líp. Jenže u toho nebyl.',
  },
  abstainer: {
    name: 'Abstinent',
    desc: 'Dosáhni patra {ante} bez jediného žolíka v celém runu.',
    flavor: 'Jen minerálku, děkuji.',
  },
  office_copier: {
    name: 'Kopírka na úřadě',
    desc: 'Měj najednou {count|plural:kopírujícího žolíka,kopírující žolíky,kopírujících žolíků}.',
    hint: 'Kopie kopie kopie. Ověřená.',
    flavor: 'Originál se ztratil, ale kopií máme dost.',
  },
  like_water: {
    name: 'Jak z vody',
    desc: 'Nech rostoucího žolíka dorůst aspoň na {xmult|x} mult nebo +{mult} mult.',
    flavor: 'Roste jako z vody. Asi to bude tím pivem.',
  },
  july_snowman: {
    name: 'Sněhulák v červenci',
    desc: 'Poraz finálového šéfa se Sněhulákem ve slotu.',
    hint: 'Něco, co mělo dávno roztát, vydrží až do úplného konce.',
    flavor: 'Medard prohrál. Sněhulák ne.',
  },

  // ── spotřebky a karty ──
  tree_frog: {
    name: 'Rosnička na žebříku',
    desc: 'Použij celkem {count|plural:pranostiku,pranostiky,pranostik}.',
    flavor: 'Vylezla až nahoru. Bude hezky.',
  },
  happy_grandma: {
    name: 'Babička má radost',
    desc: 'Použij celkem {count|plural:babskou radu,babské rady,babských rad}.',
    flavor: 'Konečně ji někdo poslouchá.',
  },
  stamp_on_stamp: {
    name: 'Razítko na razítku',
    desc: 'Použij celkem {count|plural:úřední razítko,úřední razítka,úředních razítek}.',
    flavor: 'Úředník roku. Bez jediného úsměvu.',
  },
  weather_wise: {
    name: 'Sedlák rozumí počasí',
    desc: 'Objev všechny pranostiky.',
    flavor: 'Ví, kdy zaprší. Ví, kdy padne Barva.',
  },
  notarized: {
    name: 'Notářský zápis',
    desc: 'Zahraj ruku, ve které skórují karty se všemi druhy pečetí.',
    flavor: 'Ověřeno, podepsáno, čtyřikrát orazítkováno.',
  },
  lucky_shards: {
    name: 'Střepy pro štěstí',
    desc: 'Rozbij celkem {count|plural:skleněnou kartu,skleněné karty,skleněných karet}.',
    flavor: 'Na svatbě by se divili.',
  },
  iron_curtain: {
    name: 'Železná opona',
    desc: 'Skóruj, zatímco v ruce držíš aspoň {count|plural:ocelovou kartu,ocelové karty,ocelových karet}.',
    flavor: 'Tudy neprojde ani myš. Ani prohra.',
  },
  stone_wall: {
    name: 'Kamenná zídka',
    desc: 'Zahraj ruku z {count|plural:kamenné karty,kamenných karet,kamenných karet}.',
    flavor: 'Soused staví plot, ty zídku.',
  },

  // ── balíčky ──
  pub_crawl: {
    name: 'Turné po hospodách',
    desc: 'Vyhraj run s každým startovním balíčkem.',
    flavor: 'Všude byli, všude platili.',
  },
  flek_re_tutti: {
    name: 'Flek, re, tutti',
    desc: 'Vyhraj run s Mariášovým balíčkem.',
    flavor: 'Kdo nehraje, nevyhraje. Kdo flekuje, platí.',
  },
  installment_plan: {
    name: 'Splátkový kalendář',
    desc: 'Vyhraj run s Dlužníkem.',
    flavor: 'Poslední splátka. A hned zase půjčka.',
  },
  fairy_court: {
    name: 'Pohádkový dvůr',
    desc: 'Vyhraj run s Obrázkovým balíčkem.',
    flavor: 'Král, dáma a kluk. Pěšáci se nekonali.',
  },

  // ── síla piva ──
  warmed_up: {
    name: 'Rozehřívačka',
    desc: 'Vyhraj run na Jedenáctce (nebo silnějším pivu).',
    flavor: 'Pivo zdražilo. Ty taky.',
  },
  twelve_standing: {
    name: 'Dvanáctka na stojáka',
    desc: 'Vyhraj run na Dvanáctce (nebo silnějším pivu).',
    flavor: 'Klasika, která nepotřebuje židli.',
  },
  special_care: {
    name: 'Speciální péče',
    desc: 'Vyhraj run na Speciálu (nebo silnějším pivu).',
    flavor: 'Žolíci zvětrali, ty ne.',
  },
  five_beers: {
    name: 'Pět piv a jdu domů',
    desc: 'Vyhraj run na Ležáku (nebo silnějším pivu).',
    flavor: 'Mělo jich být pět. Bylo jich patnáct.',
  },
  bock_on_side: {
    name: 'Bock na bok',
    desc: 'Vyhraj run na Bocku (nebo silnějším pivu).',
    flavor: 'Tmavé, silné a s kozlem na etiketě.',
  },
  double_hit: {
    name: 'Dvojitý zásah',
    desc: 'Vyhraj run na Doppelbocku (nebo silnějším pivu).',
    flavor: 'Přibité, půjčené – a stejně to šlo.',
  },
  tap_emperor: {
    name: 'Imperátor výčepu',
    desc: 'Vyhraj run na Imperialu.',
    flavor: 'Šéf sedí u každého stolu. Ty u výčepu.',
  },
  district_legend: {
    name: 'Legenda okresu',
    desc: 'Vyhraj run na Imperialu s různými balíčky – potřebuješ jich {count}.',
    flavor: 'Vyprávět se o tobě bude i v sousední vesnici.',
  },

  // ── výzvy ──
  challenger: {
    name: 'Vyzývatel',
    desc: 'Dokonči libovolnou výzvu.',
    flavor: 'Rukavice hozena, rukavice zvednuta.',
  },
  decathlon: {
    name: 'Desetiboj',
    desc: 'Dokonči {count|plural:různou výzvu,různé výzvy,různých výzev}.',
    flavor: 'Disk, oštěp a Švejkova anabáze.',
  },
  national_champion: {
    name: 'Mistr republiky',
    desc: 'Dokonči všechny výzvy.',
    flavor: 'Medaile z perníku, sláva z oceli.',
  },

  // ── sbírka ──
  coaster_collector: {
    name: 'Sběratel tácků',
    desc: 'Objev {count|plural:žolíka,žolíky,žolíků}.',
    flavor: 'Doma má krabici od bot plnou žolíků.',
  },
  joker_museum: {
    name: 'Muzeum žolíků',
    desc: 'Objev všechny žolíky.',
    flavor: 'Vstupné dobrovolné, odchod nedobrovolný.',
  },
  voucher_maniac: {
    name: 'Poukázkový maniak',
    desc: 'Měj v jednom runu {count|plural:kupón,kupóny,kupónů}.',
    flavor: 'Peněženka praská ve švech. Poukázkami.',
  },

  // ── meta ──
  morning_exercise: {
    name: 'Ranní rozcvička',
    desc: 'Dojdi v oficiálním denním runu aspoň do patra {ante}.',
    flavor: 'Káva, rohlík, tři patra.',
  },
  week_straight: {
    name: 'Týden v kuse',
    desc: 'Odehraj oficiální denní run {days|plural:den,dny,dní} po sobě.',
    flavor: 'I v neděli. Hlavně v neděli.',
  },
  seed_sown: {
    name: 'Semínko zaseto',
    desc: 'Rozehraj run s vlastním seedem.',
    flavor: 'Co si zaseješ, to si zahraješ.',
  },
  pub_inventory: {
    name: 'Inventář podniku',
    desc: 'Odehraj celkem {count|plural:run,runy,runů}.',
    flavor: 'Už nejsi štamgast. Jsi inventář.',
  },
  regulars_apprentice: {
    name: 'Štamgastův žák',
    desc: 'Dokonči tutoriál.',
    flavor: 'Štamgast ti půjčil svůj tácek. Jen na chvíli.',
  },

  // ── kuriozity ──
  quick_beer: {
    name: 'Rychlé pivo',
    desc: 'Prohraj hned na první Malé útratě.',
    hint: 'Někdy to skončí dřív, než to začne.',
    flavor: 'Bunda na věšáku ještě ani nevychladla.',
  },
  by_a_hair: {
    name: 'O chlup',
    desc: 'Prohraj kolo, ve kterém ti do cíle chybělo méně než {pct} %.',
    hint: 'Tak blízko, a přece zpátky u výčepu.',
    flavor: 'Kdyby, kdyby. Kdyby nebylo kdyby.',
  },
  one_blow: {
    name: 'Jednou ranou',
    desc: 'Poraz šéfa hned první rukou.',
    flavor: 'Sedm jich bylo. Šéf jen jeden.',
  },
  nothing_wasted: {
    name: 'Nic se nevyhazuje',
    desc: 'Vyhraj run bez jediného zahození.',
    flavor: 'Zahrádkář Venca by plakal dojetím.',
  },
  papers_in_order: {
    name: 'Doklady v pořádku',
    desc: 'Poraz Kontrolu z finančáku a měj přitom aspoň {money|money} v kapse.',
    flavor: 'Účtenky? Všechny. Seřazené podle data.',
  },
  shortcut: {
    name: 'Zkratkou přes pole',
    desc: 'Přeskoč v jednom runu {count|plural:útratu,útraty,útrat}.',
    flavor: 'Rovnou přes řepku, hlavně nešlapat do brázdy.',
  },
} satisfies TextTree;
