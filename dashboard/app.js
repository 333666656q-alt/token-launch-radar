// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a live-token view of the calibration set, a method page, and a per-protocol
// detail drawer with the model's arithmetic and the protocol's farm plan. No network: every byte it
// shows is in data.js, and the page recomputes each row's implied value from the calibration table
// to prove the page and board.json carry the same numbers.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', segment: 'all', minTvl: 0, tab: 'board', sort: 'rank', dir: 1, selected: null };

  var CAL = {};
  DATA.calibration.forEach(function (c) { CAL[c.category] = c; });
  function multipleOf(row) {
    var cal = CAL[row.category || 'Uncategorised'];
    return cal ? cal.multiple : DATA.global_median_multiple;
  }
  // The model in one function: the same arithmetic lib/model.ts runs, from the same rounded inputs,
  // so the detail view can check a row's implied value against board.json and say so.
  function impliedOf(row) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(M.growth_cap_pct, Math.max(M.growth_floor_pct, g));
    var gm = 1 + (g / 100) * M.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var mm = M.maturity_base + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var rm = 1 + M.reach_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), M.reach_max_extra_chains);
    return Math.max(1, Math.round(row.tvl_usd * multipleOf(row) * gm * mm * rm));
  }

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
  function fmtMult(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(2) + 'x'; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('segment')) state.segment = params.get('segment');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.segment !== 'all') params.set('segment', state.segment);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    try {
      if (next) window.history.replaceState(null, '', '#' + next);
      else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) { /* history is a nicety: the view works without it */ }
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.segment === 'watch' && !r.watchlist) return false;
      if (state.segment === 'early' && r.watchlist) return false;
      if (r.tvl_usd < state.minTvl) return false;
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
      else if (key === 'mult') { av = a.model.category_multiple; bv = b.model.category_multiple; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'rings', 'aria-hidden': 'true' }, el('i'), el('b')),
        el('span', { class: 'brand-name', text: 'LAUNCH RADAR' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: 'Model ' + DATA.model_version + ': comps-calibrated' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Protocols with no token yet, ranked by what a launch would be worth' }),
        el('p', null,
          'Every protocol in the snapshot that records no token and is not a wrapped or staked product of one that trades, valued by the market\u2019s own yardstick: ',
          el('b', { text: 'what live protocols in the same category are worth per dollar of TVL' }),
          '. The watchlist is the floor, not the ceiling: the radar also ranks ' + DATA.early_size + ' early finds below it. Implied value is this board\u2019s claim, not a prediction and not a price.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', null, el('em', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }))),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token protocols ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Protocols scanned' }), el('b', { text: String(DATA.scanned_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token comps in the calibration' }), el('b', { text: String(DATA.comps_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chainCount = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; }); });
    var chains = Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a] || (a < b ? -1 : 1); }).slice(0, 24);

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function select(id, label, options, value, onChange) {
      var sel = el('select', { id: id, 'aria-label': label },
        options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: String(o[0]) === String(value) ? 'selected' : null }); })
      );
      sel.addEventListener('change', function () { onChange(sel.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), sel);
    }
    var seg = el('div', { class: 'field' },
      el('span', { class: 'lab', text: 'Radar segment' }),
      el('div', { class: 'tabs' },
        [['all', 'All rows'], ['watch', 'Watchlist'], ['early', 'Early finds']].map(function (t) {
          return el('button', { type: 'button', 'aria-pressed': state.segment === t[0] ? 'true' : 'false', text: t[1], onclick: function () { state.segment = t[0]; writeHash(); render(); } });
        })
      )
    );
    var tabs = el('div', { class: 'field' },
      el('span', { class: 'lab', text: 'View' }),
      el('div', { class: 'tabs' },
        [['board', 'Board'], ['live', 'Live comps'], ['method', 'Method']].map(function (t) {
          return el('button', { type: 'button', 'aria-pressed': state.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { state.tab = t[0]; writeHash(); render(); } });
        })
      )
    );
    var count = state.tab === 'board' ? rows().length + ' of ' + DATA.board_size + ' rows shown'
      : state.tab === 'live' ? DATA.live.length + ' live-token protocols'
      : DATA.calibration.length + ' categories calibrated';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      select('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      select('mintvl', 'Min TVL', [[0, 'Any size'], [50000000, '$50M and up'], [100000000, '$100M and up'], [250000000, '$250M and up'], [1000000000, '$1B and up']], state.minTvl, function (v) { state.minTvl = Number(v); }),
      select('sort', 'Sort by', [['rank', 'Rank'], ['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age'], ['mult', 'Category multiple'], ['name', 'Name']], state.sort, function (v) { state.sort = v; state.dir = v === 'rank' || v === 'name' ? 1 : -1; }),
      seg, tabs,
      el('span', { class: 'count', text: count })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25BC' : ' \u25B2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the filters to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.segment = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        class: r.rank <= 3 ? 'top3' : '',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', null,
            el('b', { text: r.name }),
            el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'WATCHLIST' : 'EARLY' })
          ),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00B7 ' + ((r.chains || []).length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num mult', text: fmtMult(r.model.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: '$' + r.plan_capital_usd })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols ranked by implied value: TVL times the category\u2019s calibrated multiple, adjusted for seven-day growth, time running with no token, and chain reach. Select a row for the full arithmetic and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', '#'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('mult', 'x TVL'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Plan capital' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r, i) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'rank', text: String(i + 1) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00B7 ' + ((r.chains || []).length ? r.chains.slice(0, 2).join(', ') : 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num mult', text: fmtMult(r.multiple) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are never ranked; they are the comps the board\u2019s category multiples are calibrated from. The calibration reads all ' + DATA.comps_size + ' token-bearing protocols with a market cap in the snapshot; the ' + DATA.live.length + ' largest by market cap are shown.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' })
          )),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var top = DATA.rows[0];
    var calRows = DATA.calibration.slice(0, 18).map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'num', text: fmtMult(c.live_median) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) })
      );
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How the radar values a protocol with no token' }),
      el('p', null,
        'The model never asserts a multiple. It reads one off the snapshot itself: for every category, the live-token protocols in the same snapshot give a market cap per dollar of TVL, and the board uses their ',
        el('b', { text: 'median' }),
        ', shrunk toward the all-category median (' + fmtMult(DATA.global_median_multiple) + ') by the comp count, so a category priced by two wild comps cannot run away. A category with no live comps takes the global median.'
      ),
      el('div', { class: 'formula', text: 'implied = round( tvl x multiple(category) x (1 + 0.6 x clamp(change_7d, -50, 100)/100) x (0.78 + 0.42 x min(age_days, 1460)/1460) x (1 + 0.015 x min(chains - 1, 12)) )' }),
      el('div', { class: 'cols' },
        el('div', null,
          el('h3', { text: 'Why each factor is there' }),
          el('ul', null,
            el('li', null, el('b', { text: 'TVL x category multiple. ' }), 'Size, priced the way the market prices the same kind of protocol today.'),
            el('li', null, el('b', { text: 'Growth. ' }), 'A protocol adding TVL this week is worth more than the same TVL standing still; the clamp keeps one wild week from ruling.'),
            el('li', null, el('b', { text: 'Maturity. ' }), 'Years run with no token is a track record: the model pays up to 1.20x for four years of it, 0.78x for a launch-week protocol.'),
            el('li', null, el('b', { text: 'Reach. ' }), 'Each extra chain is another surface a token can be used and farmed on, worth 1.5% up to twelve.'),
            el('li', null, el('b', { text: 'Worked example. ' }), top.name + ': ' + fmtUsd(top.tvl_usd) + ' TVL x ' + fmtMult(top.model.category_multiple) + ' = ' + fmtUsd(top.model.base_value_usd) + ', then x' + top.model.growth_multiplier.toFixed(2) + ' growth, x' + top.model.maturity_multiplier.toFixed(2) + ' maturity, x' + top.model.reach_multiplier.toFixed(2) + ' reach = ' + fmtUsd(top.implied_value_usd) + '.')
          )
        ),
        el('div', null,
          el('h3', { text: 'The calibration table (top categories by comps)' }),
          el('table', null,
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Comps' }),
              el('th', { scope: 'col', text: 'Live median' }), el('th', { scope: 'col', text: 'Multiple used' })
            )),
            el('tbody', null, calRows)
          )
        )
      ),
      el('p', { text: 'Honest limits: DefiLlama records no token is not proof a protocol has none, and a wrapped or staked product of a trading token is excluded for that reason. The board says what a launch would be worth if the record stayed as it is; it does not say a launch will happen.' })
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Data: ' + DATA.source + '. The snapshot is sealed; the board is a model run over it, and every figure on this page can be recomputed from it.' }),
      el('p', { text: 'Implied value is this entry\u2019s own claim about a hypothetical launch, never a price, a promise or investment advice. Farm plans carry real costs and real smart-contract risk; a protocol can also simply never issue a token.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var m = row.model;
    var recomputed = impliedOf(row);
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' \u00B7 watchlist' : ' \u00B7 early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' \u00B7 ' + ((row.chains || []).length ? row.chains.join(', ') : 'chain unlisted') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The record' }),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', { class: 'fact' }, el('span', { text: '7d TVL change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', { class: 'fact' }, el('span', { text: 'Tracked since' }), el('b', { text: row.listed_at || 'unreported' })),
        el('div', { class: 'fact' }, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', { class: 'fact' }, el('span', { text: 'Chains' }), el('b', { text: String((row.chains || []).length) })),
        el('div', { class: 'fact' }, el('span', { text: 'Token on record' }), el('b', { text: 'none recorded' }))
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, step by step' }),
      el('div', { class: 'waterfall' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'x category multiple (' + (row.category || 'Uncategorised') + ', ' + m.category_comps + ' live comps)' }), el('b', { text: fmtMult(m.category_multiple) })),
        el('div', null, el('span', { text: '= base value' }), el('b', { text: fmtUsd(m.base_value_usd) })),
        el('div', null, el('span', { text: 'x growth (' + fmtPct(m.growth_pct) + ' over 7d)' }), el('b', { text: 'x' + m.growth_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'x maturity (' + fmtAge(row.age_days) + ' with no token)' }), el('b', { text: 'x' + m.maturity_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'x reach (' + (row.chains || []).length + ' chains)' }), el('b', { text: 'x' + m.reach_multiplier.toFixed(4) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'This page recomputes the row from the calibration table as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' \u2014 the same number board.json carries.' : ' \u2014 which differs from the board, so the data would be stale.') + ' Model ' + DATA.model_version + ' scores every protocol with this one function; no name is special-cased.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'totals' },
        el('span', null, 'Capital ', el('b', { text: '$' + row.plan_capital_usd })),
        el('span', null, 'Est. fees ', el('b', { text: '~$' + row.plan_fees_usd })),
        el('span', null, 'Runs ', el('b', { text: '~' + row.plan_weeks + ' weeks' }))
      ),
      el('ol', { class: 'steps' }, row.steps.map(function (s) {
        return el('li', null,
          el('b', { text: s.text }),
          el('span', { class: 'chips' },
            el('span', { class: 'chip cost', text: 'Cost: ' + s.cost }),
            el('span', { class: 'chip', text: 'Time: ' + s.time })
          )
        );
      })),
      el('p', { class: 'note', text: 'DefiLlama records no token for ' + row.name + ' as of ' + DATA.as_of + '; that is a record, not proof. Farming is positioning in case a launch rewards early users \u2014 it may never happen, and the capital stays at risk while it is in the protocol.' })
    ));
    if (typeof dialog.showModal === 'function' && !dialog.open) {
      try { dialog.showModal(); } catch (e) { dialog.setAttribute('open', ''); }
    } else if (!dialog.open) {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else shell.appendChild(methodPanel());
    shell.appendChild(foot());
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
