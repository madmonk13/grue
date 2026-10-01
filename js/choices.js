/*
 * Derives clickable choices from a running Z-machine: nearby objects,
 * carried objects, and the verbs the game's parser understands.
 *
 * Objects are read from the game's object tree, but only offered once the
 * game has actually mentioned them, so a closed mailbox doesn't give away
 * the leaflet inside it.
 */
(function (root) {
  'use strict';

  const PLAYER_NAMES = ['yourself', '(self object)', 'cretin', 'adventurer', 'you', 'myself', 'player', 'me'];

  const DIRECTIONS = [
    { id: 'nw', label: 'NW', cmd: 'northwest', alt: 'nw' },
    { id: 'n', label: 'N', cmd: 'north', alt: 'n' },
    { id: 'ne', label: 'NE', cmd: 'northeast', alt: 'ne' },
    { id: 'w', label: 'W', cmd: 'west', alt: 'w' },
    { id: 'e', label: 'E', cmd: 'east', alt: 'e' },
    { id: 'sw', label: 'SW', cmd: 'southwest', alt: 'sw' },
    { id: 's', label: 'S', cmd: 'south', alt: 's' },
    { id: 'se', label: 'SE', cmd: 'southeast', alt: 'se' },
    { id: 'u', label: 'Up', cmd: 'up', alt: 'u' },
    { id: 'd', label: 'Down', cmd: 'down', alt: 'd' },
    { id: 'in', label: 'In', cmd: 'in', alt: 'enter' },
    { id: 'out', label: 'Out', cmd: 'out', alt: 'exit' },
  ];

  // Verbs offered for an object. `two` marks commands that need a second
  // object, which the player picks next.
  const HERE_ACTIONS = [
    { label: 'Examine', cmd: 'examine %' },
    { label: 'Take', cmd: 'take %' },
    { label: 'Open', cmd: 'open %' },
    { label: 'Close', cmd: 'close %' },
    { label: 'Read', cmd: 'read %' },
    { label: 'Look in', cmd: 'look in %' },
    { label: 'Search', cmd: 'search %' },
    { label: 'Push', cmd: 'push %' },
    { label: 'Pull', cmd: 'pull %' },
    { label: 'Move', cmd: 'move %' },
    { label: 'Turn', cmd: 'turn %' },
    { label: 'Turn on', cmd: 'turn on %' },
    { label: 'Turn off', cmd: 'turn off %' },
    { label: 'Enter', cmd: 'enter %' },
    { label: 'Climb', cmd: 'climb %' },
    { label: 'Knock on', cmd: 'knock on %' },
    { label: 'Talk to', cmd: 'talk to %' },
    { label: 'Eat', cmd: 'eat %' },
    { label: 'Drink', cmd: 'drink %' },
    { label: 'Attack with…', cmd: 'attack % with ', two: true },
    { label: 'Unlock with…', cmd: 'unlock % with ', two: true },
    { label: 'Tie to…', cmd: 'tie % to ', two: true },
  ];
  const CARRIED_ACTIONS = [
    { label: 'Examine', cmd: 'examine %' },
    { label: 'Drop', cmd: 'drop %' },
    { label: 'Read', cmd: 'read %' },
    { label: 'Open', cmd: 'open %' },
    { label: 'Close', cmd: 'close %' },
    { label: 'Look in', cmd: 'look in %' },
    { label: 'Turn on', cmd: 'turn on %' },
    { label: 'Turn off', cmd: 'turn off %' },
    { label: 'Wear', cmd: 'wear %' },
    { label: 'Remove', cmd: 'remove %' },
    { label: 'Eat', cmd: 'eat %' },
    { label: 'Drink', cmd: 'drink %' },
    { label: 'Put in…', cmd: 'put % in ', two: true },
    { label: 'Put on…', cmd: 'put % on ', two: true },
    { label: 'Give to…', cmd: 'give % to ', two: true },
    { label: 'Throw at…', cmd: 'throw % at ', two: true },
    { label: 'Show to…', cmd: 'show % to ', two: true },
  ];

  const QUICK = [
    { label: 'Inventory', cmd: 'inventory', alt: 'i' },
    { label: 'Wait', cmd: 'wait', alt: 'z' },
    { label: 'Again', cmd: 'again', alt: 'g' },
    { label: 'Take all', cmd: 'take all' },
    { label: 'Undo', cmd: 'undo' },
    { label: 'Score', cmd: 'score' },
    { label: 'Diagnose', cmd: 'diagnose' },
    { label: 'Hint', cmd: 'hint' },
  ];

  const COMMON_VERBS = [
    'examine', 'take', 'drop', 'open', 'close', 'read', 'put', 'give', 'push', 'pull',
    'move', 'turn', 'attack', 'kill', 'eat', 'drink', 'climb', 'enter', 'search',
    'unlock', 'lock', 'light', 'wear', 'remove', 'tie', 'throw', 'show', 'ask', 'tell',
    'say', 'listen', 'smell', 'touch', 'wave', 'dig', 'fill', 'pour', 'jump', 'pray',
    'swim', 'sleep', 'yell', 'knock', 'burn', 'break', 'cut', 'inflate', 'deflate',
  ];

  // Words that read as nouns but make poor tap targets in the story text.
  const NOT_LINKED = [
    'it', 'them', 'him', 'her', 'me', 'myself', 'self', 'you', 'yourself', 'all', 'everything',
    'both', 'i', 'a', 'an', 'the', 'here', 'there', 'room', 'north', 'south', 'east', 'west',
    'northeast', 'northwest', 'southeast', 'southwest', 'up', 'down', 'in', 'out', 'ne', 'nw',
    'se', 'sw', 'n', 's', 'e', 'w', 'u', 'd',
  ];

  const PREPOSITIONS = ['in', 'on', 'with', 'to', 'at', 'from', 'under', 'into', 'behind', 'about'];

  const TWO_OBJECT_VERBS = new Set(['put', 'give', 'throw', 'tie', 'unlock', 'lock', 'show', 'insert', 'ask', 'tell']);

  class Choices {
    constructor(vm) {
      this.vm = vm;
      this.entries = vm.dictionaryEntries();
      this.scheme = this.detectScheme();
      this.player = 0;
      this.dark = false;
    }

    /** Infocom (ZIL) and Inform encode "this word is a verb" differently. */
    detectScheme() {
      const probe = ['take', 'look', 'open', 'get', 'examine', 'drop', 'inventory'];
      let zil = 0;
      let inform = 0;
      for (const w of probe) {
        const e = this.entryFor(w);
        if (!e || !e.data.length) continue;
        if (e.data[0] & 0x40) zil++;
        if (e.data[0] & 0x01) inform++;
      }
      return inform > zil ? 'inform' : 'zil';
    }

    entryFor(word) {
      const addr = this.vm.lookupWord(word);
      return addr ? this.entries.find((e) => e.addr === addr) : null;
    }

    has(word) {
      return this.vm.lookupWord(word) !== 0;
    }

    hasPhrase(phrase) {
      return phrase
        .replace('%', '')
        .trim()
        .split(/\s+/)
        .every((w) => this.has(w));
    }

    isVerbEntry(e) {
      if (!e.data.length) return false;
      return this.scheme === 'inform' ? (e.data[0] & 0x01) !== 0 : (e.data[0] & 0x40) !== 0;
    }

    /* ------------------------------------------------------------------ */

    directions() {
      return DIRECTIONS.map((d) => {
        const cmd = this.has(d.cmd) ? d.cmd : this.has(d.alt) ? d.alt : null;
        return { ...d, cmd, available: !!cmd };
      });
    }

    quick() {
      return QUICK.map((q) => {
        const cmd = this.hasPhrase(q.cmd) ? q.cmd : q.alt && this.has(q.alt) ? q.alt : null;
        return cmd ? { label: q.label, cmd } : null;
      }).filter(Boolean);
    }

    prepositions() {
      return PREPOSITIONS.filter((p) => this.has(p));
    }

    needsSecondObject(verb) {
      return TWO_OBJECT_VERBS.has(verb);
    }

    /** Verbs, split into familiar ones and everything else the parser knows. */
    verbs() {
      const common = COMMON_VERBS.filter((v) => this.has(v)).sort();
      const commonSet = new Set(common.map((v) => this.vm.lookupWord(v)));
      const dirs = new Set(DIRECTIONS.flatMap((d) => [d.cmd, d.alt]).map((w) => this.vm.lookupWord(w)));
      const other = [];
      const seen = new Set();
      for (const e of this.entries) {
        if (!this.isVerbEntry(e) || commonSet.has(e.addr) || dirs.has(e.addr)) continue;
        const w = e.word.toLowerCase();
        if (!/^[a-z][a-z-]+$/.test(w) || seen.has(w)) continue;
        seen.add(w);
        other.push(w);
      }
      other.sort();
      return { common, other };
    }

    actionsFor(obj) {
      const list = obj.carried ? CARRIED_ACTIONS : HERE_ACTIONS;
      return list
        .filter((a) => this.hasPhrase(a.cmd))
        .map((a) => ({ label: a.label, two: !!a.two, cmd: a.cmd.replace('%', obj.phrase) }));
    }

    isVerbWord(word) {
      const e = this.entryFor(word);
      return !!e && this.isVerbEntry(e);
    }

    /** Is this word from the story text a noun the parser knows? */
    isNoun(word) {
      const vm = this.vm;
      const addr = vm.lookupWord(word);
      if (!addr) return false;
      if (!this.notLinked) {
        this.vocab(0);
        this.notLinked = new Set(NOT_LINKED.map((w) => vm.lookupWord(w)).filter(Boolean));
      }
      if (this.notLinked.has(addr)) return false;
      if (this.player && this.vocab(this.player).includes(addr)) return false;
      const e = this.entryByAddr.get(addr);
      return !!e && (e.data[0] & 0x80) !== 0;
    }

    /* ------------------------------------------------------------------ */
    /* Exits                                                              */
    /* ------------------------------------------------------------------ */

    /**
     * Direction ids with a usable exit from `loc`, or null when the game's
     * exit data can't be read (in which case every direction stays enabled).
     */
    exits(loc) {
      if (!loc) return null;
      if (this.exitMap === undefined) this.exitMap = this.findExitProps();
      if (!this.exitMap) return null;
      const open = new Set();
      for (const [id, prop] of this.exitMap) if (this.exitUsable(loc, prop)) open.add(id);
      // A room with no readable exits usually means the game handles movement
      // some other way; don't strand the player with a dead compass.
      return open.size ? open : null;
    }

    /** Map of direction id -> the room property holding that exit. */
    findExitProps() {
      const vm = this.vm;
      const dirs = this.directions().filter((d) => d.available);

      // Infocom (ZIL): direction words carry their property number in the dictionary.
      const zil = new Map();
      for (const d of dirs) {
        const e = this.entryFor(d.cmd);
        if (!e || !(e.data[0] & 0x10)) continue;
        const prop = (e.data[0] & 3) === 3 ? e.data[1] : e.data[2];
        if (prop >= 1 && prop <= 63) zil.set(d.id, prop);
      }
      if (zil.size >= 4) {
        this.exitStyle = 'zil';
        return zil;
      }

      // Inform: compass objects share a property (door_dir) naming each exit property.
      const north = vm.lookupWord('north') || vm.lookupWord('n');
      const n = this.objCount || (this.objCount = vm.objCount());
      let compass = 0;
      for (let o = 1; o <= n && !compass; o++) {
        if (this.vocab(o).includes(north) && vm.objParent(o)) compass = vm.objParent(o);
      }
      if (!compass) return null;
      const kids = [];
      for (let c = vm.objChild(compass); c; c = vm.objSibling(c)) kids.push(c);
      if (kids.length < 4) return null;

      let doorDir = 0;
      for (let a = vm.firstPropAddr(kids[0]), info; (info = vm.propInfo(a)); a = info.data + info.size) {
        const values = kids.map((k) => {
          const p = vm.findProp(k, info.num);
          return p && p.size === 2 ? vm.getWord(p.data) : -1;
        });
        if (values.every((v) => v >= 1 && v <= 63) && new Set(values).size === values.length) {
          doorDir = info.num;
          break;
        }
      }
      if (!doorDir) return null;

      const inform = new Map();
      for (const k of kids) {
        const words = this.vocab(k);
        const prop = vm.getWord(vm.findProp(k, doorDir).data);
        for (const d of dirs) {
          if (inform.has(d.id)) continue;
          if ([d.cmd, d.alt].some((w) => words.includes(vm.lookupWord(w)))) inform.set(d.id, prop);
        }
      }
      if (inform.size < 4) return null;
      this.exitStyle = 'inform';
      return inform;
    }

    exitUsable(loc, prop) {
      const vm = this.vm;
      const info = vm.findProp(loc, prop);
      if (!info) return false;

      if (this.exitStyle === 'zil') {
        // Exit kinds are told apart by size: plain, "can't go" message,
        // routine, conditional (on a global flag), door. Room numbers are
        // words from version 4 on, which makes every kind one byte longer.
        const wide = vm.version >= 4 ? 1 : 0;
        switch (info.size - wide) {
          case 1: return true; // plain exit
          case 2: return false; // message only
          case 3: return true; // routine decides
          case 4: {
            const flag = vm.mem[info.data + 1 + wide];
            return flag >= 16 ? vm.global(flag - 16) !== 0 : true;
          }
          case 5: return true; // door, open or not
          default: return true;
        }
      }

      const value = info.size === 1 ? vm.mem[info.data] : vm.getWord(info.data);
      if (!value) return false;
      if (value <= this.objCount) return true; // a room or a door
      // Otherwise a packed address: a string is a refusal message, a routine may allow it.
      return !this.looksLikeMessage(value);
    }

    looksLikeMessage(packed) {
      const vm = this.vm;
      const addr = vm.unpackString(packed);
      if (addr >= vm.mem.length) return false;
      let text;
      try {
        text = vm.decodeText(addr).text;
      } catch {
        return false;
      }
      if (!/^[\x20-\x7e\n]+$/.test(text) || text.startsWith(' ')) return false;
      const words = text.match(/[A-Za-z]{2,}/g) || [];
      const letters = (text.match(/[A-Za-z ]/g) || []).length;
      return words.length >= 2 && /[aeiou]/i.test(text) && letters / text.length > 0.8;
    }

    /* ------------------------------------------------------------------ */

    /**
     * The current room. Infocom and most Inform games keep it in global 0 (the
     * v3 status line reads it from there); for others, fall back to the room
     * named on the status line.
     */
    location(statusName) {
      const vm = this.vm;
      const n = this.objCount || (this.objCount = vm.objCount());
      const g0 = vm.global(0);
      const valid = g0 >= 1 && g0 <= n && /^[\x20-\x7e]+$/.test(vm.objName(g0));
      const want = (statusName || '').trim().toLowerCase();
      if (valid && (!want || want.includes(vm.objName(g0).toLowerCase()))) return g0;
      if (want) {
        for (let o = 1; o <= n; o++) {
          const name = vm.objName(o).toLowerCase();
          if (name && !vm.objParent(o) && want.startsWith(name)) return o;
        }
      }
      return valid ? g0 : 0;
    }

    /**
     * The player object: it stands in the room and answers to "me", or has a
     * player-ish name ("cretin" in Zork, "yourself" in most Inform games).
     */
    findPlayer(loc) {
      const vm = this.vm;
      const selfWords = ['me', 'myself', 'self'].map((w) => vm.lookupWord(w)).filter(Boolean);
      const inRoom = (o) => {
        for (let p = vm.objParent(o), i = 0; p && i < 8; p = vm.objParent(p), i++) if (p === loc) return true;
        return false;
      };
      if (this.player && inRoom(this.player)) return this.player;
      const n = this.objCount || (this.objCount = vm.objCount());
      let best = 0;
      let bestScore = 0;
      for (let o = 1; o <= n; o++) {
        if (!vm.objParent(o)) continue;
        let score = 0;
        if (this.vocab(o).some((w) => selfWords.includes(w))) score += 4;
        if (PLAYER_NAMES.includes(vm.objName(o).toLowerCase())) score += 2;
        if (!score) continue;
        if (inRoom(o)) score += 8;
        if (score > bestScore) {
          best = o;
          bestScore = score;
        }
      }
      // Keep the previous answer if the player is somewhere we can't see (e.g. darkness).
      if (bestScore < 8 && this.player) return this.player;
      return (this.player = best);
    }

    /**
     * The room the player is really in. Usually `loc`, but Inform reports a
     * stand-in "Darkness" location when the lights are out.
     */
    realRoom(loc) {
      const vm = this.vm;
      const player = this.player;
      if (!player) return loc;
      let top = 0;
      for (let p = vm.objParent(player), i = 0; p && i < 10; p = vm.objParent(p), i++) {
        if (p === loc) return loc;
        top = p;
      }
      return top || loc;
    }

    /** The words of an object's name that the parser actually understands. */
    phraseFor(o) {
      let name = this.vm.objName(o).toLowerCase();
      // "pile of leaves" -> "leaves", "quantity of water" -> "water"
      const of = name.lastIndexOf(' of ');
      if (of >= 0) name = name.slice(of + 4);
      const words = name.split(/[^a-z0-9'-]+/).filter((w) => w && !/^(a|an|the|some)$/.test(w));
      const known = words.filter((w) => this.has(w));
      if (known.length) return known.slice(-2).join(' ');
      const vocab = this.vocab(o);
      return vocab.length ? this.entryByAddr.get(vocab[0]).word : '';
    }

    /** Dictionary addresses of the nouns an object answers to. */
    vocab(o) {
      if (!this.vocabCache) {
        this.vocabCache = new Map();
        this.entryByAddr = new Map(this.entries.map((e) => [e.addr, e]));
        const d = this.vm.parseDict(this.vm.dictAddr);
        this.dictRange = [d.start, d.start + d.count * d.entryLen, d.entryLen];
      }
      if (!o) return [];
      if (this.vocabCache.has(o)) return this.vocabCache.get(o);
      const vm = this.vm;
      const [lo, hi, len] = this.dictRange;
      const words = [];
      let a = vm.firstPropAddr(o);
      for (let info; (info = vm.propInfo(a)); a = info.data + info.size) {
        if (info.size % 2) continue;
        const list = [];
        for (let i = 0; i < info.size; i += 2) list.push(vm.getWord(info.data + i));
        if (list.every((w) => w >= lo && w < hi && (w - lo) % len === 0)) words.push(...list);
      }
      const nouns = words.filter((w) => (this.entryByAddr.get(w).data[0] & 0x80) !== 0);
      const result = nouns.length ? nouns : words;
      this.vocabCache.set(o, result);
      return result;
    }

    wordsIn(text) {
      const set = new Set();
      for (const w of text.match(/[a-z0-9'-]+/g) || []) {
        const addr = this.vm.lookupWord(w);
        if (addr) set.add(addr);
      }
      return set;
    }

    /**
     * Has the game mentioned this object? Objects directly in the room may be
     * matched by any of their nouns; objects inside something need their own
     * name to appear, so a sack "smelling of hot peppers" doesn't reveal the
     * lunch inside it.
     */
    mentioned(o, text, words, strict) {
      const name = this.vm.objName(o).toLowerCase();
      if (!name) return false;
      if (text.includes(name)) return true;
      if (!strict) return this.vocab(o).some((w) => words.has(w));
      const head = name.split(/[^a-z0-9'-]+/).filter(Boolean).pop();
      return !!head && head.length > 2 && new RegExp(`\\b${head}(e?s)?\\b`).test(text);
    }

    /**
     * @param {string} sceneText  everything printed since arriving here
     * @param {string} turnText   what the last command printed
     * @param {number} [loc]       the current room (see location())
     */
    scan(sceneText, turnText, loc) {
      const vm = this.vm;
      if (loc == null) loc = this.location();
      const player = this.findPlayer(loc);
      const scene = sceneText.toLowerCase();
      const turn = turnText.toLowerCase();
      const words = this.wordsIn(scene);

      // Infocom games keep the room in global 0 even when it's dark, so rely on
      // the game's own words. (Inform switches the location to "Darkness".)
      const locName = vm.objName(loc).toLowerCase();
      if (/pitch (black|dark)|too dark to see|can't see a thing/.test(turn)) this.dark = true;
      else if (this.lastLoc !== loc || turn.includes(locName + '\n')) this.dark = false;
      this.lastLoc = loc;

      const carried = [];
      const here = [];
      const seen = new Set();
      const add = (list, o, isCarried) => {
        if (seen.has(o) || o === player || o === loc) return;
        const phrase = this.phraseFor(o);
        if (!phrase) return;
        seen.add(o);
        list.push({ obj: o, name: vm.objName(o), phrase, carried: isCarried });
      };

      if (player) {
        for (let c = vm.objChild(player); c; c = vm.objSibling(c)) {
          add(carried, c, true);
          for (let g = vm.objChild(c); g; g = vm.objSibling(g)) {
            if (this.mentioned(g, scene, words, true)) add(carried, g, true);
          }
        }
      }

      if (!this.dark && loc) {
        const walk = (parent, depth) => {
          for (let c = vm.objChild(parent); c; c = vm.objSibling(c)) {
            if (c === player) continue;
            if (this.mentioned(c, scene, words, depth > 1)) add(here, c, false);
            if (depth < 3) walk(c, depth + 1);
          }
        };
        walk(loc, 1);
      }

      return { here, carried, dark: this.dark };
    }
  }

  Choices.PREPOSITIONS = PREPOSITIONS;
  root.Choices = Choices;
  if (typeof module !== 'undefined' && module.exports) module.exports = Choices;
})(typeof window !== 'undefined' ? window : globalThis);
