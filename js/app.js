/* Grue — a Z-machine player with tappable choices. */
(function () {
  'use strict';

  const { local, stories } = window.GrueStorage;
  const STYLE = ZMachine.STYLE;

  const LIBRARY = [
    {
      id: 'zork1',
      numeral: 'Part one',
      title: 'Zork I',
      subtitle: 'The Great Underground Empire',
      blurb: 'West of a white house, a mailbox, a boarded door — and nineteen treasures hidden somewhere below.',
      url: 'https://raw.githubusercontent.com/historicalsource/zork1/master/COMPILED/zork1.z3',
      spine: '#9b3d23',
    },
    {
      id: 'zork2',
      numeral: 'Part two',
      title: 'Zork II',
      subtitle: 'The Wizard of Frobozz',
      blurb: 'Deeper into the Empire, where a capricious wizard toys with you as you hunt his realm’s treasures.',
      url: 'https://raw.githubusercontent.com/historicalsource/zork2/master/COMPILED/zork2.z3',
      spine: '#3d4f8a',
    },
    {
      id: 'zork3',
      numeral: 'Part three',
      title: 'Zork III',
      subtitle: 'The Dungeon Master',
      blurb: 'The final descent: a stranger, quieter test of worthiness set by the Dungeon Master himself.',
      url: 'https://raw.githubusercontent.com/historicalsource/zork3/master/COMPILED/zork3.z3',
      spine: '#2f6f68',
    },
  ];

  const THEMES = [
    { id: 'paper', label: 'Paper', bg: '#fbfaf7', fg: '#1d1c1a' },
    { id: 'sepia', label: 'Sepia', bg: '#f4ecd8', fg: '#4b3a28' },
    { id: 'dusk', label: 'Dusk', bg: '#2c2d30', fg: '#dcd8cf' },
    { id: 'night', label: 'Night', bg: '#000000', fg: '#b9b6b0' },
    { id: 'phosphor', label: 'Phosphor', bg: '#0a100b', fg: '#8ef59a' },
  ];
  const FONTS = [
    { id: 'serif', label: 'Serif' },
    { id: 'sans', label: 'Sans' },
    { id: 'mono', label: 'Mono' },
  ];
  const LEADING = [
    { id: '1.4', label: 'Tight' },
    { id: '1.6', label: 'Normal' },
    { id: '1.85', label: 'Airy' },
  ];
  const MEASURES = [
    { id: '100%', label: 'Narrow' },
    { id: '38em', label: 'Normal' },
    { id: '32em', label: 'Wide' },
  ];

  const $ = (sel) => document.querySelector(sel);
  const el = {
    library: $('#library'),
    game: $('#game'),
    zorkList: $('#zork-list'),
    continueSection: $('#continue-section'),
    continueList: $('#continue-list'),
    fileInput: $('#file-input'),
    dropzone: $('#dropzone'),
    urlForm: $('#url-form'),
    urlInput: $('#url-input'),
    libraryError: $('#library-error'),
    statusLocation: $('#status-location'),
    statusRight: $('#status-right'),
    menu: $('#menu'),
    upper: $('#upper'),
    transcript: $('#transcript'),
    panel: $('#panel'),
    compass: $('#compass'),
    here: $('#here'),
    carried: $('#carried'),
    strip: $('#strip'),
    cmdbar: $('#cmdbar'),
    cmd: $('#cmd'),
    panelToggle: $('#panel-toggle'),
    sheet: $('#sheet'),
    sheetTitle: $('#sheet-title'),
    sheetSub: $('#sheet-sub'),
    sheetBody: $('#sheet-body'),
    settings: $('#settings'),
    saves: $('#saves'),
    savesTitle: $('#saves-title'),
    savesSub: $('#saves-sub'),
    saveForm: $('#save-form'),
    saveName: $('#save-name'),
    saveList: $('#save-list'),
    toast: $('#toast'),
    mapDialog: $('#mapview'),
    mapSvg: $('#map-svg'),
    mapSub: $('#map-sub'),
    mapCard: $('#map-card'),
    mapCardName: $('#map-card-name'),
    mapCardInfo: $('#map-card-info'),
    mapWalk: $('#map-walk'),
  };

  const finePointer = window.matchMedia('(pointer: fine)').matches;

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  }

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
  }

  const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ====================================================================== */
  /* Settings                                                               */
  /* ====================================================================== */

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const settings = Object.assign(
    { theme: prefersDark ? 'night' : 'paper', font: 'serif', size: 18, leading: '1.6', measure: '38em', panel: true, links: true },
    local.get('settings', {})
  );

  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    root.dataset.links = settings.links ? 'on' : 'off';
    root.style.setProperty('--read-size', settings.size + 'px');
    root.style.setProperty('--read-leading', settings.leading);
    root.style.setProperty('--measure', settings.measure);
    const theme = THEMES.find((t) => t.id === settings.theme) || THEMES[0];
    document.querySelector('meta[name="theme-color"]').setAttribute('content', theme.bg);
    el.panel.classList.toggle('collapsed', !settings.panel);
    el.panelToggle.setAttribute('aria-expanded', String(settings.panel));
    renderSettings();
  }

  function saveSettings() {
    local.set('settings', settings);
    applySettings();
  }

  function segmented(container, options, key) {
    container.replaceChildren(
      ...options.map((o) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(settings[key] === o.id),
          text: o.label,
          onclick: () => {
            settings[key] = o.id;
            saveSettings();
          },
        })
      )
    );
  }

  function renderSettings() {
    $('#theme-choices').replaceChildren(
      ...THEMES.map((t) =>
        h(
          'button',
          {
            type: 'button',
            class: 'swatch',
            style: `background:${t.bg};color:${t.fg}`,
            'aria-pressed': String(settings.theme === t.id),
            'aria-label': t.label,
            onclick: () => {
              settings.theme = t.id;
              saveSettings();
            },
          },
          h('b', { text: 'Aa' }),
          h('span', { text: t.label })
        )
      )
    );
    segmented($('#font-choices'), FONTS, 'font');
    segmented($('#leading-choices'), LEADING, 'leading');
    segmented($('#measure-choices'), MEASURES, 'measure');
    segmented($('#link-choices'), [{ id: true, label: 'On' }, { id: false, label: 'Off' }], 'links');
    $('#size-range').value = settings.size;
  }

  $('#size-range').addEventListener('input', (e) => {
    settings.size = +e.target.value;
    saveSettings();
  });
  document.querySelectorAll('[data-size]').forEach((b) =>
    b.addEventListener('click', () => {
      settings.size = Math.max(14, Math.min(26, settings.size + +b.dataset.size));
      saveSettings();
    })
  );

  /* ====================================================================== */
  /* Dialog plumbing                                                        */
  /* ====================================================================== */

  for (const d of [el.sheet, el.settings, el.saves, el.mapDialog]) {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  }

  function openDialog(d) {
    if (!d.open) d.showModal();
  }

  /* ====================================================================== */
  /* Library                                                                */
  /* ====================================================================== */

  function autosaveMeta(gameId) {
    const a = local.get('auto.' + gameId);
    return a ? a.meta : null;
  }

  function progressText(meta) {
    if (!meta) return '';
    const bits = [meta.location, meta.moves != null ? `${meta.moves} moves` : null].filter(Boolean);
    return bits.join(' · ');
  }

  function renderLibrary() {
    el.zorkList.replaceChildren(
      ...LIBRARY.map((entry) => {
        const gameId = local.get('lib.' + entry.id);
        const meta = gameId && autosaveMeta(gameId);
        return h(
          'button',
          { class: 'book', style: `--spine:${entry.spine}`, onclick: (e) => openLibraryEntry(entry, e.currentTarget) },
          h('span', { class: 'numeral', text: entry.numeral }),
          h('h3', { text: entry.title }),
          h('p', { text: entry.subtitle }),
          h('p', { text: entry.blurb }),
          h('span', { class: 'progress', text: meta ? `Continue · ${progressText(meta)}` : 'Begin' })
        );
      })
    );

    const libIds = new Set(LIBRARY.map((e) => local.get('lib.' + e.id)).filter(Boolean));
    const others = local
      .keys('auto.')
      .map((k) => ({ id: k.slice(5), meta: autosaveMeta(k.slice(5)) }))
      .filter((x) => x.meta && !libIds.has(x.id))
      .sort((a, b) => (b.meta.savedAt || 0) - (a.meta.savedAt || 0));

    el.continueSection.hidden = !others.length;
    el.continueList.replaceChildren(
      ...others.map(({ id, meta }) =>
        h(
          'div',
          { class: 'continue-item' },
          h(
            'button',
            { class: 'open', onclick: () => openStoredGame(id, meta) },
            h('strong', { text: meta.title }),
            h('span', { text: progressText(meta) || 'In progress' })
          ),
          h(
            'button',
            {
              class: 'icon-btn',
              'aria-label': `Remove ${meta.title}`,
              onclick: async () => {
                if (!confirm(`Remove “${meta.title}” and its progress from this device?`)) return;
                local.remove('auto.' + id);
                await stories.remove(id);
                renderLibrary();
              },
            },
            svgIcon('M6 6l12 12M18 6L6 18')
          )
        )
      )
    );
  }

  function svgIcon(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
    return svg;
  }

  function libraryError(msg) {
    el.libraryError.textContent = msg;
    el.libraryError.hidden = !msg;
  }

  async function fetchStory(url) {
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error('Couldn’t download that story. Check your connection, or the site may not allow direct downloads.');
    }
    if (!res.ok) throw new Error(`Couldn’t download that story (HTTP ${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function openLibraryEntry(entry, card) {
    libraryError('');
    card.classList.add('loading');
    try {
      const gameId = local.get('lib.' + entry.id);
      const cached = gameId && (await stories.get(gameId));
      const bytes = cached ? cached.bytes : await fetchStory(entry.url);
      startGame(bytes, { title: entry.title, source: entry.url, libId: entry.id });
    } catch (e) {
      libraryError(e.message);
    } finally {
      card.classList.remove('loading');
    }
  }

  async function openStoredGame(id, meta) {
    libraryError('');
    const rec = await stories.get(id);
    try {
      if (rec) return startGame(rec.bytes, { title: rec.title, source: rec.source });
      if (meta.source && /^https?:/.test(meta.source))
        return startGame(await fetchStory(meta.source), { title: meta.title, source: meta.source });
      libraryError('That story file is no longer stored on this device. Open it again to continue.');
    } catch (e) {
      libraryError(e.message);
    }
  }

  function openFile(file) {
    if (!file) return;
    libraryError('');
    const reader = new FileReader();
    reader.onload = () => {
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      startGame(new Uint8Array(reader.result), { title: capitalise(title), source: 'file' });
    };
    reader.onerror = () => libraryError('Couldn’t read that file.');
    reader.readAsArrayBuffer(file);
  }

  el.fileInput.addEventListener('change', () => {
    openFile(el.fileInput.files[0]);
    el.fileInput.value = '';
  });
  el.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.dropzone.classList.add('over');
  });
  el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('over'));
  el.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('over');
    openFile(e.dataTransfer.files[0]);
  });
  el.urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = el.urlInput.value.trim();
    if (!url) return;
    libraryError('');
    try {
      const bytes = await fetchStory(url);
      const name = decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.[^.]+$/, '');
      startGame(bytes, { title: capitalise(name.replace(/[_-]+/g, ' ')) || 'Story', source: url });
      el.urlInput.value = '';
    } catch (err) {
      libraryError(err.message);
    }
  });

  function unwrapBlorb(bytes) {
    const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    if (bytes.length < 12 || tag(0) !== 'FORM' || tag(8) !== 'IFRS') return bytes;
    const end = Math.min(bytes.length, 8 + u32(4));
    for (let p = 12; p + 8 <= end; ) {
      const len = u32(p + 4);
      if (tag(p) === 'ZCOD') return bytes.slice(p + 8, p + 8 + len);
      p += 8 + len + (len & 1);
    }
    throw new Error('This Blorb file doesn’t contain a Z-code story.');
  }

  function showLibrary() {
    closeMenu();
    for (const d of [el.sheet, el.saves, el.mapDialog]) if (d.open) d.close();
    game = null;
    el.game.hidden = true;
    el.library.hidden = false;
    document.title = 'Grue';
    renderLibrary();
  }

  /* ====================================================================== */
  /* Game                                                                   */
  /* ====================================================================== */

  let game = null;

  function measureColumns() {
    const probe = h('span', { text: 'M'.repeat(20) });
    el.upper.hidden = false;
    el.upper.replaceChildren(probe);
    el.upper.style.fontSize = '';
    const charW = probe.getBoundingClientRect().width / 20 || 8;
    const avail = el.upper.clientWidth - 24;
    el.upper.hidden = true;
    const natural = Math.floor(avail / charW);
    // Games drop status-line fields on narrow screens, so always claim at
    // least 60 columns and shrink the upper window's type to fit instead.
    const cols = Math.max(60, Math.min(100, natural));
    if (natural < cols) el.upper.style.fontSize = `${(13 * natural) / cols}px`;
    return cols;
  }

  function startGame(rawBytes, meta) {
    let vm;
    const bytes = unwrapBlorb(rawBytes);
    el.library.hidden = true;
    el.game.hidden = false;
    const columns = measureColumns();
    const io = {
      screenWidth: columns,
      print: (text, style) => output(text, style),
      clear: () => {
        el.transcript.replaceChildren();
        newTurn();
      },
      error: (e) => notice(`Something went wrong inside the story: ${e.message}`, true),
      bell: () => navigator.vibrate && navigator.vibrate(40),
    };
    try {
      vm = new ZMachine(bytes, io);
    } catch (e) {
      el.game.hidden = true;
      el.library.hidden = false;
      libraryError(e.message);
      return;
    }

    game = {
      vm,
      meta,
      id: vm.gameId,
      choices: new Choices(vm),
      turnEl: null,
      turnText: '',
      scene: '',
      lastLoc: -1,
      history: local.get('hist.' + vm.gameId, []),
      histPos: -1,
      anchor: null,
      map: new AutoMap(),
      mapLoc: 0,
      pendingCmd: '',
    };
    stories.put(game.id, { bytes, title: meta.title, source: meta.source, addedAt: Date.now() });
    if (meta.libId) local.set('lib.' + meta.libId, game.id);

    document.title = `${meta.title} — Grue`;
    local.set('current', game.id);
    if (!history.state || !history.state.game) history.pushState({ game: true }, '');
    el.transcript.replaceChildren();
    el.cmd.value = '';
    buildCompass();

    const auto = local.get('auto.' + game.id);
    if (auto && resumeAutosave(auto)) return;
    newTurn();
    vm.run();
    afterRun();
  }

  function resumeAutosave(auto) {
    const { vm } = game;
    try {
      vm.loadSnapshot(ZMachine.deserialize(auto.snap));
      vm.waiting = auto.waiting;
      if (auto.upper) {
        vm.splitWindow(auto.upper.height);
        auto.upper.rows.forEach((r, i) => r.forEach(([c, st], j) => {
          if (i < vm.upperHeight && j < vm.screenWidth) vm.upper[i][j] = { c, s: st };
        }));
      }
      el.transcript.innerHTML = auto.html || '';
      game.scene = auto.scene || '';
      game.lastLoc = auto.lastLoc;
      game.choices.dark = !!auto.dark;
      game.map = new AutoMap(auto.map);
      game.mapLoc = game.map.current;
    } catch {
      local.remove('auto.' + game.id);
      vm.reset();
      el.transcript.replaceChildren();
      return false;
    }
    const n = notice('Picked up where you left off.');
    n.classList.add('transient');
    n.append(
      h(
        'div',
        { class: 'actions' },
        h('button', {
          class: 'btn',
          text: 'Start over',
          onclick: () => {
            if (!confirm('Start this story from the beginning? Your current progress will be lost (saved games are kept).')) return;
            restartStory();
          },
        })
      )
    );
    // Continue the restored prompt so the next command echoes after its ">".
    const turns = el.transcript.querySelectorAll('.turn');
    if (turns.length) game.turnEl = turns[turns.length - 1];
    else newTurn();
    afterRun({ resumed: true });
    return true;
  }

  function restartStory() {
    const { vm } = game;
    local.remove('auto.' + game.id);
    vm.reset();
    game.scene = '';
    game.lastLoc = -1;
    game.choices.dark = false;
    game.map = new AutoMap();
    game.mapLoc = 0;
    el.transcript.replaceChildren();
    newTurn();
    vm.run();
    afterRun();
  }

  /* ---------- Output ---------- */

  function newTurn() {
    game.turnEl = h('div', { class: 'turn' });
    el.transcript.append(game.turnEl);
    const turns = el.transcript.children;
    while (turns.length > 250) turns[0].remove();
  }

  function styleClass(style) {
    const c = [];
    if (style & STYLE.REVERSE) c.push('s-rev');
    if (style & STYLE.BOLD) c.push('s-bold');
    if (style & STYLE.ITALIC) c.push('s-ital');
    if (style & STYLE.FIXED) c.push('s-fixed');
    return c.join(' ');
  }

  function output(text, style) {
    if (!game) return;
    game.turnText += text;
    const cls = styleClass(style);
    const t = game.turnEl;
    const last = t.lastChild;
    if (!cls) {
      if (last && last.nodeType === Node.TEXT_NODE) last.appendData(text);
      else t.append(document.createTextNode(text));
    } else if (last && last.nodeType === Node.ELEMENT_NODE && last.className === cls && !last.dataset.echo) {
      last.append(text);
    } else {
      t.append(h('span', { class: cls, text }));
    }
  }

  function notice(msg, isError) {
    const n = h('div', { class: 'notice' + (isError ? ' error' : '') }, h('div', { text: msg }));
    el.transcript.append(n);
    return n;
  }

  function scrollAfterTurn() {
    const t = el.transcript;
    const anchor = game.anchor;
    game.anchor = null;
    requestAnimationFrame(() => {
      if (anchor && anchor.isConnected) {
        const top = anchor.getBoundingClientRect().top - t.getBoundingClientRect().top + t.scrollTop - 12;
        const bottom = t.scrollHeight - t.clientHeight;
        t.scrollTop = Math.min(bottom, Math.max(0, top));
      } else t.scrollTop = t.scrollHeight;
    });
  }

  /* ---------- Status line & upper window ---------- */

  function renderStatus() {
    const { vm, meta } = game;
    if (vm.version <= 3) {
      const s = vm.statusInfo();
      el.statusLocation.textContent = s.location || meta.title;
      if (s.isTime) {
        const hr = s.a;
        el.statusRight.textContent = `${((hr + 11) % 12) + 1}:${String(s.b).padStart(2, '0')} ${hr < 12 ? 'am' : 'pm'}`;
      } else el.statusRight.textContent = `Score ${s.a} · Moves ${s.b}`;
      el.upper.hidden = vm.upperHeight === 0;
      if (!el.upper.hidden) renderUpper(vm.upper);
      return;
    }

    const rows = vm.upper.slice(0, vm.upperHeight);
    const texts = rows.map((r) => r.map((c) => c.c).join(''));
    const nonBlank = texts.filter((t) => t.trim());
    game.statusName = nonBlank.length ? nonBlank[0].trim().split(/\s{2,}/)[0] : '';
    if (nonBlank.length === 1 && rows.length <= 2) {
      // A classic one-line status bar: fold it into the top bar.
      const parts = nonBlank[0].trim().split(/\s{2,}/);
      el.statusLocation.textContent = parts[0];
      el.statusRight.textContent = parts.slice(1).join(' · ');
      el.upper.hidden = true;
    } else {
      el.statusLocation.textContent = meta.title;
      el.statusRight.textContent = '';
      el.upper.hidden = nonBlank.length === 0;
      if (!el.upper.hidden) renderUpper(rows);
    }
  }

  function renderUpper(rows) {
    const frag = document.createDocumentFragment();
    rows.forEach((row, i) => {
      let run = '';
      let style = row.length ? row[0].s : 0;
      const flush = () => {
        if (!run) return;
        const cls = styleClass(style);
        frag.append(cls ? h('span', { class: cls, text: run }) : document.createTextNode(run));
        run = '';
      };
      for (const cell of row) {
        if (cell.s !== style) {
          flush();
          style = cell.s;
        }
        run += cell.c;
      }
      flush();
      if (i < rows.length - 1) frag.append('\n');
    });
    el.upper.replaceChildren(frag);
  }

  /* ---------- After each burst of execution ---------- */

  function afterRun(opts = {}) {
    if (!game) return;
    const { vm } = game;
    renderStatus();

    const loc = game.choices.location(vm.version <= 3 ? '' : game.statusName);
    if (!opts.resumed) {
      if (loc !== game.lastLoc && !opts.keepScene) game.scene = '';
      game.scene = (game.scene + game.turnText).slice(-8000);
    }
    game.lastLoc = loc;
    renderChoices(opts.resumed ? '' : game.turnText);
    recordMap(loc, opts);
    game.turnText = '';
    scrollAfterTurn();

    const w = vm.waiting;
    setCharMode(w && w.type === 'char');
    if (!w) return storyEnded();
    if (w.type === 'line') {
      autosave();
      if (finePointer && !el.sheet.open && !el.saves.open) el.cmd.focus({ preventScroll: true });
    } else if (w.type === 'save') openSaves('save');
    else if (w.type === 'restore') openSaves('restore');
  }

  function storyEnded() {
    local.remove('auto.' + game.id);
    const n = notice(game.vm.error ? 'The story stopped unexpectedly.' : 'The story has ended.', !!game.vm.error);
    n.append(
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', text: 'Play again', onclick: restartStory }),
        h('button', { class: 'btn', text: 'Library', onclick: goLibrary })
      )
    );
    el.cmd.disabled = true;
    scrollAfterTurn();
  }

  function autosave() {
    const { vm, meta } = game;
    const s = vm.version <= 3 ? vm.statusInfo() : null;
    // Notices (resume banners, errors) belong to this session only.
    const clone = el.transcript.cloneNode(true);
    clone.querySelectorAll('.notice').forEach((n) => n.remove());
    const html = clone.innerHTML;
    const payload = {
      snap: ZMachine.serialize(vm.snapshot()),
      waiting: vm.waiting,
      upper: { height: vm.upperHeight, rows: vm.upper.map((r) => r.map((c) => [c.c, c.s])) },
      html: html.length > 200000 ? html.slice(html.indexOf('<div class="turn">', html.length - 200000)) : html,
      scene: game.scene,
      lastLoc: game.lastLoc,
      map: game.map.toJSON(),
      dark: game.choices.dark,
      meta: {
        title: meta.title,
        source: meta.source,
        location: s ? s.location : el.statusLocation.textContent,
        moves: s && !s.isTime ? s.b : null,
        savedAt: Date.now(),
      },
    };
    if (!local.set('auto.' + game.id, payload)) {
      payload.html = '';
      local.set('auto.' + game.id, payload);
    }
  }

  /* ---------- Sending commands ---------- */

  function submit(cmd) {
    const { vm } = game || {};
    if (!vm || !vm.waiting || vm.waiting.type !== 'line') return;
    cmd = cmd.trim().replace(/\s+/g, ' ');
    const echo = h('span', { class: 'echo', text: cmd });
    echo.dataset.echo = '1';
    game.turnEl.append(echo, '\n');
    game.anchor = echo;
    game.pendingCmd = cmd;
    if (cmd && game.history[game.history.length - 1] !== cmd) {
      game.history.push(cmd);
      if (game.history.length > 100) game.history.shift();
      local.set('hist.' + game.id, game.history);
    }
    game.histPos = -1;
    el.cmd.value = '';
    el.transcript.querySelectorAll('.notice.transient').forEach((n) => n.remove());
    newTurn();
    vm.submitLine(cmd);
    afterRun();
  }

  el.cmdbar.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!game) return;
    if (game.vm.waiting && game.vm.waiting.type === 'char') return sendChar(13);
    submit(el.cmd.value);
  });

  el.cmd.addEventListener('keydown', (e) => {
    if (!game || !game.vm.waiting) return;
    if (game.vm.waiting.type === 'char') {
      const code = keyToZscii(e);
      if (code != null) {
        e.preventDefault();
        sendChar(code);
      }
      return;
    }
    const hist = game.history;
    if (e.key === 'ArrowUp' && hist.length) {
      e.preventDefault();
      game.histPos = game.histPos < 0 ? hist.length - 1 : Math.max(0, game.histPos - 1);
      el.cmd.value = hist[game.histPos];
      renderStrip();
    } else if (e.key === 'ArrowDown' && game.histPos >= 0) {
      e.preventDefault();
      game.histPos++;
      el.cmd.value = game.histPos < hist.length ? hist[game.histPos] : '';
      if (game.histPos >= hist.length) game.histPos = -1;
      renderStrip();
    }
  });

  el.cmd.addEventListener('input', () => {
    if (game && game.vm.waiting && game.vm.waiting.type === 'char') {
      // Soft keyboards don't always send keydown with a useful key.
      const ch = el.cmd.value.slice(-1);
      el.cmd.value = '';
      if (ch) sendChar(game.vm.charToZscii(ch));
      return;
    }
    renderStrip();
  });

  el.cmd.addEventListener('focus', () => {
    if (!finePointer) document.body.classList.add('typing');
  });
  el.cmd.addEventListener('blur', () => document.body.classList.remove('typing'));

  /* ---------- Single keypress input ---------- */

  function keyToZscii(e) {
    const map = {
      Enter: 13, Escape: 27, Backspace: 8, Delete: 8,
      ArrowUp: 129, ArrowDown: 130, ArrowLeft: 131, ArrowRight: 132,
    };
    if (e.key in map) return map[e.key];
    const f = /^F(\d{1,2})$/.exec(e.key);
    if (f && +f[1] <= 12) return 132 + +f[1];
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return game.vm.charToZscii(e.key);
    return null;
  }

  function sendChar(code) {
    if (!game || !game.vm.waiting || game.vm.waiting.type !== 'char') return;
    newTurn();
    game.vm.submitChar(code);
    afterRun();
  }

  function setCharMode(on) {
    el.cmdbar.classList.toggle('char-mode', on);
    el.cmd.placeholder = on ? 'Press any key…' : 'What do you do?';
    el.cmd.disabled = !game.vm.waiting;
  }

  document.addEventListener('keydown', (e) => {
    if (!game || el.game.hidden || document.activeElement === el.cmd) return;
    if (document.querySelector('dialog[open]')) return;
    const w = game.vm.waiting;
    if (w && w.type === 'char') {
      const code = keyToZscii(e);
      if (code != null) {
        e.preventDefault();
        sendChar(code);
      }
    } else if (w && w.type === 'line' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      el.cmd.focus();
    }
  });

  el.transcript.addEventListener('click', (e) => {
    const noun = e.target.closest('.noun');
    const lineMode = game && game.vm.waiting && game.vm.waiting.type === 'line';
    if (noun && settings.links && lineMode) return nounTapped(noun);
    if (game && game.vm.waiting && game.vm.waiting.type === 'char' && !window.getSelection().toString()) sendChar(32);
  });
  el.transcript.addEventListener('keydown', (e) => {
    const noun = e.target.closest('.noun');
    if (noun && settings.links && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      nounTapped(noun);
    }
  });

  /* ====================================================================== */
  /* Tappable nouns in the story text                                       */
  /* ====================================================================== */

  function linkNouns() {
    for (const turn of el.transcript.querySelectorAll('.turn:not([data-linked])')) {
      turn.dataset.linked = '1';
      const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest('.echo, .noun') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = node.data;
        const re = /[A-Za-z]+/g;
        let frag = null;
        let last = 0;
        for (let m; (m = re.exec(text)); ) {
          if (m[0].length < 2 || !game.choices.isNoun(m[0])) continue;
          frag = frag || document.createDocumentFragment();
          frag.append(text.slice(last, m.index), h('span', { class: 'noun', role: 'button', tabindex: '0', text: m[0] }));
          last = m.index + m[0].length;
        }
        if (frag) {
          frag.append(text.slice(last));
          node.replaceWith(frag);
        }
      }
    }
  }

  /** Add a word from the story text to the command being built. */
  function nounTapped(span) {
    if (!game || !game.vm.waiting || game.vm.waiting.type !== 'line') return;
    const word = span.textContent.toLowerCase();
    const text = el.cmd.value;
    el.cmd.value = (text.trim() ? text.trimEnd() + ' ' : '') + word + ' ';
    span.classList.remove('flash');
    void span.offsetWidth;
    span.classList.add('flash');
    renderStrip();
  }

  /* ====================================================================== */
  /* Choices                                                                */
  /* ====================================================================== */

  function buildCompass() {
    const dirs = Object.fromEntries(game.choices.directions().map((d) => [d.id, d]));
    game.compass = {};
    const btn = (d, cls) => {
      const b = h('button', {
        type: 'button',
        class: cls,
        text: d.label,
        disabled: !d.available,
        'aria-label': d.cmd || d.label,
        title: d.cmd || '',
        onclick: () => submit(d.cmd),
      });
      if (d.available) game.compass[d.id] = b;
      return b;
    };
    const look = game.choices.has('look') ? 'look' : 'l';
    el.compass.replaceChildren(
      btn(dirs.nw), btn(dirs.n), btn(dirs.ne),
      btn(dirs.w),
      h('button', { type: 'button', class: 'look', text: 'Look', onclick: () => submit(look) }),
      btn(dirs.e),
      btn(dirs.sw), btn(dirs.s), btn(dirs.se),
      h('div', { class: 'wide' }, btn(dirs.u, 'vert'), btn(dirs.d, 'vert'), btn(dirs.in, 'vert'), btn(dirs.out, 'vert'))
    );
  }

  /** Enable only directions the room has an exit for (all of them in the dark). */
  function updateCompass(dark) {
    const exits = dark ? null : game.choices.exits(game.lastLoc);
    for (const [id, b] of Object.entries(game.compass)) {
      const usable = !exits || exits.has(id);
      b.disabled = !usable;
      b.title = usable ? b.getAttribute('aria-label') : 'No obvious way ' + b.getAttribute('aria-label');
    }
  }

  function renderChoices(turnText) {
    const { choices } = game;
    const r = choices.scan(game.scene, turnText, game.lastLoc);
    game.scanned = r;
    updateCompass(r.dark);
    linkNouns();
    const chip = (item) =>
      h('button', {
        type: 'button',
        class: 'chip' + (item.carried ? ' carried' : ''),
        text: item.phrase,
        title: item.name,
        onclick: () => objectTapped(item),
      });
    el.here.dataset.empty = r.dark ? 'Too dark to see' : 'Nothing you’ve noticed';
    el.carried.dataset.empty = 'Empty-handed';
    el.here.replaceChildren(...r.here.map(chip));
    el.carried.replaceChildren(...r.carried.map(chip));
    renderStrip();
  }

  function words(s) {
    return s.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function renderStrip() {
    if (!game) return;
    const { choices } = game;
    const text = el.cmd.value;
    const chips = [];
    if (!text.trim()) {
      chips.push(h('button', { type: 'button', class: 'chip accent', text: 'Verbs…', onclick: openVerbSheet }));
      for (const q of choices.quick())
        chips.push(h('button', { type: 'button', class: 'chip', text: q.label, onclick: () => submit(q.cmd) }));
    } else {
      const w = words(text);
      const last = w[w.length - 1];
      if (!choices.isVerbWord(w[0]) && !choices.prepositions().includes(w[0])) {
        // Nouns picked from the text but no verb yet: offer verbs to go in front.
        chips.push(h('button', { type: 'button', class: 'chip accent', text: 'Verbs…', onclick: openVerbSheet }));
        for (const verb of ['examine', 'take', 'open', 'read', 'drop', 'push', 'close'].filter((v) => choices.has(v)))
          chips.push(h('button', { type: 'button', class: 'chip', text: verb, onclick: () => applyVerb(verb) }));
      } else if (choices.prepositions().includes(last) && /\s$/.test(text)) {
        chips.push(h('span', { class: 'hint', text: 'Tap what to use, or keep typing' }));
      } else {
        for (const p of choices.prepositions())
          chips.push(
            h('button', {
              type: 'button',
              class: 'chip prep',
              text: p,
              onclick: () => {
                el.cmd.value = text.trimEnd() + ' ' + p + ' ';
                renderStrip();
              },
            })
          );
      }
      chips.push(
        h('button', {
          type: 'button',
          class: 'chip ghost',
          text: 'Clear',
          onclick: () => {
            el.cmd.value = '';
            renderStrip();
          },
        })
      );
    }
    el.strip.replaceChildren(...chips);
    el.strip.scrollLeft = 0;
  }

  function objectTapped(item) {
    const { choices } = game;
    const text = el.cmd.value.trim();
    if (!text) return openActionSheet(item);
    // Build on whatever is already typed or picked.
    const cmd = text + ' ' + item.phrase;
    const w = words(text);
    const last = w[w.length - 1];
    const endsWithPrep = choices.prepositions().includes(last);
    const loneVerb = w.length === 1 && !choices.needsSecondObject(last);
    if (endsWithPrep || loneVerb) submit(cmd);
    else {
      el.cmd.value = cmd + ' ';
      renderStrip();
    }
  }

  function openActionSheet(item) {
    const actions = game.choices.actionsFor(item);
    el.sheetTitle.textContent = capitalise(item.name);
    el.sheetSub.textContent = item.carried ? 'You’re carrying this' : 'Here with you';
    const grid = h(
      'div',
      { class: 'action-grid' },
      actions.map((a) =>
        h('button', {
          type: 'button',
          class: a.two ? 'two' : '',
          text: a.label,
          onclick: () => {
            el.sheet.close();
            if (a.two) {
              el.cmd.value = a.cmd;
              renderStrip();
              toast('Now tap the other thing');
            } else submit(a.cmd);
          },
        })
      ),
      h('button', {
        type: 'button',
        class: 'two',
        text: 'Type…',
        onclick: () => {
          el.sheet.close();
          el.cmd.value = ' ' + item.phrase;
          el.cmd.focus();
          el.cmd.setSelectionRange(0, 0);
          renderStrip();
        },
      })
    );
    el.sheetBody.replaceChildren(grid);
    openDialog(el.sheet);
  }

  /** Put a verb at the front of the command (keeping any nouns already picked). */
  function applyVerb(verb) {
    const text = el.cmd.value.trim();
    const rest = text && !game.choices.isVerbWord(words(text)[0]) ? text + ' ' : '';
    el.cmd.value = verb + ' ' + rest;
    renderStrip();
    if (finePointer) el.cmd.focus();
  }

  function openVerbSheet() {
    const { choices, vm } = game;
    const v = choices.verbs();
    const all = [...v.common, ...v.other];
    const letters = new Set(all.map((w) => w[0]));
    let filter = '';

    const pick = (verb) =>
      h('button', {
        type: 'button',
        class: 'chip',
        text: verb,
        onclick: () => {
          el.sheet.close();
          applyVerb(verb);
        },
      });

    const bar = h('div', { class: 'letter-bar', role: 'toolbar', 'aria-label': 'Filter by first letter' });
    const results = h('div', { class: 'verb-results' });

    function renderLetters() {
      const btn = (id, label, enabled) =>
        h('button', {
          type: 'button',
          text: label,
          disabled: !enabled,
          'aria-pressed': String(filter === id),
          onclick: () => {
            filter = id;
            renderLetters();
            renderResults();
          },
        });
      const scroll = bar.scrollLeft;
      bar.replaceChildren(
        btn('', 'All', true),
        ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => btn(c, c.toUpperCase(), letters.has(c)))
      );
      bar.scrollLeft = scroll;
    }

    function renderResults() {
      const match = (w) => !filter || w[0] === filter;
      const common = v.common.filter(match);
      const other = v.other.filter(match);
      const sections = [];
      if (common.length)
        sections.push(
          h('section', { class: 'sheet-section' }, h('h3', { text: 'Common' }), h('div', { class: 'word-cloud' }, common.map(pick)))
        );
      if (other.length)
        sections.push(
          h(
            'section',
            { class: 'sheet-section' },
            h('h3', { text: filter ? 'More' : 'Everything else the game understands' }),
            h('div', { class: 'word-cloud' }, other.map(pick))
          )
        );
      if (vm.version <= 3 && other.length)
        sections.push(
          h('p', { class: 'sheet-note', text: 'Infocom games only remember the first six letters of each word, so some appear shortened. They still work.' })
        );
      results.replaceChildren(...sections);
    }

    renderLetters();
    renderResults();
    el.sheetTitle.textContent = 'Verbs';
    el.sheetSub.textContent = 'Pick a verb, then tap an object — or press send.';
    el.sheetBody.replaceChildren(bar, results);
    openDialog(el.sheet);
    el.sheetBody.scrollTop = 0;
  }

  /* ====================================================================== */
  /* Map                                                                    */
  /* ====================================================================== */

  const mapView = new MapView(el.mapSvg, { onRoomTap: selectMapRoom });
  let mapSelected = 0;

  /** Note this turn's position on the map. */
  function recordMap(loc, opts) {
    const { choices, vm } = game;
    const cmd = game.pendingCmd;
    game.pendingCmd = '';
    // In Inform games a dark room reports "Darkness" as the location; map the real room.
    const room = choices.realRoom(loc);
    if (!room) return;
    const dark = game.scanned ? game.scanned.dark : false;
    if (!opts.resumed) {
      game.map.record(game.mapLoc, room, cmd, {
        name: vm.objName(room) || game.statusName || '?',
        dark,
        darkName: 'Dark place',
        died: /you have died|\*\*\*\*/i.test(game.turnText),
      });
      if (!dark) game.map.setExits(room, choices.exits(loc));
    } else if (!game.map.rooms[room]) {
      game.map.record(0, room, '', { name: vm.objName(room), dark });
    }
    game.mapLoc = room;
    game.map.current = room;
    if (el.mapDialog.open) renderMap();
  }

  function renderMap() {
    const n = game.map.size;
    el.mapSub.textContent = `${n} ${n === 1 ? 'place' : 'places'} explored · tap a room`;
    mapView.render(game.map, mapSelected);
  }

  function openMap() {
    mapSelected = 0;
    el.mapCard.hidden = true;
    openDialog(el.mapDialog);
    requestAnimationFrame(() => {
      renderMap();
      mapView.center(game.map.rooms[game.map.current]);
    });
  }

  function selectMapRoom(id) {
    const map = game.map;
    const room = map.rooms[id];
    if (!room) return;
    mapSelected = id;
    renderMap();
    el.mapCardName.textContent = room.name || 'Unknown';
    el.mapWalk.hidden = true;
    if (id === map.current) {
      el.mapCardInfo.textContent = 'You are here';
    } else {
      const route = map.route(map.current, id);
      if (route && route.length) {
        el.mapCardInfo.textContent = `${route.length} ${route.length === 1 ? 'move' : 'moves'} away`;
        el.mapWalk.hidden = false;
        el.mapWalk.onclick = () => walkRoute(route);
      } else {
        el.mapCardInfo.textContent = 'No known route from here yet';
      }
    }
    el.mapCard.hidden = false;
  }

  /** Walk a route one move at a time, stopping if anything goes differently. */
  async function walkRoute(route) {
    el.mapDialog.close();
    const dirs = Object.fromEntries(game.choices.directions().map((d) => [d.id, d.cmd]));
    for (const step of route) {
      if (!game || !game.vm.waiting || game.vm.waiting.type !== 'line') return;
      submit(dirs[step.dir]);
      await new Promise((r) => setTimeout(r, 220));
      if (!game) return;
      if (game.mapLoc !== step.to) {
        toast('Stopped: that move didn’t go where the map expected');
        return;
      }
    }
  }

  $('#map-zoom-in').addEventListener('click', () => mapView.zoomBy(1.25));
  $('#map-zoom-out').addEventListener('click', () => mapView.zoomBy(0.8));
  $('#map-center').addEventListener('click', () => game && mapView.center(game.map.rooms[game.map.current]));
  el.mapSvg.addEventListener('keydown', (e) => {
    const room = e.target.closest && e.target.closest('[data-room]');
    if (room && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      selectMapRoom(+room.dataset.room);
    }
  });
  window.addEventListener('resize', () => el.mapDialog.open && mapView.applyView());

  /* ====================================================================== */
  /* Save & restore                                                         */
  /* ====================================================================== */

  let saveMode = null;

  function slots() {
    return local.get('saves.' + game.id, {});
  }

  function openSaves(mode) {
    saveMode = mode;
    const isSave = mode === 'save';
    el.savesTitle.textContent = isSave ? 'Save game' : 'Restore game';
    el.savesSub.textContent = isSave ? 'Saved on this device' : 'Choose a saved position';
    el.saveForm.hidden = !isSave;
    const s = game.vm.version <= 3 ? game.vm.statusInfo() : null;
    el.saveName.value = s ? `${s.location}${s.isTime ? '' : `, move ${s.b}`}` : el.statusLocation.textContent || 'Saved game';
    renderSaveList();
    openDialog(el.saves);
    if (isSave && finePointer) el.saveName.select();
  }

  function renderSaveList() {
    const all = slots();
    const names = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
    const isSave = saveMode === 'save';
    if (!names.length) {
      el.saveList.replaceChildren(h('li', { class: 'empty', text: isSave ? 'No saved games yet.' : 'There are no saved games for this story yet.' }));
      return;
    }
    el.saveList.replaceChildren(
      ...names.map((name) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'pick',
              onclick: () => (isSave ? doSave(name, true) : doRestore(name)),
            },
            h('strong', { text: name }),
            h('span', { text: (isSave ? 'Overwrite · ' : '') + new Date(all[name].savedAt).toLocaleString() })
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': `Delete ${name}`,
              onclick: () => {
                if (!confirm(`Delete the saved game “${name}”?`)) return;
                const cur = slots();
                delete cur[name];
                local.set('saves.' + game.id, cur);
                renderSaveList();
              },
            },
            svgIcon('M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3')
          )
        )
      )
    );
  }

  function doSave(name, overwrite) {
    name = name.trim();
    if (!name) return;
    const all = slots();
    if (all[name] && !overwrite && !confirm(`Replace the saved game “${name}”?`)) return;
    all[name] = {
      savedAt: Date.now(),
      snap: ZMachine.serialize(game.vm.snapshot()),
      scene: game.scene,
      dark: game.choices.dark,
      map: game.map.toJSON(),
    };
    const ok = local.set('saves.' + game.id, all);
    finishSaveDialog();
    toast(ok ? 'Game saved' : 'Couldn’t save — this device’s storage is full');
    game.vm.finishSave(ok);
    afterRun();
  }

  function doRestore(name) {
    const slot = slots()[name];
    if (!slot) return;
    finishSaveDialog();
    game.vm.finishRestore(ZMachine.deserialize(slot.snap));
    game.scene = slot.scene || '';
    game.choices.dark = !!slot.dark;
    if (slot.map) {
      game.map = new AutoMap(slot.map);
      game.mapLoc = game.map.current;
    }
    game.pendingCmd = '';
    toast(`Restored “${name}”`);
    afterRun({ keepScene: true });
  }

  function finishSaveDialog() {
    saveMode = null;
    if (el.saves.open) el.saves.close();
  }

  el.saveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    doSave(el.saveName.value, false);
  });

  el.saves.addEventListener('close', () => {
    // Closed without choosing: tell the game it didn't happen.
    if (!saveMode || !game) return;
    const mode = saveMode;
    saveMode = null;
    if (mode === 'save') game.vm.finishSave(false);
    else game.vm.finishRestore(null);
    afterRun();
  });

  /* ====================================================================== */
  /* Menu & global actions                                                  */
  /* ====================================================================== */

  function closeMenu() {
    el.menu.hidden = true;
  }

  function goLibrary() {
    local.remove('current');
    if (history.state && history.state.game) history.back();
    else showLibrary();
  }

  window.addEventListener('popstate', () => {
    if (el.game.hidden) return;
    local.remove('current');
    showLibrary();
  });

  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!e.target.closest('#menu') && !e.target.closest('[data-action="menu"]')) closeMenu();
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'menu') el.menu.hidden = !el.menu.hidden;
      else if (action === 'settings') {
        closeMenu();
        openDialog(el.settings);
      } else if (action === 'library') goLibrary();
      else if (action === 'map' && game) {
        closeMenu();
        openMap();
      }
    }
    const cmdEl = e.target.closest('[data-cmd]');
    if (cmdEl && game) {
      closeMenu();
      submit(cmdEl.dataset.cmd);
    }
  });

  el.panelToggle.addEventListener('click', () => {
    settings.panel = !settings.panel;
    saveSettings();
  });

  /* ====================================================================== */

  applySettings();
  history.replaceState(null, '');
  showLibrary();

  // A reload drops you back into the story you were reading.
  const current = local.get('current');
  const currentMeta = current && autosaveMeta(current);
  if (currentMeta) openStoredGame(current, currentMeta);
  else local.remove('current');
})();
