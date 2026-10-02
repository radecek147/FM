# Architektura — Karban

> Technický přehled. Herní pravidla a čísla jsou v `docs/DESIGN.md`, rozhodnutí v `docs/DECISIONS.md`.

## 1. Vrstvy

```
┌──────────────────────────────────────────────────────────────┐
│ src/ui/**        DOM + CSS renderer, obrazovky, animace,     │
│                  částice (canvas), zvuk (Web Audio)           │
│   ▲ události (EventBus)          │ akce (dispatch)           │
│   │ snapshot stavu (readonly)    ▼                           │
│ src/engine/**    čistý TypeScript, BEZ DOM, deterministický  │
│   ▲ ContentRegistry (dependency injection)                   │
│ src/content/**   DATA: žolíci, šéfové, spotřebky, balíčky…   │
│ src/i18n/**      všechny texty (cs) + formátování čísel       │
└──────────────────────────────────────────────────────────────┘
```

Pravidla závislostí (hlídá ESLint `no-restricted-imports` / `no-restricted-globals`):

- `engine` neimportuje `ui`, `content` ani `i18n` a nesahá na `window`/`document`/`localStorage`.
  Obsah dostává přes `ContentRegistry` (viz `src/engine/content-types.ts`).
- `content` importuje jen typy a pomocné funkce z `engine` (nikdy UI).
- `ui` čte stav jen přes snapshot (`Readonly<RunState>`) a mění ho jen akcemi (`game.dispatch(action)`).
- Texty jsou výhradně v `src/i18n/cs.ts` (+ podmoduly `src/i18n/cs/*.ts`). Engine emituje klíče a čísla.
  I statické `index.html` (titulek, meta popis, `<noscript>`) má jen zástupné symboly `{{t:klíč}}`, které při
  buildu/dev dosadí plugin `karban-i18n-html` ve `vite.config.ts`.

## 2. Engine

### 2.1 Stav

`RunState` (`src/engine/types.ts`) je **čistě JSON-serializovatelný** objekt: žádné `Set`, `Map`,
třídy ani funkce. Obsahuje i stav RNG streamů, takže `JSON.parse(JSON.stringify(state))` je plnohodnotné
uložení. Definice obsahu se ve stavu odkazují přes `defId`.

### 2.2 Akce a události

```ts
const game = Game.newRun({ deckId: 'pub', stake: 1, seed: 'ABCD2345' }, registry);
game.bus.on('handPlayed', (e) => ui.animateScore(e.result));
const res = game.dispatch({ type: 'play', cardIds: [12, 7, 3] });
if (!res.ok) ui.toast(t(`errors.${res.error}`));
```

- `dispatch(action)` validuje fázi a vstupy, změní stav, emituje události na `bus` a vrátí je i v
  `ActionResult.events` (UI je může přehrát sekvenčně s animací).
- Neplatná akce stav **nemění**, vrací `{ ok: false, error }` a na bus nepošle nic (i neznámý typ akce nebo vstup,
  který není pole — textový režim). Události se na bus doručí až po dokončení akce; chyba posluchače stav nevrací.
- Determinismus: stejný seed + stejná posloupnost akcí ⇒ identický stav (testováno i celým runem botem a s uložením
  a načtením po každé akci — `tests/unit/run-determinism.test.ts`). Boti simulace (`engine/sim`) nemají stav mimo
  `RunState`: rozhodnutí je čistá funkce stavu (RNG rozhodnutí ze seedu, jména bota a otisku stavu), takže simulace
  po uložení a načtení pokračuje stejně (`tests/unit/review2-sim-save.test.ts`).
- Stavový automat (`RunPhase`): `blind_select` → (`selectBlind`) `round` → výhra `round_end` (rozpis odměn) →
  `cashOut` → `shop` → `leaveShop` → `blind_select`…; `skipBlind` (Malá, Velká) zůstává ve `blind_select`;
  porážka šéfa → při výplatě nové patro (`anteChanged`, nové útraty, šéf, kupón); šéf patra 8 → `victory` →
  `continueEndless` → `round_end` (nekonečný režim); prohra → `game_over` (konečný stav). `booster` se vrací do
  `returnTo`. Přeřadit ruku jde jen v kole nebo v obálce, žolíky ve všech fázích kromě konce runu.
- Zahození: karty opustí ruku a zahození se započte **před** hooky (žolíci `onDiscard`, pečetě, šéf `onDiscard`),
  takže obsah vidí v ruce jen zbylé karty a událost `cardsDiscarded` hráčova zahození přijde před reakcemi.
- Dotazy pro UI bez změny stavu: `blindTarget(kind, bossId)` a `blindReward(kind, bossId)` (výběr útrat ukazuje
  stejná čísla, jaká pak použije kolo a rozpis odměn), `preview(cardIds)`, `sellValue(uid)`,
  `canUseConsumable(uid, targets)`, `modifiers()`. `preview` vrací i `blockedReason` (i18n klíč), když by šéf ruku
  zakázal (`validateHand`, Soused s vrtačkou) — čistý hook se volá v `readOnly`, takže dotaz neposune RNG.

### 2.3 RNG

`src/engine/rng/rng.ts` — xoshiro128** seedovaný hashem cyrb128. Každý účel má vlastní stream
(`deck`, `shop`, `booster`, `boss`, `tag`, `joker`, `card`, `consumable`, `misc`), seedovaný
`hash(seed + ':' + stream)`. Díky tomu např. přehazování obchodu neovlivní míchání balíčku.
`rngFromState(state.rng.shop)` mutuje pole ve stavu na místě → pokrok streamu se ukládá.

Denní run: `dailySeed(date)` = `DEN-YYYYMMDD` (UTC).

### 2.4 Moduly

| Modul                     | Odpovědnost                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `engine/types.ts`         | datové typy stavu, akcí, událostí                                                                                                 |
| `engine/content-types.ts` | rozhraní definic obsahu, hooků, `EngineApi`, `ContentRegistry`                                                                    |
| `engine/constants.ts`     | čísla pravidel z DESIGN 2.10 (odměny, násobky útrat, vzácnosti, nálepky, strop opakování, seed) a i18n klíče hlášek `MSG`         |
| `engine/rng/`             | seedovaný RNG                                                                                                                     |
| `engine/events.ts`        | typovaný `EventBus`                                                                                                               |
| `engine/cards/`           | tvorba karet, standardní balíček, čipy karty, barvy (divoká/kamenná)                                                              |
| `engine/hands/`           | detekce kombinací (vč. tajných, divokých karet, modifikátorů 4 prstů/mezer/kolem dokola)                                          |
| `engine/scoring/`         | skórovací pipeline → `ScoreResult` s kroky pro animaci                                                                            |
| `engine/effects/`         | skládání `Modifiers`, volání hooků žolíků/šéfů/štítků, implementace `EngineApi`                                                   |
| `engine/run/`             | `Game` — stavový automat runu (útraty, kola, odměny, konec, nekonečný režim), cíle, losování šéfů (`bosses.ts`)                   |
| `engine/shop/`            | generování obchodu a boosterů (`shop.ts`), pooly a edice (`pool.ts`), ceny a prodej (`prices.ts`)                                 |
| `engine/save/`            | serializace, verze formátu, migrace                                                                                               |
| `engine/meta/`            | profil hráče: odemykání, statistiky, achievementy, historie (fáze 8)                                                              |
| `engine/sim/`             | boti (`bots.ts`), hodnocení tahů (`hand-eval.ts`), runner a souhrn metrik (`runner.ts`), příkazy textového režimu (`commands.ts`) |

### 2.5 Skórování (pořadí je závazné a otestované)

1. **Základ kombinace**: čipy a mult podle úrovně (`HandTypeDef` + `chipsPerLevel`/`multPerLevel`),
   případně upravené šéfem (`BossHooks.modifyBase`). Žolíci s `beforeScoring` běží před tímto krokem
   (mohou např. zvýšit úroveň kombinace).
2. **Skórující karty zleva doprava** (v pořadí, v jakém je hráč zahrál). Pro každou aktivaci karty:
   čipy karty → vylepšení (`EnhancementDef.onScored`) → edice karty → pečeť (`SealDef.onScored`) →
   žolíci zleva doprava (`onCardScored`). Opakované aktivace (červená pečeť, `retriggerScored`)
   zopakují celou sekvenci. Debuffnutá karta nedává nic (ale počítá se do kombinace).
3. **Karty držené v ruce** zleva doprava: vylepšení (`onHeld`, např. ocelová ×1,5) → žolíci
   (`onCardHeld`), včetně opakování (`retriggerHeld`). `EffectResult.destroyCard` tu nic nezničí — platí jen
   pro efekty skórující karty (krok 2 a `afterScored`).
4. **Žolíci zleva doprava** (`onHandPlayed`): edice žolíka typu „before“ (lesklá +čipy,
   holografická +mult) → vlastní efekt žolíka → edice typu „after“ (duhová ×mult).
5. `score = floor(chips × mult)`, šéf může skóre upravit (`BossHooks.adjustHandScore`). Pak `afterHandScored`
   (počítadla), šéf `afterHandPlayed`, `afterScored` vylepšení (jednou za ruku: hod skla, Ohmataná +3 čipy;
   `afterScoredCards` ve `scoring/score.ts`) a zničení označených karet.

Počet aktivací jedné karty je nejvýš `MAX_ACTIVATIONS_PER_CARD` (10). Platná vylepšení dává `GameCore.enhancements()`
— při `Modifiers.disableEnhancements` (Bílá hora) prázdný registr, karta se pak chová jako bez vylepšení.

Každá změna čipů/multu/peněz se zapíše jako **samostatný** `ScoreStep` (s průběžnými hodnotami), UI je přehraje —
efekt `{ chips, mult }` dá dva kroky (čipy → mult → ×mult → peníze), zpráva efektu patří k jeho prvnímu kroku.
Neplatné hodnoty efektu (NaN) se ignorují, nekonečno se ořízne na `Number.MAX_VALUE` (skóre ruky i kola zůstává
konečné, aby šlo uložit do JSON).
Velká čísla: počítáme v `number` (double); nad 1e15 formátujeme vědecky (`src/i18n/format.ts`).

### 2.6 Modifikátory

`Modifiers` = `BASE_MODIFIERS` + delty ze zdrojů v tomto pořadí: obtížnost (všechny úrovně ≤ zvolená),
balíček, výzva a trvalé efekty (`extraModifiers`, doplňuje `api.addPermanentModifier` přes `mergeDelta`), kupóny,
štítky, žolíci (`passive`), šéf (`passive`, pokud není vypnutý), dočasná velikost ruky kola
(`RoundState.handSizeDelta`). Čísla se sčítají, pole končící na `Mult` se násobí, booleany se ORují; výsledek se
ořízne na rozumné meze (`clampModifiers`). Neplatná čísla v deltě (NaN, ±∞) i přetečení se ignorují.
`bossTargetMult` násobí jen cíl šéfa (navíc k `targetMult`; `Game.blindTarget` ho použije i v náhledu výběru útrat) —
štítek Šéf má chřipku ho drží `passive` (0,75), dokud se v kole šéfa nespotřebuje.

`GameCore.mods()` drží výsledek v cache a vrací ho **zmrazený** (nikdo ho nesmí měnit — pravidla mění jen delty).
Cache se zneplatní po každé změně, která může změnit výsledek: příkazy API, každý hook žolíka/štítku, hooky šéfa
s vedlejšími účinky (`onRoundStart`, `afterHandPlayed`, `onDiscard`, `onDraw`) a konec akce. `passive` musí být čistá
funkce; běží v `GameCore.readOnly` — `ctx.rng`/`ctx.chance` v ní pracují na kopii streamu a stav RNG neposunou
(stejně náhled ruky a `ConsumableDef.canUse`: dotazy UI nesmí měnit run). `passive`, která sama čte `mods()`, dostane
`BASE_MODIFIERS` (ochrana proti rekurzi).

### 2.7 Hooky obsahu

Viz `JokerHooks`, `BossHooks`, `TagHooks` v `content-types.ts`. Hooky smí:

- číst stav (`ctx.state`, `ctx.api.*` dotazy),
- měnit **pouze** `ctx.self.state` (žolíci/štítky) a stav přes `ctx.api` příkazy,
- pro náhodu používat výhradně `ctx.rng` / `ctx.chance(n, d)`.

`EngineApi` (`ctx.api`, implementace `effects/api.ts`, typy v `content-types.ts`) — příkazy jsou deterministické,
emitují události a respektují limity (sloty, dluhový limit, „jen během kola“):

| Oblast             | Příkazy                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| peníze             | `addMoney` (ořízne dluhovým limitem), `setMoney` (přesně)                                                                                                                                |
| kolo a ruka        | `addHands`, `addDiscards`, `drawCards`, `addRoundHandSize`, `discardFromHand`, `setCardFaceDown`, `shuffleHand`, `cleanseCard`                                                           |
| kombinace          | `levelUpHand`, `levelUpAll`, `handBase` (dotaz na základ úrovně)                                                                                                                         |
| žolíci a spotřebky | `createJoker`, `destroyJoker`, `setJokerDebuffed`, `setJokerEdition`, `removeJokerStickers`, `copyJoker`, `transformJoker`, `createConsumable`                                           |
| karty balíčku      | `addCard`, `copyCard`, `destroyCard`, `modifyCard`                                                                                                                                       |
| run                | `addTag`, `openBooster`, `disableBoss`, `rerollBoss`, `changeAnte`, `addPermanentModifier`, `message` (i18n klíč)                                                                        |
| Večerka            | `addFreeRerolls`, `addShopJoker`, `setShopJokerEdition`, `addShopVoucher` (jen otevřená Večerka; přehození zdarma mimo ni čekají na příští)                                              |
| dotazy (bez změn)  | `getCard`, `handCards`, `modifiers` (zmrazené), `handLevel`, `isFace`, `cardRank`, `hasSuit`, `cardChips`, `jokerSlots`, `sellValue`, `availableJokers`, `jokerRarity`, `consumableKind` |

Žolíci z efektů spotřebek (fáze 5, úřední razítka): `setJokerEdition` mění edici (negativní tím mění sloty),
`removeJokerStickers` sundá nálepky (zvětralý žolík bez „zvětrávající“ znovu funguje, dočasný debuff kola trvá),
`copyJoker` vytvoří kopii i se stavem, nálepkami a prodejním bonusem (`onAcquire` jako u získání; edici lze přepsat)
a dotaz `availableJokers({ rarity })` vrátí pool, ze kterého by losoval `createJoker` — bez náhradního Pivního tácku,
takže obsah pozná, že žolík dané vzácnosti dostupný není (Výjimka z vyhlášky, Daňové přiznání). Změna edice/nálepek
emituje událost `jokerChanged`.

Babské rady (fáze 5): `transformJoker(uid, defId)` promění žolíka na místě (Kouzelný kotlík) — uid, pozice, edice,
nálepky i odpočet zvětrávání zůstanou, stav (`initState`) a prodejní bonus se založí znovu, nový žolík dostane
`onAcquire` a emituje se `jokerChanged`. `cleanseCard(cardId)` vrátí kartu do provozu do konce kola (Česnek na krk):
zruší debuff, otočí ji lícem nahoru a zapíše ji do `RoundState.cleansedCards`, takže ji `bossDebuffs` při dalších
přepočtech vynechá (pole je volitelné kvůli starším uložením). Dotazy `jokerRarity(defId)` a `consumableKind(defId)`
čtou definice z registru (obsah registr sám nemá). `ConsumableCtx.targets` jsou vždy seřazené zleva doprava podle
pozice v ruce (v kole nebo v ruce dobrané obálkou), ne podle pořadí výběru — „levá“ a „pravá“ karta (DESIGN 5.1).

Číselné vstupy příkazů: NaN a ±∞ se ignorují, počty (ruce, zahození, úrovně, patra, velikost ruky) se usekávají na
celá čísla, peníze a statistiky se zastaví na `Number.MAX_VALUE` — stav musí zůstat uložitelný do JSON.

Kopírující žolíci (`copyTarget`) volají hook cílového žolíka s `isCopy = true` — hook pak nesmí měnit
`self.state` (aby se počítadla nenavyšovala dvakrát); engine to jistí i sám: při `isCopy` dostane hook kopii instance
cíle a její změny se zahodí. V řetězu kopírujících žolíků dostane každý článek do `copyTarget` svou vlastní pozici
(`index`), hook cíle pak pozici kopírujícího. Cyklus, debuffnutý cíl nebo `copyable: false` = nic.
`JokerCtx.index` je vždy **aktuální** pozice žolíka — když hook dřív v témže průchodu zničí jiného žolíka (Sněhulák
roztaje), ostatní se posunou a kopírující „souseda“ vidí skutečného souseda.

Robustnost: vnoření téhož hooku žolíků (`onCardAdded` → `api.addCard` → `onCardAdded`…) je omezené
`MAX_NESTED_HOOK_DEPTH` (3), hlubší volání se přeskočí. Žolík s id, které registr nezná (obsah odebraný od uložení),
nic nedělá — stejně jako neznámý šéf, štítek, vylepšení či edice. Výjimka z hooku uprostřed akce vrátí stav do stavu
před akcí (jako neplatná akce) a propadne volajícímu. Po každé akci `dispatch` dobere prázdnou ruku v kole (spotřebka
zničila celou ruku…); nejsou-li karty ani pak, je to prohra z nedostatku karet.

Debuffy hracích karet určuje jen šéf (`BossHooks.isCardDebuffed`). Dočasné debuffy z jeho pravidla (Černá kočka) se
ukládají do `RoundState.flags`; engine po hooku šéfa `onRoundStart`, `afterHandPlayed` (až po `afterScored`),
`onDiscard` a `onDraw` přepočítá `Card.debuffed` celého balíčku, takže platí hned i pro karty v ruce.

Stav pravidla šéfa do konce kola žije v `RoundState.flags` pod klíči s předponou id šéfa (`black_cat.cards`,
`superstitious_granny.suit`, `track_closure.drawn`…): zapisují ho jen hooky s vedlejšími účinky (`onRoundStart`,
`afterHandPlayed`, `onDiscard`, `onDraw`), čisté hooky (`passive`, `isCardDebuffed`, `isDrawnFaceDown`, `validateHand`)
ho jen čtou. Nové kolo začíná s prázdnými `flags`, uložení a načtení je přenáší. **Strop** hodnoty modifikátoru
(Polední pauza „jen 1 ruka“, Sucho v obci „0 zahození“, Garsonka „nejvýš 4 karty“) se dělá bez nového pole
`Modifiers`: `onRoundStart` spočítá, o kolik je hodnota bez vlastního stropu nad stropem, uloží rozdíl do `flags`
a `passive` ho odečte — strop tak platí i s kupóny, balíčkem a žolíky, `Game.selectBlind` promítne změnu do
`handsLeft`/`discardsLeft` (porovnání modifikátorů před a po hoocích začátku kola) a Odvolání (`disableBoss`) vrátí
rozdíl jako u každého `passive`. Ruce a zahození přidané efekty až během kola (`api.addHands`) platí navíc.

Debuffy **žolíků** podle pravidla šéfa (Jednooký hejtman: pravá polovina řady, Výpadek proudu: do konce první ruky)
určuje čistá funkce `BossHooks.isJokerDebuffed(ctx, joker, index)`. Engine ji přepočítá (`refreshBossJokerDebuffs`
v `run/draw.ts`) na začátku kola po `onRoundStart` šéfa (před `onRoundStart` žolíků a před přepočtem rukou/zahození),
po zahrání ruky (před dobráním), po zahození a na konci každé akce v kole (`Game.dispatch`: přeřazení, prodej, nový
žolík ze spotřebky) — pravidlo tak sleduje pozici, ne uid. Rozdíl promítá přes `api.setJokerDebuffed`; žolíky vypnuté
pravidlem eviduje `RoundState.ruleJokerDebuffs` (volitelná podmnožina `jokerDebuffs`): žolíka vypnutého už jiným
efektem (Krajský úřad, Exekutor) si pravidlo nepřivlastní a jeho debuff nezruší. `clearJokerDebuffs` (konec kola,
Odvolání) eviduje prázdné pole; mimo fázi `round` se nepřepočítává. Ruce a zahození z pasivních efektů žolíků platí
podle stavu na začátku kola (jako u Exekutora) — přeřazením se nedají „nasbírat“.

`BossDef.params` nese čísla do textů šéfa: `rule` je má jen přes `{param}` (dosazuje `bossTexts` v `src/ui/describe.ts`
i textový režim `npm run simulate -- --play`) a testy šéfů hlídají, že změna `params` změní text.
`EngineApi.cardRank(card)` vrací hodnotu karty pro pravidla (kamenná při platných vylepšeních `null` — Sudé dny, Kapsář,
Mlha nad Labem).

Kontexty hooků jsou levné objekty: společný prototyp jádra nese živé `state`, `mods` a `api`; `ScoringInfo` zahrané
ruky je **sdílená vrstva** (`GameCore.ctxLayer`), kterou kontexty všech hooků ruky dědí přes prototyp (gettery
`chips`/`mult` zůstávají živé); vlastní pole volání (`card`, `isRetrigger`, `score`…) se přiřadí hodnotami a `ctx.rng`
vzniká až při prvním použití. Obsah proto nesmí kontext kopírovat spreadem (`{ ...ctx }` zkopíruje jen vlastní pole).
Dřív se `ScoringInfo` kopírovala přes `extend` (deskriptory) pro každý hook — ~45 % času skórování.

Štítky (fáze 6, `TagHooks`; každý hook vrací true = štítek se spotřeboval): `onAdded` hned po získání (přeskočení
útraty, `api.addTag`); `onBlindSelect` před výpočtem cíle a `onRoundStart` po něm (ruka se dobere až po hooku, takže
`addRoundHandSize` platí pro první dobrání); `onShopEnter` až **po** vygenerování Večerky (štítek ji upravuje přes
`addShopJoker` / `setShopJokerEdition` / `addShopVoucher` / `addFreeRerolls`; `passive` štítku při generování platí),
před `onShopEnter` žolíků; `roundEndMoney` přidá řádek `tag:<id>` do rozpisu odměn (krok 5 za balíčkem) a `onRoundEnd`
štítků běží až **po** sestavení rozpisu — štítek, který vyplácí v rozpisu (Termínovaný vklad), se tak smí spotřebovat
v `onRoundEnd`. `api.openBooster(id)` zařadí obálku zdarma do fronty `RunState.flags.pendingBoosters`; `Game.dispatch`
(a konec `newRun`) ji po akci otevře přes `startBooster`, jakmile je fáze `blind_select` nebo `shop` (zavření obálky
vrátí tam, odkud se otevřela, a další z fronty se otevře po té akci). Obálka ze štítku získaného uprostřed kola tak
počká na Večerku; fronta je součástí uloženého stavu, neznámé id se zahodí.

Zvláštní hooky (volají se jen jednomu adresátovi, ne všem zleva doprava): `JokerHooks.onAcquire` (žolík vstoupil do
slotů — koupě, obálka, `createJoker`; ne startovní žolíci výzvy), `JokerHooks.preventGameOver` a
`TagHooks.onRoundLost` (záchrana prohraného kola; štítky se ptají první), `DeckDef.onBossDefeated`. Hlášky, které
engine emituje (`ScoreStep.message`, událost `message`), jsou i18n klíče z `MSG` v `engine/constants.ts`.

### 2.8 Večerka a ceny

Ceny počítá `shop/prices.ts` podle DESIGN 2.5.2 (sleva zaokrouhlená polovinou nahoru, minimum 1 Kč, pak
`shopPriceAdd`; položky `free` za 0). `Game.dispatch` po každé úspěšné akci přepočítá ceny neprodaných položek
(`refreshShopPrices`), takže kupón se slevou platí hned. Prodejní ceny nezávisí na slevách ani `shopPriceAdd`.
Akce `pickBooster` umí `keep: true` — vybraná spotřebka se uloží do slotu místo použití.

Úpravy ze štítků (fáze 6) jsou pole položky (`ShopPriced`), takže je přepočet cen respektuje: `priceMult` násobí
základní cenu před slevou a `shopPriceAdd` (Doporučení od známého 0,5), `noEditionSurcharge` počítá žolíka bez
příplatku za edici (Vyleštěné příbory, Fotonegativ) a `extra` označí položku navíc — přehození ji (neprodanou) nechá
na konci nabídky a její žolík se znovu nenabídne, `syncShopSlots` ji do `shopCardSlots` nepočítá. Kupón navíc
(`addShopVoucher`) platí jen pro tu Večerku, do `anteVouchers` se nezapíše.

Kupóny (fáze 5): `VoucherDef.available?(ctx)` je čistá funkce (běží v `GameCore.readOnly`, neposune RNG ani stav),
která říká, jestli má kupón teď smysl — Úřední škrt a Amnestie („−1 patro“) až od patra 2. `voucherAvailable` ji
vyhodnotí, `eligibleVouchers` (los kupónu patra) ji respektuje a `buyVoucher` odmítne (`cannotUse`, stav beze změny)
kupón nedostupný, už vlastněný nebo tier 2 bez vlastněného tier 1; startovní kupóny výzvy ji obcházejí. Po uplatnění
kupónu `syncShopSlots` doplní otevřenou Večerku na aktuální `shopCardSlots`/`shopBoosterSlots` (Druhý regál, Regál
u pokladny platí hned): chybějící sloty vylosuje streamem `shop` jako při vstupu, vystavené ani prodané zboží nemění
a sloty nikdy neubírá. Kupón, jehož `passive` čte stav (Rozkládací stůl: `round.blind === 'boss'`), se přepočítá při
každém `invalidate()` — výběr útraty, výplata.

## 3. Obsah (`src/content`)

Každá položka = jeden objekt v odpovídajícím souboru + texty v `src/i18n/cs/*.ts` + test.
`src/content/index.ts` sestaví `ContentRegistry` a ověří konzistenci (unikátní id, existence textů,
`requires` u kupónů…). Test `tests/unit/content.test.ts` hlídá, že každá položka má název, popis,
flavor a že texty dodržují typografii.

## 4. UI (`src/ui`)

- Vlastní lehký helper `h(tag, props, ...children)` (`src/ui/dom.ts`) — žádný framework.
- `src/ui/app.ts` — router obrazovek (menu, nová hra, hra, sbírka, statistiky, nastavení, titulky).
- `src/ui/controller.ts` — drží instanci `Game`, předává akce, řadí události do fronty animací,
  po každé akci autosave.
- Obrazovky v `src/ui/screens/*`, komponenty v `src/ui/components/*`.
- Animace: CSS transform/opacity + `src/ui/fx/particles.ts` (jediný `<canvas>` overlay).
- Zvuk: `src/ui/audio/` — syntetizované SFX (jsfxr-like) a procedurální chiptune.
- Témata a barvoslepý režim přes CSS proměnné na `:root`.
- Obrázky: `src/ui/art/` skládá SVG žolíků z `ArtSpec` (ikona + paleta + vzor), karty jsou SVG.
- Šéfové a štítky v UI (fáze 6): texty přes `describe.ts` (`bossTexts` dosazuje `BossDef.params`, `bossReasonText`
  = „Šéf X: pravidlo“ jen když pravidlo v kole platí). Příchod šéfa = plakát nad stolem (`screens/game/bossBanner.ts`,
  `PresentView.showBossIntro`, neblokuje a zmizí sám), porážka a použitý štítek = oznámení se žetonem (`toast` s
  `title`/`media`), vypnutí žolíka šéfem = bublina (`jokerDebuffChanged`). Tooltip karty mimo provoz / lícem dolů a
  žolíka v `round.jokerDebuffs` vysvětlí pravidlo šéfa. Levý panel: šéf + pravidlo (Imperial „Pravidlo navíc“),
  aktivní štítky (žetony s tooltipem), varování „Neskóruje“ z `preview.blockedReason`; ruka ukazuje velikost
  (`Modifiers.handSize`) se změnou proti začátku kola (Velká voda). Pitva ukáže žeton a pravidlo šéfa vedle hlášky
  `death`, Info o runu šéfa patra; zboží ze štítků ve Večerce má nálepku (`extra`, `priceMult`, `noEditionSurcharge`).

## 5. Ukládání

- `localStorage`: `karban.profile` (profil, odemčení, statistiky, nastavení) a `karban.run` (rozehraný run).
- Formát `{ format: 'karban-save', kind: 'run' | 'profile', version: N, savedAt, data }` (`src/engine/save/save.ts`:
  `serializeRun`, `deserializeRun`, `SaveError`). `savedAt` dodá volající (engine nečte hodiny). Migrace
  `RUN_MIGRATIONS` ve stejném souboru (čisté funkce `vN → vN+1`, aplikují se postupně, každá musí vrátit objekt;
  `deserializeRun(input, { migrations, currentVersion })` umí vlastní tabulku pro testy). Načtení ověří obálku (verze
  = kladné celé číslo), odmítne novější verzi a po migracích zkontroluje tvar stavu (fáze, RNG streamy, pole);
  vstupní objekt nemění. Chyby: `SaveError.code` = `invalidJson` / `invalidFormat` / `wrongKind` / `tooNew` /
  `migrationFailed` (`tests/unit/save.test.ts`). Profil se nikdy nesmí ztratit: při chybě načtení se poškozená data
  zálohují do `karban.profile.backup.<timestamp>`.
- Export/import JSON z nastavení.

## 6. Testy

- `tests/unit/**` (Vitest): kombinace, skórování, pořadí efektů, každý žolík, RNG determinismus,
  save/load roundtrip, migrace, obsahová konzistence, simulace jako smoke test. Pokrytí enginu ≥ 80 %.
- `tests/e2e/**` (Playwright): spuštění, zahrání ruky, obchod, uložení/načtení, screenshot,
  vykreslení věty „Příliš žluťoučký kůň úpěl ďábelské ódy“.
  `tests/e2e/a11y.spec.ts` projde všechny obrazovky a fáze hry: přístupný název každého ovládacího prvku, platné
  odkazy `aria-*`, Tab jen po viditelných prvcích s viditelnou změnou focusu, focus trap dialogů (Tab i Shift+Tab)
  a návrat focusu po Esc. `tests/e2e/visual.spec.ts` (snímky v 5 rozlišeních) běží jen s `KARBAN_VISUAL=1`.

## 7. Skripty

- `npm run simulate -- --runs 500 --stake 1 [--deck pub] [--strategy all] [--seed-prefix A] [--json out.json]`
  — headless boti (seed runu `i` = `SIM-<prefix>-<i>`, viz `docs/DESIGN.md` kap. 12). `--bot` a `--strategy`
  jsou totéž, `--json -` píše na stdout, `--max-actions` mění pojistku délky runu. Výstup je česky
  (`src/i18n/cs/cli.ts`), JSON bez doby běhu, takže stejné parametry dají stejné bajty.
- `npm run simulate -- --play [--seed SEED] [--deck pub] [--stake 1] [--script "v;h 1 2 3;q"]` — textový hratelný
  režim bez UI (`node:readline`; převod řádku na akci v `engine/sim/commands.ts`, nápověda `?`). `--script` přehraje
  příkazy oddělené středníkem neinteraktivně (testy a ukázky).
- `npm run fetch-assets` — stáhne/extrahuje volně licencované assety a přegeneruje `ASSETS.md`.
- `npm run deploy` — build pro GitHub Pages (`BASE_PATH=/<repo>/`).
- `npx tsx scripts/ui-walkthrough.ts [--seed S] [--bot max|flush|pairs|econ] [--anim]` — QA průchod celým runem přes
  UI (běžící `vite preview` na portu 4173): bot rozhoduje, prohlížeč klávesami a myší provádí akce a po každé z nich
  se uložený stav porovná s tím, co by z předchozího uložení udělal engine; cestou dva reloady (Pokračovat), po výhře
  Nekonečný režim; hlídá konzoli. Trvá minuty, proto není součástí `test:e2e`.
