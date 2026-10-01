/* Draws an AutoMap as a pannable, zoomable SVG. */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const CW = 156; // grid cell width
  const CH = 96; // grid cell height
  const BW = 118; // room box width
  const BH = 48; // room box height

  // Where a connection leaves a room, and which way it heads.
  const ANCHOR = {
    n: [0, -BH / 2], s: [0, BH / 2], e: [BW / 2, 0], w: [-BW / 2, 0],
    ne: [BW / 2 - 8, -BH / 2], nw: [-BW / 2 + 8, -BH / 2], se: [BW / 2 - 8, BH / 2], sw: [-BW / 2 + 8, BH / 2],
    u: [BW / 4, -BH / 2], d: [-BW / 4, BH / 2], in: [-BW / 2, BH / 4], out: [BW / 2, -BH / 4],
  };
  const HEADING = {
    n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
    ne: [0.7, -0.7], nw: [-0.7, -0.7], se: [0.7, 0.7], sw: [-0.7, 0.7],
    u: [0.35, -1], d: [-0.35, 1], in: [-1, 0.35], out: [1, -0.35],
  };
  const SHORT = { u: '↑', d: '↓', in: 'in', out: 'out' };

  function el(tag, attrs, text) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  }

  function wrapName(name) {
    const words = (name || '?').split(/\s+/);
    const lines = [''];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (cur && (cur + ' ' + w).length > 16) lines.push(w);
      else lines[lines.length - 1] = cur ? cur + ' ' + w : w;
    }
    if (lines.length > 2) {
      lines.length = 2;
      lines[1] = lines[1].slice(0, 14) + '…';
    }
    return lines.map((l) => (l.length > 17 ? l.slice(0, 16) + '…' : l));
  }

  class MapView {
    constructor(svg, { onRoomTap } = {}) {
      this.svg = svg;
      this.onRoomTap = onRoomTap;
      this.view = { x: 0, y: 0, zoom: 1 };
      this.pointers = new Map();
      this.bindGestures();
    }

    center(room) {
      this.view.x = room ? room.x * CW : 0;
      this.view.y = room ? room.y * CH : 0;
      this.applyView();
    }

    zoomBy(factor, sx, sy) {
      const rect = this.svg.getBoundingClientRect();
      const z0 = this.view.zoom;
      const z1 = Math.max(0.25, Math.min(3, z0 * factor));
      // Keep the point under (sx, sy) fixed while zooming.
      const px = sx == null ? rect.width / 2 : sx - rect.left;
      const py = sy == null ? rect.height / 2 : sy - rect.top;
      const dx = px - rect.width / 2;
      const dy = py - rect.height / 2;
      this.view.x += dx / z0 - dx / z1;
      this.view.y += dy / z0 - dy / z1;
      this.view.zoom = z1;
      this.applyView();
    }

    applyView() {
      const rect = this.svg.getBoundingClientRect();
      const w = (rect.width || 400) / this.view.zoom;
      const h = (rect.height || 400) / this.view.zoom;
      this.svg.setAttribute('viewBox', `${this.view.x - w / 2} ${this.view.y - h / 2} ${w} ${h}`);
    }

    bindGestures() {
      const svg = this.svg;
      let moved = 0;
      let pinch = null;
      svg.addEventListener('pointerdown', (e) => {
        svg.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = 0;
        if (this.pointers.size === 2) {
          const [a, b] = [...this.pointers.values()];
          pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.view.zoom };
        }
      });
      svg.addEventListener('pointermove', (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        if (this.pointers.size === 1) {
          this.view.x -= dx / this.view.zoom;
          this.view.y -= dy / this.view.zoom;
          this.applyView();
        } else if (this.pointers.size === 2 && pinch) {
          const [a, b] = [...this.pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          this.zoomBy((pinch.zoom * dist) / pinch.dist / this.view.zoom, (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
      });
      const end = (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) pinch = null;
        if (e.type === 'pointerup' && moved < 8 && this.pointers.size === 0) {
          const hit = document.elementFromPoint(e.clientX, e.clientY);
          const room = hit && hit.closest('[data-room]');
          if (room && this.onRoomTap) this.onRoomTap(+room.dataset.room);
        }
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
        },
        { passive: false }
      );
    }

    render(map, selected) {
      const svg = this.svg;
      svg.replaceChildren();
      const defs = el('defs');
      const marker = el('marker', {
        id: 'map-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
        markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
      });
      marker.append(el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'map-arrowhead' }));
      defs.append(marker);
      svg.append(defs);

      const rooms = map.rooms;
      const pos = (r) => [r.x * CW, r.y * CH];
      const anchor = (r, dir) => {
        const [cx, cy] = pos(r);
        const a = ANCHOR[dir] || [0, 0];
        return [cx + a[0], cy + a[1]];
      };

      const lines = el('g', { class: 'map-edges' });
      const labels = el('g', { class: 'map-labels' });
      const drawn = new Set();

      for (const [key, e] of Object.entries(map.edges)) {
        const a = rooms[e.from];
        const b = rooms[e.to];
        if (!a || !b || drawn.has(key)) continue;
        drawn.add(key);

        if (!e.dir) {
          // A move without a direction ("climb tree", magic words): dashed, labelled.
          const [x1, y1] = pos(a);
          const [x2, y2] = pos(b);
          lines.append(el('path', { d: `M${x1},${y1} L${x2},${y2}`, class: 'map-edge special', 'marker-end': 'url(#map-arrow)' }));
          const label = e.label.length > 18 ? e.label.slice(0, 17) + '…' : e.label;
          labels.append(el('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, class: 'map-edge-label' }, label));
          continue;
        }

        // Pair with the way back, if that's been taken too.
        const back = AutoMap.OPPOSITE[e.dir];
        const backKey = `${e.to}>${back}`;
        const twoWay = map.edges[backKey] && map.edges[backKey].to === e.from;
        if (twoWay) drawn.add(backKey);

        const [x1, y1] = anchor(a, e.dir);
        const endDir = twoWay ? back : AutoMap.GRID[e.dir] ? back : nearestSide(b, a);
        const [x2, y2] = anchor(b, endDir);
        const h1 = HEADING[e.dir];
        const h2 = HEADING[endDir] || [0, 0];
        const k = Math.max(18, Math.min(46, Math.hypot(x2 - x1, y2 - y1) / 2.5));
        const d = `M${x1},${y1} C${x1 + h1[0] * k},${y1 + h1[1] * k} ${x2 + h2[0] * k},${y2 + h2[1] * k} ${x2},${y2}`;
        const attrs = { d, class: 'map-edge' + (SHORT[e.dir] ? ' vertical' : '') };
        if (!twoWay) attrs['marker-end'] = 'url(#map-arrow)';
        lines.append(el('path', attrs));
        if (SHORT[e.dir]) labels.append(el('text', { x: x1 + h1[0] * 14, y: y1 + h1[1] * 14 + 4, class: 'map-edge-label' }, SHORT[e.dir]));
      }

      // Stubs for exits that exist but haven't been explored.
      const stubs = el('g', { class: 'map-stubs' });
      for (const r of Object.values(rooms)) {
        if (!r.exits) continue;
        for (const dir of r.exits) {
          if (map.edges[`${r.id}>${dir}`]) continue;
          const back = AutoMap.OPPOSITE[dir];
          // Already known from the other side?
          if (Object.values(map.edges).some((e) => e.to === r.id && e.dir === back)) continue;
          const [x, y] = anchor(r, dir);
          const h = HEADING[dir];
          if (SHORT[dir]) {
            stubs.append(el('text', { x: x + h[0] * 12, y: y + h[1] * 12 + 4, class: 'map-stub-label' }, SHORT[dir]));
          } else {
            stubs.append(el('path', { d: `M${x},${y} l${h[0] * 16},${h[1] * 16}`, class: 'map-stub' }));
            stubs.append(el('circle', { cx: x + h[0] * 18, cy: y + h[1] * 18, r: 2.5, class: 'map-stub-dot' }));
          }
        }
      }

      const boxes = el('g', { class: 'map-rooms' });
      for (const r of Object.values(rooms)) {
        const [cx, cy] = pos(r);
        const cls = ['map-room'];
        if (r.id === map.current) cls.push('here');
        if (r.id === selected) cls.push('selected');
        if (r.dark) cls.push('dark');
        const g = el('g', { class: cls.join(' '), 'data-room': r.id, tabindex: '0', role: 'button', 'aria-label': r.name || 'Unknown room' });
        g.append(el('rect', { x: cx - BW / 2, y: cy - BH / 2, width: BW, height: BH, rx: 9 }));
        const names = wrapName(r.name);
        names.forEach((line, i) => {
          g.append(el('text', { x: cx, y: cy + 4 + (i - (names.length - 1) / 2) * 14 }, line));
        });
        boxes.append(g);
      }

      svg.append(lines, stubs, boxes, labels);
      this.applyView();
    }
  }

  // For one-way or displaced connections: arrive at the side facing the source.
  function nearestSide(target, source) {
    const dx = source.x - target.x;
    const dy = source.y - target.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
    return dy >= 0 ? 's' : 'n';
  }

  root.MapView = MapView;
})(window);
