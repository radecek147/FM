/**
 * Obtížnosti „Síla piva“ (docs/DESIGN.md kap. 10) — klíče `stakes.<id>.name|desc|flavor` podle id
 * v src/content/stakes.ts. `desc` popisuje jen ztížení, které úroveň přidává (nižší úrovně platí také);
 * `{param}` dosadí UI z `params` definice.
 */
export const stakes = {
  desitka: {
    name: 'Desítka',
    desc: 'Základní pravidla a nejmírnější cíle: Malá útrata v osmém patře chce {small8|plural:bod,body,bodů}.',
    flavor: 'Na rozehřátí. Zatím se nikdo nezranil.',
  },
  jedenactka: {
    name: 'Jedenáctka',
    desc: 'Dražší pivo: od {fromAnte}. patra stojí každé přehození ve Večerce o {add|money} víc.',
    flavor: 'Pivo zdražilo. Zase.',
  },
  dvanactka: {
    name: 'Dvanáctka',
    desc: 'Cíle rostou rychleji: Malá útrata v osmém patře chce {small8|plural:bod,body,bodů}.',
    flavor: 'Klasika. Cíle rostou rychleji než útrata.',
  },
  special: {
    name: 'Speciál',
    desc: 'Zvětrávání: {perishable} % žolíků ve Večerce a v obálkách je zvětrávajících – po {rounds|plural:kole,kolech,kolech} ve slotu přestanou fungovat.',
    flavor: 'Speciál se pije pomalu. Žolíci zvětrají rychle.',
  },
  lezak: {
    name: 'Ležák',
    desc: 'Bez dýška: od {fromAnte}. patra dává každá nevyužitá ruka o {money|money} méně, takže běžně nic.',
    flavor: 'Dýško? To se dneska nenosí.',
  },
  bock: {
    name: 'Bock',
    desc: 'Cíle až do stropu: Malá útrata v osmém patře chce {small8|plural:bod,body,bodů}.',
    flavor: 'Tmavé, silné a cíle až do stropu.',
  },
  doppelbock: {
    name: 'Doppelbock',
    desc: 'Bazar a půjčovna: {eternal} % žolíků v nabídce je přibitých (nejdou prodat) a {rental} % zapůjčených (stojí jen {price|money}, ale na konci každého kola si půjčovna řekne o {fee|money}).',
    flavor: 'Co je přibité, neprodáš. Co je půjčené, platíš.',
  },
  imperial: {
    name: 'Imperial',
    desc: 'Šéf i ve Velké: Velká útrata má navíc pravidlo náhodného běžného šéfa (její cíl i odměna zůstávají) a cíle šéfů jsou o {boss} % vyšší.',
    flavor: 'Šéf sedí u každého stolu.',
  },
};
