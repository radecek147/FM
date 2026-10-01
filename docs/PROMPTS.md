# Prompty pro Claude Code

## Postup

1. Založ prázdnou složku (např. `zolikarna`), do ní dej `CLAUDE.md` z této dvojice souborů a spusť v ní `git init`.
2. Ve složce spusť `claude`. Aby se Claude Code nezastavoval u každého zápisu souboru, buď mu průběžně schvaluj akce „vždy povolit“, nebo ho spusť s `claude --dangerously-skip-permissions` (jen v této izolované složce).
3. Vlož **Prompt 1**. Až se session zaplní nebo Claude Code skončí, otevři novou a vlož **Prompt 2**. Opakuj, dokud není hotová fáze 10.

---

## Prompt 1 — start projektu

```
Přečti si CLAUDE.md v této složce — je to kompletní zadání hry, kterou máš postavit od nuly. Řiď se přesně kapitolou 1 (jak pracuješ) a kapitolou 9 (fáze).

Začni Fází 0 a plynule pokračuj dál, fázi za fází. Neptej se mě na rozhodnutí — rozhodni sám, zapiš to do docs/DECISIONS.md a jeď dál. Každou fázi zakonči zelenými testy, buildem, commitem a zápisem stavu do ROADMAP.md. Zastav se jen při fatální chybě, kterou nejde obejít, a i tak nejdřív zkus obejití. Až bude hotová Fáze 3, napiš mi dva řádky, jak hru spustím v prohlížeči, a pokračuj v práci.
```

## Prompt 2 — každá další session

```
Přečti si CLAUDE.md, ROADMAP.md a docs/DECISIONS.md. Pokračuj přesně tam, kde ROADMAP.md končí, podle pravidel z CLAUDE.md kap. 1. Nejdřív ověř, že `npm run typecheck && npm run lint && npm test` prochází; pokud ne, oprav to jako první. Pak pokračuj dalšími fázemi, neptej se, rozhoduj sám a dokumentuj.
```

## Prompt 3 — když chceš něco přidat / změnit (příklady)

```
Přidej 20 nových žolíků v duchu CLAUDE.md kap. 5. Každý: název, přesná mechanika s čísly, flavor hláška, vzácnost, cena, podmínka odemčení, obrázek podle kap. 7, test. Pak spusť `npm run simulate -- --runs 300` a pokud některý nový žolík vychází výrazně nad nebo pod tabulkou v docs/DESIGN.md, nalaď čísla a zapiš do DECISIONS.
```

```
Hra mi přijde v patře 5–6 moc lehká. Spusť simulaci na Desítce a Dvanáctce, porovnej s cíli v CLAUDE.md kap. 8, uprav křivku cílů a ceny ve večerce, zapiš nová čísla do docs/DESIGN.md a změnu do DECISIONS. Testy musí zůstat zelené.
```

```
Projdi všechny texty v src/i18n/cs.ts: oprav pravopis a diakritiku, sjednoť tykání/vykání hráči (zvol jedno a zapiš do DECISIONS), zkontroluj skloňování přes plural() a doplň vtip tam, kde je text nudný. Nic nemaž, jen zlepšuj.
```

```
Udělej „obsahový patch 1.1“: 2 nové startovní balíčky, 5 nových šéfů, 5 nových výzev a 10 achievementů. Vše s podmínkami odemčení, testy a zápisem do sbírky. Aktualizuj README a tagni v1.1.0.
```

## Tipy

- Když Claude Code hlásí, že mu dochází kontext, napiš `/compact` nebo mu řekni: „Zapiš přesný stav do ROADMAP.md a skonči“ a otevři novou session s Promptem 2.
- Hru spustíš `npm run dev` a otevřeš adresu, kterou vypíše (typicky `http://localhost:5173`).
- Chceš-li vidět, co a proč rozhodl, čti `docs/DECISIONS.md`; co je hotovo, čti `ROADMAP.md`; odkud jsou obrázky, čti `ASSETS.md`.
- Pokud v nějaké fázi nemůže stáhnout obrázky (síť), hra musí fungovat s vygenerovanými SVG — je to v zadání, takže ho na to stačí odkázat: „Řiď se CLAUDE.md kap. 7, poslední odrážka.“
