# Herní design — Karban

> **Karban — Hospodský roguelike se žolíky.**
> Kompletní herní design pro vývojáře: pravidla, čísla, obsah, meta a postup balancu.
> Technické provedení je v `docs/ARCHITECTURE.md`, rozhodnutí a jejich důvody v `docs/DECISIONS.md`.
> Všechna čísla jsou **výchozí** a ladí se simulací (fáze 2 a 10). Při změně čísla uprav tento dokument,
> obsah v `src/content/**`, test a zapiš změnu do `DECISIONS.md`.

## 0. O dokumentu

### 0.1 Konvence

- Hráči **tykáme** („Zahraj“, „Dosáhni aspoň…“), ale **rodově neutrálně**: žádné „jsi zahrál“, „jsi hrdý“ —
  rozkazovací způsob, přítomný/budoucí čas nebo neosobní tvar („v tomto kole se ještě nezahazovalo“).
  Tón je laskavá, suchá satira všedního Česka.
- Figury: **Kluk / Dáma / Král / Eso**, rohové indexy **J / Q / K / A**. Barvy: **piky ♠, srdce ♥, káry ♦, kříže ♣**.
- Čísla v tomto dokumentu: tisíce oddělené mezerou, desetinná čárka (`×1,5`). Ve hře se formátuje vlastní
  funkcí v `src/i18n/format.ts` (ne `Intl`): oddělovač tisíců NBSP (U+00A0), `5 Kč` s NBSP, `×1,5`,
  od 1e15 vědecký zápis `1,23e16`. Multiplikátor se zobrazuje s nejvýš 2 desetinnými místy, koncové nuly
  se ořezávají (`×2`, `×1,5`, `393,75`).
- „1 z N“ = pravděpodobnost `1/N`. Čitatel se násobí `Modifiers.probabilityMult` (např. „1 z 4“ → „2 z 4“),
  text ve hře se generuje dynamicky.
- „Skórující karta“ = karta, která je součástí vyhodnocené kombinace (nebo kamenná, nebo vše při `allCardsScore`).
- Názvy obsahu mají **nejvýš 3 slova** (jedinou výjimkou je achievement ze zadání „Pět piv a jdu domů“).
- Žádná jména žijících osob ani skutečných značek, nic převzatého z Balatra ani jiné komerční hry.
  Lidové postavy (Švejk, Krakonoš, Libuše, Bruncvík, vodník…) jsou volné kulturní dědictví.

### 0.2 Slovníček (hráčský termín → identifikátor v kódu)

| Ve hře                                    | V kódu                                           | Poznámka                                     |
| ----------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| Run                                       | `RunState`                                       | jedna hra od výběru balíčku po výhru/prohru  |
| Patro                                     | `ante`                                           | 1–8 hlavní hra, 9+ nekonečný režim           |
| Malá útrata / Velká útrata / Šéf          | `blind: 'small' / 'big' / 'boss'`                | tři útraty v každém patře                    |
| Kolo                                      | `round`                                          | odehrání jedné útraty                        |
| Ruka / Zahození                           | `hands` / `discards`                             | počty v kole                                 |
| Velikost ruky                             | `handSize`                                       | kolik karet držíš                            |
| Večerka                                   | `shop`                                           | obchod mezi koly                             |
| Obálka                                    | `booster`                                        | „balíček do kapsy“, hráč vybírá z N možností |
| Startovní balíček                         | `deck`                                           | volba na začátku runu (mění pravidla)        |
| Pranostika / Babská rada / Úřední razítko | `consumable` (`pranostika` / `rada` / `razitko`) | spotřebky                                    |
| Kupón                                     | `voucher`                                        | trvalé vylepšení na run                      |
| Štítek                                    | `tag`                                            | odměna za přeskočení útraty                  |
| Síla piva                                 | `stake`                                          | obtížnost 1–8                                |
| Nálepka                                   | `sticker`                                        | přibitý / zvětrávající / zapůjčený žolík     |
| Pitva                                     | `gameOver`                                       | obrazovka konce runu s hláškou podle příčiny |

## 1. Shrnutí hry a herní smyčka

**Karban** je roguelike karetní hra: z pokerových kombinací skládáš body (`čipy × mult`), kupuješ si žolíky
s pasivními efekty a snažíš se stačit exponenciálně rostoucím cílům. Každý run je jiný díky náhodné
nabídce Večerky, šéfům a štítkům — a deterministický díky seedu.

### 1.1 Smyčka

```
Nový run (balíček + síla piva + seed)
└─ Patro 1 … 8
   ├─ Výběr útraty: Malá (1× cíl) → Velká (1,5× cíl) → Šéf (2× cíl + pravidlo)
   │    • Malou a Velkou lze PŘESKOČIT → dostaneš štítek, ale žádnou odměnu ani Večerku
   ├─ Kolo: 4 ruce, 3 zahození, 8 karet v ruce, max 5 vybraných karet
   │    • Zahraj 1–5 karet → skóre = čipy × mult → přičte se ke skóre kola
   │    • Dosáhneš cíle → kolo vyhráno hned (zbylé ruce jsou „nevyužité“)
   │    • Dojdou ruce pod cílem → konec runu („pitva“)
   ├─ Konec kola: odměna za útratu + nevyužité ruce + úrok + bonusy → „Vyplatit“
   └─ Večerka: žolíci, spotřebky, obálky, kupón, přehození, prodej → „Pokračovat“
Po porážce šéfa patra 8 → VÝHRA (titulky, statistika) → nabídka Nekonečného režimu
```

- Na začátku každého kola se celý balíček (všechny karty runu) zamíchá a dobere se ruka do `handSize`.
  Po každém zahrání i zahození se dobírá zpět do `handSize`, dokud jsou karty v dobíracím balíčku.
- Šéf patra se losuje při vstupu do patra (stream `boss`) a je vidět už na výběru útrat — hráč se může
  připravit. Štítky za přeskočení jsou také vidět předem.
- Večerka následuje po každém **vyhraném** kole (3× za patro, pokud nic nepřeskočíš).

### 1.2 Výhra a prohra

- **Výhra:** poražení (finálového) šéfa patra 8. Run se zapíše jako vítězný, odemyká obsah a další sílu piva
  pro daný balíček. Hráč pak volí „Konec“ nebo „Nekonečný režim“.
- **Prohra:** kolo skončí (došly ruce) se skóre pod cílem. Výjimky: štítek „Lékařské potvrzení“ (kap. 7).
- **Prohra z nedostatku karet:** pokud je ruka prázdná a dobírací balíček také (např. malý balíček + šéf,
  který brání dobírání), kolo končí jako prohra.
- Konec runu vede na **pitvu**: statistiky runu + hláška podle příčiny (id šéfa / `small` / `big`).

### 1.3 Nekonečný režim

- Pokračuje se stejným runem (žolíci, balíček, peníze, kupóny zůstávají). Výherní obrazovka se ukáže jen jednou.
- Základ patra `a ≥ 9`:

  ```
  base(a) = nice( base(8) × g(a)^(a − 8) ),   g(a) = 2,2 + 0,15 × (a − 9)
  ```

  kde `base(8)` je základ patra 8 zvolené křivky (21 000 / 23 000 / 26 000, kalibrace fáze 6 — kap. 2.3.1).
  Růst je nadexponenciální (poměr mezi patry se zvyšuje z ×2,2 v patře 9 na zhruba ×4,5 v patře 16 a dál roste).

- `nice(x)` je stejné zaokrouhlení jako v hlavní hře (kap. 2.3.2). Útraty pak `nice(base × 1 / 1,5 / 2)`.
- **Finálový šéf** se objevuje v každém 8. patře (16, 24, 32…), ostatní patra mají běžné šéfy.
- **Přetečení:** pokud by cíl nebo skóre přestalo být konečné číslo (≈ patro 210), použije se
  `Number.MAX_VALUE` a UI ukáže „nekonečno“. Achievement „Tepelná smrt vesmíru“.
- Statistika nekonečného režimu: nejvyšší dosažené patro (per balíček a síla piva).

## 2. Karty, kombinace a čísla

### 2.1 Hrací karty

- Standardní balíček: 52 karet, 4 barvy × 13 hodnot (2–10, J, Q, K, A). Startovní balíčky mohou složení měnit.
- **Čipy karty:** 2–10 = číslo, J / Q / K = 10, A = 11. Kamenná karta 0 (čipy dává její vylepšení).
  K tomu se přičítají trvalé `bonusChips` (např. Klenotník, Ohmataná karta, Kopřivový odvar).
- Karta má nejvýš **jedno vylepšení, jednu pečeť a jednu edici**. Nové vylepšení/pečeť/edice přepíše staré.
- **Figury** = J, Q, K (Eso není figura). Modifikátor `allFaces` dělá figurou každou kartu.
- **Eso** je nejvyšší karta (14); jako nízké (1) se počítá jen v postupce A-2-3-4-5. Čipy má vždy 11.
- **Debuffnutá karta** (šéf, efekt) se počítá do detekce kombinace, ale nedává čipy ani žádné efekty
  (vylepšení, edice, pečeť, reakce žolíků) a nespouští opakování.
- **Karta lícem dolů** jde vybrat a zahrát; otočí se při zahrání. V náhledu kombinace se nepočítá
  (náhled ukáže „?“). Třídění ruky (hodnota / barva) ji podle skryté hodnoty nepřeskládá — zakryté karty zůstanou
  vpravo za odkrytými v dosavadním pořadí.
- Úpravy karet během runu (přidání, zničení, změna) jsou trvalé do konce runu.

### 2.2 Kombinace

#### 2.2.1 Tabulka

Úroveň 1 je výchozí. `čipy(L) = základ + přírůstek × (L − 1)`, totéž pro mult.

| Pořadí síly | Kombinace (`id`)                             | Čipy | Mult | +čipy / úr. | +mult / úr. | Úr. 1 (čipy×mult) |          Úr. 5 | Skórující karty  |
| ----------- | -------------------------------------------- | ---: | ---: | ----------: | ----------: | ----------------: | -------------: | ---------------- |
| 1           | Vysoká karta (`high_card`)                   |    6 |    1 |         +12 |          +1 |                 6 |     54×5 = 270 | 1 nejvyšší karta |
| 2           | Dvojice (`pair`)                             |   12 |    2 |         +14 |          +1 |                24 |     68×6 = 408 | 2                |
| 3           | Dvě dvojice (`two_pair`)                     |   24 |    2 |         +18 |          +1 |                48 |     96×6 = 576 | 4                |
| 4           | Trojice (`three`)                            |   28 |    3 |         +22 |          +2 |                84 | 116×11 = 1 276 | 3                |
| 5           | Postupka (`straight`)                        |   35 |    4 |         +25 |          +2 |               140 | 135×12 = 1 620 | 5                |
| 6           | Barva (`flush`)                              |   40 |    4 |         +18 |          +2 |               160 | 112×12 = 1 344 | 5                |
| 7           | Full house (`full_house`)                    |   45 |    5 |         +28 |          +2 |               225 | 157×13 = 2 041 | 5                |
| 8           | Čtveřice (`four`)                            |   65 |    6 |         +35 |          +3 |               390 | 205×18 = 3 690 | 4                |
| 9           | Postupka v barvě (`straight_flush`)          |   90 |    9 |         +40 |          +3 |               810 | 250×21 = 5 250 | 5                |
| 10          | Královská postupka (`royal_flush`)           |  120 |   10 |         +45 |          +3 |             1 200 | 300×22 = 6 600 | 5                |
| 11          | _Pětice_ (`five`) — tajná                    |  110 |   11 |         +40 |          +3 |             1 210 | 270×23 = 6 210 | 5                |
| 12          | _Barevný full house_ (`flush_house`) — tajná |  130 |   13 |         +45 |          +4 |             1 690 | 310×29 = 8 990 | 5                |
| 13          | _Barevná pětice_ (`flush_five`) — tajná      |  150 |   15 |         +55 |          +3 |             2 250 | 370×27 = 9 990 | 5                |

Poznámky k designu tabulky:

- Postupka roste po úrovních rychleji než Barva — je těžší ji poskládat, ale za investici do pranostik se odmění.
- Čtveřice je první „velký skok“ (mult 6). Tajné kombinace jsou nejsilnější, ale vyžadují upravený balíček.
- Pořadí síly (sloupec 1) určuje, která kombinace se vyhodnotí, když zahrané karty splňují víc kombinací;
  je to pořadí `HAND_TYPES` v `src/engine/types.ts`. Hodnota na vysoké úrovni na pořadí nemá vliv.

#### 2.2.2 Definice a hraniční případy

- **Vysoká karta:** skóruje jediná karta s nejvyšší hodnotou (A > K > … > 2); při shodě ta zahraná nejvíc vlevo.
- **Dvojice / Trojice / Čtveřice / Pětice:** 2 / 3 / 4 / 5 karet stejné hodnoty. Ostatní zahrané karty
  („kopy“) neskórují.
- **Dvě dvojice:** dvě dvojice různých hodnot v nejvýš 5 kartách; pátá karta neskóruje. Dvě dvojice stejné
  hodnoty jsou Čtveřice.
- **Postupka:** 5 karet po sobě jdoucích hodnot. Platí **A-2-3-4-5** (Eso nízké) i **10-J-Q-K-A** (Eso vysoké).
  **„Kolem dokola“** (např. Q-K-A-2-3) **neplatí**, pokud to nepovolí modifikátor `straightWrap`
  (žolík „Kolotoč na pouti“).
- **Barva:** 5 karet stejné barvy. Divoká karta patří do všech barev. Kamenná do žádné.
- **Full house:** Trojice + Dvojice jiné hodnoty.
- **Postupka v barvě:** Postupka, jejíž karty jsou všechny jedné barvy (včetně A-2-3-4-5).
- **Královská postupka:** Postupka v barvě, jejíž nejvyšší karta je vysoké Eso (10-J-Q-K-A v jedné barvě;
  s modifikátorem 4 karet stačí J-Q-K-A). Postupka kolem dokola nikdy není Královská.
- **Pětice:** 5 karet stejné hodnoty (možné jen s kopiemi karet nebo změnou hodnot).
- **Barevný full house:** Full house, jehož všech 5 karet má stejnou barvu.
- **Barevná pětice:** Pětice, jejíž všech 5 karet má stejnou barvu.
- **Kamenné karty** nemají hodnotu ani barvu, nepočítají se do žádné kombinace, ale **vždy skórují**
  (přidají se mezi skórující karty v pořadí, v jakém byly zahrány).
- **Debuffnuté karty** se do detekce počítají normálně.
- **Modifikátory detekce:** `fourCardStraightFlush` (Postupka i Barva stačí ze 4 karet; Postupka v barvě
  pak ze 4 karet stejné barvy po sobě), `straightGaps` (postupka smí přeskočit nejvýš jednu hodnotu mezi
  sousedními kartami, např. 3-5-6-8-9), `straightWrap` (kolem dokola), `mergedSuits` (♥ = ♦ a ♠ = ♣),
  `allFaces`, `allCardsScore` (skórují všechny zahrané karty, ne jen kombinace).
- **Výběr mezi variantami:** pokud jde zahrané karty vyhodnotit víc způsoby, vyhrává nejsilnější kombinace;
  při stejném typu ta s více skórujícími kartami, pak s vyšším součtem čipů skórujících karet, pak ta,
  jejíž karty jsou zahrané víc vlevo. Výsledek je deterministický a pokrytý testy.

#### 2.2.3 Relace „obsahuje“ (pro žolíky a šéfy)

`DetectedHand.contains` vždy obsahuje vyhodnocenou kombinaci a navíc:

| Kombinace          | Obsahuje navíc                                   |
| ------------------ | ------------------------------------------------ |
| Dvě dvojice        | Dvojice                                          |
| Trojice            | Dvojice                                          |
| Full house         | Trojice, Dvě dvojice, Dvojice                    |
| Čtveřice           | Trojice, Dvojice                                 |
| Postupka v barvě   | Postupka, Barva                                  |
| Královská postupka | Postupka v barvě, Postupka, Barva                |
| Pětice             | Čtveřice, Trojice, Dvojice                       |
| Barevný full house | Full house, Barva, Trojice, Dvě dvojice, Dvojice |
| Barevná pětice     | Pětice, Barva, Čtveřice, Trojice, Dvojice        |

Vysoká karta není obsažena v ničem jiném (žolík „na Vysokou kartu“ reaguje jen na čistou Vysokou kartu).

#### 2.2.4 Tajné kombinace

- Pětice, Barevný full house a Barevná pětice jsou **skryté**: v „Info o runu“ i ve sbírce je místo nich „???“.
- **Objev v profilu** nastane prvním zahráním (událost `handDiscovered`). Od té doby jsou vidět ve sbírce
  a v „Info o runu“ všech dalších runů (na úrovni 1).
- **Objev v runu:** pranostiky tajné kombinace se v obchodě a obálkách objevují až poté, co hráč danou
  kombinaci **v aktuálním runu** zahrál. Úrovně tajné kombinace lze do té doby zvýšit jen efekty, které
  zvyšují „všechny kombinace“.
- Jak se k nim hráč dostane: kopie karet (babská rada „Jablko od stromu“), změna hodnot („Zrcátko v předsíni“,
  „Kynuté těsto“), změna barev („Babiččina barva“, divoké karty), obálky s hracími kartami, balíček Obrázkový.

### 2.3 Cíle útrat

#### 2.3.1 Základ patra podle křivky

Cíl útraty = `nice(base(patro) × násobek útraty × Modifiers.targetMult)`. Násobek: Malá 1×, Velká 1,5×,
Šéf 2× (některý šéf jinak, viz kap. 8). Křivku určuje síla piva: **křivka 1** (Desítka, Jedenáctka),
**křivka 2** (od Dvanáctky), **křivka 3** (od Bocku).

| Patro | Křivka 1: Malá |  Velká |    Šéf | Křivka 2: Malá |  Velká |    Šéf | Křivka 3: Malá |  Velká |    Šéf |
| ----: | -------------: | -----: | -----: | -------------: | -----: | -----: | -------------: | -----: | -----: |
|     1 |            250 |    380 |    500 |            250 |    380 |    500 |            250 |    380 |    500 |
|     2 |            550 |    830 |  1 100 |            550 |    830 |  1 100 |            550 |    830 |  1 100 |
|     3 |          1 100 |  1 650 |  2 200 |          1 100 |  1 650 |  2 200 |          1 150 |  1 750 |  2 300 |
|     4 |          2 200 |  3 300 |  4 400 |          2 300 |  3 500 |  4 600 |          2 400 |  3 600 |  4 800 |
|     5 |          4 300 |  6 500 |  8 600 |          4 500 |  6 800 |  9 000 |          4 700 |  7 100 |  9 400 |
|     6 |          7 800 | 11 500 | 15 500 |          8 000 | 12 000 | 16 000 |          8 600 | 13 000 | 17 000 |
|     7 |         13 500 | 20 000 | 27 000 |         14 000 | 21 000 | 28 000 |         15 500 | 23 000 | 31 000 |
|     8 |         21 000 | 32 000 | 42 000 |         23 000 | 35 000 | 46 000 |         26 000 | 39 000 | 52 000 |

Engine má v tabulce jen základy křivek (sloupce „Malá“); Velkou a Šéfa počítá přes `nice()`. Celá tabulka slouží
jako test.

**Kalibrace se šéfy a štítky (fáze 6, 2026-10-02):** křivky jsou naladěné simulací na obsah s 101 žolíky (fáze 7
rozpracovaná), spotřebkami, obálkami, kupóny, 30 šéfy (cíle šéfů kap. 8.2/8.3) a 20 štítky tak, aby nejlepší rozumný
bot na Desítce vyhrál 25–35 % runů (naměřeno ~31–35 %) a na Imperialu < 3 % (~1 %). Křivka 1 dostala vyšší patra 5–7
a nižší patro 8 (vrchol proher má být v patrech 5–7); křivky 2 a 3 mají patra 1–3 skoro jako křivka 1 (vyšší síly
piva dřív končily v patře 2 ve 20–30 % runů kvůli ekonomice — Jedenáctka a Ležák) a přidávají až od patra 4.
Fáze 5 (bez šéfů) měla patro 8 22 000 / 27 000 / 35 000, původní návrh 80 000 / 150 000 / 250 000. Dlouhodobý cíl
CLAUDE.md kap. 3 (patro 8 řádově statisíce) dnešní obsah a boti nedosáhnou — viz `docs/DECISIONS.md` („Fáze 6:
ladění se šéfy“), co je pro to potřeba; křivky se znovu naladí po dokončení fáze 7 a ve fázi 10.

#### 2.3.2 Zaokrouhlení `nice(x)`

```
nice(x):
  x < 100   → zaokrouhli na násobek 5
  jinak     → e = floor(log10(x)); krok = 10^(e − 1)
              je-li první číslice 1 → krok = krok / 2
              výsledek = round(x / krok) × krok        (round = Math.round, polovina nahoru)
```

Tedy 2 platné číslice; začíná-li číslo jedničkou, 3 platné s krokem 5 (`14 250 → 14 500`, `115 000 → 115 000`,
`1 125 → 1 150`, `375 → 380`). Stejná funkce se použije pro všechny odvozené cíle (násobky šéfů, `targetMult`
z balíčků, výzev a kupónů, nekonečný režim).

#### 2.3.3 Ukázka nekonečného režimu (patra 9–16)

`g(a) = 2,2 + 0,15 × (a − 9)`, `base(a) = nice(base(8) × g(a)^(a − 8))`.

| Patro |    g | Křivka 1: Malá |       Velká |         Šéf | Křivka 2: Malá |         Šéf | Křivka 3: Malá |         Šéf |
| ----: | ---: | -------------: | ----------: | ----------: | -------------: | ----------: | -------------: | ----------: |
|     9 | 2,20 |         46 000 |      69 000 |      92 000 |         51 000 |     100 000 |         57 000 |     115 000 |
|    10 | 2,35 |        115 000 |     175 000 |     230 000 |        125 000 |     250 000 |        145 000 |     290 000 |
|    11 | 2,50 |        330 000 |     500 000 |     660 000 |        360 000 |     720 000 |        410 000 |     820 000 |
|    12 | 2,65 |      1 050 000 |   1 600 000 |   2 100 000 |      1 150 000 |   2 300 000 |      1 300 000 |   2 600 000 |
|    13 | 2,80 |      3 600 000 |   5 400 000 |   7 200 000 |      4 000 000 |   8 000 000 |      4 500 000 |   9 000 000 |
|    14 | 2,95 |     14 000 000 |  21 000 000 |  28 000 000 |     15 000 000 |  30 000 000 |     17 000 000 |  34 000 000 |
|    15 | 3,10 |     58 000 000 |  87 000 000 | 115 000 000 |     63 000 000 | 125 000 000 |     72 000 000 | 145 000 000 |
|    16 | 3,25 |    260 000 000 | 390 000 000 | 520 000 000 |    290 000 000 | 580 000 000 |    320 000 000 | 640 000 000 |

Pro orientaci (křivka 1): patro 20 ≈ 220 000 000 000, patro 24 ≈ 5e14, patro 32 ≈ 2,4e22, patro 40 ≈ 1,15e31
(zápis jako ve hře: od 1e15 vědecky, koncové nuly mantisy se ořezávají).

### 2.4 Kolo a peníze

#### 2.4.1 Kolo

| Parametr                                | Výchozí | Modifikátor                    |
| --------------------------------------- | ------: | ------------------------------ |
| Ruce za kolo                            |       4 | `hands`                        |
| Zahození za kolo                        |       3 | `discards`                     |
| Velikost ruky                           |       8 | `handSize`                     |
| Max. vybraných karet (zahrát i zahodit) |       5 | `maxSelect`                    |
| Sloty žolíků                            |       5 | `jokerSlots`                   |
| Sloty spotřebek                         |       2 | `consumableSlots`              |
| Startovní peníze                        |    5 Kč | `DeckDef.startingMoney`, výzvy |

Minimum: `hands ≥ 1`, `handSize ≥ 1`, `maxSelect ≥ 1`, `discards ≥ 0`, sloty ≥ 0 (efekty, které by šly pod
minimum, se ořežou).

#### 2.4.2 Odměny na konci kola (v tomto pořadí)

|   # | Položka            | Výchozí hodnota                                               | Modifikátory                                  |
| --: | ------------------ | ------------------------------------------------------------- | --------------------------------------------- |
|   1 | Odměna za útratu   | Malá 3 Kč, Velká 4 Kč, Šéf 5 Kč (`BossDef.reward`)            | `blindRewardMult`                             |
|   2 | Nevyužité ruce     | +1 Kč za každou                                               | `moneyPerUnusedHand`                          |
|   3 | Nevyužitá zahození | 0 Kč                                                          | `moneyPerUnusedDiscard`                       |
|   4 | Úrok               | +1 Kč za každých celých 5 Kč, strop 5 Kč                      | `interestStep`, `interestCap`, `interestMult` |
|   5 | Bonusy             | zlaté karty v ruce, žolíci (`roundEndMoney`), balíček, štítky | —                                             |
|   6 | Zapůjčení žolíci   | −2 Kč za každého                                              | —                                             |

- **Úrok** se počítá ze zůstatku **v okamžiku výhry kola, před výplatou** této odměny:
  `úrok = min(floor(max(0, peníze) / interestStep), interestCap) × interestMult`. Ze záporného zůstatku
  není úrok ani penále.
- Rozpis se zobrazí s animací a hráč ho potvrdí tlačítkem **Vyplatit** (akce `cashOut`).
- Přeskočená útrata nedává odměnu ani úrok a nevede do Večerky.
- Všechny odměny se násobí podle `Modifiers`; zaokrouhluje se dolů na celé koruny.

#### 2.4.3 Dluh

- Výchozí `debtLimit = 0`: zůstatek nesmí klesnout pod 0. Platba, na kterou nemáš, se neprovede
  (nákup je zakázán; srážka od šéfa se provede jen do výše dluhového limitu; poplatek za zapůjčeného žolíka
  viz 4.6).
- Žolík **Sekera** (+15), balíček **Dlužník** (+20) a výzva **Byrokracie** (+15) povolují jít do mínusu.
  Nákupy v mínusu jsou možné, dokud po nákupu nebudeš pod `−debtLimit`.

### 2.5 Večerka (obchod)

#### 2.5.1 Nabídka

| Část                                            |                  Počet | Obnova                                                               |
| ----------------------------------------------- | ---------------------: | -------------------------------------------------------------------- |
| Kartové sloty (žolík / spotřebka / hrací karta) |    2 (`shopCardSlots`) | při každém vstupu a při **Přehodit**                                 |
| Obálky                                          | 2 (`shopBoosterSlots`) | při každém vstupu (přehození je nemění)                              |
| Kupón                                           | 1 (`shopVoucherSlots`) | jednou za patro: drží se ve všech Večerkách patra až do porážky šéfa |

- **Generování kartového slotu:** typ podle vah (tabulka 2.5.3) → konkrétní položka. Žolík: vzácnost podle vah →
  náhodný odemčený žolík, kterého hráč **nevlastní** a který není v aktuální nabídce; pak edice (2.6) a nálepky
  podle síly piva (kap. 10). Je-li pool vyčerpaný, nabídne se **Pivní tácek** (smí se opakovat).
- **První Večerka runu** má v prvním slotu obálek vždy normální **Žolíkovou obálku**.
- **Kupón:** náhodný z odemčených, nevlastněných; tier 2 jen s vlastněným tier 1.
- Prázdný stav (vše koupeno): „Večerka zavřená – inventura“.
- Všechna losování jdou přes stream `shop` (obálky přes `booster`), takže přehození neovlivní míchání balíčku.

#### 2.5.2 Ceny

| Položka                            |                                      Cena | Poznámka                                                                    |
| ---------------------------------- | ----------------------------------------: | --------------------------------------------------------------------------- |
| Žolík běžný                        |                                    4–5 Kč | konkrétní cena v `JokerDef.cost`                                            |
| Žolík vzácný                       |                                    6–7 Kč |                                                                             |
| Žolík epický                       |                                   8–10 Kč |                                                                             |
| Žolík legendární                   |                                     16 Kč | jen z razítka „Výjimka z vyhlášky“, nikdy v obchodě; cena slouží pro prodej |
| Pranostika                         |                                      3 Kč |                                                                             |
| Babská rada                        |                                      4 Kč |                                                                             |
| Úřední razítko                     |                                      6 Kč | v obchodě jen s kupónem „Babiččina spíž“                                    |
| Hrací karta                        |                                      2 Kč | + vylepšení +1 Kč, pečeť +2 Kč, edice dle 2.6                               |
| Obálka normální / tlustá / krabice |                             4 / 7 / 10 Kč | kap. 2.9                                                                    |
| Kupón                              |                                   8–15 Kč | kap. 6                                                                      |
| Přehození                          | 4 Kč, +1 Kč za každé další v téže Večerce | `rerollBaseCost`, `rerollCostStep`; nová Večerka začíná znovu od základu    |

- **Výsledná cena** = `max(1, round((základ + příplatky) × (100 − shopDiscountPct) / 100)) + shopPriceAdd`
  (round = polovina nahoru; `shopPriceAdd` je +1 na Jedenáctce, kap. 10). Přehození se slevou nezlevňuje,
  `shopPriceAdd` na něj platí.
- Zdarma (štítky, efekty) = cena 0, a to i při `shopPriceAdd`.
- **Prodej** žolíka nebo spotřebky: `max(1, floor(základní cena / 2)) + sellBonus`. Základní cena = cena
  z definice + příplatek za edici (bez slev a bez `shopPriceAdd`). Přibitý žolík nejde prodat, zapůjčený
  se prodá za 1 Kč. Hrací karty ani kupóny prodat nejde.

#### 2.5.3 Váhy kartových slotů

| Typ            | Výchozí váha | Mění                                        |
| -------------- | -----------: | ------------------------------------------- |
| Žolík          |           14 | —                                           |
| Pranostika     |            3 | Trhací kalendář (+4), Babiččina spíž (+1,5) |
| Babská rada    |            3 | Trhací kalendář (+4), Babiččina spíž (+1,5) |
| Úřední razítko |            0 | Babiččina spíž (+2)                         |
| Hrací karta    |            0 | Stánek s kartami (+5)                       |

Výchozí podíl: žolík 70 %, pranostika 15 %, babská rada 15 %.

**Vzácnost žolíka** v obchodě i v Žolíkové obálce: běžný 68, vzácný 26, epický 6, legendární 0.

**Hrací karta** v obchodě: hodnota a barva rovnoměrně z výchozího složení startovního balíčku; vylepšení 20 %
(s „Kartářkou“ 50 %), pečeť 0 % (s „Kartářkou“ 20 %), edice podle 2.6.

### 2.6 Edice

| Edice (`id`)           | Efekt                                            | Na čem           | Šance u žolíka (obchod, obálka) | Šance u hrací karty | Příplatek |
| ---------------------- | ------------------------------------------------ | ---------------- | ------------------------------: | ------------------: | --------: |
| Lesklá (`foil`)        | +50 čipů                                         | žolík, karta     |                           2,5 % |                 5 % |     +1 Kč |
| Holografická (`holo`)  | +10 mult                                         | žolík, karta     |                           1,5 % |               2,5 % |     +2 Kč |
| Duhová (`poly`)        | ×1,5 mult                                        | žolík, karta     |                           0,4 % |                 1 % |     +4 Kč |
| Negativní (`negative`) | +1 slot (žolíka u žolíka, spotřebky u spotřebky) | žolík, spotřebka |                          0,25 % |                   — |     +6 Kč |

- **Načasování u žolíka:** lesklá a holografická se aplikují **před** vlastním efektem žolíka, duhová **po** něm
  (`jokerTiming`). Edice funguje i u žolíka, který v dané ruce sám nic nedělá. Debuffnutý žolík nedává nic,
  ani efekt edice.
- **U hrací karty** se edice aplikuje ve skórování po vylepšení (kap. 3, krok 2).
- `editionRateMult` násobí šance lesklé, holografické a duhové (negativní ne). Nejdřív samostatný hod na negativní
  (jen žolíci), pak jeden hod `r`: `r < p_duhová` → duhová; jinak `r < p_duhová + p_holo` → holografická;
  jinak `r < p_duhová + p_holo + p_lesklá` → lesklá; jinak bez edice.
- Negativní spotřebky vznikají jen speciálními efekty (v 1.0 žádný běžný zdroj; engine je podporuje).

### 2.7 Vylepšení hracích karet

| Vylepšení (`id`)   | Efekt                                                            | Kdy                            | Zdroj (babská rada) |
| ------------------ | ---------------------------------------------------------------- | ------------------------------ | ------------------- |
| Prémiová (`bonus`) | +25 čipů                                                         | při skórování                  | Heřmánkový čaj      |
| Pálivá (`mult`)    | +5 mult                                                          | při skórování                  | Pálivá paprička     |
| Skleněná (`glass`) | ×2 mult; po vyhodnocení ruky 1 z 5, že praskne (zničí se)        | při skórování                  | Babiččina vitrína   |
| Ocelová (`steel`)  | ×1,5 mult                                                        | když je držená v ruce (krok 3) | Litinový hrnec      |
| Kamenná (`stone`)  | +50 čipů; nemá hodnotu ani barvu; vždy skóruje                   | při skórování                  | Kámen na zelí       |
| Zlatá (`gold`)     | +3 Kč                                                            | držená v ruce na konci kola    | Dukát pod polštář   |
| Šťastná (`lucky`)  | 1 z 4: +15 mult; nezávisle 1 z 12: +15 Kč                        | při skórování                  | Čtyřlístek          |
| Divoká (`wild`)    | patří do všech barev (pro Barvu i efekty barev)                  | vždy                           | Kvetoucí kapradí    |
| Ohmataná (`worn`)  | po každé ruce, ve které skórovala, trvale +3 čipy (`bonusChips`) | po vyhodnocení                 | Dědova peněženka    |

- Skleněná: hod na prasknutí proběhne **jednou za zahranou ruku** (`afterScored`), i když karta skórovala
  vícekrát; karta se zničí až po sečtení skóre (krok 5), takže svou ruku ještě dohraje.
- Šťastná: hody proběhnou při každé aktivaci (červená pečeť = dvě šance).
- Ohmataná je 9. vlastní vylepšení — pomalé škálování pro hráče, kteří rádi „pěstují“ balíček.
- Flavor texty: Prémiová „Třináctý plat pro jednu kartu.“, Pálivá „Opatrně, pálí i v ruce.“, Skleněná
  „Křehká jako slib před volbami.“, Ocelová „Drží, i když nehraje.“, Kamenná „Těžká, poctivá, bez hodnot.“,
  Zlatá „Kdo šetří, má za tři.“, Šťastná „Kominík jí podal ruku.“, Divoká „Hraje za všechny týmy.“,
  Ohmataná „Tuhle kartu držel v ruce už děda.“

### 2.8 Pečetě

| Pečeť (`id`)       | Efekt                                                                                                                    | Zdroj                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Zlatá (`gold`)     | +2 Kč při každém skórování karty                                                                                         | razítko „Ověřeno notářem“ |
| Červená (`red`)    | karta se aktivuje 1× navíc — ve skórování (krok 2) i v ruce (krok 3)                                                     | razítko „Kolek“           |
| Modrá (`blue`)     | drží-li se karta v ruce na konci kola, vytvoří pranostiku poslední kombinace zahrané v tomto kole (potřebuje volný slot) | razítko „Modrý formulář“  |
| Fialová (`purple`) | při zahození vytvoří náhodnou babskou radu (potřebuje volný slot)                                                        | razítko „Doporučeně“      |

Modrá pečeť bez zahrané ruky v kole (nemůže nastat při výhře) nic nevytvoří. Více modrých karet = více pranostik
(do zaplnění slotů).

### 2.9 Obálky (boostery)

Velikosti: **Obálka** (normální), **Tlustá obálka** (jumbo), **Krabice od bot** (mega). V UI „Tlustá obálka · Žolíci“.

| Druh (`kind`)             | Velikost                  |  Možností |   Vybereš |       Cena |  Váha v obchodě |
| ------------------------- | ------------------------- | --------: | --------: | ---------: | --------------: |
| Pranostiky (`pranostika`) | Obálka / Tlustá / Krabice | 3 / 4 / 6 | 1 / 1 / 2 | 4 / 7 / 10 |   5 / 2,5 / 0,6 |
| Babské rady (`rada`)      | Obálka / Tlustá / Krabice | 3 / 4 / 6 | 1 / 1 / 2 | 4 / 7 / 10 |   5 / 2,5 / 0,6 |
| Razítka (`razitko`)       | Obálka / Tlustá / Krabice | 2 / 3 / 5 | 1 / 1 / 2 | 4 / 7 / 10 |   1 / 0,5 / 0,1 |
| Žolíci (`joker`)          | Obálka / Tlustá / Krabice | 2 / 3 / 5 | 1 / 1 / 2 | 4 / 7 / 10 | 1,5 / 0,7 / 0,2 |
| Hrací karty (`card`)      | Obálka / Tlustá / Krabice | 3 / 4 / 6 | 1 / 1 / 2 | 4 / 7 / 10 | 3,5 / 1,5 / 0,4 |

Součet vah je 25,6 (normální 16 : tlusté 7,7 : krabice 1,9), tj. normální obálka ≈ 63 %, tlustá ≈ 30 %,
krabice od bot ≈ 7 %. Druhy: pranostiky a babské rady po ≈ 32 %, hrací karty ≈ 21 %, žolíci ≈ 9 %,
razítka ≈ 6 %. (Počty možností i váhy jsou vlastní — viz příloha A.)

Pravidla:

- Otevření babské nebo razítkové obálky dobere ruku (`handSize` karet z balíčku) jen pro výběr cílů;
  po zavření se karty vrátí.
- Vybranou **spotřebku** můžeš hned použít, nebo ji uložit do volného slotu. **Žolík** jde do slotu
  (bez volného slotu ho nejde vybrat, leda je negativní). **Hrací karta** se přidá do balíčku.
- Obálku lze **přeskočit** (žolíci s `onBoosterSkipped` na to reagují).
- Možnosti v jedné obálce se neopakují. Pranostiková obálka nabízí jen kombinace dostupné v runu (tajné po objevu).
  Razítko „Výjimka z vyhlášky“ má v razítkové obálce váhu 0,25 (ostatní 1).
- **Karetní obálka:** hodnota a barva z výchozího složení startovního balíčku (Mariášový jen 7–A, Obrázkový jen
  J–A); vylepšení 35 %, pečeť 15 %, edice podle 2.6.
- **Žolíková obálka:** vzácnosti 68 / 26 / 6, edice a nálepky jako v obchodě.

### 2.10 Konstanty (souhrn pro `src/engine/constants.ts`)

| Konstanta                         | Hodnota                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_MODIFIERS`                  | hands 4, discards 3, handSize 8, maxSelect 5, jokerSlots 5, consumableSlots 2, interestStep 5, interestCap 5, interestMult 1, moneyPerUnusedHand 1, moneyPerUnusedDiscard 0, blindRewardMult 1, debtLimit 0, shopCardSlots 2, shopBoosterSlots 2, shopVoucherSlots 1, rerollBaseCost 4, rerollCostStep 1, shopDiscountPct 0, shopWeightJoker 14, shopWeightPranostika 3, shopWeightRada 3, shopWeightRazitko 0, shopWeightPlayingCard 0, editionRateMult 1, probabilityMult 1, targetMult 1, booleany false |
| `STARTING_MONEY`                  | 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `BLIND_REWARDS`                   | small 3, big 4, boss 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `BLIND_TARGET_MULT`               | small 1, big 1,5, boss 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `FINAL_ANTE`                      | 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RARITY_WEIGHTS`                  | common 68, rare 26, epic 6, legendary 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `PERISH_ROUNDS`                   | 6 (zvětrávající žolík)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `RENTAL_BUY_PRICE` / `RENTAL_FEE` | 2 Kč / 2 Kč za kolo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `MAX_ACTIVATIONS_PER_CARD`        | 10 (pojistka proti nekonečným opakováním)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SEED_ALPHABET`                   | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, délka 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 3. Skórování

### 3.1 Pořadí vyhodnocení (závazné, shodné s `docs/ARCHITECTURE.md` 2.5)

0. **Příprava.** Hráč vybere 1–`maxSelect` karet a dá **Zahrát**. Engine detekuje kombinaci (kap. 2.2) a určí
   skórující karty. Šéf může ruku zablokovat (`validateHand`, např. Soused s vrtačkou) — ruka se spotřebuje,
   skóre 0, karty odejdou. Pak žolíci zleva doprava s `beforeScoring` (smějí např. zvýšit úroveň kombinace).
1. **Základ kombinace:** čipy a mult podle aktuální úrovně, případně upravené šéfem (`modifyBase`).
2. **Skórující karty zleva doprava** (v pořadí, v jakém je hráč zahrál). Pro každou **aktivaci** karty:
   1. čipy karty (`cardChips`: hodnota + `bonusChips`; kamenná 0),
   2. vylepšení (`onScored`: Prémiová, Pálivá, Skleněná, Kamenná, Šťastná),
   3. edice karty (lesklá +čipy, holografická +mult, duhová ×mult),
   4. pečeť (`onScored`: zlatá +2 Kč),
   5. žolíci zleva doprava (`onCardScored`).

   Počet aktivací = 1 + opakování (červená pečeť +1, žolíci `retriggerScored`), max. `MAX_ACTIVATIONS_PER_CARD`.
   Každé opakování zopakuje celou sekvenci 1–5 (žolíci dostanou `isRetrigger = true`).
   Debuffnutá karta se přeskočí celá (ani se neopakuje).

3. **Karty držené v ruce zleva doprava** (pořadí zobrazení v ruce). Pro každou aktivaci: vylepšení (`onHeld`:
   Ocelová ×1,5) → žolíci zleva doprava (`onCardHeld`). Opakování: červená pečeť +1, `retriggerHeld`.
   Karta lícem dolů funguje v ruce normálně, debuffnutá se přeskočí.
4. **Žolíci zleva doprava** (`onHandPlayed`). Pro každého žolíka:
   edice „před“ (lesklá +50 čipů, holografická +10 mult) → vlastní efekt žolíka → edice „po“ (duhová ×1,5).
   Kopírující žolík vyvolá efekt cíle (`isCopy = true`) a obalí ho **svou** edicí.
5. **Výsledek:** `skóre = floor(čipy × mult)`. Pak `afterHandScored` žolíků (počítadla, peníze), šéf
   `afterHandPlayed` (srážky, zahazování), `afterScored` vylepšení (hod skla, Ohmataná +3), zničení karet
   označených k zničení, přičtení skóre ke skóre kola, kontrola výhry kola, dobrání karet.

Pravidla aplikace výsledku efektu (`EffectResult`): **čipy → mult → ×mult → peníze**, každé jako samostatný
`ScoreStep` s průběžnými hodnotami (UI je přehrává jako „tik tik tik“). Peníze se připíší okamžitě, takže
efekt, který čte zůstatek a je v pořadí později (např. Doktor Faust), už je započítá. Čipy jsou celá čísla, mult je `number`
(bez zaokrouhlování během výpočtu), skóre se zaokrouhlí dolů až v kroku 5.

**Výhra kola** nastane hned, jak skóre kola dosáhne cíle (≥). Zbývající ruce jsou nevyužité (odměna kap. 2.4).

**Náhled** při výběru karet (`HandPreview`) ukazuje jen kombinaci, úroveň a základ (krok 1) — bez žolíků a bez
náhody, aby náhled nic neprozrazoval a byl levný.

### 3.2 Pracovní příklad

**Situace (pozdní fáze runu):**

- Kombinace: **Full house** na úrovni 2 → čipy `45 + 28 = 73`, mult `5 + 2 = 7`.
- Zahráno (zleva): **K♥** Pálivá (+5 mult) · **K♠** lesklá edice (+50 čipů) · **K♦** · **5♣** Prémiová (+25 čipů)
  · **5♥** Skleněná (×2 mult) s červenou pečetí.
- V ruce zůstaly: **Q♠** Ocelová · **Q♣** · **7♦**.
- Žolíci (zleva): **[1] Srdcař** (každá skórující ♥ +5 čipů a +2 mult) s holografickou edicí · **[2] Pivní tácek**
  (+10 čipů a +2 mult) · **[3] Zpožděný rychlík** (×1,5 mult, 1 z 6 nenastane) s duhovou edicí.

| Krok | Zdroj                              | Změna                        | Čipy |       Mult |
| ---- | ---------------------------------- | ---------------------------- | ---: | ---------: |
| 1    | Full house úr. 2                   | základ                       |   73 |          7 |
| 2    | K♥ čipy                            | +10                          |   83 |          7 |
| 2    | K♥ Pálivá                          | +5 mult                      |   83 |         12 |
| 2    | K♥ → Srdcař                        | +5 čipů, +2 mult             |   88 |         14 |
| 2    | K♠ čipy                            | +10                          |   98 |         14 |
| 2    | K♠ lesklá                          | +50                          |  148 |         14 |
| 2    | K♦ čipy                            | +10                          |  158 |         14 |
| 2    | 5♣ čipy                            | +5                           |  163 |         14 |
| 2    | 5♣ Prémiová                        | +25                          |  188 |         14 |
| 2    | 5♥ čipy                            | +5                           |  193 |         14 |
| 2    | 5♥ Skleněná                        | ×2                           |  193 |         28 |
| 2    | 5♥ → Srdcař                        | +5 čipů, +2 mult             |  198 |         30 |
| 2    | 5♥ **znovu** (červená pečeť): čipy | +5                           |  203 |         30 |
| 2    | 5♥ Skleněná                        | ×2                           |  203 |         60 |
| 2    | 5♥ → Srdcař                        | +5 čipů, +2 mult             |  208 |         62 |
| 3    | Q♠ Ocelová (v ruce)                | ×1,5                         |  208 |         93 |
| 3    | Q♣, 7♦ (v ruce)                    | —                            |  208 |         93 |
| 4    | [1] Srdcař — holografická (před)   | +10 mult                     |  208 |        103 |
| 4    | [1] Srdcař — vlastní efekt po ruce | žádný (reaguje jen na karty) |  208 |        103 |
| 4    | [2] Pivní tácek                    | +10 čipů, +2 mult            |  218 |        105 |
| 4    | [3] Zpožděný rychlík               | ×1,5                         |  218 |      157,5 |
| 4    | [3] duhová (po)                    | ×1,5                         |  218 |     236,25 |
| 5    | výsledek                           | `floor(218 × 236,25)`        |      | **51 502** |

Po sečtení: hod skla u 5♥ (1 z 5, jednou za ruku) — když praskne, karta se zničí až teď. Kdyby Zpožděný rychlík
„nabral zpoždění“, jeho vlastní ×1,5 by odpadlo, ale duhová edice by platila dál: `floor(218 × 157,5) = 34 335`.
(Jeden efekt s čipy i multem se v UI ukáže jako dva kroky: nejdřív čipy, pak mult — `ScoreStep` je vždy jedna
změna. Přesné pořadí kroků hlídá test „pracovní příklad z DESIGN 3.2“ v `tests/unit/scoring.test.ts`.)

Poučení pro hráče (do tipů na načítací obrazovce): **+mult patří doleva, ×mult doprava** a ocelové karty
nech v ruce.

## 4. Žolíci

### 4.1 Vzácnosti a ceny

| Vzácnost (`rarity`)      |    Cena | Prodej |     Váha v obchodě a Žolíkové obálce | Fáze 4 | Cíl 1.0 (fáze 7) |
| ------------------------ | ------: | -----: | -----------------------------------: | -----: | ---------------: |
| Běžný (`common`)         |  4–5 Kč |   2 Kč |                                   68 |     15 |               44 |
| Vzácný (`rare`)          |  6–7 Kč |   3 Kč |                                   26 |     10 |               32 |
| Epický (`epic`)          | 8–10 Kč | 4–5 Kč |                                    6 |      5 |               17 |
| Legendární (`legendary`) |   16 Kč |   8 Kč | 0 (jen razítko „Výjimka z vyhlášky“) |      0 |                8 |
| **Celkem**               |         |        |                                      | **30** |          **101** |

Výchozí limit 5 slotů (`jokerSlots`), negativní edice +1. Pořadí žolíků je herně důležité — hráč je přesouvá
tažením (akce `reorderJokers`), klik otevře detail s tlačítkem Prodat.

### 4.2 Referenční ruce a přepočty hodnoty

Hodnotu žolíka měříme jako **průměrné procentní navýšení skóre ruky** proti referenční ruce:

- **R1 (patra 1–3):** 60 čipů × 8 mult = 480 bodů (kombinace úr. 1–2 + 1–2 slabší žolíci).
- **R2 (patra 6–8):** 200 čipů × 40 mult × 3 (souhrnný ×mult ostatních žolíků) = 24 000 bodů.

| Efekt                                              | Hodnota vůči R1 | Hodnota vůči R2 |
| -------------------------------------------------- | --------------: | --------------: |
| +1 mult                                            |         +12,5 % |          +2,5 % |
| +10 čipů                                           |         +16,7 % |            +5 % |
| ×1,5 mult                                          |           +50 % |           +50 % |
| 1 Kč za kolo (heuristika: peníze → síla v obchodě) |         ≈ +10 % |          ≈ +2 % |

Průměr se počítá přes **všechny ruce typického runu se strategií, která žolíka rozumně podporuje** (ne ideální
případ). Podmíněný efekt = efekt × četnost splnění podmínky v takové strategii. Škálující žolík se hodnotí
průměrem za očekávanou dobu držení (koupě v patře 2 → patro 8).

### 4.3 Cílová průměrná hodnota podle vzácnosti

| Vzácnost   | Patra 1–3: navýšení vůči R1 | ≈ ekvivalent v patrech 1–3                          | Patra 6–8: navýšení vůči R2 | ≈ ekvivalent v patrech 6–8 |   Ekonomika | Δ výher v simulaci (Desítka) |
| ---------- | --------------------------: | --------------------------------------------------- | --------------------------: | -------------------------- | ----------: | ---------------------------: |
| Běžný      |               +35 až +100 % | +3 až +8 mult · +20 až +60 čipů · ×1,35–2 podmíněně |                 +8 až +30 % | +3 až +12 mult · ×1,1–1,3  | 2–3 Kč/kolo |               +2 až +6 p. b. |
| Vzácný     |               +50 až +130 % | +4 až +10 mult · ×1,5–2,3                           |                +20 až +60 % | +8 až +24 mult · ×1,2–1,6  | 3–5 Kč/kolo |              +4 až +10 p. b. |
| Epický     |               +80 až +180 % | ×1,8–2,8                                            |               +45 až +110 % | ×1,45–2,1                  | 5–7 Kč/kolo |              +7 až +15 p. b. |
| Legendární |              +150 až +350 % | ×2,5–4,5                                            |              +100 až +300 % | ×2–4                       |           — |             +12 až +25 p. b. |

Pravidla tabulky:

1. Žolík musí dosáhnout **dolní hranice aspoň v jednom okně** (patra 1–3 nebo 6–8) — jinak je bezcenný.
2. Žolík **nesmí překročit horní hranici v žádném okně** — jinak je „auto-win“.
3. **Špička** (ideální ruka, plný build) smí horní hranici překročit nejvýš 2×.
4. Ekonomičtí a užitkoví žolíci se ověřují hlavně simulací (sloupec Δ výher = rozdíl % výher runů, kde žolík
   byl ve slotu aspoň 6 kol, proti runům bez něj; normalizováno na patro koupě).
5. Žolík mimo pásmo v simulaci se ladí změnou čísla v `params` (ne přepisem mechaniky), změna do `DECISIONS.md`.

Ukázky: **Pivní tácek** (+2 mult, +10 čipů) = (70 × 10) / 480 → **+46 %** R1, (210 × 42) / 8 000 → **+10 %** R2 ✔.
**Srdcař** v „srdcovém“ balíčku (≈ 2,5 skórujících ♥ na ruku): +12,5 čipů a +5 mult → **+96 %** R1, **+19 %** R2 ✔.
**Zpožděný rychlík** (×1,5 s šancí 5/6 = průměr ×1,42): **+42 %** v obou oknech — v R1 pod dolní hranicí vzácného,
v R2 v pásmu ✔ (typický „pozdní“ žolík).

### 4.4 Pravidla pro design žolíka

1. **Mechanika = jedna přesná věta s čísly** (max. ~110 znaků). Čísla jsou v `params` a text je čte přes `{param}`;
   dynamický stav (počítadla) přes `describe(self)` → „(teď ×1,6)“.
2. **Žádný bezcenný, žádný auto-win** — viz 4.3. Žádné nekonečné smyčky: opakování max. `MAX_ACTIVATIONS_PER_CARD`,
   škálování bez stropu jen lineární (exponenciální jen se stropem).
3. **Čitelnost:** podmínka musí jít ověřit z obrazovky (žádné skryté počítadlo; stav ukazuje bublina/popisek).
4. **Náhoda jen jako „1 z N“** přes `ctx.chance(n, d)`; popisek vždy ukazuje aktuální šanci (respektuje `probabilityMult`).
5. **Determinismus a serializace:** stav jen v `self.state` (JSON), náhoda jen přes RNG streamy, žádný reálný čas.
6. **Disciplína hooků:** hook mění jen `self.state` a stav přes `ctx.api`; při `isCopy = true` nemění `self.state`.
7. **Kopírovatelnost:** `copyable: false` mají žolíci, jejichž efekt je čistě `passive` pravidlo nebo by kopie
   vytvořila smyčku (ekonomika z prodeje, kopírující žolíci navzájem — kopie kopie se vyhodnotí max. 1 úroveň).
8. **Ničivé efekty** (zničení karty/žolíka) musí být v textu výslovně a s cílem, který hráč ovlivní (pořadí, výběr).
9. **Synergie:** každý žolík má aspoň jednoho „partnera“ (jiný žolík, vylepšení, balíček, kupón) — buildy vznikají kombinací.
10. **Unikátnost:** žádný čistý duplikát „stejný efekt, jiné číslo“; výjimkou jsou rodiny (např. 4 barevní žolíci,
    každý s jiným typem efektu).
11. **Obsahová pravidla:** název max. 3 slova, flavor = jedna vtipná hláška, žádné žijící osoby ani značky,
    `ArtSpec` (ikona z game-icons + paleta + vzor), u ~30 % podmínka odemčení, každý žolík ≥ 1 test.
12. **Nálepky:** žolíci, kteří se sami ničí (Sněhulák, Pokladnička), mají `noEternal`; čistě ekonomičtí mají
    `noRental` (zapůjčený ekonomický žolík by jen platil sám sebe).

### 4.5 Kategorie efektů

| Kategorie (`JokerTag`)                   | Typické hooky                                      | Příklad             | Poznámka k balancu                   |
| ---------------------------------------- | -------------------------------------------------- | ------------------- | ------------------------------------ |
| +čipy (`chips`)                          | `onCardScored`, `onHandPlayed`                     | Hrobník             | silné brzy, slabé pozdě              |
| +mult (`mult`)                           | `onCardScored`, `onHandPlayed`                     | Srdcař, Ranní ptáče | patří vlevo před ×mult               |
| ×mult (`xmult`)                          | `onHandPlayed`                                     | Pan vrchní          | jádro pozdní hry, patří vpravo       |
| Ekonomika (`economy`)                    | `roundEndMoney`, `onSell`, `onShopEnter`           | Zahrádkář Venca     | hodnota klesá s patrem               |
| Škálování (`scaling`)                    | `afterHandScored`, `onRoundEnd`, `onCardDestroyed` | Stálý host          | hodnotit průměrem za dobu držení     |
| Opakování (`retrigger`)                  | `retriggerScored`, `retriggerHeld`                 | Ozvěna z propasti   | násobí efekty karet i žolíků         |
| Úpravy pravidel (`utility`)              | `passive` (`Modifiers`)                            | Kolotoč na pouti    | otevírají nové buildy                |
| Kopírování (`copy`)                      | `copyTarget`                                       | Napodobitel         | max. 3 v celé hře                    |
| Spotřebky/balíček (`consumable`, `deck`) | `onConsumableUsed`, `onCardAdded`                  | Kořenářka, Golem    | propojují žolíky s ostatními systémy |

Další štítky pro filtr sbírky a pro boty: `hand`, `suit`, `face`, `rank`, `discard`.

### 4.6 Nálepky obtížností

Každý žolík má nejvýš jednu nálepku. Losuje se při vzniku žolíka v obchodě nebo obálce v pořadí
přibitý → zapůjčený → zvětrávající (první úspěšný hod vyhrává); šance určuje síla piva (kap. 10).

| Nálepka (`id`)                  | Ikona         | Pravidlo                                                                                                                                                                                                         |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Přibitý** (`eternal`)         | hřebík        | Nejde prodat ani zničit (efekty ničící žolíky ho přeskočí).                                                                                                                                                      |
| **Zvětrávající** (`perishable`) | pivo bez pěny | Po 6 dokončených kolech ve slotu **zvětrá**: trvale debuffnutý (nefunguje on ani jeho edice). Prodat jde normálně. UI ukazuje zbývající kola.                                                                    |
| **Zapůjčený** (`rental`)        | visačka       | V obchodě i obálce stojí **2 Kč** (místo ceny). Na konci každého kola **−2 Kč** (krok 6 výplaty). Když poplatek nejde zaplatit ani do dluhového limitu, žolík „se vrací do půjčovny“ (zničí se). Prodej za 1 Kč. |

### 4.7 Žolíci pro fázi 4 (30)

|   # | Název (`id`)                        | Vzácnost | Cena | Kategorie       | Mechanika                                                                                                     | Hook(y)                            | Flavor                                                            |
| --: | ----------------------------------- | -------- | ---: | --------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
|   1 | Pivní tácek (`beer_mat`)            | běžný    |    4 | +mult           | +10 čipů a +2 mult. Jediný žolík, který se smí v nabídce opakovat.                                            | `onHandPlayed`                     | „Každá čárka se počítá.“                                          |
|   2 | Srdcař (`hearts_man`)               | běžný    |    5 | +mult           | Každá skórující ♥ dá +5 čipů a +2 mult.                                                                       | `onCardScored`                     | „Srdce na dlani, peněženku v kapse.“                              |
|   3 | Hrobník (`gravedigger`)             | běžný    |    5 | +čipy           | Každá skórující ♠ dá +20 čipů.                                                                                | `onCardScored`                     | „Pro každou piku kope zvlášť.“                                    |
|   4 | Klenotník (`jeweler`)               | běžný    |    5 | škálování       | Každá skórující ♦ trvale získá +5 čipů.                                                                       | `onCardScored`                     | „Každou káru nejdřív vyleští.“                                    |
|   5 | Křižák (`crusader`)                 | běžný    |    4 | +mult           | +12 mult, pokud skórují aspoň 2 ♣.                                                                            | `onHandPlayed`                     | „Na výpravu se nechodí sám.“                                      |
|   6 | Ranní ptáče (`early_bird`)          | běžný    |    4 | +mult           | První ruka kola dá +8 mult.                                                                                   | `onHandPlayed`                     | „Kdo dřív přijde, ten dřív skóruje.“                              |
|   7 | Noční směna (`night_shift`)         | běžný    |    4 | +mult           | V kole se šéfem dá každá ruka +14 mult.                                                                       | `onHandPlayed`                     | „Po půlnoci platí noční tarif. A šéf chodí na kontrolu.“          |
|   8 | Meteorolog (`meteorologist`)        | běžný    |    5 | +mult           | +2 mult za každou úroveň zahrané kombinace nad 1.                                                             | `onHandPlayed`                     | „Zítra polojasno, místy přeháňky bodů.“                           |
|   9 | Tělocvikář (`pe_teacher`)           | běžný    |    4 | +čipy           | +8 čipů za každou zahranou kartu (i neskórující).                                                             | `onHandPlayed`                     | „Nastoupit do řady, i s omluvenkou!“                              |
|  10 | Párty pro dva (`party_for_two`)     | běžný    |    4 | +mult           | +15 čipů a +3 mult, pokud zahraná ruka obsahuje Dvojici.                                                      | `onHandPlayed`                     | „Do páru se to táhne líp.“                                        |
|  11 | Zahrádkář Venca (`gardener`)        | běžný    |    5 | ekonomika       | Na konci kola +2 Kč za každé 3 karty držené v ruce.                                                           | `roundEndMoney`                    | „Kompost nelže.“                                                  |
|  12 | Švejk (`svejk`)                     | běžný    |    4 | úpravy pravidel | Po ruce, která dala méně než 10 % cíle kola, získáš +1 zahození (nejvýš 2× za kolo).                          | `afterHandScored`                  | „Poslušně hlásím, že to byl taktický ústup.“                      |
|  13 | Pokladnička (`piggy_bank`)          | běžný    |    5 | ekonomika       | Na konci kola +2 Kč; po 8. kole se rozbije, dá ještě 8 Kč a zmizí.                                            | `roundEndMoney`, `onRoundEnd`      | „Kladívko je přivázané na provázku.“                              |
|  14 | Bazarník (`flea_trader`)            | běžný    |    4 | ekonomika       | Na konci kola +3 Kč za každý prázdný slot žolíka.                                                             | `roundEndMoney`                    | „Prodám všechno, i ten regál.“                                    |
|  15 | Golem (`golem`)                     | běžný    |    5 | +čipy           | Při získání přidá do balíčku 2 kamenné karty; každá skórující kamenná karta dá +20 čipů navíc.                | `onAcquire`*, `onCardScored`       | „Šém mu vložili, návod nikdo.“                                    |
|  16 | Zpožděný rychlík (`late_train`)     | vzácný   |    6 | ×mult           | ×1,5 mult; 1 z 6 efekt „nabere zpoždění“ a nenastane.                                                         | `onHandPlayed`                     | „Mult přijede s mírným zpožděním.“                                |
|  17 | Pan vrchní (`head_waiter`)          | vzácný   |    7 | ×mult           | ×2 mult, pokud zahraná ruka má nejvýš 3 karty.                                                                | `onHandPlayed`                     | „Platím! — Za tři.“                                               |
|  18 | Stará garda (`old_guard`)           | vzácný   |    6 | ×mult           | ×1,5 mult, pokud má zahraná kombinace úroveň aspoň 3.                                                         | `onHandPlayed`                     | „My to hráli, když byla Dvojice ještě na jedničce.“               |
|  19 | Kořenářka (`herbalist`)             | vzácný   |    6 | škálování       | Po každé použité babské radě trvale +2 mult (začíná na +0).                                                   | `onConsumableUsed`, `onHandPlayed` | „Na každou bolest bylinka, na každou bylinku mult.“               |
|  20 | Stálý host (`regular`)              | vzácný   |    6 | škálování       | +1 mult za každé kolo, které od koupě strávil ve slotu.                                                       | `onRoundEnd`, `onHandPlayed`       | „Má tu vlastní hrnek i vlastní židli.“                            |
|  21 | Pivní břicho (`beer_belly`)         | vzácný   |    6 | škálování       | Po každé zahrané ruce trvale +2 čipy (začíná na +0).                                                          | `afterHandScored`, `onHandPlayed`  | „Tohle není břicho, to je dlouhodobá investice.“                  |
|  22 | Kolotoč na pouti (`carousel`)       | vzácný   |    6 | úpravy pravidel | Postupka smí jít kolem dokola (např. Q-K-A-2-3) a každá Postupka dá +14 mult.                                 | `passive`, `onHandPlayed`          | „Točí se to dokola jako každý rok.“                               |
|  23 | Ozvěna z propasti (`echo`)          | vzácný   |    7 | opakování       | Poslední skórující karta skóruje ještě 4×.                                                                    | `retriggerScored`                  | „Haló! …haló …aló …ló …ó.“                                        |
|  24 | Šťastná sedmička (`lucky_seven`)    | vzácný   |    6 | opakování       | Každá skórující karta: 1 ze 7, že skóruje ještě 7×.                                                           | `retriggerScored`                  | „Automat v nádražce sype jednou za čas. Zato pořádně.“            |
|  25 | Sekera (`tab`)                      | vzácný   |    6 | ekonomika       | Můžeš jít do mínusu až −15 Kč; +1 mult za každou korunu, která ti chybí do 15 Kč.                             | `passive`, `onHandPlayed`          | „Zapište mi to. Čím míň v kapse, tím víc na tácku.“               |
|  26 | Sněhulák (`snowman`)                | epický   |    8 | ×mult           | ×2,5 mult; po každém kole −×0,25; při ×1 roztaje (zničí se).                                                  | `onHandPlayed`, `onRoundEnd`       | „Na jaře z něj zbude jen mrkev.“                                  |
|  27 | Sběrač hub (`mushroom_picker`)      | epický   |    9 | škálování       | ×1 mult a navíc +×0,25 za každou hrací kartu zničenou od jeho koupě.                                          | `onCardDestroyed`, `onHandPlayed`  | „Rostou tam, kde něco zmizelo.“                                   |
|  28 | Napodobitel (`impersonator`)        | epický   |   10 | kopírování      | Při získání bez edice dostane duhovou; v každém kole kopíruje tvého nejdražšího běžného nebo vzácného žolíka. | `onAcquire`, `copyTarget`          | „V kulturáku napodobí kohokoli, jen na hvězdy mu flitry nestačí.“ |
|  29 | Hostinský (`innkeeper`)             | epický   |    8 | ×mult           | ×2,5 mult, dokud v tomto kole nikdo nezahazoval.                                                              | `onHandPlayed`                     | „U mě se nic nevylévá.“                                           |
|  30 | Babiččina truhla (`grandmas_chest`) | epický   |    8 | ×mult           | ×1,3 mult za každou spotřebku, kterou držíš ve slotech.                                                       | `onHandPlayed`                     | „Na půdě je všechno, co jednou bude k něčemu.“                    |

\* `onAcquire` je nový hook (žolík vstoupil do slotů — koupě, obálka, efekt); viz příloha B.

Čísla č. 4, 5, 6, 11, 14, 22, 23 a 29 jsou po měření hodnoty (`npx tsx scripts/joker-value.ts`, kap. 4.2–4.3)
upravená proti původnímu návrhu; staré → nové číslo, naměřené hodnoty a důvody jsou v `docs/DECISIONS.md`
(„Ladění žolíků fáze 4 podle hodnoty 4.3“). Č. 27 (Sběrač hub, +×0,15 → +×0,25 za kartu) je upravené po přeměření
se spotřebkami ve fázi 5 („Fáze 5: boti se spotřebkami a předběžná kalibrace cílů“); Kořenářka, Babiččina truhla,
Meteorolog a Stará garda jsou po přeměření v pásmu beze změny. Č. 7, 24, 25 a 28 (Noční směna, Šťastná sedmička,
Sekera, Napodobitel) měly ve fázi 4 mechaniku, kterou číslem do pásma dostat nešlo; ve fázi 7 jsou přepracované
(téma zůstalo, mechanika je nová) — staré → nové a naměřené hodnoty v `docs/DECISIONS.md` („Fáze 7: legendární žolíci
a přepracování čtyř žolíků pod pásmem“).

Rozložení fáze 4: +mult 7, +čipy 3, ×mult 6, ekonomika 4, škálování 5, opakování 2, úpravy pravidel 2, kopírování 1.
Pro start bez odemykání (fáze 4–7) jsou všichni dostupní; podmínky odemčení přijdou ve fázi 8.

### 4.8 Legendární žolíci (fáze 7, 8 kusů)

Objevují se **jen** z razítka „Výjimka z vyhlášky“. Cena 16 Kč (prodej 8 Kč). Všichni jsou postavy nebo symboly
z českých pověstí.

| Název (`id`)                       | Mechanika                                                                                           | Hook(y)                      | Flavor                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| Praotec Čech (`forefather`)        | První ruka každého kola zvýší úroveň zahrané kombinace o 1 (před skórováním).                       | `beforeScoring`              | „Tady se usadíme a tady budeme skórovat.“                     |
| Kněžna Libuše (`libuse`)           | Každá skórující dáma dá ×1,4 mult; na konci kola promění 1 náhodnou kartu drženou v ruce v dámu.    | `onCardScored`, `onRoundEnd` | „Vidím skóre veliké, jehož sláva hvězd se dotýká.“            |
| Blaničtí rytíři (`blanik_knights`) | ×3 mult, dokud je skóre kola pod polovinou cíle.                                                    | `onHandPlayed`               | „Vyjedou, až bude nejhůř. Na začátku kola je vždycky nejhůř.“ |
| Bruncvíkův meč (`bruncvik_sword`)  | Při prvním zahození v kole zničí nejnižší zahozenou kartu a trvale získá +×0,2 mult (začíná na ×1). | `onDiscard`, `onHandPlayed`  | „Seká sám. Stačí říct: ‚Hlavy dolů!‘“                         |
| Doktor Faust (`faust`)             | ×1 mult a navíc +×0,06 za každou korunu, kterou máš (nejvýš ×5).                                    | `onHandPlayed`               | „Duši neprodal, jen ji dal do zástavy.“                       |
| Krakonoš (`krakonos`)              | Každá použitá pranostika zvýší úroveň o 1 navíc a dá +2 Kč.                                         | `onConsumableUsed`           | „Počasí si dělá sám. Úrovně taky.“                            |
| Hloupý Honza (`silly_honza`)       | Vysoká karta a Dvojice dávají ×4 mult.                                                              | `onHandPlayed`               | „Ležel na peci, a stejně vyhrál princeznu.“                   |
| Orloj (`astro_clock`)              | ×2 mult v první ruce kola, ×3 ve druhé a ×4 v každé další.                                          | `onHandPlayed`               | „Kostlivec zvoní, apoštolové kynou, skóre se násobí.“         |

Čísla Libuše, Fausta a Orloje jsou po měření hodnoty (`scripts/joker-value.ts`, kap. 4.2–4.3) upravená proti
původnímu návrhu (×1,5 za dámu bez proměny karet: +27 % / +27 %; +×0,05 za korunu: R2 +100,6 % na hraně; Orloj
×1 / ×2 / ×3 / ×4: +43 % / +69 %, protože v patrech 1–3 je 80 % rukou první ruka kola). Praotec Čech a Krakonoš zvyšují úrovně, které měřicí nástroj
nevidí (úrovně si nastavuje sám) — hodnotí se simulací a projekcí přidaných úrovní; podrobnosti
v `docs/DECISIONS.md` („Fáze 7: legendární žolíci a přepracování čtyř žolíků pod pásmem“).

### 4.9 Plán na 100+ žolíků (fáze 7)

| Kategorie                        |     Fáze 4 |     Cíl 1.0 | Skutečnost 1.0 (z toho legendárních) |
| -------------------------------- | ---------: | ----------: | -----------------------------------: |
| +mult                            |          7 |          18 |                               18 (0) |
| +čipy                            |          3 |          10 |                                9 (0) |
| ×mult                            |          6 |          16 |                               21 (5) |
| Ekonomika                        |          4 |          12 |                               12 (0) |
| Škálování                        |          5 |          14 |                               13 (2) |
| Opakování                        |          2 |           7 |                                5 (0) |
| Úpravy pravidel                  |          2 |          10 |                               10 (0) |
| Kopírování                       |          1 |           3 |                                3 (0) |
| Spotřebky / balíček              |          0 |          11 |                               10 (1) |
| **Celkem** (z toho legendárních) | **30** (0) | **101** (8) |                          **101** (8) |

Skutečnost = hlavní kategorie každého žolíka v tabulce 4.10 (revize obsahu fáze 7). Bez legendárních sedí +mult,
×mult, ekonomika, úpravy pravidel i kopírování přesně na cíl; legendární jsou z 5/8 ×mult (DESIGN 4.8), proto ×mult
o 5 nad cílem a +čipy, škálování, opakování a spotřebky o 1–2 pod ním. Vědomě: opakování mají jen běžní a epičtí
(u vzácných dělalo špičky nad pravidlem 3 — DECISIONS „Vzácní žolíci fáze 7“); doplnění je kandidát na obsahové
patche (`docs/IDEAS.md`). Zdůvodnění v `docs/DECISIONS.md` („Revize obsahu fáze 7“).

**Zásobník nápadů pro fázi 7** (návrhy — čísla se doladí podle 4.3; konečná podoba je v 4.10, úpravy proti
zásobníku v `docs/DECISIONS.md` u jednotlivých skupin a v „Revizi obsahu fáze 7“ — např. Hlídač parkoviště → Vrátný,
Zkratka přes louku → Vyšlapaná pěšina, Bludička bez náhody):

| Název               | Vzácnost | Návrh mechaniky                                                         |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| Známý na úřadě      | vzácný   | Jednou za patro můžeš zdarma přelosovat šéfa (akce `rerollBoss`).       |
| Teta z poradny      | běžný    | Po použití babské rady 1 z 3, že vznikne další náhodná babská rada.     |
| Chatař              | běžný    | +4 mult za každý prázdný slot spotřebky.                                |
| Střelec z pouti     | běžný    | Každá skórující 10 dá +6 mult.                                          |
| Trafikant           | běžný    | V každé Večerce stojí první spotřebka 1 Kč.                             |
| Kronikář            | vzácný   | +2 mult za každou různou kombinaci zahranou od jeho koupě.              |
| Revizor             | běžný    | +30 čipů, pokud mezi zahranými kartami není žádná figura.               |
| Hlídač parkoviště   | běžný    | Každý Král držený v ruce dá +6 mult.                                    |
| Kominík             | vzácný   | Šance šťastných karet jsou dvojnásobné.                                 |
| Zlatník             | běžný    | Zlaté karty dávají na konci kola +2 Kč navíc.                           |
| Sklář               | vzácný   | Skleněné karty nepraskají.                                              |
| Dlaždič             | běžný    | Každá kamenná karta držená v ruce dá +5 mult.                           |
| Pošťák              | běžný    | +1 Kč za každou otevřenou obálku; obálky stojí o 1 Kč méně.             |
| Notář               | vzácný   | Každá skórující karta s pečetí dá +6 mult.                              |
| Čarodějnice         | vzácný   | Po porážce šéfa vytvoří náhodné úřední razítko (potřebuje místo).       |
| Hokynář             | běžný    | +2 mult za každého běžného žolíka (včetně sebe).                        |
| Pivní sommelier     | epický   | ×1 mult a +×0,25 za každou jinou kombinaci zahranou v tomto kole.       |
| Táta u grilu        | běžný    | +40 čipů, pokud se v tomto kole zahazovalo právě jednou.                |
| Učitelka            | běžný    | +3 mult, pokud jsou všechny skórující karty sudé (2, 4, 6, 8, 10).      |
| Vodník              | vzácný   | Každá zahozená ♦ mu trvale dá +1 mult („dušičky v hrníčcích“).          |
| Hejkal              | běžný    | 1 z 3: +15 mult.                                                        |
| Bludička            | vzácný   | 1 z 4: ×3 mult.                                                         |
| Polednice           | vzácný   | Druhá ruka kola ×2 mult.                                                |
| Klekánice           | vzácný   | ×2 mult, pokud v ruce nedržíš žádnou figuru.                            |
| Pan farář           | vzácný   | Karty s červenou pečetí se aktivují ještě 1× navíc.                     |
| Vědma               | vzácný   | Když jedinou rukou dosáhneš cíle kola, vytvoří pranostiku té kombinace. |
| Tramvaják           | běžný    | +6 mult, pokud to není první ruka kola a v kole už se zahazovalo.       |
| Archivář            | epický   | Kopíruje schopnost žolíka nalevo od sebe.                               |
| Kouzelník z pouti   | epický   | Skórují všechny zahrané karty (`allCardsScore`).                        |
| Dvorní malíř        | vzácný   | Všechny karty jsou figury (`allFaces`).                                 |
| Barvoslepý strýc    | vzácný   | ♥ a ♦ jsou jedna barva, ♠ a ♣ také (`mergedSuits`).                     |
| Turistický průvodce | epický   | Postupka i Barva stačí ze 4 karet (`fourCardStraightFlush`).            |
| Zkratka přes louku  | vzácný   | Postupka smí přeskočit jednu hodnotu (`straightGaps`).                  |
| Sázkař              | běžný    | Na konci kola 1 z 3: +6 Kč.                                             |

### 4.10 Finální seznam 101 žolíků (po revizi fáze 7)

Stav po revizi obsahu fáze 7: 44 běžných, 32 vzácných, 17 epických a 8 legendárních (cíl 4.1). Mechanika je popisek
ze hry s čísly z `params` (bez dynamických dovětků „(teď …)“); texty žijí v `src/i18n/cs/jokers/*.ts`, definice
v `src/content/jokers/*.ts` a přesné znění hlídá `tests/unit/jokers-combos.test.ts`. Kategorie = hlavní kategorie
pro rozložení 4.9 (štítky `tags` mohou být širší). Hodnoty podle 4.3 (`scripts/joker-value.ts`) jsou u jednotlivých
skupin v `docs/DECISIONS.md`.

|   # | Název (`id`)                                   | Vzácnost   | Cena | Kategorie         | Fáze | Mechanika                                                                                                         | Flavor                                                                                |
| --: | ---------------------------------------------- | ---------- | ---: | ----------------- | ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
|   1 | Pivní tácek (`beer_mat`)                       | běžný      |    4 | +mult             | 4    | +10 čipů a +2 mult. Jako jediný žolík se smí v nabídce opakovat.                                                  | „Každá čárka se počítá.“                                                              |
|   2 | Srdcař (`hearts_man`)                          | běžný      |    5 | +mult             | 4    | Každá skórující srdcová karta dá +5 čipů a +2 mult.                                                               | „Srdce na dlani, peněženku v kapse.“                                                  |
|   3 | Hrobník (`gravedigger`)                        | běžný      |    5 | +čipy             | 4    | Každá skórující piková karta dá +20 čipů.                                                                         | „Pro každou piku kope zvlášť.“                                                        |
|   4 | Klenotník (`jeweler`)                          | běžný      |    5 | škálování         | 4    | Každá skórující kárová karta trvale získá +5 čipů.                                                                | „Každou káru nejdřív vyleští.“                                                        |
|   5 | Křižák (`crusader`)                            | běžný      |    4 | +mult             | 4    | +12 mult, pokud skórují aspoň 2 křížové karty.                                                                    | „Na výpravu se nechodí sám.“                                                          |
|   6 | Ranní ptáče (`early_bird`)                     | běžný      |    4 | +mult             | 4    | První ruka kola dá +8 mult.                                                                                       | „Kdo dřív přijde, ten dřív skóruje.“                                                  |
|   7 | Noční směna (`night_shift`)                    | běžný      |    4 | +mult             | 4    | V kole se šéfem dá každá ruka +14 mult.                                                                           | „Po půlnoci platí noční tarif. A šéf chodí na kontrolu.“                              |
|   8 | Meteorolog (`meteorologist`)                   | běžný      |    5 | +mult             | 4    | +2 mult za každou úroveň zahrané kombinace nad první.                                                             | „Zítra polojasno, místy přeháňky bodů.“                                               |
|   9 | Tělocvikář (`pe_teacher`)                      | běžný      |    4 | +čipy             | 4    | +8 čipů za každou zahranou kartu, i za neskórující.                                                               | „Nastoupit do řady, i s omluvenkou!“                                                  |
|  10 | Párty pro dva (`party_for_two`)                | běžný      |    4 | +mult             | 4    | +15 čipů a +3 mult, pokud zahraná ruka obsahuje Dvojici.                                                          | „Do páru se to táhne líp.“                                                            |
|  11 | Zahrádkář Venca (`gardener`)                   | běžný      |    5 | ekonomika         | 4    | Na konci kola +2 Kč za každé 3 karty držené v ruce.                                                               | „Kompost nelže.“                                                                      |
|  12 | Švejk (`svejk`)                                | běžný      |    4 | úpravy pravidel   | 4    | Po ruce za méně než 10 % cíle kola získáš +1 zahození, nejvýš 2× za kolo.                                         | „Poslušně hlásím, že to byl taktický ústup.“                                          |
|  13 | Pokladnička (`piggy_bank`)                     | běžný      |    5 | ekonomika         | 4    | Na konci kola +2 Kč. Po 8. kole se rozbije, dá ještě 8 Kč a zmizí.                                                | „Kladívko je přivázané na provázku.“                                                  |
|  14 | Bazarník (`flea_trader`)                       | běžný      |    4 | ekonomika         | 4    | Na konci kola +3 Kč za každý prázdný slot žolíka.                                                                 | „Prodám všechno, i ten regál.“                                                        |
|  15 | Golem (`golem`)                                | běžný      |    5 | +čipy             | 4    | Při získání přidá do balíčku 2 kamenné karty; každá skórující kamenná karta dá +20 čipů navíc.                    | „Šém mu vložili, návod nikdo.“                                                        |
|  16 | Teta z poradny (`helpline_aunt`)               | běžný      |    5 | spotřebky/balíček | 7    | Po použití babské rady 1 z 2, že vznikne další náhodná babská rada (potřebuje volný slot).                        | „Poradí ti, i když se neptáš. Hlavně když se neptáš.“                                 |
|  17 | Chatař (`weekend_cottager`)                    | běžný      |    4 | +mult             | 7    | +3 mult za každý prázdný slot spotřebky.                                                                          | „Na chatě nemá signál ani zásoby. A je mu tam nejlíp.“                                |
|  18 | Střelec z pouti (`shooting_gallery`)           | běžný      |    5 | +mult             | 7    | Každá skórující desítka nebo figura dá +3 mult.                                                                   | „Za desítku růže z krepáku, za figuru medvěd větší než ty.“                           |
|  19 | Trafikant (`tobacconist`)                      | běžný      |    5 | spotřebky/balíček | 7    | Při vstupu do Večerky 1 z 2, že ti dá náhodnou pranostiku (potřebuje volný slot).                                 | „Noviny, losy, cigarety. Předpověď počasí dostaneš zadarmo, ať chceš, nebo ne.“       |
|  20 | Revizor (`ticket_inspector`)                   | běžný      |    4 | +čipy             | 7    | +50 čipů, pokud mezi zahranými kartami není žádná figura.                                                         | „Jízdenky, prosím. Králové, dámy a kluci vystoupí na příští.“                         |
|  21 | Vrátný (`doorman`)                             | běžný      |    5 | +mult             | 7    | Každá figura držená v ruce dá +4 mult.                                                                            | „Pana ředitele pozdraví, paní hlavní účetní taky. Tebe dál nepustí.“                  |
|  22 | Zlatník (`goldsmith`)                          | běžný      |    5 | spotřebky/balíček | 7    | Na konci kola promění náhodnou kartu bez vylepšení drženou v ruce na zlatou.                                      | „Pozlatí ti cokoli. Nejvíc účet.“                                                     |
|  23 | Dlaždič (`paver`)                              | běžný      |    5 | spotřebky/balíček | 7    | Každé zahození promění první zahozenou kartu bez vylepšení na kamennou; každá skórující kamenná karta dá +5 mult. | „Kostku ke kostce. Za tři roky to přijdou zase rozkopat.“                             |
|  24 | Pošťák (`postman`)                             | běžný      |    4 | ekonomika         | 7    | Za každou otevřenou obálku dostaneš 3 Kč.                                                                         | „Nikdo nebyl doma, tak nechal lísteček. Vyzvednout zítra od osmi do devíti.“          |
|  25 | Hokynář (`grocer`)                             | běžný      |    4 | +mult             | 7    | +2 mult za každého jiného běžného žolíka (jiní Hokynáři se nepočítají).                                           | „Má všechno, co se běžně shání. Neběžné až ve čtvrtek.“                               |
|  26 | Táta u grilu (`grill_dad`)                     | běžný      |    4 | +čipy             | 7    | +60 čipů, pokud se v tomto kole zahazovalo právě 1×.                                                              | „Maso se otáčí jen jednou. A radit mu nebudeš.“                                       |
|  27 | Učitelka (`teacher`)                           | běžný      |    4 | +mult             | 7    | +15 mult, pokud mají všechny skórující karty sudou hodnotu (dvojky, čtyřky, šestky, osmičky a desítky).           | „Samé sudé? Jednička s hvězdičkou. Lichá jde do žákovské.“                            |
|  28 | Hejkal (`hejkal`)                              | běžný      |    4 | +mult             | 7    | 1 z 3, že zahraná ruka dostane +15 mult.                                                                          | „Hejká po lese, až se ozvěna stydí. Občas se trefí do noty.“                          |
|  29 | Tramvaják (`tram_driver`)                      | běžný      |    4 | +mult             | 7    | +12 mult, pokud to není první ruka kola a v kole už se zahazovalo.                                                | „Ukončete výstup a nástup. Kdo zahazoval, ten jede dál.“                              |
|  30 | Sázkař (`punter`)                              | běžný      |    4 | ekonomika         | 7    | Na konci kola 1 z 3, že vyhraje 6 Kč.                                                                             | „Má systém. Systém má jeho výplatu.“                                                  |
|  31 | Drbna z pavlače (`pavlac_gossip`)              | běžný      |    5 | ×mult             | 7    | ×1,5 mult, pokud je zahraná kombinace stejná jako v minulé ruce.                                                  | „Zase Dvojice? To už ví celý dům. Zítra celá ulice.“                                  |
|  32 | Rundu všem (`round_for_everyone`)              | běžný      |    5 | ×mult             | 7    | ×1,4 mult, pokud zahraješ 5 karet a všechny skórují.                                                              | „Hospodský, rundu pro všech pět! Platí ten, kdo to řekl nahlas.“                      |
|  33 | Nakládaný hermelín (`pickled_cheese`)          | běžný      |    4 | +čipy             | 7    | +6 čipů za každou kartu drženou v ruce.                                                                           | „Čím déle leží, tím víc voní. Celý lokál to ocení.“                                   |
|  34 | Třináctý plat (`thirteenth_salary`)            | běžný      |    5 | ekonomika         | 7    | Po porážce šéfa dostaneš v odměnách navíc 8 Kč.                                                                   | „Prémie za splnění plánu. Plán zněl: porazit šéfa.“                                   |
|  35 | Brigádník (`temp_worker`)                      | běžný      |    4 | ekonomika         | 7    | Na konci kola +2 Kč za každou ruku zahranou v tomto kole.                                                         | „Placený od kusu. Kusů je hodně, kvalita se dořeší.“                                  |
|  36 | Rybář (`fisherman`)                            | běžný      |    5 | spotřebky/balíček | 7    | Po každém zahození 1 z 2, že něco chytí: náhodnou babskou radu (potřebuje volný slot).                            | „Největší kapr mu zase utekl. Domů nese aspoň dobrou radu.“                           |
|  37 | Popelář (`garbage_man`)                        | běžný      |    4 | škálování         | 7    | Každá zahozená karta s hodnotou nejvýš 5 mu trvale přidá +1 čip.                                                  | „Ve čtvrtek v šest ráno odveze všechno. Hlavně tvůj spánek.“                          |
|  38 | Hrací automat (`jukebox`)                      | běžný      |    5 | opakování         | 7    | Skórující karty s nejvyšší hodnotou skórují ještě 1×.                                                             | „Za pětikorunu hraje pořád stejnou písničku. Celou noc.“                              |
|  39 | Kůlna (`tool_shed`)                            | běžný      |    4 | úpravy pravidel   | 7    | +1 slot spotřebky.                                                                                                | „Vejde se tam všechno. Hlavně to, co pak nikdy nenajdeš.“                             |
|  40 | Náhradní autobus (`replacement_bus`)           | běžný      |    4 | úpravy pravidel   | 7    | Každé z prvních 2 zahození v kole zvětší do konce kola ruku o 1 kartu.                                            | „Pojede to o hodinu déle, ale vejde se celá vesnice i s kozou.“                       |
|  41 | Zabijačka (`pig_slaughter`)                    | běžný      |    5 | spotřebky/balíček | 7    | Na konci kola zničí nejnižší kartu bez vylepšení drženou v ruce a dá za ni 2 Kč.                                  | „Z prasete se využije všechno kromě kvičení. Z dvojky taky.“                          |
|  42 | Městské derby (`derby_fans`)                   | běžný      |    4 | +mult             | 7    | +8 mult, pokud mezi skórujícími kartami je červená i černá barva.                                                 | „Půlka hospody fandí červeným, půlka černým. Hospodský fandí tržbě.“                  |
|  43 | Hospodský kvíz (`pub_quiz`)                    | běžný      |    4 | +čipy             | 7    | +10 čipů za každou různou hodnotu mezi skórujícími kartami.                                                       | „Hlavní cena: sud piva. Cena útěchy: taky sud piva.“                                  |
|  44 | Sběrna surovin (`scrap_yard`)                  | běžný      |    5 | škálování         | 7    | Za každou zničenou hrací kartu trvale +3 mult, nejvýš +21 mult.                                                   | „Za kilo karet dvacet haléřů a pochvala do žákovské.“                                 |
|  45 | Zpožděný rychlík (`late_train`)                | vzácný     |    6 | ×mult             | 4    | ×1,5 mult; 1 z 6, že efekt „nabere zpoždění“ a nenastane.                                                         | „Mult přijede s mírným zpožděním.“                                                    |
|  46 | Pan vrchní (`head_waiter`)                     | vzácný     |    7 | ×mult             | 4    | ×2 mult, pokud zahraná ruka má nejvýš 3 karty.                                                                    | „Platím! – Za tři.“                                                                   |
|  47 | Stará garda (`old_guard`)                      | vzácný     |    6 | ×mult             | 4    | ×1,5 mult, pokud má zahraná kombinace úroveň aspoň 3.                                                             | „My to hráli, když byla Dvojice ještě na jedničce.“                                   |
|  48 | Kořenářka (`herbalist`)                        | vzácný     |    6 | škálování         | 4    | Po každé použité babské radě trvale +2 mult.                                                                      | „Na každou bolest bylinka, na každou bylinku mult.“                                   |
|  49 | Stálý host (`regular`)                         | vzácný     |    6 | škálování         | 4    | +1 mult za každé kolo, které od koupě strávil ve slotu.                                                           | „Má tu vlastní hrnek i vlastní židli.“                                                |
|  50 | Pivní břicho (`beer_belly`)                    | vzácný     |    6 | škálování         | 4    | Po každé zahrané ruce trvale +2 čipy.                                                                             | „Tohle není břicho, to je dlouhodobá investice.“                                      |
|  51 | Kolotoč na pouti (`carousel`)                  | vzácný     |    6 | úpravy pravidel   | 4    | Postupka smí jít kolem dokola (např. Q-K-A-2-3) a každá Postupka dá +14 mult.                                     | „Točí se to dokola jako každý rok.“                                                   |
|  52 | Ozvěna z propasti (`echo`)                     | vzácný     |    7 | opakování         | 4    | Poslední skórující karta skóruje ještě 4×.                                                                        | „Haló! …haló …aló …ló …ó.“                                                            |
|  53 | Šťastná sedmička (`lucky_seven`)               | vzácný     |    6 | opakování         | 4    | Každá skórující karta: 1 ze 7, že skóruje ještě 7×.                                                               | „Automat v nádražce sype jednou za čas. Zato pořádně.“                                |
|  54 | Sekera (`tab`)                                 | vzácný     |    6 | ekonomika         | 4    | Můžeš jít do mínusu až −15 Kč; +1 mult za každou korunu, která ti chybí do 15 Kč.                                 | „Zapište mi to. Čím míň v kapse, tím víc na tácku.“                                   |
|  55 | Známý na úřadě (`office_connection`)           | vzácný     |    6 | úpravy pravidel   | 7    | Cíl šéfa je o 20 % nižší a po každém přeskočení útraty přelosuje šéfa patra.                                      | „Nic neslibuju. Ale švagrová dělá na podatelně.“                                      |
|  56 | Kronikář (`chronicler`)                        | vzácný     |    7 | škálování         | 7    | Za každou kombinaci, kterou od jeho koupě zahraješ poprvé, trvale +2 mult.                                        | „Zapsal to do obecní kroniky. Krasopisně, s datem a s chybou.“                        |
|  57 | Kominík (`chimney_sweep`)                      | vzácný     |    6 | +mult             | 7    | Každá skórující piková, křížová nebo šťastná karta: 1 z 2, že dá +6 mult.                                         | „Kdo ho potká, chytí se za knoflík. Kdo ho nepotká, chytí se za hlavu.“               |
|  58 | Sklář (`glassblower`)                          | vzácný     |    7 | spotřebky/balíček | 7    | Při získání přidá do balíčku 1 skleněnou kartu; každou zničenou skleněnou kartu hned vyfoukne do balíčku znovu.   | „Střepy přinášejí štěstí. Hlavně sklářům.“                                            |
|  59 | Notář (`notary_public`)                        | vzácný     |    6 | ekonomika         | 7    | První ruka Malé a Velké útraty dá ještě před skórováním první skórující kartě bez pečeti zlatou pečeť.            | „Podpis ověří za minutu, poplatek naúčtuje za hodinu. Na šéfy nemá úřední hodiny.“    |
|  60 | Čarodějnice (`witch`)                          | vzácný     |    6 | spotřebky/balíček | 7    | Po porážce šéfa vytvoří náhodné úřední razítko (potřebuje volný slot).                                            | „Na Filipojakubskou noc se pálí. Zbytek roku razítkuje.“                              |
|  61 | Vodník (`water_goblin`)                        | vzácný     |    6 | škálování         | 7    | Každá zahozená srdcová karta mu trvale přidá +1 mult.                                                             | „Co hodíš do rybníka, to on schová pod hrníček.“                                      |
|  62 | Bludička (`will_o_wisp`)                       | vzácný     |    6 | ×mult             | 7    | V kole se šéfem dá každá ruka ×2 mult.                                                                            | „Svítí jen v té největší tmě. Kam vede, to už neřekne.“                               |
|  63 | Polednice (`noon_witch`)                       | vzácný     |    6 | ×mult             | 7    | Druhá ruka kola dá ×2 mult.                                                                                       | „Kdo v poledne zlobí, toho si odnese. Kdo hraje, tomu zdvojnásobí mult.“              |
|  64 | Klekánice (`klekanice`)                        | vzácný     |    6 | ×mult             | 7    | ×2 mult, pokud ti po zahrání v ruce nezůstala žádná figura.                                                       | „Po klekání mají být všichni doma. Králové, dámy i kluci.“                            |
|  65 | Pan farář (`parish_priest`)                    | vzácný     |    6 | +mult             | 7    | +5 mult za každou kartu v balíčku, která má vylepšení, pečeť nebo edici.                                          | „Zná každou ovečku jménem. Hlavně ty, co mají na sobě něco blyštivého.“               |
|  66 | Vědma (`seer`)                                 | vzácný     |    6 | spotřebky/balíček | 7    | Když jediná ruka dosáhne celého cíle Malé útraty, vytvoří pranostiku její kombinace (potřebuje volný slot).       | „Vidím budoucnost: zítra bude pršet a ty zahraješ Dvojici.“                           |
|  67 | Dvorní malíř (`court_painter`)                 | vzácný     |    6 | úpravy pravidel   | 7    | Všechny karty kromě kamenných se počítají jako figury.                                                            | „Namaluje tě jako krále. Za příplatek i s koněm.“                                     |
|  68 | Barvoslepý strýc (`colorblind_uncle`)          | vzácný     |    6 | úpravy pravidel   | 7    | Srdcové a kárové karty se počítají jako jedna barva, pikové a křížové taky.                                       | „Na semaforu jezdí podle pořadí, ne podle barvy.“                                     |
|  69 | Vyšlapaná pěšina (`trodden_path`)              | vzácný     |    6 | úpravy pravidel   | 7    | Mezi sousedními kartami Postupky smí chybět jedna hodnota.                                                        | „Kudy chodí všichni, tam jednou udělají chodník. Za dvacet let.“                      |
|  70 | Válečná kořist (`war_loot`)                    | vzácný     |    6 | ekonomika         | 7    | Na konci kola +2 Kč za každého šéfa poraženého od jeho koupě.                                                     | „Žižka nikdy neprohrál bitvu. Kořist počítal po vozech.“                              |
|  71 | Anonymní diskutér (`anonymous_commenter`)      | vzácný     |    6 | +mult             | 7    | Každá zahraná karta, která neskóruje, dá +7 mult.                                                                 | „Nečetl jsem to, ale nesouhlasím.“                                                    |
|  72 | Virální video (`viral_video`)                  | vzácný     |    6 | +čipy             | 7    | První ruka kola dá +64 čipů, každá další ruka v kole polovinu předchozí.                                          | „Včera milion zhlédnutí, dnes trapárna.“                                              |
|  73 | Kopírák (`carbon_paper`)                       | vzácný     |    7 | kopírování        | 7    | Kopíruje schopnost nejpravějšího běžného nebo vzácného žolíka, kterého jde kopírovat.                             | „Průklep je skoro jako originál. Jen trochu modřejší.“                                |
|  74 | Defenestrace (`defenestration`)                | vzácný     |    6 | ekonomika         | 7    | Každé zahození, ve kterém je aspoň jedna figura, dá 5 Kč.                                                         | „Námitky se v Praze tradičně vyřizují oknem.“                                         |
|  75 | Brňák (`brno_native`)                          | vzácný     |    6 | ×mult             | 7    | ×1,5 mult, pokud stojí v řadě žolíků úplně vlevo.                                                                 | „Hradec? To je ta vesnice u Brna?“                                                    |
|  76 | Sociální bublina (`social_bubble`)             | vzácný     |    6 | +čipy             | 7    | Když mají všechny skórující karty stejnou barvu nebo stejnou hodnotu, každá dá +15 čipů.                          | „Všichni stejní, všichni souhlasí. Kdo nesouhlasí, ten tu není.“                      |
|  77 | Sněhulák (`snowman`)                           | epický     |    8 | ×mult             | 4    | ×2,5 mult; po každém kole −×0,25, při ×1 roztaje a zničí se.                                                      | „Na jaře z něj zbude jen mrkev.“                                                      |
|  78 | Sběrač hub (`mushroom_picker`)                 | epický     |    9 | škálování         | 4    | ×1 mult a navíc +×0,25 za každou hrací kartu zničenou od jeho koupě.                                              | „Rostou tam, kde něco zmizelo.“                                                       |
|  79 | Napodobitel (`impersonator`)                   | epický     |   10 | kopírování        | 4    | Při získání bez edice dostane duhovou; v každém kole kopíruje tvého nejdražšího běžného nebo vzácného žolíka.     | „V kulturáku napodobí kohokoli, jen na hvězdy mu flitry nestačí.“                     |
|  80 | Hostinský (`innkeeper`)                        | epický     |    8 | ×mult             | 4    | ×2,5 mult, dokud se v tomto kole nezahazovalo.                                                                    | „U mě se nic nevylévá.“                                                               |
|  81 | Babiččina truhla (`grandmas_chest`)            | epický     |    8 | ×mult             | 4    | ×1,3 mult za každou spotřebku, kterou držíš ve slotech.                                                           | „Na půdě je všechno, co jednou bude k něčemu.“                                        |
|  82 | Pivní sommelier (`beer_sommelier`)             | epický     |    9 | ×mult             | 7    | ×1 mult a navíc +×0,7 za každou různou kombinaci zahranou v tomto kole (včetně této ruky).                        | „Nejdřív ležák, pak polotmavé, nakonec řezané. Po čtvrtém už hodnotí jen pěnu.“       |
|  83 | Archivář (`archivist`)                         | epický     |   10 | kopírování        | 7    | Při získání bez edice dostane duhovou; kopíruje schopnost žolíka nalevo od sebe.                                  | „Opis souhlasí s originálem. Kde je originál, ví jen on a regál číslo čtyřicet sedm.“ |
|  84 | Kouzelník z pouti (`fair_magician`)            | epický     |    9 | úpravy pravidel   | 7    | Skórují všechny zahrané karty a každá skórující karta dá ×1,15 mult.                                              | „Z klobouku vytáhne králíka, z rukávu eso a z tvé peněženky stovku.“                  |
|  85 | Turistický průvodce (`tour_guide`)             | epický     |    8 | úpravy pravidel   | 7    | Postupka i Barva stačí ze čtyř karet a ruka, která obsahuje Postupku nebo Barvu, dá +40 čipů.                     | „Značky mají čtyři barvy a jemu to stačí. Pátá cesta stejně vede do hospody.“         |
|  86 | Spartakiáda (`spartakiada`)                    | epický     |    9 | opakování         | 7    | V první ruce kola skóruje každá skórující karta ještě 2×.                                                         | „Tisíc párů trenýrek, jeden pohyb. A pak ještě dvakrát, pro televizi.“                |
|  87 | Kupónová privatizace (`voucher_privatization`) | epický     |    8 | ekonomika         | 7    | Na konci kola +1 Kč za každých 5 % cíle, o které skóre kola cíl překročilo (nejvýš 8 Kč).                         | „Za knížku kupónů slibovali desetinásobek. Fond je mezitím někde u moře.“             |
|  88 | Lázeňský host (`spa_guest`)                    | epický     |    9 | škálování         | 7    | Za každé kolo, ve kterém se nezahazovalo, trvale +×0,15 mult.                                                     | „Kolonáda, oplatka, pramen. Hlavně nic nevyhazovat, pan doktor říkal klid.“           |
|  89 | Dechovka (`brass_band`)                        | epický     |    8 | opakování         | 7    | Každá skórující karta skóruje ještě 2× za každou další skórující kartu stejné hodnoty.                            | „Hrají pořád tutéž polku. Na třetí sloce už zpívá celá náves.“                        |
|  90 | Karlův most (`charles_bridge`)                 | epický     |    9 | ×mult             | 7    | ×3 mult, pokud držíš v ruce kartu stejné hodnoty jako některá skórující karta.                                    | „Jedna je na Malé Straně, druhá na Starém Městě. Spojuje je most a tisíc turistů.“    |
|  91 | Dálnice D1 (`d1_motorway`)                     | epický     |    8 | ×mult             | 7    | ×2 mult; v ruce máš o 1 kartu méně.                                                                               | „Zúžení do jednoho pruhu, ale pak se jede! Teda, pak se zase stojí.“                  |
|  92 | Směnárna (`exchange_office`)                   | epický     |    9 | ×mult             | 7    | ×1 mult a navíc +×0,1 za každých 15 čipů, které ruka v tu chvíli má (nejvýš ×2,5).                                | „Nula procent provize, kurz drobným písmem. Čipy dáš všechny, mult dostaneš trochu.“  |
|  93 | Silvestr (`new_years_eve`)                     | epický     |    8 | škálování         | 7    | Po každé porážce šéfa trvale +×0,2 mult.                                                                          | „Půlnoc, ohňostroj, předsevzetí. Do Tří králů vydrží jen ta kocovina.“                |
|  94 | Praotec Čech (`forefather`)                    | legendární |   16 | škálování         | 7    | První ruka každého kola ještě před skórováním zvýší úroveň zahrané kombinace o 1.                                 | „Tady se usadíme a tady budeme skórovat.“                                             |
|  95 | Kněžna Libuše (`libuse`)                       | legendární |   16 | ×mult             | 7    | Každá skórující dáma dá ×1,4 mult; na konci kola promění 1 náhodnou kartu drženou v ruce v dámu.                  | „Vidím skóre veliké, jehož sláva hvězd se dotýká.“                                    |
|  96 | Blaničtí rytíři (`blanik_knights`)             | legendární |   16 | ×mult             | 7    | ×3 mult, dokud skóre kola nedosáhne 50 % cíle.                                                                    | „Vyjedou, až bude nejhůř. Na začátku kola je vždycky nejhůř.“                         |
|  97 | Bruncvíkův meč (`bruncvik_sword`)              | legendární |   16 | škálování         | 7    | Při prvním zahození v kole zničí nejnižší zahozenou kartu a trvale získá +×0,2 mult.                              | „Seká sám. Stačí říct: ‚Hlavy dolů!‘“                                                 |
|  98 | Doktor Faust (`faust`)                         | legendární |   16 | ×mult             | 7    | ×1 mult a navíc +×0,06 za každou korunu, kterou máš (nejvýš ×5).                                                  | „Duši neprodal, jen ji dal do zástavy.“                                               |
|  99 | Krakonoš (`krakonos`)                          | legendární |   16 | spotřebky/balíček | 7    | Každá použitá pranostika zvýší úroveň své kombinace o 1 navíc a dá +2 Kč.                                         | „Počasí si dělá sám. Úrovně taky.“                                                    |
| 100 | Hloupý Honza (`silly_honza`)                   | legendární |   16 | ×mult             | 7    | Vysoká karta a Dvojice dávají ×4 mult.                                                                            | „Ležel na peci, a stejně vyhrál princeznu.“                                           |
| 101 | Orloj (`astro_clock`)                          | legendární |   16 | ×mult             | 7    | ×2 mult v první ruce kola, ×3 ve druhé a ×4 v každé další.                                                        | „Kostlivec zvoní, apoštolové kynou, skóre se násobí.“                                 |

## 5. Spotřebky

### 5.1 Společná pravidla

- **Sloty:** 2 (`consumableSlots`). Koupená spotřebka jde do slotu; bez volného slotu ji jde jen
  „Koupit a použít“ (akce `buyAndUse`), a to jen pokud nepotřebuje cíl na hrací karty.
- **Kdy použít:** spotřebky s cílem na hrací karty (`target`) jdou použít jen během kola (na karty v ruce)
  nebo uvnitř babské/razítkové obálky (dobere se ruka). Spotřebky bez cíle kdykoli: v kole, ve Večerce,
  na výběru útraty. Některé mají omezení „jen v kole“.
- **Levá / pravá karta** = pořadí vybraných karet v ruce zleva doprava.
- **Prodej:** `floor(cena / 2)`, min. 1 Kč. Pranostika 1 Kč, babská rada 2 Kč, razítko 3 Kč.
- Efekty, které „vytvoří spotřebku“, potřebují volný slot (spotřebka, která efekt vyvolala, svůj slot před
  vytvořením uvolní). Bez místa se nic nevytvoří, pokud text neříká jinak.
- Použití se zapíše do `RunState.lastConsumable` (pro „Babiččin recept“) a do statistik.

### 5.2 Pranostiky (13, cena 3 Kč)

Každá zvýší úroveň jedné kombinace o 1 (`levelUpHand`). Pranostiky tajných kombinací se v obchodě a obálkách
objevují až po objevení kombinace v aktuálním runu (kap. 2.2.4). Popisek ve hře ukáže změnu: „Barva: úroveň 3 → 4
(+18 čipů, +2 mult)“.

|   # | Kombinace                  | Název (`id`)                           | Flavor                                                                     |
| --: | -------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
|   1 | Vysoká karta               | Slepičí krok (`hen_step`)              | „Na Nový rok o slepičí krok. A o kartu výš.“                               |
|   2 | Dvojice                    | Filip a Jakub (`philip_jacob`)         | „Na Filipa a Jakuba se pálí čarodějnice. Ve dvou to jde líp.“              |
|   3 | Dvě dvojice                | Hadi a štíři (`snakes_scorpions`)      | „Na svatého Jiří lezou hadi a štíři. Po párech.“                           |
|   4 | Trojice                    | Tři králové (`three_kings`)            | „Na Tři krále o krok dále.“                                                |
|   5 | Postupka                   | Svatá Anna (`saint_anne`)              | „Svatá Anna, chladna zrána — a karty pěkně za sebou.“                      |
|   6 | Barva                      | Medardova kápě (`medard_drop`)         | „Medard kápne a čtyřicet dní je všechno jedné barvy.“                      |
|   7 | Full house                 | Martin na koni (`martin_horse`)        | „Martin přijel na bílém koni a chalupa je plná.“                           |
|   8 | Čtveřice                   | Ledoví muži (`ice_saints`)             | „Pankrác, Servác, Bonifác — a Žofie, aby jich byla čtveřice.“              |
|   9 | Postupka v barvě           | Březen, duben, máj (`march_april_may`) | „Březen, za kamna vlezem; duben, ještě tam budem; máj — postupka v barvě.“ |
|  10 | Královská postupka         | Svatý Václav (`saint_wenceslas`)       | „Na svatého Václava sklizeň bývá hotová. I ta královská.“                  |
|  11 | Pětice (tajná)             | Na Hromnice (`candlemas`)              | „Na Hromnice o hodinu více. A o kartu taky.“                               |
|  12 | Barevný full house (tajná) | Kateřina na ledě (`catherine_ice`)     | „Kateřina na ledě, Vánoce na blátě, plný dům v jedné barvě.“               |
|  13 | Barevná pětice (tajná)     | Lucie noci upije (`lucy_night`)        | „Nejdelší noc v roce. Dost času poskládat pět stejných.“                   |

### 5.3 Babské rady (22, cena 4 Kč)

|   # | Název (`id`)                         | Cíl                   | Efekt                                                                                                                   | Flavor                                               |
| --: | ------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
|   1 | Heřmánkový čaj (`chamomile`)         | 1–3 karty             | Vybrané karty dostanou vylepšení **Prémiová** (+25 čipů).                                                               | „Na všechno pomůže heřmánek.“                        |
|   2 | Pálivá paprička (`chili`)            | 1–2 karty             | Vybrané karty dostanou vylepšení **Pálivá** (+5 mult).                                                                  | „Kdo nepálí, nehraje.“                               |
|   3 | Babiččina vitrína (`glass_cabinet`)  | 1 karta               | Vylepšení **Skleněná**.                                                                                                 | „Na to se nesahá, to je na neděli.“                  |
|   4 | Litinový hrnec (`cast_iron_pot`)     | 1 karta               | Vylepšení **Ocelová**.                                                                                                  | „Vydrží tři generace a jednu válku.“                 |
|   5 | Kámen na zelí (`cabbage_stone`)      | 1–2 karty             | Vylepšení **Kamenná**.                                                                                                  | „Zelí se samo nezatíží.“                             |
|   6 | Dukát pod polštář (`ducat`)          | 1 karta               | Vylepšení **Zlatá**.                                                                                                    | „Šupina pod talířem nestačila.“                      |
|   7 | Čtyřlístek (`four_leaf`)             | 1–2 karty             | Vylepšení **Šťastná**.                                                                                                  | „Hledala ho celé léto. U kontejnerů.“                |
|   8 | Kvetoucí kapradí (`fern_bloom`)      | 1–2 karty             | Vylepšení **Divoká**.                                                                                                   | „Kvete jen o svatojánské noci. Pak je z ní všechno.“ |
|   9 | Dědova peněženka (`grandpas_wallet`) | 1–3 karty             | Vylepšení **Ohmataná**.                                                                                                 | „Ohmataná od lepších časů.“                          |
|  10 | Babiččina barva (`grandmas_dye`)     | 2–4 karty             | Všechny vybrané karty převezmou barvu karty vybrané nejvíc vlevo.                                                       | „Pletla jen z jedné vlny.“                           |
|  11 | Zrcátko v předsíni (`hall_mirror`)   | přesně 2              | Levá karta převezme hodnotu pravé (barva, vylepšení, pečeť i edice levé zůstávají).                                     | „Zrcadlo, zrcadlo, kdo je v ruce nejvyšší?“          |
|  12 | Kynuté těsto (`risen_dough`)         | 1–3 karty             | Hodnota vybraných karet +1 (Eso zůstane Esem).                                                                          | „Nechat v teple a nekoukat.“                         |
|  13 | Generální úklid (`spring_cleaning`)  | 1–3 karty             | Vybrané karty se zničí; za každou +1 Kč.                                                                                | „Co tři roky nepoužiješ, vyhodíš.“                   |
|  14 | Jablko od stromu (`apple_tree`)      | 1 karta               | Přidá do balíčku i do ruky kopii vybrané karty (s vylepšením a pečetí, bez edice).                                      | „Jablko nepadá daleko od stromu.“                    |
|  15 | Kopřivový odvar (`nettle_tea`)       | přesně 2              | Levá karta se zničí; pravá trvale získá její čipy (`cardChips`) jako bonusové čipy.                                     | „Pálí, ale čistí krev.“                              |
|  16 | Pod slamníkem (`under_mattress`)     | —                     | +50 % tvých peněz (dolů), nejvýš +12 Kč; při záporném zůstatku nic.                                                     | „Banky padají, slamník nikdy.“                       |
|  17 | Rosnička (`tree_frog`)               | —                     | Vytvoří pranostiku tvé nejčastěji hrané kombinace v runu (při shodě silnější) a 1 náhodnou pranostiku.                  | „Když leze nahoru, bude hezky.“                      |
|  18 | Zaklepat na dřevo (`knock_on_wood`)  | —                     | 1 z 3: náhodný tvůj žolík bez edice dostane lesklou nebo holografickou edici (50 : 50); jinak +2 Kč útěchou.            | „Ťuk, ťuk, ťuk. Hlavně to nezakřiknout.“             |
|  19 | Babiččin recept (`grandmas_recipe`)  | —                     | Vytvoří kopii naposledy použité babské rady nebo pranostiky v tomto runu (ne sebe, ne razítko).                         | „Přesně podle receptu. Od oka.“                      |
|  20 | Studený obklad (`cold_compress`)     | jen v kole            | +2 zahození v tomto kole.                                                                                               | „Na bouli i na kocovinu.“                            |
|  21 | Česnek na krk (`garlic`)             | jen v kole, 1–3 karty | Vybraným kartám zruší debuff a otočí je lícem nahoru (do konce kola).                                                   | „Na upíry i na šéfy.“                                |
|  22 | Kouzelný kotlík (`cauldron`)         | žolík nejvíc vlevo    | Promění ho v náhodného jiného žolíka stejné vzácnosti (edice a nálepka zůstanou; legendárního ani přibitého nepromění). | „Zamíchat, zaklít, neochutnávat.“                    |

Rozložení: vylepšení 9 · barva 1 · hodnota 2 · ničení 2 · kopie 1 · peníze 1 · tvorba spotřebek 2 · žolíci 2 · kolo 2.
Bez platného cíle (např. Zaklepat na dřevo bez žolíka bez edice) je tlačítko Použít neaktivní a ukáže důvod. Totéž,
když by rada nic nezměnila: Babiččina barva, když všechny vybrané karty už mají barvu levé; Zrcátko v předsíni na dvě
karty stejné hodnoty; Kynuté těsto na samá esa.

### 5.4 Úřední razítka (16, cena 6 Kč)

Vzácná a silná, většinou s cenou. V obchodě jen s kupónem „Babiččina spíž“, jinak z razítkových obálek.

|   # | Název (`id`)                          | Cíl                               | Efekt (a cena za něj)                                                                                                       | Flavor                                               |
| --: | ------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
|   1 | Ověřeno notářem (`notarized`)         | 1 karta                           | **Zlatá pečeť**.                                                                                                            | „Za ověření podpisu se platí zvlášť.“                |
|   2 | Kolek (`duty_stamp`)                  | 1 karta                           | **Červená pečeť**.                                                                                                          | „Bez kolku to neplatí. S kolkem to platí dvakrát.“   |
|   3 | Modrý formulář (`blue_form`)          | 1 karta                           | **Modrá pečeť**.                                                                                                            | „Vyplňte modrou propiskou, hůlkovým písmem.“         |
|   4 | Doporučeně (`registered_mail`)        | 1 karta                           | **Fialová pečeť**.                                                                                                          | „S dodejkou. Vyzvednout do 15 dnů.“                  |
|   5 | Výjimka z vyhlášky (`exemption`)      | —                                 | Vytvoří náhodného **legendárního** žolíka (potřebuje volný slot). V obálce váha 0,25.                                       | „Výjimečně, jen pro vás, a nikomu to neříkejte.“     |
|   6 | Zpětný odběr (`buyback`)              | ruka                              | Zničí polovinu karet v ruce (nahoru, náhodně) a za každou dá **4 Kč**.                                                      | „Vykupujeme staré karty. Platíme hotově.“            |
|   7 | Ověřená kopie (`certified_copy`)      | —                                 | Zkopíruje žolíka **nejvíc vlevo** (kopie bez negativní edice); **všichni ostatní** žolíci kromě přibitých se zničí.         | „Kopie souhlasí s originálem. Originály skartovány.“ |
|   8 | Hromadné vyřízení (`bulk_processing`) | —                                 | Všichni žolíci bez edice dostanou náhodnou edici (lesklá 55 %, holografická 30 %, duhová 15 %); **trvale −1 karta v ruce**. | „Vyřízeno hromadně, stížnosti individuálně.“         |
|   9 | Úřední hodiny (`office_hours`)        | —                                 | Všechny kombinace **+2 úrovně**; **trvale −1 ruka** za kolo.                                                                | „Po–St 8–11, Čt zavřeno, Pá dle nálady.“             |
|  10 | Kontrola totožnosti (`id_check`)      | 1 karta                           | Karta dostane náhodnou edici (lesklá 55 %, holografická 30 %, duhová 15 %).                                                 | „Občanku, prosím. To na té fotce jste vy?“           |
|  11 | Sloučení spisů (`merge_files`)        | přesně 2                          | Pravá karta se zničí; levá převezme její vylepšení, pečeť a edici (jen to, co levá nemá).                                   | „Dva spisy, jedna složka, nula přehlednosti.“        |
|  12 | Daňové přiznání (`tax_return`)        | —                                 | Vytvoří náhodného **epického** žolíka (potřebuje slot); **peníze se nastaví na 0 Kč** (dluh zůstane).                       | „Přiznání je polehčující okolnost.“                  |
|  13 | Kolaudace (`occupancy_permit`)        | —                                 | **Trvale +1 slot žolíka a −1 slot spotřebky** (jen pokud máš aspoň 2 sloty spotřebek a ostatní spotřebky se pak vejdou).    | „Stavba je hotová, chybí jen schody.“                |
|  14 | Odvolání (`appeal`)                   | jen v kole se šéfovským pravidlem | Vypne pravidlo šéfa do konce kola; **stojí 5 Kč** (i do dluhu, do limitu).                                                  | „Odvolání má odkladný účinek. Za pět korun.“         |
|  15 | Vyvlastnění (`expropriation`)         | —                                 | Zničí žolíka **nejvíc vpravo** (ne přibitého) a dá **3× jeho prodejní cenu**.                                               | „Ve veřejném zájmu, samozřejmě.“                     |
|  16 | Prominutí pokut (`fine_waiver`)       | —                                 | Odstraní všechny nálepky ze všech tvých žolíků (zvětralým vrátí funkci).                                                    | „Amnestie na všechno kromě parkování.“               |

Upřesnění pravidel (fáze 5, `canUse` = kdy jde razítko použít; bez platného cíle je Použít neaktivní):

- **Pečetě (1–4)** přepíšou dosavadní pečeť karty. **Kontrola totožnosti** jen na kartu bez edice.
- **Výjimka z vyhlášky** a **Daňové přiznání** potřebují volný slot a aspoň jednoho dostupného (nevlastněného, odemčeného)
  žolíka dané vzácnosti — náhradní žolík (Pivní tácek) se nikdy nevytvoří. Dokud legendární žolíci nejsou
  (fáze 7), Výjimka z vyhlášky použít nejde. Daňové přiznání nuluje jen kladný zůstatek.
- **Zpětný odběr** pracuje s rukou v kole i s dobranou rukou razítkové obálky; zničí `ceil(n / 2)` náhodných karet.
- **Ověřená kopie**: nejdřív zničí ostatní (kromě přibitých), pak vznikne kopie i se stavem, nálepkami, odpočtem
  zvětrávání a prodejním bonusem; edice zůstane, jen negativní ne. Nejde použít, když by po zničení nezbyl slot
  (zničený negativní žolík si odnese svůj slot).
- **Hromadné vyřízení** potřebuje aspoň jednoho žolíka bez edice a velikost ruky aspoň 2; **Úřední hodiny** aspoň
  2 ruce za kolo (postih nesmí být zadarmo). Úřední hodiny zvednou i tajné kombinace.
- **Kolaudace** nesmí přeplnit sloty: ostatní spotřebky se po ubrání slotu musí vejít (razítko použité ze slotu svůj
  slot uvolní). S plnými sloty jinými spotřebkami ji tedy nejde ani „Koupit a použít“, ani použít z obálky.
- **Sloučení spisů**: levá/pravá podle pořadí v ruce, ne podle pořadí výběru.
- **Odvolání**: jen ve fázi kola s aktivním (nevypnutým) šéfovským pravidlem a jen když `peníze − 5 ≥ −dluhový limit`.
- **Vyvlastnění** vezme nejpravějšího žolíka, který **není přibitý** (přibité přeskočí); zapůjčený vynese 3 × 1 Kč.
- **Prominutí pokut**: zvětralému žolíkovi vrátí funkci; dočasný debuff od šéfa v kole trvá.

### 5.5 Čtvrtý typ spotřebky — rozhodnutí: **ne (v 1.0)**

Důvody:

1. Tři typy už pokrývají tři osy hry: **kombinace** (pranostiky), **hrací karty** (babské rady) a **riziko/pravidla**
   (razítka). Čtvrtý typ by se s některým překrýval.
2. Každý další typ zředí nabídku Večerky — hráč by méně často našel spotřebku, kterou jeho build potřebuje.
3. `ConsumableKind` je uzavřený výčet a UI má jasné tři barvy slotů; přidání stojí víc práce než přínosu.
4. Hloubku navíc dodává 9. vylepšení (Ohmataná) a štítky.

Nápad po 1.0 (zapsat do `docs/IDEAS.md`): **Stírací losy** — okamžitá loterie za 2 Kč (1 z 3: 4 Kč, 1 z 6: obálka zdarma,
1 z 20: kupón, jinak „Bohužel, zkuste to znovu“).

## 6. Kupóny (24 = 12 párů)

- Ve Večerce je **1 kupón za patro**; drží se ve všech Večerkách patra, po porážce šéfa se nabídne nový.
  Nekoupený kupón se vrací do poolu. Štítek „Úřední poukaz“ přidá další.
- **Tier 2** se může objevit jen tehdy, když hráč vlastní příslušný tier 1. Každý kupón jde koupit jednou za run.
- Efekty jsou trvalé do konce runu (`passive` → `Modifiers`, jednorázové věci v `onRedeem`).

|   # | Tier 1 (`id`)                        | Cena | Efekt                                                                       | Tier 2 (`id`)                         | Cena | Efekt                                                                                                   |
| --: | ------------------------------------ | ---: | --------------------------------------------------------------------------- | ------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------- |
|   1 | Druhý regál (`second_shelf`)         |    9 | +1 kartový slot ve Večerce.                                                 | Regál u pokladny (`checkout_shelf`)   |   12 | +1 slot obálky ve Večerce.                                                                              |
|   2 | Věrnostní karta (`loyalty_card`)     |   10 | Vše ve Večerce o 20 % levnější.                                             | Zlatá věrnostní (`gold_loyalty`)      |   13 | Vše ve Večerce o 40 % levnější (celkem).                                                                |
|   3 | Kamarád za pultem (`counter_buddy`)  |    9 | Přehození je o 1 Kč levnější (začíná na 3 Kč).                              | Švagr vedoucí (`manager_inlaw`)       |   11 | Cena přehození v téže Večerce neroste.                                                                  |
|   4 | Prodloužená otvíračka (`late_hours`) |   12 | +1 ruka v každém kole.                                                      | Nonstop (`nonstop`)                   |   15 | +1 ruka v každém kole a +1 Kč navíc za každou nevyužitou ruku.                                          |
|   5 | Kontejner před domem (`dumpster`)    |    9 | +1 zahození v každém kole.                                                  | Sběrný dvůr (`recycling_yard`)        |   12 | +1 zahození v každém kole a +1 Kč za každé nevyužité zahození.                                          |
|   6 | Větší stůl (`bigger_table`)          |   12 | +1 karta v ruce.                                                            | Rozkládací stůl (`folding_table`)     |   15 | +1 karta v ruce; v kole šéfa ještě +1 navíc.                                                            |
|   7 | Spořicí účet (`savings_account`)     |    9 | Strop úroku 8 Kč.                                                           | Stavební spoření (`building_savings`) |   12 | Strop úroku 12 Kč.                                                                                      |
|   8 | Úzký věšák (`narrow_rack`)           |   11 | +1 slot žolíka, ale −1 karta v ruce.                                        | Pořádný věšák (`proper_rack`)         |   13 | +1 karta v ruce (ruší postih Úzkého věšáku).                                                            |
|   9 | Trhací kalendář (`tear_calendar`)    |    8 | Pranostiky a babské rady se ve Večerce objevují častěji (váha každé 3 → 7). | Babiččina spíž (`grandmas_pantry`)    |   11 | +1 slot spotřebky; ve Večerce se objevují i úřední razítka; pranostiky a rady ještě o polovinu častěji. |
|  10 | Stánek s kartami (`card_stall`)      |    9 | Ve Večerce se objevují hrací karty.                                         | Kartářka (`card_reader`)              |   12 | Hrací karty ve Večerce mají 50 % šanci na vylepšení a 20 % na pečeť.                                    |
|  11 | Leštěnka (`polish`)                  |    9 | Edice (lesklá, holografická, duhová) se objevují 2,5× častěji.              | Hologramová fólie (`holo_foil`)       |   12 | Edice se objevují 3,5× častěji (celkem).                                                                |
|  12 | Úřední škrt (`official_strike`)      |   12 | −1 patro; cíle všech útrat do konce runu ×1,1.                              | Amnestie (`amnesty`)                  |   14 | −1 patro; ve Večerce stojí do konce runu všechno o 1 Kč víc.                                            |

Implementace (`Modifiers` delta): 1 `shopCardSlots +1` / `shopBoosterSlots +1`; 2 `shopDiscountPct +20` / `+20`;
3 `rerollBaseCost −1` / `rerollCostStep −1`; 4 `hands +1` / `hands +1, moneyPerUnusedHand +1`; 5 `discards +1` / `discards +1, moneyPerUnusedDiscard +1`;
6 `handSize +1` / `handSize +1` (+1 navíc, když `round.blind === 'boss'`); 7 `interestCap +3` / `+4`; 8 `jokerSlots +1, handSize −1` / `handSize +1`;
9 `shopWeightPranostika +4, shopWeightRada +4` / `consumableSlots +1, shopWeightRazitko +2, shopWeightPranostika +1,5, shopWeightRada +1,5`;
10 `shopWeightPlayingCard +5` / `playingCardEnhanceChance 0,5, playingCardSealChance 0,2` (nová pole);
11 `editionRateMult ×2,5` / `×1,4`; 12 `onRedeem: ante −1 (min. 1)` + `targetMult ×1,1` / `onRedeem: ante −1` + `shopPriceAdd +1`.

**−1 patro:** číslo patra se okamžitě sníží o 1 (min. 1) a pokračuje se další útratou v pořadí s cíli nového patra.
Výhra stále vyžaduje porazit šéfa patra 8 — hráč tedy dostane víc kol na rozjezd za cenu trvalého postihu.
Úřední škrt i Amnestie se nabízejí a jdou koupit **až od patra 2** (`VoucherDef.available`) — v patře 1 by zbyl jen
postih.

Flavor: Druhý regál „Konečně je kam dát chipsy.“ · Regál u pokladny „Impulzivní nákupy na dosah ruky.“ ·
Věrnostní karta „Sbíráte body? — Ne. — Tak je máte.“ · Zlatá věrnostní „Platinová by byla moc nápadná.“ ·
Kamarád za pultem „Pro tebe to přehodím.“ · Švagr vedoucí „Rodina je rodina.“ · Prodloužená otvíračka „Otevřeno do
posledního hosta.“ · Nonstop „Zavíráme? To slovo neznáme.“ · Kontejner před domem „Vyhodit můžeš cokoli. Kromě gauče.“ ·
Sběrný dvůr „Třídit se vyplácí.“ · Větší stůl „Ze sklepa, po dědovi.“ · Rozkládací stůl „Když přijde šéf, rozkládá se až do předsíně.“ ·
Spořicí účet „Úrok skoro jako za první republiky.“ · Stavební spoření „Se státní podporou, bez stavby.“ ·
Úzký věšák „Vejde se tam ještě jeden žolík. Kabát ne.“ · Pořádný věšák „Konečně i na bundu.“ ·
Trhací kalendář „Každý den jedna moudrost.“ · Babiččina spíž „Zavařeniny na příštích dvacet let.“ ·
Stánek s kartami „Z druhé ruky, jako nové.“ · Kartářka „Vyložila mi budoucnost. Je v ní Barva.“ ·
Leštěnka „Lesk jako nedělní boty.“ · Hologramová fólie „Duha v každém balení.“ ·
Úřední škrt „Patro škrtnuto. Razítko, podpis.“ · Amnestie „Na co se zapomene, to se nestalo.“

## 7. Štítky za přeskočení (20)

- Malou i Velkou útratu lze přeskočit; dostaneš štítek, který je u útraty vidět předem. Šéfa přeskočit nejde.
- Štítky útrat patra se losují při vstupu do patra (stream `tag`) z poolu s `minAnte ≤ patro`; Malá a Velká mají
  různé štítky. Štítky se hromadí (i stejné) a ukazují se v levém panelu.
- „Příští Večerka / příští kolo“ = první Večerka / kolo **po** získání štítku (po přeskočení se Večerka vynechá).

|   # | Název (`id`)                           | Od patra | Efekt                                                                                                        | Spotřebuje se  | Flavor                                              |
| --: | -------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------- |
|   1 | Drobné v kabátě (`coat_change`)        |        1 | +6 Kč.                                                                                                       | hned           | „Z loňské zimy, ještě s účtenkou.“                  |
|   2 | Termínovaný vklad (`term_deposit`)     |        1 | Po porážce šéfa tohoto patra +15 Kč.                                                                         | po šéfovi      | „Výběr před splatností zpoplatněn.“                 |
|   3 | Zálohy (`advance_payment`)             |        1 | +3 Kč za každou útratu přeskočenou v tomto runu (včetně této).                                               | hned           | „Doplatek přijde v březnu.“                         |
|   4 | Brigáda na chmelu (`hop_picking`)      |        1 | +1 Kč za každé 2 ruce zahrané v tomto runu (nejvýš +15 Kč).                                                  | hned           | „Za dědy povinná, dnes aspoň placená.“              |
|   5 | Otevřené dveře (`open_doors`)          |        1 | V příští Večerce 3 přehození zdarma.                                                                         | příští Večerka | „Den otevřených dveří: vstup i přehazování zdarma.“ |
|   6 | Obálka od strýce (`uncle_envelope`)    |        1 | Zdarma Tlustá obálka žolíků (otevře se hned).                                                                | hned           | „Na zub. A nic neříkej mámě.“                       |
|   7 | Kalendář z trafiky (`kiosk_calendar`)  |        1 | Zdarma Tlustá obálka pranostik.                                                                              | hned           | „S hasičskými motivy, jako každý rok.“              |
|   8 | Balík od babičky (`grandma_parcel`)    |        1 | Zdarma Tlustá obálka babských rad.                                                                           | hned           | „Buchty, ponožky a dobré rady.“                     |
|   9 | Úřední dopis (`official_letter`)       |        2 | Zdarma normální Obálka razítek.                                                                              | hned           | „Do vlastních rukou. Bohužel.“                      |
|  10 | Mariáš na chalupě (`cottage_marias`)   |        1 | Zdarma Tlustá obálka hracích karet.                                                                          | hned           | „Hraje se do tmy a o drobné.“                       |
|  11 | Vyleštěné příbory (`polished_cutlery`) |        1 | Příští žolík ve Večerce dostane náhodnou edici (lesklá 55 %, holografická 30 %, duhová 15 %) bez příplatku.  | příští Večerka | „Na návštěvu se vytahuje to nejlepší.“              |
|  12 | Fotonegativ (`photo_negative`)         |        2 | Příští žolík ve Večerce bude negativní, bez příplatku.                                                       | příští Večerka | „Z alba, kde všichni vypadají jako duchové.“        |
|  13 | Doporučení od známého (`referral`)     |        1 | V příští Večerce navíc slot se vzácným žolíkem za poloviční cenu.                                            | příští Večerka | „Řekni, že jdeš ode mě.“                            |
|  14 | Protekce (`connections`)               |        3 | V příští Večerce navíc slot s epickým žolíkem (plná cena).                                                   | příští Večerka | „Nejde o to, co umíš, ale koho znáš.“               |
|  15 | Úřední poukaz (`voucher_slip`)         |        1 | V příští Večerce navíc 1 kupón.                                                                              | příští Večerka | „Platí do konce měsíce. Kterého, neuvedeno.“        |
|  16 | Šéf má chřipku (`boss_flu`)            |        1 | Cíl šéfa tohoto patra −25 %.                                                                                 | v kole šéfa    | „Omluvenka od doktora, podpis nečitelný.“           |
|  17 | Rozložené noviny (`spread_newspaper`)  |        1 | V příštím kole +2 karty v ruce a +1 zahození.                                                                | příští kolo    | „Kdo čte noviny, má přehled. A víc místa na stole.“ |
|  18 | Předpověď počasí (`forecast`)          |        1 | +2 úrovně tvé nejčastěji hrané kombinace v runu (při shodě silnější; bez zahraných rukou Vysoká karta).      | hned           | „Zítra jasno, místy Full house.“                    |
|  19 | Lékařské potvrzení (`sick_note`)       |        2 | Když v příštím kole nedosáhneš cíle, ale máš aspoň 50 %, kolo se počítá jako vyhrané (bez odměny za útratu). | příští kolo    | „Neschopenka zpětně? Udělám výjimku.“               |
|  20 | Bazar u silnice (`roadside_bazaar`)    |        1 | Vytvoří náhodného běžného žolíka; bez volného slotu místo toho +4 Kč.                                        | hned           | „Starožitnosti, tašky a jeden žolík.“               |

## 8. Šéfové

### 8.1 Pravidla výběru

- Šéf se losuje při vstupu do patra (stream `boss`) z běžných šéfů s `minAnte ≤ patro`, přednostně z dosud v runu
  neviděných (`bossesSeen`); když dojdou, pool se obnoví.
- **Finální šéfové** jen v patře 8 a v každém 8. patře nekonečného režimu (16, 24…).
- Výchozí cíl 2× základ, odměna 5 Kč. Pravidlo platí celé kolo; razítko „Odvolání“ ho vypne (cíl zůstává).
- Na Imperialu dostane i Velká útrata pravidlo náhodného běžného šéfa (kap. 10).
- Každý šéf má texty `name`, `rule`, `intro` (příchod), `defeat` (porážka) a `death` (pitva, příloha C).

### 8.2 Běžní šéfové (25)

|   # | Název (`id`)                             | Pravidlo                                                                                | Od patra |   Cíl | Příchod                                                  | Porážka                                             |
| --: | ---------------------------------------- | --------------------------------------------------------------------------------------- | -------: | ----: | -------------------------------------------------------- | --------------------------------------------------- |
|   1 | Kontrola z finančáku (`tax_audit`)       | Každá zahraná ruka stojí 1 Kč.                                                          |        1 | 2,25× | „Dobrý den, finanční úřad. Účtenky máte?“                | „Tentokrát bez pokuty. Tentokrát.“                  |
|   2 | Výluka na trati (`track_closure`)        | Každá druhá líznutá karta přijde lícem dolů (polovina ruky je zakrytá).                 |        2 |    1× | „Polovina karet jede náhradní autobusovou dopravou.“     | „Provoz obnoven. Zpoždění neuvedeno.“               |
|   3 | Inventura (`inventory`)                  | Figury (J, Q, K) jsou debuffnuté.                                                       |        1 |    2× | „Zavřeno z důvodu inventury. Figury se přepočítávají.“   | „Inventura sedí. Až na jednoho kluka.“              |
|   4 | Soused s vrtačkou (`drilling_neighbor`)  | Kombinace, která už v tomto kole byla zahrána, neskóruje.                               |        1 |    2× | „Sobota, osm ráno. Vrrrrr.“                              | „Konečně ticho. Do pondělí.“                        |
|   5 | Polední pauza (`lunch_break`)            | Máš jen 1 ruku.                                                                         |        2 | 0,65× | „Je polední pauza. Máte na to jeden pokus.“              | „Hotovo? Tak to se divím.“                          |
|   6 | Pověrčivá babka (`superstitious_granny`) | Na začátku kola se vylosuje barva; karty té barvy jsou debuffnuté.                      |        1 |    2× | „Dneska ne, dneska je špatný den na {suit}.“             | „Tak to byla holt náhoda.“                          |
|   7 | Černá kočka (`black_cat`)                | Po každé zahrané ruce se 2 náhodné karty v ruce stanou debuffnutými (do konce kola).    |        2 |    2× | „Přeběhla ti přes cestu. Zleva doprava.“                 | „Kočka odešla. Smůla zůstala u ní.“                 |
|   8 | Mlha nad Labem (`elbe_fog`)              | Karty s hodnotou 2–5 se lížou lícem dolů.                                               |        2 |    2× | „Viditelnost pod sto metrů, malé karty v mlze.“          | „Mlha se zvedla. Byly to dvojky.“                   |
|   9 | Parkovné (`parking_fee`)                 | Každé zahození stojí 1 Kč.                                                              |        1 | 2,25× | „Modrá zóna. Zahazovat jen s parkovací kartou.“          | „Za stěračem tentokrát nic.“                        |
|  10 | Garsonka 1+kk (`studio_flat`)            | −1 karta v ruce a nejvýš 4 vybrané karty.                                               |        2 | 1,35× | „Vítej v bytě, kde se kuchyni říká roh.“                 | „Stěhuješ se? Nech tu klíče.“                       |
|  11 | Sucho v obci (`village_drought`)         | 0 zahození, ale +1 ruka.                                                                |        2 |    2× | „Zákaz zalévání i zahazování.“                           | „Prší! Tedy aspoň kape.“                            |
|  12 | Kapsář v tramvaji (`pickpocket`)         | Po každé zahrané ruce se z ruky zahodí karta s nejvyšší hodnotou.                       |        2 | 2,25× | „Pozor, ve voze se pohybují kapsáři.“                    | „Chytili ho na konečné.“                            |
|  13 | Exekutor (`bailiff`)                     | Na začátku kola debuffne tvého žolíka s nejvyšší prodejní cenou.                        |        2 | 1,75× | „Tohle je zabavené. A tohle taky.“                       | „Exekuce zastavena pro nemajetnost exekutora.“      |
|  14 | Nová vyhláška (`new_decree`)             | Všechny kombinace se v tomto kole počítají na úrovni 1.                                 |        3 |  1,1× | „Na základě nové vyhlášky se úrovně ruší.“               | „Vyhláška zrušena soudem.“                          |
|  15 | Šanon na šanonu (`binder_tower`)         | Vyšší cíl.                                                                              |        2 |    3× | „Podklady k útratě: tři šanony a jeden pořadač.“         | „Spis uzavřen a uložen do sklepa.“                  |
|  16 | Krajské derby (`regional_derby`)         | Ruka s červenými (♥ ♦) i černými (♠ ♣) kartami má poloviční základní čipy i mult.       |        2 | 1,75× | „Hradec, nebo Brno? Vyber si stranu!“                    | „Remíza. Slaví obě strany.“                         |
|  17 | Zabijačka (`pig_slaughter`)              | Po každé zahrané ruce se zničí 1 náhodná skórující karta.                               |        3 |  2,5× | „Dneska se dělá ovar. Z tvých karet.“                    | „Tlačenka hotová, karty přežily.“                   |
|  18 | Bílá hora (`white_mountain`)             | Vylepšení hracích karet v tomto kole nefungují.                                         |        3 |    2× | „Bitva je prohraná, vylepšení jdou do exilu.“            | „Tentokrát to dopadlo líp.“                         |
|  19 | Normalizace (`normalization`)            | Každá skórující karta dává právě 5 čipů (vylepšení a edice fungují).                    |        2 |    2× | „Všichni jsme si rovni. Po pěti čipech.“                 | „Uvolnění! Karty smí být zase různé.“               |
|  20 | Jednooký hejtman (`one_eyed_hetman`)     | Žolíci v pravé polovině řady nefungují (při lichém počtu prostřední funguje).           |        3 |  1,4× | „Na jedno oko nevidí, na druhé nepočítá s tvými žolíky.“ | „Hejtman se stáhl na Tábor.“                        |
|  21 | Tchyně na návštěvě (`mother_in_law`)     | Každé zahození ti navíc zahodí 1 náhodnou kartu z ruky (dobírá se normálně).            |        1 | 2,25× | „Já jen na kafe. A trochu ti to tu uklidím.“             | „Už jede domů. Bábovku nechala.“                    |
|  22 | Influencerka Nikča (`influencer`)        | Tvoje nejčastěji hraná kombinace v runu má v tomto kole poloviční základní čipy i mult. |        2 |    2× | „Tohle pořád hraješ? Cringe.“                            | „Odsledováno. Potichu.“                             |
|  23 | Kocovina (`hangover`)                    | −1 ruka.                                                                                |        1 |    2× | „Proč tak řveš? A proč je tu tolik karet?“               | „Okurková voda zabrala.“                            |
|  24 | Výpadek proudu (`blackout`)              | Žolíci nefungují v první ruce kola.                                                     |        1 |    2× | „Vypadly pojistky, žolíci sedí potmě.“                   | „Elektrikář dorazil. Za čtyři hodiny, ale dorazil.“ |
|  25 | Sudé dny (`even_days`)                   | Liché karty (A, 3, 5, 7, 9) jsou debuffnuté; figury nejsou ani liché, ani sudé.         |        1 |    2× | „Smogová regulace: dnes hrají jen sudé.“                 | „Regulace odvolána, liché zpátky v provozu.“        |

Poloviční hodnoty se zaokrouhlují nahoru. Šéfů s `minAnte 1` je 9 (od patra 2 přibude dalších 12, od patra 3
poslední 4), aby i první patro mělo pestrost a těžší pravidla přišla až se žolíky.

**Cíle šéfů (sloupec „Cíl“) jsou laděné simulací** (fáze 6, 2026-10-02; `docs/DECISIONS.md` „Fáze 6: ladění se
šéfy“): žádný šéf nemá být výrazně smrtelnější než ostatní, měřeno letalitou při setkání **normovanou podle patra**
(šéfové s `minAnte 1` potkávají hráče v prvních patrech, kde se skoro neumírá). Tvrdá pravidla (polovina ruky
zakrytá, jedna ruka, bez úrovní, bez nejcennějšího nebo poloviny žolíků, bez Postupek a Barev) mají nižší cíl, mírná
pravidla (peníze, karta navíc pryč) vyšší. Šanon na šanonu (3×) a Protihluková stěna (4,5×) mají číslo v textu
pravidla — změna cíle = změna textu v `src/i18n/cs/bosses/`.

### 8.3 Finální šéfové (5, jen patro 8 a každé 8. patro)

|   # | Název (`id`)                         | Pravidlo                                                                                |   Cíl | Příchod                                                     | Porážka                                           |
| --: | ------------------------------------ | --------------------------------------------------------------------------------------- | ----: | ----------------------------------------------------------- | ------------------------------------------------- |
|  F1 | Pan starosta (`mayor`)               | Ruka se započítá, jen když má vyšší skóre než předchozí ruka v tomto kole (první vždy). |  2,5× | „Slibuji, že každá další ruka bude lepší než ta předchozí!“ | „Volby prohrál. Funkci si nechal v jiném výboru.“ |
|  F2 | Krajský úřad (`regional_office`)     | Po každé zahrané ruce se náhodný fungující žolík vypne do konce kola.                   | 2,25× | „Vaše žolíky prověříme. Jednoho po druhém.“                 | „Kontrola skončila bez nálezu. A bez oběda.“      |
|  F3 | Protihluková stěna (`noise_barrier`) | Vyšší cíl.                                                                              |  4,5× | „Čtyři metry betonu. A ani jeden strom.“                    | „Zeď padla. Sousedi děkují.“                      |
|  F4 | Velká voda (`great_flood`)           | Každá zahraná ruka zmenší velikost ruky o 1 (do konce kola).                            |  2,5× | „Voda stoupá! Karty do vyšších pater!“                      | „Voda opadla. Bláto zůstalo.“                     |
|  F5 | Bílá paní (`white_lady`)             | Po každé zahrané ruce i zahození se všechny karty v ruce otočí lícem dolů a zamíchají.  |  1,5× | „O půlnoci se zjevuje na zámku. A otáčí karty.“             | „Zmizela. Klíče od sklepa taky.“                  |

Cíle finálových šéfů jsou laděné simulací na letalitu 20–40 % (kap. 12.1): Bílá paní (hráč po každé akci vidí jen
nově dobrané karty) má 1,5×, Pan starosta a Velká voda 2,5×, Krajský úřad 2,25×.

## 9. Startovní balíčky (12)

|   # | Název (`id`)                | Pravidla                                                                                                      | Odemčení                              | Flavor                                              |
| --: | --------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
|   1 | Hospodský (`pub`)           | Standardních 52 karet, pravidla beze změny.                                                                   | od začátku                            | „Lepkavé karty a tácek pod sklenicí.“               |
|   2 | Štamgastův (`regulars`)     | +1 slot žolíka (6); start s 0 Kč.                                                                             | od začátku                            | „Má tu vlastní věšák. Na žolíky.“                   |
|   3 | Úřednický (`clerk`)         | Start s kupóny Věrnostní karta a Trhací kalendář.                                                             | kup celkem 5 kupónů                   | „Všechno vyřízeno předem. Na razítko.“              |
|   4 | Turistický (`tourist`)      | Postupka i Barva stačí ze 4 karet; cíle všech útrat ×1,2.                                                     | zahraj celkem 25 Postupek             | „Po červené, pak po modré, pak se ztratit.“         |
|   5 | Mariášový (`marias`)        | 32 karet: 7–A ve 4 barvách (bez 2–6). Postupka A-2-3-4-5 tu není možná.                                       | zahraj Čtveřici                       | „Kdo nehraje, nevyhraje. Kdo hraje, flekuje.“       |
|   6 | Obrázkový (`court`)         | 32 karet: J, Q, K, A ve 4 barvách, každá karta 2×; −1 karta v ruce (7); cíle ×1,5.                            | vyhraj run s Mariášovým               | „Samí páni, žádní pěšáci.“                          |
|   7 | Notářský (`notary`)         | Každá karta má při stavbě balíčku 25% šanci na náhodnou pečeť (4 druhy rovnoměrně); −1 slot spotřebky.        | měj v jednom runu 5 karet s pečetí    | „Ověřeno, orazítkováno, zaplombováno.“              |
|   8 | Zbohatlík (`nouveau_riche`) | Odměny za útraty a úrok ×2, nevyužitá ruka +2 Kč; −2 ruce (2).                                                | měj najednou 50 Kč                    | „Peníze jsou, čas není.“                            |
|   9 | Dlužník (`debtor`)          | Start −10 Kč; dluh smí jít až do −20 Kč; úrok ×2 (jen z kladného zůstatku).                                   | dokonči kolo se záporným zůstatkem    | „Půjčka? Já? Jen na chvilku.“                       |
|  10 | Babiččin (`grandmas`)       | +1 slot spotřebky (3); start se 2 náhodnými babskými radami.                                                  | použij celkem 30 babských rad         | „Babička ví všechno. A ráda to řekne.“              |
|  11 | Vetešnický (`junk_shop`)    | Start s 1 náhodným vzácným žolíkem; Večerka má o 1 kartový slot méně (1).                                     | prodej celkem 25 žolíků               | „Všechno z druhé ruky, něco i ze třetí.“            |
|  12 | Kalendářový (`almanac`)     | Po porážce každého šéfa vznikne pranostika tvé nejčastěji hrané kombinace (bez místa +2 Kč); −1 zahození (2). | zvyš libovolnou kombinaci na úroveň 6 | „Pranostika na každý den, i na ty, kdy se nehraje.“ |

Upřesnění:

- **Obrázkový:** 4 hodnoty × 4 barvy × 2 kopie = 32 karet. Postupky bez modifikátoru 4 karet nejdou (J-Q-K-A je
  jen 4 hodnoty; s „Turistickým průvodcem“ je J-Q-K-A v jedné barvě Královská postupka). Pětice jde poskládat
  (8 kopií každé hodnoty), Barevný full house a Barevná pětice potřebují další kopie (každá karta je jen 2×).
  Šéf Inventura je pro tento balíček noční můra — záměrně (¾ balíčku debuffnuté).
- **Mariášový** a **Obrázkový**: malý balíček se může v kole vyčerpat (8 + 4×5 + 3×5 = 43 > 32) — to je jejich
  přirozená cena. Karetní obálky a hrací karty ve Večerce respektují složení balíčku.
- **Zbohatlík:** `blindRewardMult ×2`, `interestMult ×2`, `moneyPerUnusedHand +1`, `hands −2`.
- **Dlužník:** `startingMoney −10`, `debtLimit +20`, `interestMult ×2`. Odemyká se stejnou podmínkou jako
  achievement „Na sekeru“ (dokončit kolo v mínusu jde se žolíkem Sekera nebo ve výzvě Byrokracie) — dluh si hráč
  musí nejdřív „vyzkoušet“.
- Pořadí v menu = pořadí v tabulce. Balíček s vyšší dosaženou silou piva má na obálce „tácek“ s číslem úrovně.

## 10. Obtížnosti „Síla piva“ (8)

Každá úroveň zahrnuje všechna ztížení nižších úrovní a přidává jedno nové. **Výhra na úrovni N s daným balíčkem
odemkne úroveň N + 1 pro tento balíček.** Desítka je odemčená vždy.

| Úr. | Název (`id`)              | Nové ztížení                                                                                                                                           | Implementace                                 | Cíl výher (simulace) |
| --: | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------: |
|   1 | Desítka (`desitka`)       | Základní pravidla, křivka cílů 1.                                                                                                                      | `targetCurve: 1`                             |              25–35 % |
|   2 | Jedenáctka (`jedenactka`) | **Dražší pivo:** ve Večerce stojí všechno o 1 Kč víc (žolíci, spotřebky, karty, obálky, kupóny, přehození). Prodejní ceny se nemění.                   | `shopPriceAdd +1` (nové pole)                |              20–30 % |
|   3 | Dvanáctka (`dvanactka`)   | Křivka cílů 2.                                                                                                                                         | `targetCurve: 2`                             |              14–22 % |
|   4 | Speciál (`special`)       | **Zvětrávání:** 25 % žolíků v obchodě a obálkách je zvětrávajících (po 6 kolech přestanou fungovat).                                                   | `stickerChance.perishable: 0,25`             |              10–17 % |
|   5 | Ležák (`lezak`)           | **Bez dýška:** nevyužité ruce nedávají peníze.                                                                                                         | `moneyPerUnusedHand −1`                      |               7–12 % |
|   6 | Bock (`bock`)             | Křivka cílů 3.                                                                                                                                         | `targetCurve: 3`                             |                4–8 % |
|   7 | Doppelbock (`doppelbock`) | **Bazar a půjčovna:** 20 % žolíků v nabídce je přibitých a 15 % zapůjčených.                                                                           | `stickerChance.eternal: 0,2`, `rental: 0,15` |                3–6 % |
|   8 | Imperial (`imperial`)     | **Šéf i ve Velké:** Velká útrata má navíc pravidlo náhodného běžného šéfa (jiného než šéf patra, `minAnte ≤ patro`); cíl 1,5× a odměna 4 Kč zůstávají. | `bigBlindBoss: true` (nové pole)             |        1–3 % (< 3 %) |

- Nálepky se losují v pořadí přibitý → zapůjčený → zvětrávající, takže skutečné podíly na Doppelbocku a výš jsou
  přibližně 20 % přibitých, 12 % zapůjčených, 17 % zvětrávajících a 51 % bez nálepky.
- Imperial: pro Velkou útratu se nelosují šéfové, jejichž pravidlo je jen vyšší cíl (Šanon na šanonu), ani šéf
  téhož patra.
- Výzvy se hrají na Desítce (pokud výzva neříká jinak), denní run má úroveň danou seedem (kap. 11.7).
- V UI: ikona půllitru s číslem, popis všech aktivních ztížení v „Info o runu“.

Flavor: Desítka „Na rozehřátí. Zatím se nikdo nezranil.“ · Jedenáctka „Pivo zdražilo. Zase.“ · Dvanáctka „Klasika.
Cíle rostou rychleji než útrata.“ · Speciál „Speciál se pije pomalu. Žolíci zvětrají rychle.“ · Ležák „Dýško? To se
dneska nenosí.“ · Bock „Tmavé, silné a cíle až do stropu.“ · Doppelbock „Co je přibité, neprodáš. Co je půjčené,
platíš.“ · Imperial „Šéf sedí u každého stolu.“

## 11. Meta: výzvy, achievementy, odemykání, sbírka, statistiky, denní run, seed

### 11.1 Výzvy (20)

Předpřipravené runy se zvláštními pravidly, hrají se na Desítce. Dokončení = porážka šéfa patra 8 (pokud výzva
neříká jinak). **Odemykání:** výzvy 1–5 po první výhře, 6–10 po 3 výhrách, 11–15 po 6 výhrách, 16–20 po 10 výhrách
(výhry napříč balíčky a obtížnostmi).

|   # | Název (`id`)                             | Balíček                             | Pravidla                                                                                                       | Start                                 |
| --: | ---------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
|   1 | Suchý únor (`dry_february`)              | Hospodský                           | Žolíci se neobjevují nikde (Večerka, obálky, efekty). +2 sloty spotřebek.                                      | kupón Trhací kalendář, 10 Kč          |
|   2 | Skleník (`greenhouse`)                   | Hospodský                           | Všechny ♥ a ♦ jsou skleněné; sklo praská 1 z 3 (místo 1 z 5).                                                  | 2× babská rada Jablko od stromu       |
|   3 | Kamenolom (`quarry`)                     | Hospodský + 12 kamenných karet (64) | Babské rady se neobjevují.                                                                                     | žolík Golem (přibitý)                 |
|   4 | Byrokracie (`bureaucracy`)               | Hospodský                           | Každá zahraná ruka i každé zahození stojí 1 Kč; dluh až do −15 Kč.                                             | 15 Kč                                 |
|   5 | Švejkova anabáze (`svejk_anabasis`)      | Hospodský                           | Kombinace silnější než Dvojice neskórují (0 bodů). Vysoká karta a Dvojice začínají na úrovni 6.                | žolík Švejk                           |
|   6 | Rychlík bez zastávky (`express`)         | Hospodský                           | Útraty nejde přeskakovat; Večerka nemá přehození. +1 ruka.                                                     | 5 Kč                                  |
|   7 | Rovnou za ředitelem (`straight_to_boss`) | Hospodský                           | Malé a Velké útraty se automaticky přeskakují (štítky dostaneš).                                               | 10 Kč                                 |
|   8 | Minimalista (`minimalist`)               | Hospodský                           | Nejvýš 3 vybrané karty. Vysoká karta, Dvojice a Trojice začínají na úrovni 3.                                  | 5 Kč                                  |
|   9 | Jednotná cena (`flat_price`)             | Hospodský                           | Vše ve Večerce stojí 5 Kč (vč. obálek, kupónů a přehození), prodej vždy 2 Kč.                                  | 5 Kč                                  |
|  10 | Půjčovna kostýmů (`costume_rental`)      | Hospodský                           | Všichni žolíci jsou zapůjčení.                                                                                 | 10 Kč                                 |
|  11 | Svatba na doživotí (`lifelong_wedding`)  | Štamgastův                          | Všichni žolíci jsou přibití.                                                                                   | 0 Kč (dle balíčku)                    |
|  12 | Krátká paměť (`short_memory`)            | Hospodský                           | Na začátku každého patra se úrovně všech kombinací vrátí na 1. Pranostiky stojí 1 Kč.                          | 5 Kč                                  |
|  13 | Velký třesk (`big_bang`)                 | Hospodský                           | Cíle všech útrat ×3.                                                                                           | 2 náhodní legendární žolíci (přibití) |
|  14 | Večer při svíčkách (`candlelight`)       | Hospodský                           | Žolíci nefungují v první ruce každého kola. +1 ruka.                                                           | 5 Kč                                  |
|  15 | Čtyři roční období (`four_seasons`)      | Hospodský                           | Ve všech útratách patra 1 a 5 jsou debuffnuté ♥, patra 2 a 6 ♠, patra 3 a 7 ♦, patra 4 a 8 ♣.                  | 5 Kč                                  |
|  16 | Vánoční kapr (`christmas_carp`)          | Hospodský                           | 0 zahození, +2 ruce, +1 karta v ruce.                                                                          | 5 Kč                                  |
|  17 | Mariáš u Vaňků (`marias_party`)          | Mariášový                           | Barva a Postupka v barvě začínají na úrovni 3; obálky s hracími kartami se neobjevují; cíle ×1,25.             | 5 Kč                                  |
|  18 | Malometrážní byt (`micro_flat`)          | Hospodský                           | Velikost ruky 5; +2 sloty žolíků.                                                                              | 5 Kč                                  |
|  19 | Kasino u hranic (`border_casino`)        | Hospodský                           | Všech 52 karet je šťastných; úrok se nevyplácí.                                                                | 5 Kč                                  |
|  20 | Konec světa (`end_of_world`)             | Hospodský                           | Cíle křivky 1 ×1,25; run nekončí patrem 8 — dokončení až porážkou šéfa patra 12 (finálový šéf v patře 8 i 12). | 5 Kč                                  |

Výzvy se zapisují do historie odděleně, mají vlastní statistiku a achievementy (11.2).

### 11.2 Achievementy (78)

Kategorie: postup, skóre, kombinace, ekonomika, žolíci, spotřebky a karty, balíčky, obtížnosti, výzvy, sbírka
a meta, kuriozity. **Skryté** (S) se ve sbírce ukazují jako „???“, dokud je hráč nezíská. V seedovaných runech
se achievementy nezískávají (kromě „Semínko zaseto“), v denním runu ano.

|   # | Název                | Podmínka                                                                 | Kat.       |  S  |
| --: | -------------------- | ------------------------------------------------------------------------ | ---------- | :-: |
|   1 | Rundu platím já      | Vyhraj první kolo.                                                       | postup     |     |
|   2 | Šéf nešéf            | Poraz prvního šéfa.                                                      | postup     |     |
|   3 | Poločas v hospodě    | Dosáhni patra 5.                                                         | postup     |     |
|   4 | Zavíračka            | Vyhraj run (poraz šéfa patra 8).                                         | postup     |     |
|   5 | Ještě jedno!         | V nekonečném režimu poraz šéfa patra 9.                                  | postup     |     |
|   6 | Ponocný              | Dosáhni patra 12.                                                        | postup     |     |
|   7 | Kohout už kokrhá     | Dosáhni patra 16.                                                        | postup     |     |
|   8 | Tepelná smrt vesmíru | Skóre ruky přeteče do nekonečna.                                         | postup     |  S  |
|   9 | Tisícovka na stole   | Získej 1 000 bodů jednou rukou.                                          | skóre      |     |
|  10 | Desetitisícovka      | Získej 10 000 bodů jednou rukou.                                         | skóre      |     |
|  11 | Výplata              | Získej 100 000 bodů jednou rukou.                                        | skóre      |     |
|  12 | Milionář z paneláku  | Získej 1 000 000 bodů jednou rukou.                                      | skóre      |     |
|  13 | Státní rozpočet      | Získej 1 000 000 000 bodů jednou rukou.                                  | skóre      |     |
|  14 | Vědecký zápis        | Získej jednou rukou víc než 1e15 bodů.                                   | skóre      |     |
|  15 | S rezervou           | Dosáhni v jednom kole aspoň 10× cíle.                                    | skóre      |     |
|  16 | Za pět dvanáct       | Vyhraj kolo poslední rukou s přesahem menším než 5 % cíle.               | skóre      |     |
|  17 | Od Adama             | Zahraj Postupku A-2-3-4-5.                                               | kombinace  |     |
|  18 | Korunovace           | Zahraj Královskou postupku.                                              | kombinace  |     |
|  19 | Pětičlenná komise    | Objev Pětici.                                                            | kombinace  |  S  |
|  20 | Barevná televize     | Objev Barevný full house.                                                | kombinace  |  S  |
|  21 | Jako vejce vejci     | Objev Barevnou pětici.                                                   | kombinace  |  S  |
|  22 | Kariérní postup      | Zvyš libovolnou kombinaci na úroveň 10.                                  | kombinace  |     |
|  23 | Celý jídelníček      | V jednom runu zahraj všech 10 základních kombinací.                      | kombinace  |     |
|  24 | Vysoké nároky        | Vyhraj kolo jen Vysokými kartami (aspoň 2 ruce).                         | kombinace  |     |
|  25 | Encyklopedista       | Zahraj všech 13 kombinací (napříč runy).                                 | kombinace  |     |
|  26 | Na sekeru            | Dokonči kolo se záporným zůstatkem.                                      | ekonomika  |     |
|  27 | Nadité prasátko      | Měj najednou 50 Kč.                                                      | ekonomika  |     |
|  28 | Na důchod            | Měj najednou 100 Kč.                                                     | ekonomika  |     |
|  29 | Úroky z úroků        | Získej maximální úrok v 5 kolech po sobě.                                | ekonomika  |     |
|  30 | Na dřeň              | Odejdi z Večerky s 0 Kč a vyhraj další kolo.                             | ekonomika  |     |
|  31 | Nákupní horečka      | Utrať 40 Kč v jedné Večerce.                                             | ekonomika  |     |
|  32 | Ještě se podívám     | Přehoď nabídku 10× v jedné Večerce.                                      | ekonomika  |     |
|  33 | Bleší trh            | Prodej 6 žolíků v jednom runu.                                           | ekonomika  |     |
|  34 | Plný lokál           | Měj zaplněné všechny sloty žolíků (aspoň 5).                             | žolíci     |     |
|  35 | Celá vitrína         | Měj najednou žolíky s lesklou, holografickou, duhovou i negativní edicí. | žolíci     |     |
|  36 | Vyjeli z hory        | Získej legendárního žolíka.                                              | žolíci     |     |
|  37 | Staré pověsti české  | Objev všech 8 legendárních žolíků.                                       | žolíci     |     |
|  38 | Abstinent            | Dosáhni patra 4 bez jediného žolíka v runu.                              | žolíci     |     |
|  39 | Kopírka na úřadě     | Nech kopírujícího žolíka kopírovat jiného kopírujícího žolíka.           | žolíci     |  S  |
|  40 | Jak z vody           | Nech škálujícího žolíka dorůst na ×5 nebo +50 mult.                      | žolíci     |     |
|  41 | Sněhulák v červenci  | Poraz finálového šéfa se Sněhulákem ve slotu.                            | žolíci     |  S  |
|  42 | Rosnička na žebříku  | Použij celkem 50 pranostik.                                              | spotřebky  |     |
|  43 | Babička má radost    | Použij celkem 50 babských rad.                                           | spotřebky  |     |
|  44 | Razítko na razítku   | Použij celkem 25 úředních razítek.                                       | spotřebky  |     |
|  45 | Sedlák rozumí počasí | Objev všech 13 pranostik.                                                | spotřebky  |     |
|  46 | Notářský zápis       | Měj v balíčku najednou karty se všemi 4 pečetěmi.                        | spotřebky  |     |
|  47 | Střepy pro štěstí    | Rozbij celkem 10 skleněných karet.                                       | spotřebky  |     |
|  48 | Železná opona        | Skóruj ruku se 4 a více ocelovými kartami v ruce.                        | spotřebky  |     |
|  49 | Kamenná zídka        | Zahraj ruku z 5 kamenných karet.                                         | spotřebky  |     |
|  50 | Turné po hospodách   | Vyhraj s každým z 12 balíčků.                                            | balíčky    |     |
|  51 | Flek, re, tutti      | Vyhraj s Mariášovým balíčkem.                                            | balíčky    |     |
|  52 | Splátkový kalendář   | Vyhraj s Dlužníkem.                                                      | balíčky    |     |
|  53 | Pohádkový dvůr       | Vyhraj s Obrázkovým balíčkem.                                            | balíčky    |     |
|  54 | Rozehřátý            | Vyhraj na Jedenáctce.                                                    | obtížnosti |     |
|  55 | Dvanáctka na stojáka | Vyhraj na Dvanáctce.                                                     | obtížnosti |     |
|  56 | Speciální péče       | Vyhraj na Speciálu.                                                      | obtížnosti |     |
|  57 | Pět piv a jdu domů   | Vyhraj run na Ležáku.                                                    | obtížnosti |     |
|  58 | Bock na bok          | Vyhraj na Bocku.                                                         | obtížnosti |     |
|  59 | Dvojitý zásah        | Vyhraj na Doppelbocku.                                                   | obtížnosti |     |
|  60 | Imperátor výčepu     | Vyhraj na Imperialu.                                                     | obtížnosti |     |
|  61 | Legenda okresu       | Vyhraj na Imperialu se 4 různými balíčky.                                | obtížnosti |     |
|  62 | Vyzývatel            | Dokonči 1 výzvu.                                                         | výzvy      |     |
|  63 | Desetiboj            | Dokonči 10 výzev.                                                        | výzvy      |     |
|  64 | Mistr republiky      | Dokonči všech 20 výzev.                                                  | výzvy      |     |
|  65 | Sběratel tácků       | Objev 50 žolíků.                                                         | sbírka     |     |
|  66 | Muzeum žolíků        | Objev všechny žolíky.                                                    | sbírka     |     |
|  67 | Poukázkový maniak    | Vlastni v jednom runu 8 kupónů.                                          | sbírka     |     |
|  68 | Ranní rozcvička      | Dojdi v denním runu aspoň do patra 3.                                    | meta       |     |
|  69 | Týden v kuse         | Odehraj denní run 7 dní po sobě.                                         | meta       |     |
|  70 | Semínko zaseto       | Rozehraj run s vlastním seedem.                                          | meta       |     |
|  71 | Inventář podniku     | Odehraj 100 runů.                                                        | meta       |     |
|  72 | Štamgastův žák       | Dokonči tutoriál.                                                        | meta       |     |
|  73 | Rychlé pivo          | Prohraj hned na první Malé útratě.                                       | kuriozity  |  S  |
|  74 | O chlup              | Prohraj kolo, ve kterém ti chybělo méně než 1 % cíle.                    | kuriozity  |  S  |
|  75 | Jednou ranou         | Poraz šéfa první rukou.                                                  | kuriozity  |     |
|  76 | Nic se nevyhazuje    | Vyhraj run bez jediného zahození.                                        | kuriozity  |     |
|  77 | Doklady v pořádku    | Poraz Kontrolu z finančáku s aspoň 20 Kč v kapse.                        | kuriozity  |     |
|  78 | Zkratkou přes pole   | Přeskoč v jednom runu 8 útrat.                                           | kuriozity  |     |

### 11.3 Odemykání

| Co                | Na začátku                                           | Jak se odemyká                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startovní balíčky | Hospodský, Štamgastův                                | podmínky v kap. 9                                                                                                                                                                              |
| Síla piva         | Desítka pro každý balíček                            | výhra na úrovni N s balíčkem → N + 1 pro ten balíček                                                                                                                                           |
| Žolíci (101)      | ≈ 70 (všichni běžní, ~60 % vzácných, ~40 % epických) | ≈ 23 podmínkami `UnlockCondition` (např. Sekera: měj 0 Kč na konci kola; Sněhulák: vyhraj kolo první rukou; Napodobitel: měj 5 žolíků najednou); legendární se odemykají objevením (z razítka) |
| Kupóny            | všech 12 tier 1                                      | tier 2 po koupi jeho tier 1 ve 2 různých runech, nebo všechny najednou po 3 výhrách                                                                                                            |
| Spotřebky         | všechny                                              | — (sbírka sleduje objevení)                                                                                                                                                                    |
| Tajné kombinace   | skryté                                               | prvním zahráním (kap. 2.2.4)                                                                                                                                                                   |
| Výzvy             | žádná                                                | kap. 11.1                                                                                                                                                                                      |
| Denní run         | od začátku                                           | — (používá celý obsah bez ohledu na odemčení)                                                                                                                                                  |

- Odemčení se vyhodnocuje po každé akci (profil), ne až na konci runu; nově odemčené se ukáže toastem
  „Odemčeno: …“ a ve sbírce má štítek „Nové“.
- `RunState.unlockedPool` se nastaví při startu runu ze stavu profilu; během runu se nemění.

### 11.4 Sbírka (codex)

Záložky: Žolíci · Pranostiky · Babské rady · Razítka · Kupóny · Štítky · Šéfové · Balíčky · Síla piva ·
Vylepšení, pečetě a edice · Kombinace · Výzvy · Achievementy.

Stavy položky: **neodemčeno** (silueta + podmínka odemčení) → **odemčeno, neobjeveno** (silueta + název „???“,
nápověda „Zatím se ti neukázal“) → **objeveno** (plná karta: název, mechanika, flavor, vzácnost, cena, statistika
použití). Objevení = položka se hráči ukázala v obchodě, obálce, jako šéf nebo štítek. Filtr podle kategorie
a štítků (`JokerTag`), řazení podle vzácnosti/názvu/četnosti použití.

### 11.5 Statistiky

- **Profil:** odehrané runy, výhry, % výher (celkově, per balíček, per síla piva), nejlepší ruka (skóre,
  kombinace a seed), nejvyšší skóre kola, nejvyšší patro (hlavní hra i nekonečný režim), nejčastěji hraná
  kombinace, nejpoužívanější žolík (podle kol ve slotu), nejčastěji kupovaný žolík, celkem vydělané/utracené Kč,
  zahrané karty, zahození, poražení šéfové (per šéf), příčiny proher (per šéf / útrata — pro „pitvu“), nejdelší
  série výher, nejrychlejší výhra (počet zahraných rukou).
- **Historie runů:** posledních 50 runů — datum, seed, balíček, síla piva, výzva/denní, výsledek, patro, nejlepší
  ruka, žolíci na konci. Z historie jde seed zkopírovat.
- **Denní runy:** datum, patro, skóre nejlepší ruky (jen oficiální pokus).

### 11.6 Seed a seedované runy

- Seed = 8 znaků z abecedy `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (bez zaměnitelných I/O/0/1). Při zadání se převádí
  na velká písmena a mezery se ignorují; neplatné znaky hra odmítne s hláškou.
- Výjimkou jsou seedy, které hra tvoří sama: denní run `DEN-YYYYMMDD` (11.7) a simulace `SIM-<prefix>-<i>` (12.2).
  Seed denního runu jde zadat i ručně (přehraje daný den „mimo soutěž“); jiné tvary s pomlčkou hra odmítne.
- Náhodný seed se generuje z kryptograficky bezpečného zdroje jen v UI (engine dostává hotový řetězec).
- Seed je vidět v „Info o runu“ a na pitvě, jde zkopírovat jedním klikem.
- **Seedovaný run** (seed zadaný hráčem) se počítá do historie, ale ne do odemykání, achievementů (kromě „Semínko
  zaseto“) ani statistik profilu (aby nešel „farmit“).

### 11.7 Denní run

- Seed `DEN-YYYYMMDD` (UTC, `dailySeed(date)`); stejný pro všechny hráče.
- Balíček a síla piva se určí ze seedu (stream `misc`): balíček z celé dvanáctky, síla piva 1–5. Obsah se nebere
  z profilu (`unlockedPool` = vše), aby měli všichni stejné podmínky.
- Jeden **oficiální** pokus denně (zapíše se do statistik denních runů); další pokusy jsou „mimo soutěž“.
- Na konci se ukáže text ke sdílení: „Karban DEN-20261001 · patro 7 · nejlepší ruka 1 234 560“.

## 12. Balanc a simulace

### 12.1 Cíle

| Metrika                                                             | Cíl                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| % výher rozumné strategie (nejlepší z botů `max`, `flush`, `pairs`) | Desítka 25–35 %, Jedenáctka 20–30 %, Dvanáctka 14–22 %, Speciál 10–17 %, Ležák 7–12 %, Bock 4–8 %, Doppelbock 3–6 %, Imperial < 3 % |
| Bot bez žolíků (`nojoker`) na Desítce                               | medián prohry v patře 3–4 (kalibrace křivky a kombinací)                                                                            |
| Náhodný bot (`random`)                                              | prohra v patrech 1–2 v > 90 % runů (kontrola, že hra není triviální)                                                                |
| Rozložení proher (Desítka, rozumná strategie)                       | < 10 % runů skončí v patrech 1–2; vrchol proher v patrech 5–7                                                                       |
| Letalita běžného šéfa (Desítka)                                     | 4–15 % proher při setkání; finální šéfové 20–40 %; žádný šéf výrazně nad ostatními (letalita normovaná podle patra)                 |
| Výhry balíčků (Desítka)                                             | ±7 p. b. od Hospodského; Obrázkový, Zbohatlík a Dlužník smí být až o 10 p. b. těžší                                                 |
| Žolíci                                                              | Δ výher podle vzácnosti v pásmu tabulky 4.3; žádný žolík s Δ < 0 p. b. ani nad horní hranicí                                        |
| Ekonomika                                                           | peníze při vstupu do Večerky: patro 1 → 8–14 Kč, patro 4 → 15–30 Kč; úrok tvoří 15–25 % příjmů                                      |
| Poměr skóre/cíl (medián nejlepší ruky × počet rukou)                | ≥ 1,0 do patra 6; v patře 8 kolem 0,8–1,2 (drama na konci)                                                                          |
| Délka runu                                                          | výhra ≈ 24 kol a 60–80 zahraných rukou (u člověka ~45–60 minut)                                                                     |

### 12.2 Boti

| Bot (`--strategy`) | Chování                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `max`              | Zahraje kombinaci s nejvyšším očekávaným skóre (vč. žolíků), zahazuje pro zlepšení, kupuje žolíky s nejvyšším hodnocením (tabulka 4.3 × synergie), přehazuje, má-li ≥ 2× cenu přehození nad rezervu na úrok. |
| `flush`            | Honí Barvu: drží nejčastější barvu, kupuje pranostiky na Barvu, barevné žolíky a babskou barvu.                                                                                                              |
| `pairs`            | Dvojice, Dvě dvojice, Trojice, Full house; kupuje žolíky na Dvojici a Pana vrchního.                                                                                                                         |
| `econ`             | Drží rezervu 25 Kč kvůli úroku, kupuje jen žolíky nad průměrem.                                                                                                                                              |
| `random`           | Náhodné legální akce (baseline).                                                                                                                                                                             |
| `nojoker`          | Hraje jako `max`, ale žolíky nekupuje.                                                                                                                                                                       |

Boti používají jen veřejné informace (žádné nahlížení do balíčku nad rámec „zbývá v balíčku“) a stejný engine
jako hra. Simulace je deterministická: run `i` má seed `SIM-<prefix>-<i>`.

**Šéfové a štítky** (od fáze 6): boti pravidla šéfů nepoznávají podle id — zkouší je na kopii hry nebo čtou náhled
enginu:

- tahy se přepočítávají přesně (žolíci, `validateHand`, `adjustHandScore`); kombinaci, kterou by šéf zakázal
  (`HandPreview.blockedReason` — Soused s vrtačkou), bot nehraje a v odhadu po zahození jí dá skóre 0;
- karty lícem dolů bot nezná: tah jimi doplní (protočí se a skórují), odhad počítá jen z viditelných karet; pod
  šéfem, který soudí celou ruku, je do tahu nepřidává;
- sonda zahození na kopii hry ukáže, jestli zahození vezme držené karty navíc (Tchyně), otočí je (Bílá paní) nebo
  jestli dobrané karty přijdou lícem dolů (Výluka, Mlha) — Monte Carlo zahazování s tím počítá;
- pozice žolíků vypnuté pravidlem (Jednooký hejtman: sonda dvou pořadí) dostanou nejslabší žolíky; když se žolíci
  po první ruce vrátí (Výpadek proudu), bot v kole bez žolíků nezahazuje;
- poslední ruka kola (Polední pauza, poslední pokus): rozhoduje, jestli ruka cíl dosáhne (u náhodného skórování
  nejhorší ze 3 vzorků), zbývající cíl se pro Monte Carlo přepočte poměrem přesného skóre k odhadu bez žolíků;
- útratu přeskočí jen za štítek, jehož hodnota ze sondy (peníze, úrovně, žolík, obálka zdarma; nižší cíl šéfa;
  jinak paušál za štítek „na později“) převýší ztrátu (odměna, nevyužité ruce, úrok, Večerka), a se silným buildem
  (průměrná nejlepší ruka × ruce ≥ 2,5× cíl následující útraty). Plošné přeskakování se silným buildem stálo
  ~6 p. b. výher.

**Spotřebky, obálky a kupóny** (od fáze 5, `src/engine/sim/value.ts`): boti je nepoznávají podle id. Akci zkusí na
kopii hry (sonda s přeseedovaným RNG — skutečné hody nezná) a ocení změnu stavu v Kč: peníze, úrovně kombinací
(× podíl kombinace na hře bota), modifikátory runu a patro, žolíky, nové a držené spotřebky a balíček (hodnota karty
= jak často ve hře bota skóruje × co přidá + peníze z vylepšení a pečetí). Pranostiky na hrané kombinace kupují
a hned používají; babské rady a razítka s cílem míří na karty s největším přínosem (u levé/pravé karty nejdřív
přeřadí ruku); spotřebku, která dá jen pár korun, nechají na později; kupóny, obálky a spotřebky kupují, když
hodnota ≥ cena × poměr, a s penězi hluboko nad rezervou na úrok stačí menší poměr (peníze nad stropem úroku nic
nevydělají). Se žolíkem ×mult za držené spotřebky (Babiččina truhla) spotřebky drží, se žolíkem krmeným spotřebkami
(Kořenářka) víc kupují babské rady.

### 12.3 Výstup `npm run simulate`

`npm run simulate -- --runs 500 --stake 1 [--deck pub] [--strategy all] [--seed-prefix A] [--json out.json]`

- % výher podle síly piva, balíčku a bota; rozložení patra prohry; příčina prohry (útrata / id šéfa).
- Průměr a medián skóre nejlepší ruky a skóre kola na patro, poměr skóre/cíl.
- Peníze při vstupu do Večerky, útrata podle kategorií (žolíci, spotřebky, obálky, kupóny, přehození).
- Nejčastěji kupovaní žolíci, Δ výher žolíků (kap. 4.3), letalita šéfů, výhry balíčků.
- Délka runu (kola, ruce), doba simulace.

### 12.4 Postup ladění (v tomto pořadí)

1. **Křivky a kombinace** bez žolíků (`nojoker`) — posunout čísla kombinací nebo křivku, dokud medián prohry není
   v patře 3–4.
2. **Ekonomika** — odměny, ceny, přehození: peníze při vstupu do Večerky v cílovém pásmu.
3. **Žolíci** — Δ výher podle vzácnosti; mimo pásmo → upravit `params` (ne mechaniku).
4. **Šéfové** — letalita; příliš smrtící šéf dostane vyšší `minAnte` nebo mírnější číslo.
5. **Balíčky** — výhry proti Hospodskému.
6. **Síla piva** — % výher podle úrovní; ladí se křivky 2 a 3 a šance nálepek.
7. Po každé změně znovu celá sada (3 × 500 runů na úroveň s různými `--seed-prefix`). Přijetí: výsledky tří sad
   se liší nejvýš o 3 p. b. a leží v cílovém pásmu.
8. Každou změnu čísla zapsat do `docs/DECISIONS.md` (datum, co, proč, metrika před/po) a do tabulek tohoto dokumentu.

### 12.5 Pravidla změn

- Změna pořadí vyhodnocení nebo pravidla detekce = nejdřív test, pak kód, pak tento dokument.
- Čísla obsahu žijí jen v `params` definic (a v tabulkách zde); texty je čtou přes `{param}`, aby se nerozešly.
- Testy `tests/unit/content.test.ts` (kombinace 2.2.1, edice 2.6) a `tests/unit/targets.test.ts` (cíle 2.3) ověřují,
  že tabulky tohoto dokumentu odpovídají enginu a obsahu; při změně čísla se mění tabulka i test.

## 13. Obrazovky, ovládání a prezentace

Rozvržení a chování UI podle `CLAUDE.md` kap. 4 a 7. Všechny texty jsou v `src/i18n` (kap. 0.1), čísla formátuje
`src/i18n/format.ts`.

### 13.1 Obrazovky

| Obrazovka          | Obsah                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Hlavní menu        | Nová hra (balíček + síla piva + seed) · Pokračovat · Výzvy · Denní run · Sbírka · Statistiky · Nastavení · Titulky |
| Výběr útraty       | 3 karty (Malá / Velká / Šéf): cíl, odměna, u Malé a Velké tlačítko Přeskočit se štítkem; u šéfa jeho pravidlo      |
| Herní obrazovka    | viz 13.2                                                                                                           |
| Konec kola         | rozpis odměn (kap. 2.4.2) s animací po řádcích → **Vyplatit**                                                      |
| Večerka            | kartové sloty, obálky, kupón, Přehodit (s cenou), Pokračovat; prodej z řady žolíků/spotřebek; prázdný stav (2.5.1) |
| Výběr z obálky     | N karet, „Vyber {n}“, Přeskočit; u babských rad a razítek dole dobraná ruka pro výběr cílů                         |
| Pitva              | příčina (útrata / šéf + hláška `death`), statistiky runu, seed ke zkopírování, Nová hra / Menu                     |
| Výhra              | titulky se statistikou runu → Konec / Nekonečný režim                                                              |
| Info o runu        | úrovně kombinací (tajné „???“), složení balíčku, aktivní štítky, kupóny, ztížení síly piva, seed                   |
| Sbírka, Statistiky | kap. 11.4 a 11.5                                                                                                   |
| Titulky            | autoři, nástroje, atribuce z `ASSETS.md` (písmo OFL, ikony CC BY 3.0 s autory), „inspirováno hrou Balatro“         |

### 13.2 Herní obrazovka

- **Levý panel:** název útraty/šéfa + pravidlo, „Dosáhni aspoň {cíl}“, skóre kola, aktuální kombinace s úrovní a
  **živým náhledem čipy × mult** (3.1, náhled), Ruce, Zahození, peníze, Patro x/8, Kolo, tlačítka „Info o runu“
  a „Nastavení“.
- **Nahoře:** řada žolíků (x/5, tažením přesun, klik = detail s Prodat) a spotřebek (x/2, klik = Použít/Prodat).
- **Uprostřed:** stůl se zahranými kartami a animací skórování (`ScoreStep` jeden po druhém, bubliny +čipy / +mult /
  ×mult nad zdrojem).
- **Dole:** ruka (výběr klikem/dotykem, max. `maxSelect`), **Zahrát** / **Zahodit**, třídění podle hodnoty / barvy.
- **Vpravo dole:** balíček „zbývá/celkem“, klik = náhled zbývajících karet podle barev a hodnot.

### 13.3 Ovládání

| Klávesa  | Akce                                         |
| -------- | -------------------------------------------- |
| 1–8      | vybrat / zrušit výběr karty na pozici v ruce |
| Enter    | Zahrát                                       |
| X        | Zahodit                                      |
| S / B    | seřadit podle hodnoty / podle barvy          |
| Mezerník | přeskočit (zrychlit) běžící animaci          |
| Esc      | menu / zavřít dialog                         |

Myš i dotyk jsou rovnocenné (tablet plně funkční, telefon „best effort“); drag & drop žolíků funguje i dotykem.
Každý ovládací prvek je dosažitelný klávesnicí (Tab) a má viditelný focus a `aria-label`.

### 13.4 Nastavení (výchozí hodnoty)

Hlasitost SFX 70 % · hudba 50 % · rychlost hry 1× (1×–4×) · animace zap · screen shake zap · celá obrazovka vyp ·
barvoslepý režim vyp · velikost UI 100 % (80–140 %) · přehled klávesových zkratek · export/import uložení · reset
profilu (dvojí potvrzení). Nastavení je součást profilu (`karban.profile`).

- **Barvoslepý režim** = 4barevný balíček: ♠ černá, ♥ červená, ♦ modrá, ♣ zelená (+ symbol barvy vždy u indexu).
- `prefers-reduced-motion` vypne screen shake a zkrátí animace i bez zásahu do nastavení.

### 13.5 Tutoriál „Štamgast“

Při prvním runu provází hráče **Štamgast** bublinami (jde přeskočit a v Nastavení znovu zapnout). Kroky:

1. výběr karet a živý náhled čipy × mult,
2. Zahrát a pořadí skórování,
3. Zahodit,
4. cíl kola a počet Rukou,
5. konec kola a úrok,
6. Večerka a koupě žolíka,
7. pořadí žolíků (+mult vlevo, ×mult vpravo),
8. šéf a jeho pravidlo,
9. přeskočení útraty za štítek.

Dokončení = achievement „Štamgastův žák“.

### 13.6 Zvuk a „šťáva“

- **SFX** (syntetizované ve Web Audio): klik, výběr karty, zamíchání, „tik“ za každý `ScoreStep` (výška tónu roste
  s multem), velké skóre (≥ cíl jednou rukou), zaplacení, prodej, zahození, příchod šéfa, výhra, prohra, odemčení.
- **Hudba:** procedurální chiptune smyčka; v menu klidnější, ve hře rytmičtější, u šéfa tempo +15 %.
- **Efekty:** částice na jediném `<canvas>` (mince, střepy skla, jiskry u ×mult), screen shake u velkého skóre,
  tilt a hover karet, počítadlo skóre; animuje se jen `transform`/`opacity`, rychlost podle `--speed`.

---

## Příloha A — Odchylky od výchozích čísel zadání orchestrace

Výchozí návrh čísel pro fázi 0 obsahoval řadu hodnot, které se **přesně shodovaly s Balatrem** (zakázáno kap. 1, 5 a 7
`CLAUDE.md` i pravidlem „čísla volíme vlastní“). Tyto hodnoty jsou nahrazeny vlastními se stejnou křivkou síly.
Hodnoty, které výslovně určuje `CLAUDE.md` (4 ruce, 3 zahození, 8 karet, odměny 3/4/5 Kč + 1 Kč za ruku, úrok 1 Kč
za 5 Kč se stropem 5, edice +50 čipů / +10 mult / ×1,5 / +1 slot, ocelová ×1,5, kamenná +50, zlatá +3 Kč,
skleněná ×2, čipy karet, 1/1,5/2× cíle útrat, 5 slotů žolíků, 2 sloty spotřebek, složení Večerky), zůstávají.

| Položka                            | Výchozí návrh                                                                                      | Tento dokument                                                                                                   | Důvod                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Kombinace (čipy × mult, přírůstky) | např. 5×1 (+10/+1), 10×2 (+15/+1), 20×2 (+20/+1)…                                                  | tabulka 2.2.1 (6×1, 12×2, 24×2 …)                                                                                | 3 základy a 10 z 13 přírůstků byly shodné s Balatrem                   |
| Startovní peníze                   | 4 Kč                                                                                               | 5 Kč                                                                                                             | shoda                                                                  |
| Pranostika / rada / razítko        | 3 / 3 / 4 Kč                                                                                       | 3 / 4 / 6 Kč                                                                                                     | trojice cen shodná                                                     |
| Hrací karta ve Večerce             | 1 Kč                                                                                               | 2 Kč                                                                                                             | shoda                                                                  |
| Obálky                             | 4 / 6 / 8 Kč; 3/5/5 a 2/4/4 možností; váhy 4/2/0,5 a 1,2/0,6/0,15                                  | 4 / 7 / 10 Kč; 3/4/6 a 2/3/5 možností; váhy kap. 2.9                                                             | ceny, počty možností i váhy byly shodné; žolíci jsou nejcennější volba |
| Kupóny                             | 10 Kč (tier 2 také 10)                                                                             | 8–15 Kč podle síly                                                                                               | shoda; cena podle hodnoty                                              |
| Legendární žolík                   | 20 Kč                                                                                              | 16 Kč                                                                                                            | shoda                                                                  |
| Váhy kartových slotů               | 20 / 4 / 4 / 0 / 0                                                                                 | 14 / 3 / 3 / 0 / 0                                                                                               | shoda                                                                  |
| Vzácnosti v obchodě                | 70 / 25 / 5                                                                                        | 68 / 26 / 6                                                                                                      | shoda                                                                  |
| Negativní edice                    | 0,3 %                                                                                              | 0,25 %                                                                                                           | shoda                                                                  |
| Příplatky za edice                 | +2 / +3 / +5 / +5 Kč                                                                               | +1 / +2 / +4 / +6 Kč                                                                                             | shoda; cena podle hodnoty                                              |
| Zlatá pečeť                        | +3 Kč                                                                                              | +2 Kč                                                                                                            | shoda                                                                  |
| Kazící se žolík                    | debuff po 5 kolech                                                                                 | „zvětrá“ po 6 kolech                                                                                             | shoda                                                                  |
| Zapůjčený žolík                    | cena 1 Kč, −3 Kč za kolo                                                                           | cena 2 Kč, −2 Kč za kolo                                                                                         | shoda                                                                  |
| Žebříček síly piva                 | malá bez odměny / křivka 2 / věční 30 % / −1 zahození / křivka 3 / kazící se 30 % / zapůjčení 30 % | Dražší pivo / křivka 2 / zvětrávání 25 % / Bez dýška / křivka 3 / přibití 20 % + zapůjčení 15 % / Šéf i ve Velké | celý žebříček odpovídal 1:1 (pořadí, pravidla i 30 %)                  |
| Nekonečný režim                    | `base(8) × g^(a−8)`                                                                                | `nice(base(8) × g(a)^(a−8))`                                                                                     | upřesnění zápisu, stejné zaokrouhlení jako hlavní hra                  |
| Edice hrací karty (revize fáze 5)  | lesklá 4 %, holografická 2,8 %, duhová 1,2 %                                                       | 5 % / 2,5 % / 1 %                                                                                                | shoda (karetní obálka)                                                 |
| Karetní obálka (revize fáze 5)     | vylepšení 40 %                                                                                     | 35 % (pečeť 15 % beze změny)                                                                                     | shoda                                                                  |
| Zaručená edice (revize fáze 5)     | lesklá 50 %, holografická 35 %, duhová 15 %                                                        | 55 % / 30 % / 15 % (Hromadné vyřízení, Kontrola totožnosti, štítek Vyleštěné příbory)                            | shoda                                                                  |
| Babská rada č. 18 (revize fáze 5)  | Zaříkávání (`incantation`)                                                                         | Zaklepat na dřevo (`knock_on_wood`)                                                                              | přeložený název cizí karty (CONTENT-GUIDE 13: ani přeložené názvy)     |

Křivky cílů 1–3, ceny žolíků 4–5 / 6–7 / 8–10, přehození 4 Kč (+1), šance edic lesklá/holo/duhová u žolíka, vylepšení
(+25 čipů, +5 mult, sklo 1 z 5, šťastná 1 z 4 / 1 z 12) a ostatní výchozí čísla jsou převzata z návrhu beze změny.

## Příloha B — Požadovaná rozšíření rozhraní enginu

Obsah v tomto dokumentu počítá s těmito doplňky `src/engine/types.ts` a `src/engine/content-types.ts`
(doplní se ve fázi, která je poprvé potřebuje):

| Kde                         | Doplněk                                                                                                                                 | Kvůli                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Modifiers`                 | `shopPriceAdd: number` (0)                                                                                                              | Jedenáctka                                                                                   |
| `Modifiers`                 | `playingCardEnhanceChance: number` (0,2), `playingCardSealChance: number` (0)                                                           | Kartářka, hrací karty ve Večerce                                                             |
| `Modifiers`                 | `disableEnhancements: boolean`                                                                                                          | Bílá hora                                                                                    |
| `Modifiers`                 | `fixedCardChips: number` (0 = vypnuto)                                                                                                  | Normalizace                                                                                  |
| `StakeDef`                  | `bigBlindBoss?: boolean`                                                                                                                | Imperial                                                                                     |
| `JokerDef`                  | `noEternal?`, `noRental?`, `noPerishable?`                                                                                              | nálepky (4.6)                                                                                |
| `JokerHooks`                | `onAcquire?(ctx)`                                                                                                                       | Golem a další „při získání“                                                                  |
| `BossHooks`                 | `adjustHandScore?(ctx, score): number`                                                                                                  | Pan starosta                                                                                 |
| `TagHooks`                  | `onRoundLost?(ctx): boolean` (true = kolo zachráněno)                                                                                   | Lékařské potvrzení                                                                           |
| `TagHooks`                  | `roundEndMoney?(ctx): number` (řádek `tag:<id>` v rozpisu odměn; `onRoundEnd` štítků až po rozpisu)                                     | Termínovaný vklad                                                                            |
| `Modifiers`                 | `bossTargetMult: number` (1; násobí jen cíl šéfa)                                                                                       | Šéf má chřipku                                                                               |
| `EngineApi`                 | `openBooster(id)` (fronta obálek zdarma), `addFreeRerolls(n)`, `addShopJoker(opts)`, `setShopJokerEdition(edition)`, `addShopVoucher()` | obálky zdarma, štítky „v příští Večerce“                                                     |
| `ShopPriced`                | `priceMult?`, `noEditionSurcharge?`, `extra?` (položka navíc, přehození ji nemění)                                                      | Doporučení od známého, Protekce, Vyleštěné příbory, Fotonegativ                              |
| `DeckDef`                   | `onBossDefeated?(ctx)`                                                                                                                  | Kalendářový                                                                                  |
| `EngineApi`                 | `discardFromHand(cardId)`                                                                                                               | Kapsář v tramvaji, Tchyně na návštěvě                                                        |
| `EngineApi`                 | `setJokerDebuffed(uid, on)`                                                                                                             | Exekutor, Jednooký hejtman, Krajský úřad, Výpadek proudu                                     |
| `EngineApi`                 | `setCardFaceDown(cardId, on)`, `shuffleHand()`                                                                                          | Bílá paní, Česnek na krk                                                                     |
| `EngineApi`                 | `handBase(hand, level)`                                                                                                                 | Nová vyhláška, Influencerka Nikča                                                            |
| `EngineApi`                 | `addRoundHandSize(n)`                                                                                                                   | Velká voda, Rozložené noviny                                                                 |
| `EngineApi`                 | `setMoney(n)`, `changeAnte(delta)`, `levelUpAll(levels)`, `addPermanentModifier(delta)`, `rerollBoss()`                                 | Daňové přiznání, Úřední škrt/Amnestie, Úřední hodiny, trvalé postihy razítek, Známý na úřadě |
| `EngineApi`                 | `setJokerEdition`, `removeJokerStickers`, `copyJoker`, `availableJokers`                                                                | Hromadné vyřízení, Prominutí pokut, Ověřená kopie, Výjimka z vyhlášky, Daňové přiznání       |
| `VoucherDef`                | `available?(ctx): boolean` (čistá funkce; nabídka i koupě)                                                                              | Úřední škrt, Amnestie (až od patra 2)                                                        |
| `RunState`                  | `discoveredHands: HandType[]`                                                                                                           | objev kombinace v runu (2.2.4) — komentář v `RunState` už s polem počítá                     |
| `Card` / `RoundState.flags` | dočasné debuffy z efektů (Černá kočka)                                                                                                  | uloženo v `round.flags`, `isCardDebuffed` je čte                                             |

## Příloha C — Pitva: ukázky hlášek

Každý šéf a obě běžné útraty mají hlášku `death` (fáze 6 doplní všechny):

| Příčina               | Hláška                                                 |
| --------------------- | ------------------------------------------------------ |
| Malá útrata (`small`) | „Na Malé útratě? To se stává. Málokomu.“               |
| Velká útrata (`big`)  | „Velká útrata, velké zklamání.“                        |
| Kontrola z finančáku  | „Doklady k tomu nemáte, že?“                           |
| Výluka na trati       | „Náhradní doprava nejela.“                             |
| Inventura             | „Manko se strhává ze mzdy.“                            |
| Soused s vrtačkou     | „Prohráno na plné obrátky.“                            |
| Polední pauza         | „Přijďte po obědě. Zítra.“                             |
| Pan starosta          | „Sliby chyby.“                                         |
| Krajský úřad          | „Vaše žádost byla zamítnuta. Odvolání není přípustné.“ |
| Protihluková stěna    | „Hlavou zeď neprorazíš.“                               |
| Velká voda            | „Topíš se v kartách.“                                  |
| Bílá paní             | „Strašidelně slabý výkon.“                             |

Další texty v duchu hry: prázdná Večerka „Večerka zavřená – inventura“, chyba „Něco se pokazilo. Jako u Vaňků
o Vánocích.“, tip „+mult patří doleva, ×mult doprava.“, tip „Ocelové karty nech v ruce, ať makají.“

## Příloha D — Rezerva obsahu pro patche

Šéfové, kteří se nevešli do 25 (pro obsahové patche po 1.0):

| Název            | Pravidlo                                                             |
| ---------------- | -------------------------------------------------------------------- |
| Fronta na banány | První zahraná ruka kola neskóruje (karty odejdou jako při zahození). |
| Pomalá obsluha   | Po zahrání nebo zahození se dobírají nejvýš 2 karty.                 |
| Zamrzlé potrubí  | Po zahození se nedobírá.                                             |
| Povinná výbava   | Každá zahraná ruka musí mít aspoň 4 karty, jinak neskóruje.          |
| Řetízkáč         | Před každou rukou se pořadí žolíků náhodně zamíchá.                  |
| Pátek třináctého | Šance „1 z N“ v tomto kole nikdy nevyjdou (sklo nepraskne).          |

Další nápady: čtvrtý typ spotřebky „Stírací losy“ (5.5), žolíci ze zásobníku 4.9, výzvy „Hradec vs. Brno“
(jen ♥ a ♠) a „Silvestr“ (každé 3. kolo cíl ×2, odměny ×3).
