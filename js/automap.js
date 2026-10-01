/*
 * Automapping: remembers rooms the player has visited and the moves that
 * connected them, and lays them out on a grid by compass direction.
 *
 * Only observed moves become connections, so one-way passages, mazes and
 * routine-controlled exits are mapped as they actually behaved. Exits the
 * game data says exist, but which haven't been taken yet, are kept per room
 * and drawn as stubs.
 */
(function (root) {
  'use strict';

  const GRID = {
    n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
    ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1],
  };
  // Up/down/in/out have no place on a flat grid; prefer these nearby cells.
  const NEAR = { u: [1, -1], d: [-1, 1], in: [1, 1], out: [-1, -1] };

  const OPPOSITE = {
    n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw',
    u: 'd', d: 'u', in: 'out', out: 'in',
  };

  const WORDS = {
    n: ['n', 'north'], s: ['s', 'south'], e: ['e', 'east'], w: ['w', 'west'],
    ne: ['ne', 'northeast'], nw: ['nw', 'northwest'], se: ['se', 'southeast'], sw: ['sw', 'southwest'],
    u: ['u', 'up', 'upward', 'upwards', 'upstairs'],
    d: ['d', 'down', 'downward', 'downwards', 'downstairs'],
    in: ['in', 'inside', 'enter'],
    out: ['out', 'outside', 'exit', 'leave'],
  };
  const MOVE_VERBS = new Set(['go', 'walk', 'run', 'head', 'climb', 'move', 'travel', 'crawl']);
  const NOT_MOVES = new Set(['undo', 'restore', 'restart', 'load', 'save', 'quit']);

  /** The direction a command moves in ("n", "go north", "climb up"), or null. */
  function directionOf(cmd) {
    const w = cmd
      .toLowerCase()
      .replace(/[.,!?]/g, ' ')
      .split(/\s+/)
      .filter((x) => x && x !== 'the');
    if (!w.length || w.length > 3) return null;
    const i = MOVE_VERBS.has(w[0]) && w.length > 1 ? 1 : 0;
    if (w.length - i !== 1) return null;
    for (const [id, list] of Object.entries(WORDS)) if (list.includes(w[i])) return id;
    return null;
  }

  class AutoMap {
    constructor(data) {
      this.rooms = {};
      this.edges = {};
      this.current = 0;
      if (data) {
        this.rooms = JSON.parse(JSON.stringify(data.rooms || {}));
        this.edges = JSON.parse(JSON.stringify(data.edges || {}));
        this.current = data.current || 0;
      }
    }

    toJSON() {
      return { rooms: this.rooms, edges: this.edges, current: this.current };
    }

    get size() {
      return Object.keys(this.rooms).length;
    }

    /**
     * Note where the player is after a turn.
     * @param {number} prev   room before the command (0 if unknown)
     * @param {number} loc    room now
     * @param {string} cmd    the command that was typed
     * @param {object} info   { name, dark, died }
     */
    record(prev, loc, cmd, info) {
      if (!loc) return;
      const dir = cmd ? directionOf(cmd) : null;
      const first = (cmd || '').trim().toLowerCase().split(/\s+/)[0];
      const counts = prev && prev !== loc && this.rooms[prev] && cmd && !NOT_MOVES.has(first) && !info.died;

      if (!this.rooms[loc]) this.place(loc, counts ? prev : 0, dir);
      const room = this.rooms[loc];
      room.dark = !!info.dark;
      if (!info.dark || !room.name) room.name = info.dark && info.darkName ? info.darkName : info.name;
      room.seen = true;

      if (counts) {
        if (dir) this.edges[`${prev}>${dir}`] = { from: prev, to: loc, dir };
        else this.edges[`${prev}>~${loc}`] = { from: prev, to: loc, dir: null, label: cmd.trim() };
      }
      this.current = loc;
    }

    /** Remember which exits the game data lists for a room. */
    setExits(loc, exits) {
      const room = this.rooms[loc];
      if (room && exits) room.exits = [...exits];
    }

    occupied() {
      const set = new Set();
      for (const r of Object.values(this.rooms)) set.add(`${r.x},${r.y}`);
      return set;
    }

    nearestFree(x, y, taken) {
      if (!taken.has(`${x},${y}`)) return [x, y];
      for (let r = 1; r < 50; r++) {
        const ring = [];
        for (let dx = -r; dx <= r; dx++)
          for (let dy = -r; dy <= r; dy++)
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push([x + dx, y + dy, dx * dx + dy * dy]);
        ring.sort((a, b) => a[2] - b[2]);
        for (const [cx, cy] of ring) if (!taken.has(`${cx},${cy}`)) return [cx, cy];
      }
      return [x + 50, y];
    }

    place(id, from, dir) {
      const taken = this.occupied();
      const src = from && this.rooms[from];
      let pos;
      if (src) {
        const d = (dir && (GRID[dir] || NEAR[dir])) || [1, 0];
        pos = this.nearestFree(src.x + d[0], src.y + d[1], taken);
      } else if (!taken.size) {
        pos = [0, 0];
      } else {
        // Arrived with no known route (teleport, restore): start a new island.
        const rooms = Object.values(this.rooms);
        pos = this.nearestFree(Math.max(...rooms.map((r) => r.x)) + 2, Math.min(...rooms.map((r) => r.y)), taken);
      }
      this.rooms[id] = { id, name: '', x: pos[0], y: pos[1], dark: false, exits: null };
    }

    /** Shortest known route between rooms, as a list of { dir, to } steps. */
    route(from, to) {
      if (from === to) return [];
      const out = {};
      const add = (e) => (out[e.from] = out[e.from] || []).push(e);
      for (const e of Object.values(this.edges)) if (e.dir) add(e);
      // Assume a way back where the room's own exit data agrees there is one.
      // (If the guess is wrong, walking stops as soon as a step goes astray.)
      for (const e of Object.values(this.edges)) {
        const back = e.dir && OPPOSITE[e.dir];
        const room = this.rooms[e.to];
        if (back && !this.edges[`${e.to}>${back}`] && room && room.exits && room.exits.includes(back))
          add({ from: e.to, to: e.from, dir: back });
      }
      const prev = { [from]: null };
      const queue = [from];
      while (queue.length) {
        const cur = queue.shift();
        for (const e of out[cur] || []) {
          if (e.to in prev) continue;
          prev[e.to] = e;
          if (e.to === to) {
            const steps = [];
            for (let s = e; s; s = prev[s.from]) steps.unshift({ dir: s.dir, to: s.to });
            return steps;
          }
          queue.push(e.to);
        }
      }
      return null;
    }
  }

  AutoMap.directionOf = directionOf;
  AutoMap.OPPOSITE = OPPOSITE;
  AutoMap.GRID = GRID;
  root.AutoMap = AutoMap;
  if (typeof module !== 'undefined' && module.exports) module.exports = AutoMap;
})(typeof window !== 'undefined' ? window : globalThis);
