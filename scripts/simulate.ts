/**
 * npm run simulate -- --runs 500 --stake 1 [--deck pub] [--strategy all] [--seed-prefix A] [--json out.json]
 *
 * Headless simulace runů (boti a metriky viz docs/DESIGN.md kap. 12). Zatím jen kostra z fáze 0:
 * načte a ověří registr obsahu a vypíše, s jakými parametry by simulace běžela. Boti a výstupní
 * metriky přijdou ve fázi 2 (src/engine/sim/), ladění čísel ve fázích 4–7.
 * Run `i` bude mít seed `SIM-<prefix>-<i>` (docs/DESIGN.md kap. 12.2).
 */
import { parseArgs } from 'node:util';
import { registry, validateRegistry } from '../src/content/index';
import { pluralize } from '../src/i18n/format';

interface SimOptions {
  runs: number;
  stake: number;
  deck: string;
  strategy: string;
  seedPrefix: string;
  json: string | null;
}

function fail(message: string): never {
  console.error(`simulate: ${message}`);
  process.exit(1);
}

function positiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) fail(`--${name} musí být kladné celé číslo (dostal jsem „${raw}“).`);
  return n;
}

function parseOptions(argv: string[]): SimOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      runs: { type: 'string', default: '500' },
      stake: { type: 'string', default: '1' },
      deck: { type: 'string', default: 'pub' },
      strategy: { type: 'string', default: 'all' },
      'seed-prefix': { type: 'string', default: 'A' },
      json: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      'Použití: npm run simulate -- --runs 500 --stake 1 [--deck pub] [--strategy all] [--seed-prefix A] [--json out.json]',
    );
    process.exit(0);
  }
  const stake = positiveInt('stake', values.stake);
  if (stake > 8) fail('--stake musí být 1–8 (Desítka … Imperial).');
  return {
    runs: positiveInt('runs', values.runs),
    stake,
    deck: values.deck,
    strategy: values.strategy,
    seedPrefix: values['seed-prefix'],
    json: values.json ?? null,
  };
}

function main(): void {
  const opts = parseOptions(process.argv.slice(2));
  const reg = registry();
  const problems = validateRegistry(reg);
  if (problems.length > 0) fail(`registr obsahu není konzistentní:\n  - ${problems.join('\n  - ')}`);

  const counts = Object.entries({
    žolíci: reg.jokers,
    spotřebky: reg.consumables,
    šéfové: reg.bosses,
    balíčky: reg.decks,
    obtížnosti: reg.stakes,
  })
    .map(([label, items]) => `${label} ${Object.keys(items).length}`)
    .join(', ');

  console.log(`Registr obsahu je v pořádku (${counts}).`);
  console.log(
    `Parametry: ${pluralize(opts.runs, ['run', 'runy', 'runů'])}, síla piva ${opts.stake}, balíček „${opts.deck}“, strategie „${opts.strategy}“` +
      `, seedy SIM-${opts.seedPrefix}-1 až SIM-${opts.seedPrefix}-${opts.runs}` +
      (opts.json ? `, JSON do ${opts.json}` : '') +
      '.',
  );
  console.log('Simulace zatím není implementovaná — boti přijdou ve fázi 2 (src/engine/sim/).');
}

main();
