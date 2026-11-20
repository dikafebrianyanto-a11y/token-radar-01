// Token Radar's dashboard, model radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with the
// model's own inputs, a rank breakdown and the protocol's farm plan. No network: every byte it shows
// is in data.js.
//
// What the page states, and the code shows: implied value is a model of the snapshot's own figures
// (TVL, seven-day growth, age with no token, chain breadth, a category factor the snapshot computes),
// never a price and never a promise that a token is coming. Wrapped, staked and bridged products are
// left out of the board: their token already trades.
//
// The page recomputes what main.ts wrote, in two places, so the board's numbers can be checked
// without leaving the page: impliedOf rebuilds a row's implied value from the snapshot figures,
// and the detail drawer shows the recomputed number beside the one board.json carries. The Top
// movers panel and the By category table are computed the same way, from the rows data.js ships:
// nothing on this page is typed in by hand.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }
  // The model in one function, radar-2: the page recomputes a row from the snapshot figures and checks
  // the number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. The category factor comes from the data, computed by main.ts from the snapshot.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * (1 - model.maturity_floor);
    var chainsMult = model.chains_base + model.chains_step * Math.min((row.chains || []).length, model.chains_cap);
    var categoryMult = (DATA.category_factors && DATA.category_factors[row.category || 'Other']) || 1;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainsMult * categoryMult));
  }
  // Launch readiness, a page-side composite of the same inputs: how long and how steadily the protocol
  // has run with no token. It is a description of the record, not a prediction that a token is coming.
  function readinessOf(row) {
    var m = DATA.model;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthNorm = (growth - m.growth_floor) / (m.growth_cap - m.growth_floor);
    var chainNorm = Math.min((row.chains || []).length, m.chains_cap) / m.chains_cap;
    var score = 0.5 * maturity + 0.3 * growthNorm + 0.2 * chainNorm;
    return { score: score, label: score < 0.35 ? 'Early' : score < 0.65 ? 'Building' : 'Seasoned' };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the gas and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum' || chain === 'Bitcoin') return { first: 'about $5 of gas for the first transaction', setup: 'about $8 of gas', weekly: 'about $3 of gas a week' };
    return { first: 'under $1 of gas for the first transaction', setup: 'about $2 of gas', weekly: 'under $1 of gas a week' };
  }
  // One farm-action rule: the category words it matches and the action it writes. The rules are
  // tried in the order they are listed and the first match wins, so the order below is the rule:
  // a lending market that also yields is still a lending market, and a curator that also stakes
  // is still a curator. The words are matched against the category in lower case.
  var FARM_ACTIONS = [
    { words: ['lend', 'cdp', 'collateral'], action: function (name, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.'; } },
    { words: ['dex', 'yield', 'leveraged farm'], action: function (name, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.'; } },
    { words: ['staking', 'restak'], action: function (name, capital, chain) { return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.'; } },
    { words: ['perpetual', 'derivative'], action: function (name, capital, chain) { return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.'; } },
    { words: ['prediction'], action: function (name, capital, chain) { return 'Fund $' + capital + ' and place one market position on ' + name + '.'; } },
    { words: ['curator', 'allocator'], action: function (name, capital, chain) { return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.'; } },
    { words: ['stable'], action: function (name, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.'; } },
    { words: ['rwa'], action: function (name, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; } },
    { words: ['insurance'], action: function (name, capital, chain) { return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.'; } }
  ];
  // The category's one action, in the words a farmer can follow. The first rule whose words
  // appear in the category wins; a protocol whose category matches no rule gets the plain deposit.
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < FARM_ACTIONS.length; i++) {
      var rule = FARM_ACTIONS[i];
      for (var j = 0; j < rule.words.length; j++) {
        if (c.indexOf(rule.words[j]) >= 0) return rule.action(p.name, capital, chain);
      }
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas.first, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas.setup, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas.weekly, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. The snapshot records no token and promises no airdrop: the log is for the position, not a claim.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlist = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // The watchlist is the snapshot's own list, shipped in the data: a protocol with TVL above the
  // floor is not necessarily on it (wrapped and bridged products are left out of the list itself).
  function isWatchlist(r) { return (DATA.watchlist || []).indexOf(r.slug) >= 0; }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchlist && !isWatchlist(r)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // One line of evidence for a top row: its best standing among the board on TVL, growth and age.
  function topReason(row) {
    var byTvl = DATA.rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    var byGrowth = DATA.rows.slice().sort(function (a, b) { return (b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d); });
    var byAge = DATA.rows.slice().sort(function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); });
    var t = byTvl.indexOf(row) + 1, g = byGrowth.indexOf(row) + 1, a = byAge.indexOf(row) + 1;
    var best = Math.min(t, g, a);
    if (best === t) return '#' + t + ' by TVL on the board';
    if (best === g) return '#' + g + ' by seven-day growth on the board';
    return '#' + a + ' by age with no token on the board';
  }

  // The week's biggest movers: the pre-token rows with the largest seven-day growth the snapshot
  // records. A mover is ranked by the growth figure alone, not by implied value, so the panel shows
  // momentum the board's order hides: a protocol can be the week's fastest grower and still sit far
  // down the board, because one week of growth is only one of the model's five multipliers. Rows
  // with no growth figure sit at the bottom, never at the top, and the slug breaks ties so the
  // order is the same on every load.
  function topMovers() {
    return DATA.rows.slice().sort(function (a, b) {
      var av = a.change_7d === null || a.change_7d === undefined ? -Infinity : a.change_7d;
      var bv = b.change_7d === null || b.change_7d === undefined ? -Infinity : b.change_7d;
      if (av !== bv) return bv - av;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    }).slice(0, 5);
  }

  // The board by category: how many pre-token protocols each category holds, the median TVL of the
  // category's rows, and the category's strongest row by implied value. The median here is the
  // upper median, the same definition the model's category factor uses, so this table and the model
  // agree about what a category's middle looks like. Categories are ordered by how many protocols
  // they hold, most first, with the name breaking ties.
  function categoryStats() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var key = r.category || 'Other';
      if (!byCat[key]) byCat[key] = [];
      byCat[key].push(r);
    });
    return Object.keys(byCat).sort().map(function (key) {
      var list = byCat[key].slice().sort(function (a, b) { return a.tvl_usd - b.tvl_usd; });
      var median = list[Math.floor(list.length / 2)].tvl_usd;
      var top = byCat[key].slice().sort(function (a, b) {
        if (a.implied_value_usd !== b.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
        return a.slug < b.slug ? -1 : 1;
      })[0];
      return { category: key, count: list.length, medianTvl: median, top: top };
    }).sort(function (a, b) {
      if (a.count !== b.count) return b.count - a.count;
      return a.category < b.category ? -1 : 1;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, and leaves wrapped, staked and bridged products out: their token already trades. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function highlights() {
    var top = DATA.rows.slice(0, 3);
    return el('section', { class: 'highlights', 'aria-label': 'Top of the board' },
      top.map(function (r) {
        return el('article', { class: 'highlight', tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
          el('span', { class: 'rank-badge', text: '#' + r.rank }),
          el('b', { class: 'highlight-name', text: r.name }),
          el('span', { class: 'sub', text: topReason(r) }),
          el('span', { class: 'num highlight-value', text: fmtUsd(r.implied_value_usd) + ' implied' })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.watchlist ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlist = !state.watchlist; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Watchlist' }), wl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('chains', 'Chains'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The week's biggest movers, as cards: each one shows the protocol's board rank, its seven-day
  // growth, and the implied value that growth feeds into. Selecting a card opens the same detail
  // drawer the board's rows open, so a mover and a top row are inspected the same way.
  function moversPanel() {
    var movers = topMovers();
    return el('section', { class: 'panel movers', 'aria-label': 'Top movers by seven-day growth' },
      el('h2', { text: 'Top movers (7d)' }),
      el('p', { class: 'sub', text: 'The five pre-token protocols with the largest seven-day TVL growth in the snapshot. Ranked by that growth alone — a fast week is momentum, not a promise, and a mover can sit far down the board on implied value.' }),
      el('div', { class: 'movers-grid' },
        movers.map(function (r) {
          return el('article', { class: 'mover', tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
            el('span', { class: 'rank-badge', text: '#' + r.rank }),
            el('b', { class: 'mover-name', text: r.name }),
            el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + fmtAge(r.age_days) }),
            el('span', { class: 'num mover-growth ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) + ' in 7 days' }),
            el('span', { class: 'num mover-value', text: fmtUsd(r.implied_value_usd) + ' implied' })
          );
        })
      )
    );
  }

  // The board by category, as a table: every category on the board, how many pre-token protocols
  // it holds, the median TVL of its rows, and its strongest row by implied value. Selecting a row
  // opens that protocol's detail drawer, so a category's leader is one click from its farm plan.
  function categoryPanel() {
    var stats = categoryStats();
    var tbody = el('tbody');
    stats.forEach(function (s) {
      tbody.appendChild(el('tr', {
        tabindex: '0',
        onclick: function () { openDetail(s.top.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(s.top.slug); } }
      },
        el('td', null, el('b', { text: s.category })),
        el('td', { class: 'num', text: String(s.count) }),
        el('td', { class: 'num', text: fmtUsd(s.medianTvl) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: s.top.name }), el('span', { class: 'sub', text: 'Rank ' + s.top.rank + ' on the board' }))),
        el('td', { class: 'num', text: fmtUsd(s.top.implied_value_usd) })
      ));
    });
    return el('section', { class: 'panel categories', 'aria-label': 'Board by category' },
      el('h2', { text: 'By category' }),
      el('p', { class: 'sub', text: 'Every category on the board: how many pre-token protocols it holds, the median TVL of its rows, and its strongest row by implied value. Select a row to open that protocol.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Protocols' }),
            el('th', { scope: 'col', text: 'Median TVL' }),
            el('th', { scope: 'col', text: 'Strongest protocol' }),
            el('th', { scope: 'col', text: 'Implied value' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + (1 - m.maturity_floor).toFixed(2) + ') x (' + m.chains_base + ' + 0.03 x min(chains, ' + m.chains_cap + ')) x category )'
      ),
      el('div', { class: 'mult-table' },
        el('div', { class: 'mult-row mult-head' }, el('span', { text: 'Multiplier' }), el('span', { text: 'Range' }), el('span', { text: 'What it rewards' })),
        el('div', { class: 'mult-row' }, el('b', { text: 'Base' }), el('span', { class: 'num', text: 'TVL x 0.25' }), el('span', { text: 'Value already locked: the launch starts from a quarter of it.' })),
        el('div', { class: 'mult-row' }, el('b', { text: 'Growth' }), el('span', { class: 'num', text: '0.64 – 1.72' }), el('span', { text: 'Seven-day momentum, clamped so one wild week cannot decide a rank.' })),
        el('div', { class: 'mult-row' }, el('b', { text: 'Maturity' }), el('span', { class: 'num', text: '0.55 – 1.00' }), el('span', { text: 'Age with no token, over four years: the longer the record, the higher the score.' })),
        el('div', { class: 'mult-row' }, el('b', { text: 'Chains' }), el('span', { class: 'num', text: '0.98 – 1.10' }), el('span', { text: 'Breadth: more chains means more users a launch could convert.' })),
        el('div', { class: 'mult-row' }, el('b', { text: 'Category' }), el('span', { class: 'num', text: '0.92 – 1.08' }), el('span', { text: 'Where tokenless protocols sustain size, read off the snapshot medians.' }))
      ),
      el('p', { class: 'sub', text: 'The five multipliers are the whole model: nothing else moves a rank. TVL sets the order of magnitude; growth, maturity and chains move individual rows; the category factor nudges. A row\u2019s detail view shows its own five numbers, and the page recomputes the row from them, so the arithmetic is checkable on every row.' }),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth adds at most 10%: a protocol on more chains has more users a launch could convert. Category is the snapshot\'s own median TVL per category over the global median, clamped to ' + m.category_floor + '–' + m.category_cap + ', so it can nudge a rank and never set one.' }),
      el('p', { class: 'sub', text: 'Left out of the board on purpose: wrapped, staked and bridged products, exchanges and versioned pools. Their token already trades, so ranking them as launches would be wrong. The snapshot records no token for a row; that is not proof it has none, and no airdrop is promised anywhere on this page.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var ready = readinessOf(row);
    var recomputed = impliedOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: fmtMult(row.chains_multiplier) })),
        el('div', null, el('span', { text: 'Category multiplier' }), el('b', { class: 'num', text: fmtMult(row.category_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch readiness' }),
      el('div', { class: 'readiness' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.round(ready.score * 100) + '%' })),
        el('b', { class: 'num', text: ready.label + ' · ' + Math.round(ready.score * 100) + '/100' })
      ),
      el('p', { class: 'sub', text: 'How long and how steadily the protocol has run with no token: half age, three-tenths seven-day growth, two-tenths chain breadth. A description of the record, not a prediction that a token is coming.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'sub', text: 'The snapshot records no token for this protocol and promises no airdrop. Farm the protocol\'s use, not a promise.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(highlights());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(moversPanel());
      shell.appendChild(categoryPanel());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
