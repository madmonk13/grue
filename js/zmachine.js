/*
 * A compact Z-machine interpreter (versions 1-5, 7 and 8).
 *
 * The VM runs synchronously until it needs something from the outside world
 * (a line of input, a keypress, a save/restore decision) and then returns.
 * The host inspects `vm.waiting`, gathers what is needed, and calls one of
 * the `submit*` / `finish*` methods, which resume execution.
 */
(function (root) {
  'use strict';

  const A0 = 'abcdefghijklmnopqrstuvwxyz';
  const A1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // Index 0 is the ZSCII escape and index 1 is newline (never looked up directly).
  const A2 = ' \n0123456789.,!?_#\'"/\\-:()';
  const A2_V1 = ' 0123456789.,!?_#\'"/\\<-:()';

  // ZSCII 155-223 default translation table (Z-machine standard 3.8.5.3).
  const DEFAULT_UNICODE = [
    0xe4, 0xf6, 0xfc, 0xc4, 0xd6, 0xdc, 0xdf, 0xbb, 0xab, 0xeb, 0xef, 0xff, 0xcb, 0xcf,
    0xe1, 0xe9, 0xed, 0xf3, 0xfa, 0xfd, 0xc1, 0xc9, 0xcd, 0xd3, 0xda, 0xdd, 0xe0, 0xe8,
    0xec, 0xf2, 0xf9, 0xc0, 0xc8, 0xcc, 0xd2, 0xd9, 0xe2, 0xea, 0xee, 0xf4, 0xfb, 0xc2,
    0xca, 0xce, 0xd4, 0xdb, 0xe5, 0xc5, 0xf8, 0xd8, 0xe3, 0xf1, 0xf5, 0xc3, 0xd1, 0xd5,
    0xe6, 0xc6, 0xe7, 0xc7, 0xfe, 0xf0, 0xde, 0xd0, 0xa3, 0x153, 0x152, 0xa1, 0xbf,
  ];

  const STYLE_REVERSE = 1, STYLE_BOLD = 2, STYLE_ITALIC = 4, STYLE_FIXED = 8;

  const s16 = (x) => (x << 16) >> 16;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class ZMachineError extends Error {}

  class ZMachine {
    /**
     * @param {Uint8Array} story  raw story file bytes
     * @param {object} io         { print(text, style), clear(), quit(), screenWidth }
     */
    constructor(story, io) {
      this.original = new Uint8Array(story);
      this.io = io || {};
      this.version = this.original[0];
      if (![1, 2, 3, 4, 5, 7, 8].includes(this.version)) {
        throw new ZMachineError(
          this.version === 6
            ? 'Version 6 (graphical) games are not supported.'
            : 'This does not look like a Z-machine story file.'
        );
      }
      this.screenWidth = Math.max(30, Math.min(255, io.screenWidth || 60));
      this.undoStack = [];
      this.operands = new Array(8);
      this.reset();
    }

    /* ------------------------------------------------------------------ */
    /* Setup                                                              */
    /* ------------------------------------------------------------------ */

    reset() {
      const keepFlags2 = this.mem ? this.getWord(0x10) & 0x3 : 0;
      this.mem = new Uint8Array(this.original);
      const m = this.mem;
      const v = this.version;

      this.staticBase = this.getWord(0x0e);
      this.globals = this.getWord(0x0c);
      this.objectTable = this.getWord(0x0a);
      this.abbrevTable = this.getWord(0x18);
      this.dictAddr = this.getWord(0x08);
      this.routineOffset = this.getWord(0x28) * 8;
      this.stringOffset = this.getWord(0x2a) * 8;
      this.objEntrySize = v <= 3 ? 9 : 14;
      this.objPropDefaults = v <= 3 ? 31 : 63;

      this.buildAlphabets();
      this.buildUnicodeTable();

      this.setupHeader();
      this.setWord(0x10, (this.getWord(0x10) & ~0x3) | keepFlags2);

      this.stack = [];
      this.frames = [{ locals: [], retPC: 0, storeVar: -1, stackBase: 0, argCount: 0 }];
      this.pc = this.getWord(0x06);

      this.halted = false;
      this.waiting = null;
      this.style = 0;
      this.font = 1;
      this.curWin = 0;
      this.upperHeight = 0;
      this.upper = [];
      this.upperRow = 0;
      this.upperCol = 0;
      this.stream1 = true;
      this.stream3 = [];
      this.seedRandom(0);
      this.dict = null;
      this.dictCache = new Map();
    }

    setupHeader() {
      const m = this.mem;
      const v = this.version;
      if (v <= 3) {
        // status line available (bit 4 clear), screen splitting available (bit 5)
        m[0x01] = (m[0x01] & ~0x10) | 0x20;
      } else {
        // bold, italic, fixed-pitch available; no colours, sound or timed input
        m[0x01] = (m[0x01] & ~(0x01 | 0x02 | 0x20 | 0x80)) | 0x1c;
      }
      m[0x1e] = 6; // interpreter number (IBM PC)
      m[0x1f] = 'G'.charCodeAt(0);
      m[0x20] = 255; // screen height (infinite)
      m[0x21] = this.screenWidth;
      if (v >= 5) {
        this.setWord(0x22, this.screenWidth);
        this.setWord(0x24, 255);
        m[0x26] = 1;
        m[0x27] = 1;
        m[0x2c] = 1; // default colours
        m[0x2d] = 1;
      }
      m[0x32] = 1; // standard revision 1.1
      m[0x33] = 1;
      // flags 2: we do not provide pictures, mouse, colours, sound or menus
      let f2 = this.getWord(0x10);
      f2 &= ~((1 << 3) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8));
      if (v < 5) f2 &= ~(1 << 4);
      this.setWord(0x10, f2);
    }

    buildAlphabets() {
      const v = this.version;
      const custom = v >= 5 ? this.getWord(0x34) : 0;
      if (custom) {
        this.alphabets = [0, 1, 2].map((a) => {
          const chars = [];
          for (let i = 0; i < 26; i++) chars.push(this.zsciiToChar(this.mem[custom + a * 26 + i]));
          return chars;
        });
        this.alphabets[2][0] = ' ';
        this.alphabets[2][1] = '\n';
      } else {
        this.alphabets = [A0.split(''), A1.split(''), (v === 1 ? A2_V1 : A2).split('')];
      }
    }

    buildUnicodeTable() {
      this.unicodeTable = DEFAULT_UNICODE.slice();
      if (this.version >= 5) {
        const ext = this.getWord(0x36);
        if (ext && this.getWord(ext) >= 3) {
          const t = this.getWord(ext + 6);
          if (t) {
            const n = this.mem[t];
            this.unicodeTable = [];
            for (let i = 0; i < n; i++) this.unicodeTable.push(this.getWord(t + 1 + i * 2));
          }
        }
      }
      this.unicodeReverse = new Map();
      this.unicodeTable.forEach((u, i) => this.unicodeReverse.set(u, 155 + i));
    }

    /* ------------------------------------------------------------------ */
    /* Memory                                                             */
    /* ------------------------------------------------------------------ */

    getWord(a) {
      return (this.mem[a] << 8) | this.mem[a + 1];
    }
    setWord(a, v) {
      this.mem[a] = (v >> 8) & 0xff;
      this.mem[a + 1] = v & 0xff;
    }
    setByte(a, v) {
      this.mem[a] = v & 0xff;
    }

    unpackRoutine(p) {
      const v = this.version;
      if (v <= 3) return p * 2;
      if (v <= 5) return p * 4;
      if (v === 8) return p * 8;
      return p * 4 + this.routineOffset;
    }
    unpackString(p) {
      const v = this.version;
      if (v <= 3) return p * 2;
      if (v <= 5) return p * 4;
      if (v === 8) return p * 8;
      return p * 4 + this.stringOffset;
    }

    /* ------------------------------------------------------------------ */
    /* Variables & stack                                                  */
    /* ------------------------------------------------------------------ */

    get frame() {
      return this.frames[this.frames.length - 1];
    }

    readVar(n) {
      if (n === 0) {
        if (this.stack.length <= this.frame.stackBase) throw new ZMachineError('Stack underflow');
        return this.stack.pop();
      }
      if (n < 16) return this.frame.locals[n - 1];
      return this.getWord(this.globals + 2 * (n - 16));
    }
    writeVar(n, val) {
      val &= 0xffff;
      if (n === 0) this.stack.push(val);
      else if (n < 16) this.frame.locals[n - 1] = val;
      else this.setWord(this.globals + 2 * (n - 16), val);
    }
    // "Indirect" variable access: variable 0 means the top of stack, in place.
    peekVar(n) {
      if (n === 0) return this.stack[this.stack.length - 1];
      return this.readVar(n);
    }
    pokeVar(n, val) {
      if (n === 0) this.stack[this.stack.length - 1] = val & 0xffff;
      else this.writeVar(n, val);
    }

    store(val) {
      this.writeVar(this.mem[this.pc++], val);
    }

    branch(cond) {
      const b = this.mem[this.pc++];
      let off;
      if (b & 0x40) off = b & 0x3f;
      else {
        off = ((b & 0x3f) << 8) | this.mem[this.pc++];
        if (off & 0x2000) off -= 0x4000;
      }
      if (!!cond === !!(b & 0x80)) {
        if (off === 0) this.ret(0);
        else if (off === 1) this.ret(1);
        else this.pc += off - 2;
      }
    }

    call(packed, args, storeVar) {
      if (packed === 0) {
        if (storeVar >= 0) this.writeVar(storeVar, 0);
        return;
      }
      const a = this.unpackRoutine(packed);
      const n = this.mem[a];
      let p = a + 1;
      const locals = new Array(n);
      for (let i = 0; i < n; i++) {
        if (this.version <= 4) {
          locals[i] = this.getWord(p);
          p += 2;
        } else locals[i] = 0;
      }
      const argc = Math.min(args.length, n);
      for (let i = 0; i < argc; i++) locals[i] = args[i];
      this.frames.push({
        locals,
        retPC: this.pc,
        storeVar,
        stackBase: this.stack.length,
        argCount: args.length,
      });
      this.pc = p;
    }

    ret(val) {
      const f = this.frames.pop();
      if (!this.frames.length) throw new ZMachineError('Returned from main routine');
      this.stack.length = f.stackBase;
      this.pc = f.retPC;
      if (f.storeVar >= 0) this.writeVar(f.storeVar, val);
    }

    /* ------------------------------------------------------------------ */
    /* Text                                                               */
    /* ------------------------------------------------------------------ */

    zsciiToChar(c) {
      if (c === 13) return '\n';
      if (c >= 32 && c <= 126) return String.fromCharCode(c);
      if (c >= 155 && c - 155 < this.unicodeTable.length)
        return String.fromCharCode(this.unicodeTable[c - 155]);
      if (c === 0) return '';
      return '?';
    }

    charToZscii(ch) {
      const u = ch.charCodeAt(0);
      if (u === 10 || u === 13) return 13;
      if (u >= 32 && u <= 126) return u;
      return this.unicodeReverse.get(u) || 63; // '?'
    }

    readZChars(addr) {
      const zs = [];
      let a = addr;
      for (;;) {
        const w = this.getWord(a);
        a += 2;
        zs.push((w >> 10) & 31, (w >> 5) & 31, w & 31);
        if (w & 0x8000 || a >= this.mem.length) break;
      }
      return { zs, end: a };
    }

    decodeText(addr) {
      const { zs, end } = this.readZChars(addr);
      return { text: this.zcharsToText(zs, 0), end };
    }

    zcharsToText(zs, depth) {
      const v = this.version;
      let out = '';
      let alpha = 0;
      let lock = 0;
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z === 0) {
          out += ' ';
          alpha = lock;
          continue;
        }
        if (v === 1 && z === 1) {
          out += '\n';
          alpha = lock;
          continue;
        }
        if (z >= 1 && z <= 3 && (v >= 3 || (v === 2 && z === 1))) {
          if (i + 1 >= zs.length) break;
          const idx = 32 * (z - 1) + zs[++i];
          if (depth === 0) {
            const a = this.getWord(this.abbrevTable + 2 * idx) * 2;
            out += this.zcharsToText(this.readZChars(a).zs, 1);
          }
          alpha = lock;
          continue;
        }
        if (v <= 2 && z >= 2 && z <= 5) {
          const shift = z === 2 || z === 4 ? 1 : 2;
          const next = (lock + shift) % 3;
          if (z >= 4) lock = next;
          alpha = next;
          continue;
        }
        if (z === 4) {
          alpha = 1;
          continue;
        }
        if (z === 5) {
          alpha = 2;
          continue;
        }
        if (alpha === 2 && z === 6) {
          if (i + 2 >= zs.length) break;
          const code = (zs[i + 1] << 5) | zs[i + 2];
          i += 2;
          out += this.zsciiToChar(code);
          alpha = lock;
          continue;
        }
        if (alpha === 2 && z === 7 && v >= 2) out += '\n';
        else out += this.alphabets[alpha][z - 6];
        alpha = lock;
      }
      return out;
    }

    // Encode a (lower-case) word into dictionary form: an array of 4 or 6 bytes.
    encodeZscii(codes) {
      const n = this.version <= 3 ? 6 : 9;
      const zs = [];
      for (const c of codes) {
        if (zs.length >= n) break;
        const ch = this.zsciiToChar(c);
        let i = this.alphabets[0].indexOf(ch);
        if (i >= 0) {
          zs.push(i + 6);
          continue;
        }
        i = this.alphabets[2].indexOf(ch, 2);
        if (i >= 2 && ch !== '\n') {
          zs.push(5, i + 6);
          continue;
        }
        zs.push(5, 6, (c >> 5) & 31, c & 31);
      }
      while (zs.length < n) zs.push(5);
      zs.length = n;
      const bytes = [];
      for (let i = 0; i < n; i += 3) {
        let w = (zs[i] << 10) | (zs[i + 1] << 5) | zs[i + 2];
        if (i + 3 >= n) w |= 0x8000;
        bytes.push(w >> 8, w & 0xff);
      }
      return bytes;
    }

    /* ------------------------------------------------------------------ */
    /* Output                                                             */
    /* ------------------------------------------------------------------ */

    print(text) {
      if (!text) return;
      if (this.stream3.length) {
        const t = this.stream3[this.stream3.length - 1];
        for (const ch of text) {
          this.mem[t.addr + 2 + t.len] = this.charToZscii(ch);
          t.len++;
        }
        return;
      }
      if (!this.stream1) return;
      if (this.curWin === 1) this.printUpper(text);
      else if (this.io.print) this.io.print(text, this.style);
    }

    printUpper(text) {
      for (const ch of text) {
        if (ch === '\n') {
          this.upperRow++;
          this.upperCol = 0;
          continue;
        }
        if (this.upperRow < this.upperHeight && this.upperCol < this.screenWidth) {
          this.upper[this.upperRow][this.upperCol] = { c: ch, s: this.style };
        }
        this.upperCol++;
      }
    }

    blankRow() {
      const row = new Array(this.screenWidth);
      for (let i = 0; i < row.length; i++) row[i] = { c: ' ', s: 0 };
      return row;
    }

    splitWindow(lines) {
      this.upperHeight = lines;
      while (this.upper.length < lines) this.upper.push(this.blankRow());
      this.upper.length = lines;
      if (this.version === 3) for (let i = 0; i < lines; i++) this.upper[i] = this.blankRow();
      if (this.upperRow >= lines) {
        this.upperRow = 0;
        this.upperCol = 0;
      }
    }

    eraseWindow(w) {
      w = s16(w);
      if (w === -1) {
        this.splitWindow(0);
        this.curWin = 0;
      }
      if (w === -1 || w === -2 || w === 1) {
        for (let i = 0; i < this.upperHeight; i++) this.upper[i] = this.blankRow();
        this.upperRow = 0;
        this.upperCol = 0;
      }
      if ((w === -1 || w === -2 || w === 0) && this.io.clear) this.io.clear();
    }

    /* ------------------------------------------------------------------ */
    /* Objects                                                            */
    /* ------------------------------------------------------------------ */

    objAddr(o) {
      return this.objectTable + this.objPropDefaults * 2 + (o - 1) * this.objEntrySize;
    }
    objParent(o) {
      if (!o) return 0;
      const a = this.objAddr(o);
      return this.version <= 3 ? this.mem[a + 4] : this.getWord(a + 6);
    }
    objSibling(o) {
      if (!o) return 0;
      const a = this.objAddr(o);
      return this.version <= 3 ? this.mem[a + 5] : this.getWord(a + 8);
    }
    objChild(o) {
      if (!o) return 0;
      const a = this.objAddr(o);
      return this.version <= 3 ? this.mem[a + 6] : this.getWord(a + 10);
    }
    setParent(o, v) {
      const a = this.objAddr(o);
      if (this.version <= 3) this.mem[a + 4] = v;
      else this.setWord(a + 6, v);
    }
    setSibling(o, v) {
      const a = this.objAddr(o);
      if (this.version <= 3) this.mem[a + 5] = v;
      else this.setWord(a + 8, v);
    }
    setChild(o, v) {
      const a = this.objAddr(o);
      if (this.version <= 3) this.mem[a + 6] = v;
      else this.setWord(a + 10, v);
    }
    propTable(o) {
      return this.getWord(this.objAddr(o) + (this.version <= 3 ? 7 : 12));
    }

    objName(o) {
      if (!o) return '';
      const p = this.propTable(o);
      if (!this.mem[p]) return '';
      return this.decodeText(p + 1).text;
    }

    objCount() {
      // The object table has no explicit length; the first property table
      // conventionally follows the last object entry.
      let lowest = 0xffff;
      let n = 0;
      for (let o = 1; o < 0xffff; o++) {
        const a = this.objAddr(o);
        if (a >= lowest || a + this.objEntrySize > this.mem.length) break;
        const p = this.propTable(o);
        if (p && p < lowest) lowest = p;
        n = o;
      }
      return n;
    }

    testAttr(o, attr) {
      if (!o) return false;
      const a = this.objAddr(o) + (attr >> 3);
      return (this.mem[a] & (0x80 >> (attr & 7))) !== 0;
    }
    setAttr(o, attr, on) {
      if (!o) return;
      const a = this.objAddr(o) + (attr >> 3);
      const bit = 0x80 >> (attr & 7);
      if (on) this.mem[a] |= bit;
      else this.mem[a] &= ~bit;
    }

    removeObj(o) {
      const p = this.objParent(o);
      if (!p) return;
      const first = this.objChild(p);
      if (first === o) this.setChild(p, this.objSibling(o));
      else {
        let c = first;
        while (c) {
          const next = this.objSibling(c);
          if (next === o) {
            this.setSibling(c, this.objSibling(o));
            break;
          }
          c = next;
        }
      }
      this.setParent(o, 0);
      this.setSibling(o, 0);
    }

    insertObj(o, dest) {
      if (!o) return;
      this.removeObj(o);
      this.setParent(o, dest);
      this.setSibling(o, this.objChild(dest));
      this.setChild(dest, o);
    }

    // Returns { num, size, data } for each property of an object.
    firstPropAddr(o) {
      const p = this.propTable(o);
      return p + 1 + this.mem[p] * 2;
    }
    propInfo(a) {
      const b = this.mem[a];
      if (this.version <= 3) {
        if (!b) return null;
        return { num: b & 31, size: (b >> 5) + 1, data: a + 1 };
      }
      if (!b) return null;
      if (b & 0x80) {
        let size = this.mem[a + 1] & 63;
        if (size === 0) size = 64;
        return { num: b & 63, size, data: a + 2 };
      }
      return { num: b & 63, size: b & 0x40 ? 2 : 1, data: a + 1 };
    }
    findProp(o, num) {
      if (!o) return null;
      let a = this.firstPropAddr(o);
      for (;;) {
        const info = this.propInfo(a);
        if (!info || info.num < num) return null;
        if (info.num === num) return info;
        a = info.data + info.size;
      }
    }
    getProp(o, num) {
      const info = this.findProp(o, num);
      if (!info) return this.getWord(this.objectTable + 2 * (num - 1));
      return info.size === 1 ? this.mem[info.data] : this.getWord(info.data);
    }
    propLen(dataAddr) {
      if (!dataAddr) return 0;
      const b = this.mem[dataAddr - 1];
      if (this.version <= 3) return (b >> 5) + 1;
      if (b & 0x80) return b & 63 || 64;
      return b & 0x40 ? 2 : 1;
    }

    /* ------------------------------------------------------------------ */
    /* Dictionary & input                                                 */
    /* ------------------------------------------------------------------ */

    parseDict(addr) {
      if (this.dictCache.has(addr)) return this.dictCache.get(addr);
      const nsep = this.mem[addr];
      const seps = [];
      for (let i = 0; i < nsep; i++) seps.push(this.mem[addr + 1 + i]);
      const entryLen = this.mem[addr + 1 + nsep];
      const count = s16(this.getWord(addr + 2 + nsep));
      const start = addr + 4 + nsep;
      const keyLen = this.version <= 3 ? 4 : 6;
      const index = new Map();
      for (let i = 0; i < Math.abs(count); i++) {
        const e = start + i * entryLen;
        let key = '';
        for (let k = 0; k < keyLen; k++) key += String.fromCharCode(this.mem[e + k]);
        if (!index.has(key)) index.set(key, e);
      }
      const d = { seps, entryLen, count: Math.abs(count), start, index };
      this.dictCache.set(addr, d);
      return d;
    }

    lookupCodes(codes, dictAddr) {
      const d = this.parseDict(dictAddr || this.dictAddr);
      const bytes = this.encodeZscii(codes);
      return d.index.get(String.fromCharCode(...bytes)) || 0;
    }

    /** Dictionary address of a word, or 0 if the game does not know it. */
    lookupWord(word) {
      const codes = [];
      for (const ch of word.toLowerCase()) codes.push(this.charToZscii(ch));
      return this.lookupCodes(codes);
    }

    /** All dictionary entries as { word, addr, flags }. */
    dictionaryEntries() {
      const d = this.parseDict(this.dictAddr);
      const words = this.version <= 3 ? 2 : 3;
      const out = [];
      for (let i = 0; i < d.count; i++) {
        const e = d.start + i * d.entryLen;
        const zs = [];
        for (let k = 0; k < words; k++) {
          const w = this.getWord(e + k * 2);
          zs.push((w >> 10) & 31, (w >> 5) & 31, w & 31);
        }
        const data = [];
        for (let k = words * 2; k < d.entryLen; k++) data.push(this.mem[e + k]);
        out.push({ word: this.zcharsToText(zs, 1).trim(), addr: e, data });
      }
      return out;
    }

    tokenise(text, parse, dictAddr, flag) {
      const d = this.parseDict(dictAddr || this.dictAddr);
      const v = this.version;
      const codes = [];
      const base = v >= 5 ? 2 : 1;
      if (v >= 5) {
        const n = this.mem[text + 1];
        for (let i = 0; i < n; i++) codes.push(this.mem[text + 2 + i]);
      } else {
        for (let i = 1; text + i < this.mem.length && this.mem[text + i]; i++) codes.push(this.mem[text + i]);
      }
      const words = [];
      let start = -1;
      for (let i = 0; i <= codes.length; i++) {
        const c = i < codes.length ? codes[i] : 32;
        const isSep = d.seps.includes(c);
        if (c === 32 || isSep) {
          if (start >= 0) {
            words.push({ start, codes: codes.slice(start, i) });
            start = -1;
          }
          if (isSep) words.push({ start: i, codes: [c] });
        } else if (start < 0) start = i;
      }
      const max = this.mem[parse];
      const n = Math.min(max, words.length);
      this.mem[parse + 1] = n;
      for (let i = 0; i < n; i++) {
        const w = words[i];
        const addr = this.lookupCodes(w.codes, dictAddr);
        if (flag && !addr) continue;
        const e = parse + 2 + i * 4;
        this.setWord(e, addr);
        this.mem[e + 2] = w.codes.length;
        this.mem[e + 3] = w.start + base;
      }
    }

    /** Provide a line of input to a pending read. */
    submitLine(line) {
      const w = this.waiting;
      if (!w || w.type !== 'line') return;
      this.waiting = null;
      const v = this.version;
      const codes = [];
      for (const ch of line.toLowerCase()) {
        const c = this.charToZscii(ch);
        if (c !== 13) codes.push(c);
      }
      const text = w.text;
      if (v >= 5) {
        const max = this.mem[text];
        const already = Math.min(this.mem[text + 1], max);
        const n = Math.min(codes.length, max - already);
        for (let i = 0; i < n; i++) this.mem[text + 2 + already + i] = codes[i];
        this.mem[text + 1] = already + n;
      } else {
        const max = Math.max(0, this.mem[text] - 1);
        const n = Math.min(codes.length, max);
        for (let i = 0; i < n; i++) this.mem[text + 1 + i] = codes[i];
        this.mem[text + 1 + n] = 0;
      }
      if (w.parse) this.tokenise(text, w.parse, 0, false);
      if (v >= 5) this.store(13);
      return this.run();
    }

    /** Provide a single keypress (ZSCII code) to a pending read_char. */
    submitChar(code) {
      if (!this.waiting || this.waiting.type !== 'char') return;
      this.waiting = null;
      this.store(code);
      return this.run();
    }

    /* ------------------------------------------------------------------ */
    /* Save / restore / undo                                              */
    /* ------------------------------------------------------------------ */

    snapshot() {
      return {
        mem: this.mem.slice(0, this.staticBase),
        stack: this.stack.slice(),
        frames: this.frames.map((f) => ({ ...f, locals: f.locals.slice() })),
        pc: this.pc,
      };
    }

    loadSnapshot(s) {
      this.mem.set(s.mem, 0);
      this.stack = s.stack.slice();
      this.frames = s.frames.map((f) => ({ ...f, locals: f.locals.slice() }));
      this.pc = s.pc;
      this.dictCache = new Map();
      this.setupHeader();
    }

    /** Called after a save opcode paused the VM. */
    finishSave(ok) {
      if (!this.waiting || this.waiting.type !== 'save') return;
      this.waiting = null;
      if (this.version <= 3) this.branch(ok);
      else this.store(ok ? 1 : 0);
      return this.run();
    }

    /** Called after a restore opcode paused the VM; pass a snapshot or null. */
    finishRestore(snap) {
      if (!this.waiting || this.waiting.type !== 'restore') return;
      this.waiting = null;
      if (snap) {
        this.loadSnapshot(snap);
        if (this.version <= 3) this.branch(true);
        else this.store(2);
      } else if (this.version <= 3) this.branch(false);
      else this.store(0);
      return this.run();
    }

    static serialize(snap) {
      let bin = '';
      for (let i = 0; i < snap.mem.length; i++) bin += String.fromCharCode(snap.mem[i]);
      return { mem: btoa(bin), stack: snap.stack, frames: snap.frames, pc: snap.pc };
    }
    static deserialize(o) {
      const bin = atob(o.mem);
      const mem = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) mem[i] = bin.charCodeAt(i);
      return { mem, stack: o.stack, frames: o.frames, pc: o.pc };
    }

    /* ------------------------------------------------------------------ */
    /* Misc helpers for the host                                          */
    /* ------------------------------------------------------------------ */

    get gameId() {
      let serial = '';
      for (let i = 0; i < 6; i++) serial += String.fromCharCode(this.original[0x12 + i]);
      const release = (this.original[2] << 8) | this.original[3];
      const checksum = (this.original[0x1c] << 8) | this.original[0x1d];
      return `${release}-${serial.replace(/[^0-9A-Za-z]/g, '_')}-${checksum.toString(16)}`;
    }

    global(n) {
      return this.getWord(this.globals + 2 * n);
    }

    /** Status line information (meaningful for version 1-3 games). */
    statusInfo() {
      const loc = this.global(0);
      const isTime = this.version === 3 && (this.mem[1] & 0x02) !== 0;
      return {
        location: this.objName(loc),
        locationObj: loc,
        isTime,
        a: s16(this.global(1)),
        b: this.global(2),
      };
    }

    seedRandom(seed) {
      if (seed) {
        this.rng = seed < 1000 ? null : mulberry32(seed);
        this.seqMax = seed;
        this.seqNext = 1;
      } else {
        this.rng = mulberry32((Math.random() * 0xffffffff) >>> 0);
      }
    }
    random(range) {
      if (!this.rng) {
        const r = this.seqNext;
        this.seqNext = (this.seqNext % this.seqMax) + 1;
        return ((r - 1) % range) + 1;
      }
      return 1 + Math.floor(this.rng() * range);
    }

    verifyChecksum() {
      const v = this.version;
      const scale = v <= 3 ? 2 : v <= 5 ? 4 : 8;
      const len = Math.min(this.original.length, ((this.original[0x1a] << 8) | this.original[0x1b]) * scale);
      let sum = 0;
      for (let i = 0x40; i < len; i++) sum = (sum + this.original[i]) & 0xffff;
      return sum === ((this.original[0x1c] << 8) | this.original[0x1d]);
    }

    /* ------------------------------------------------------------------ */
    /* Execution                                                          */
    /* ------------------------------------------------------------------ */

    run() {
      try {
        let budget = 5e7;
        while (!this.waiting && !this.halted) {
          this.step();
          if (--budget === 0) throw new ZMachineError('The game seems to be stuck in a loop.');
        }
      } catch (e) {
        this.halted = true;
        this.error = e;
        if (this.io.error) this.io.error(e);
        else throw e;
      }
      return this.waiting;
    }

    readOperand(type) {
      const m = this.mem;
      switch (type) {
        case 0:
          this.pc += 2;
          return (m[this.pc - 2] << 8) | m[this.pc - 1];
        case 1:
          return m[this.pc++];
        case 2:
          return this.readVar(m[this.pc++]);
      }
      return undefined;
    }

    readVarOperands(ops, typesBytes) {
      let n = 0;
      for (const tb of typesBytes) {
        for (let shift = 6; shift >= 0; shift -= 2) {
          const t = (tb >> shift) & 3;
          if (t === 3) return n;
          ops[n++] = this.readOperand(t);
        }
      }
      return n;
    }

    step() {
      const m = this.mem;
      const ops = this.operands;
      const startPC = this.pc;
      let op = m[this.pc++];
      let form, opnum, count;

      if (op === 0xbe && this.version >= 5) {
        opnum = m[this.pc++];
        const tb = m[this.pc++];
        count = this.readVarOperands(ops, [tb]);
        return this.execExt(opnum, ops, count, startPC);
      }

      if ((op & 0xc0) === 0xc0) {
        opnum = op & 0x1f;
        form = op & 0x20 ? 'VAR' : '2OP';
        if (form === 'VAR' && (opnum === 0x0c || opnum === 0x1a)) {
          const t1 = m[this.pc++];
          const t2 = m[this.pc++];
          count = this.readVarOperands(ops, [t1, t2]);
        } else {
          count = this.readVarOperands(ops, [m[this.pc++]]);
        }
      } else if ((op & 0xc0) === 0x80) {
        const t = (op >> 4) & 3;
        opnum = op & 0x0f;
        if (t === 3) {
          form = '0OP';
          count = 0;
        } else {
          form = '1OP';
          ops[0] = this.readOperand(t);
          count = 1;
        }
      } else {
        form = '2OP';
        opnum = op & 0x1f;
        ops[0] = this.readOperand(op & 0x40 ? 2 : 1);
        ops[1] = this.readOperand(op & 0x20 ? 2 : 1);
        count = 2;
      }

      switch (form) {
        case '2OP':
          return this.exec2(opnum, ops, count, startPC);
        case '1OP':
          return this.exec1(opnum, ops[0], startPC);
        case '0OP':
          return this.exec0(opnum, startPC);
        default:
          return this.execVar(opnum, ops, count, startPC);
      }
    }

    illegal(kind, n, pc) {
      throw new ZMachineError(`Illegal ${kind} opcode ${n} at ${pc.toString(16)}`);
    }

    exec2(n, o, count, pc) {
      const v = this.version;
      switch (n) {
        case 1: {
          // je
          let eq = false;
          for (let i = 1; i < count; i++) if (o[0] === o[i]) eq = true;
          return this.branch(eq);
        }
        case 2:
          return this.branch(s16(o[0]) < s16(o[1]));
        case 3:
          return this.branch(s16(o[0]) > s16(o[1]));
        case 4: {
          const val = s16(this.peekVar(o[0])) - 1;
          this.pokeVar(o[0], val);
          return this.branch(s16(val) < s16(o[1]));
        }
        case 5: {
          const val = s16(this.peekVar(o[0])) + 1;
          this.pokeVar(o[0], val);
          return this.branch(s16(val) > s16(o[1]));
        }
        case 6:
          return this.branch(this.objParent(o[0]) === o[1]);
        case 7:
          return this.branch((o[0] & o[1]) === o[1]);
        case 8:
          return this.store(o[0] | o[1]);
        case 9:
          return this.store(o[0] & o[1]);
        case 10:
          return this.branch(this.testAttr(o[0], o[1]));
        case 11:
          return this.setAttr(o[0], o[1], true);
        case 12:
          return this.setAttr(o[0], o[1], false);
        case 13:
          return this.pokeVar(o[0], o[1]);
        case 14:
          return this.insertObj(o[0], o[1]);
        case 15:
          return this.store(this.getWord((o[0] + 2 * s16(o[1])) & 0xffff));
        case 16:
          return this.store(this.mem[(o[0] + s16(o[1])) & 0xffff]);
        case 17:
          return this.store(this.getProp(o[0], o[1]));
        case 18: {
          const info = this.findProp(o[0], o[1]);
          return this.store(info ? info.data : 0);
        }
        case 19: {
          let next = 0;
          if (o[0]) {
            if (o[1] === 0) {
              const info = this.propInfo(this.firstPropAddr(o[0]));
              next = info ? info.num : 0;
            } else {
              const info = this.findProp(o[0], o[1]);
              if (!info) throw new ZMachineError('get_next_prop on missing property');
              const after = this.propInfo(info.data + info.size);
              next = after ? after.num : 0;
            }
          }
          return this.store(next);
        }
        case 20:
          return this.store(s16(o[0]) + s16(o[1]));
        case 21:
          return this.store(s16(o[0]) - s16(o[1]));
        case 22:
          return this.store(Math.imul(s16(o[0]), s16(o[1])));
        case 23:
          if (s16(o[1]) === 0) throw new ZMachineError('Division by zero');
          return this.store(Math.trunc(s16(o[0]) / s16(o[1])));
        case 24:
          if (s16(o[1]) === 0) throw new ZMachineError('Division by zero');
          return this.store(s16(o[0]) % s16(o[1]));
        case 25:
          if (v >= 4) return this.call(o[0], [o[1]], this.mem[this.pc++]);
          break;
        case 26:
          if (v >= 5) return this.call(o[0], [o[1]], -1);
          break;
        case 27:
          if (v >= 5) return; // set_colour: themes own the colours
          break;
        case 28:
          if (v >= 5) {
            this.frames.length = Math.max(1, o[1]);
            return this.ret(o[0]);
          }
          break;
      }
      this.illegal('2OP', n, pc);
    }

    exec1(n, a, pc) {
      const v = this.version;
      switch (n) {
        case 0:
          return this.branch(a === 0);
        case 1: {
          const s = this.objSibling(a);
          this.store(s);
          return this.branch(s !== 0);
        }
        case 2: {
          const c = this.objChild(a);
          this.store(c);
          return this.branch(c !== 0);
        }
        case 3:
          return this.store(this.objParent(a));
        case 4:
          return this.store(this.propLen(a));
        case 5:
          return this.pokeVar(a, s16(this.peekVar(a)) + 1);
        case 6:
          return this.pokeVar(a, s16(this.peekVar(a)) - 1);
        case 7:
          return this.print(this.decodeText(a).text);
        case 8:
          if (v >= 4) return this.call(a, [], this.mem[this.pc++]);
          break;
        case 9:
          return this.removeObj(a);
        case 10:
          return this.print(this.objName(a));
        case 11:
          return this.ret(a);
        case 12:
          this.pc += s16(a) - 2;
          return;
        case 13:
          return this.print(this.decodeText(this.unpackString(a)).text);
        case 14:
          return this.store(this.peekVar(a));
        case 15:
          if (v <= 4) return this.store(~a & 0xffff);
          return this.call(a, [], -1);
      }
      this.illegal('1OP', n, pc);
    }

    exec0(n, pc) {
      const v = this.version;
      switch (n) {
        case 0:
          return this.ret(1);
        case 1:
          return this.ret(0);
        case 2: {
          const { text, end } = this.decodeText(this.pc);
          this.pc = end;
          return this.print(text);
        }
        case 3: {
          const { text, end } = this.decodeText(this.pc);
          this.pc = end;
          this.print(text + '\n');
          return this.ret(1);
        }
        case 4:
          return;
        case 5:
          if (v <= 4) {
            this.waiting = { type: 'save' };
            return;
          }
          break;
        case 6:
          if (v <= 4) {
            this.waiting = { type: 'restore' };
            return;
          }
          break;
        case 7:
          this.reset();
          if (this.io.clear) this.io.clear();
          return;
        case 8:
          return this.ret(this.readVar(0));
        case 9:
          if (v <= 4) {
            this.readVar(0);
            return;
          }
          return this.store(this.frames.length);
        case 10:
          this.halted = true;
          if (this.io.quit) this.io.quit();
          return;
        case 11:
          return this.print('\n');
        case 12:
          if (this.io.status) this.io.status();
          return;
        case 13:
          return this.branch(this.verifyChecksum());
        case 15:
          return this.branch(true);
      }
      this.illegal('0OP', n, pc);
    }

    execVar(n, o, count, pc) {
      const v = this.version;
      switch (n) {
        case 0:
          return this.call(o[0], o.slice(1, count), this.mem[this.pc++]);
        case 1:
          return this.setWord((o[0] + 2 * s16(o[1])) & 0xffff, o[2]);
        case 2:
          return this.setByte((o[0] + s16(o[1])) & 0xffff, o[2]);
        case 3: {
          const info = this.findProp(o[0], o[1]);
          if (!info) throw new ZMachineError(`put_prop: object ${o[0]} lacks property ${o[1]}`);
          if (info.size === 1) this.mem[info.data] = o[2] & 0xff;
          else this.setWord(info.data, o[2]);
          return;
        }
        case 4:
          if (v <= 3 && this.io.status) this.io.status();
          this.waiting = { type: 'line', text: o[0], parse: count > 1 ? o[1] : 0 };
          return;
        case 5:
          return this.print(this.zsciiToChar(o[0]));
        case 6:
          return this.print(String(s16(o[0])));
        case 7: {
          const r = s16(o[0]);
          if (r > 0) return this.store(this.random(r));
          this.seedRandom(-r);
          return this.store(0);
        }
        case 8:
          return this.writeVar(0, o[0]);
        case 9: {
          const val = this.readVar(0);
          return this.pokeVar(o[0], val);
        }
        case 10:
          return this.splitWindow(o[0]);
        case 11:
          this.curWin = o[0] & 1;
          if (this.curWin === 1) {
            this.upperRow = 0;
            this.upperCol = 0;
          }
          return;
        case 12:
          return this.call(o[0], o.slice(1, count), this.mem[this.pc++]);
        case 13:
          return this.eraseWindow(o[0]);
        case 14:
          if (this.curWin === 1 && o[0] === 1 && this.upperRow < this.upperHeight) {
            for (let c = this.upperCol; c < this.screenWidth; c++)
              this.upper[this.upperRow][c] = { c: ' ', s: 0 };
          }
          return;
        case 15:
          if (this.curWin === 1) {
            const row = s16(o[0]) - 1;
            const col = (count > 1 ? o[1] : 1) - 1;
            if (row >= this.upperHeight && row < 255) this.splitWindow(row + 1);
            this.upperRow = Math.max(0, row);
            this.upperCol = Math.max(0, col);
          }
          return;
        case 16:
          this.setWord(o[0], (this.curWin === 1 ? this.upperRow : 0) + 1);
          this.setWord(o[0] + 2, (this.curWin === 1 ? this.upperCol : 0) + 1);
          return;
        case 17:
          this.style = o[0] === 0 ? 0 : this.style | o[0];
          return;
        case 18:
          return;
        case 19: {
          const s = s16(o[0]);
          if (s === 1) this.stream1 = true;
          else if (s === -1) this.stream1 = false;
          else if (s === 2) this.setWord(0x10, this.getWord(0x10) | 1);
          else if (s === -2) this.setWord(0x10, this.getWord(0x10) & ~1);
          else if (s === 3) {
            if (this.stream3.length >= 16) throw new ZMachineError('Too many nested stream 3 tables');
            this.stream3.push({ addr: o[1], len: 0 });
          } else if (s === -3) {
            const t = this.stream3.pop();
            if (t) this.setWord(t.addr, t.len);
          }
          return;
        }
        case 20:
          return;
        case 21:
          if (o[0] === 1 || o[0] === 2) {
            if (this.io.bell) this.io.bell();
          }
          return;
        case 22:
          this.waiting = { type: 'char' };
          return;
        case 23: {
          const form = count > 3 ? o[3] : 0x82;
          const size = form & 0x7f;
          const words = form & 0x80;
          let found = 0;
          for (let i = 0, a = o[1]; i < o[2]; i++, a += size) {
            const val = words ? this.getWord(a) : this.mem[a];
            if (val === o[0]) {
              found = a;
              break;
            }
          }
          this.store(found);
          return this.branch(found !== 0);
        }
        case 24:
          if (v >= 5) return this.store(~o[0] & 0xffff);
          break;
        case 25:
          if (v >= 5) return this.call(o[0], o.slice(1, count), -1);
          break;
        case 26:
          if (v >= 5) return this.call(o[0], o.slice(1, count), -1);
          break;
        case 27:
          if (v >= 5) return this.tokenise(o[0], o[1], count > 2 ? o[2] : 0, count > 3 && o[3] !== 0);
          break;
        case 28:
          if (v >= 5) {
            const codes = [];
            for (let i = 0; i < o[1]; i++) codes.push(this.mem[o[0] + o[2] + i]);
            const bytes = this.encodeZscii(codes);
            for (let i = 0; i < bytes.length; i++) this.mem[o[3] + i] = bytes[i];
            return;
          }
          break;
        case 29:
          if (v >= 5) {
            const first = o[0];
            const second = o[1];
            const size = s16(o[2]);
            const len = Math.abs(size);
            if (second === 0) for (let i = 0; i < len; i++) this.mem[first + i] = 0;
            else if (size < 0) for (let i = 0; i < len; i++) this.mem[second + i] = this.mem[first + i];
            else this.mem.set(this.mem.slice(first, first + len), second);
            return;
          }
          break;
        case 30:
          if (v >= 5) {
            const width = o[1];
            const height = count > 2 ? o[2] : 1;
            const skip = count > 3 ? o[3] : 0;
            let a = o[0];
            const col = this.upperCol;
            for (let r = 0; r < height; r++) {
              let line = '';
              for (let c = 0; c < width; c++) line += this.zsciiToChar(this.mem[a++]);
              a += skip;
              if (this.curWin === 1) {
                this.upperCol = col;
                this.print(line);
                this.upperRow++;
              } else this.print(line + (r < height - 1 ? '\n' : ''));
            }
            if (this.curWin === 1) this.upperRow--;
            return;
          }
          break;
        case 31:
          if (v >= 5) return this.branch(o[0] <= this.frame.argCount);
          break;
      }
      this.illegal('VAR', n, pc);
    }

    execExt(n, o, count, pc) {
      switch (n) {
        case 0: // save
          if (count > 0) return this.store(0); // auxiliary table saves unsupported
          this.waiting = { type: 'save' };
          return;
        case 1: // restore
          if (count > 0) return this.store(0);
          this.waiting = { type: 'restore' };
          return;
        case 2: {
          const places = s16(o[1]);
          return this.store(places >= 0 ? o[0] << places : o[0] >>> -places);
        }
        case 3: {
          const places = s16(o[1]);
          return this.store(places >= 0 ? s16(o[0]) << places : s16(o[0]) >> -places);
        }
        case 4: {
          const prev = this.font;
          if (o[0] === 0) return this.store(prev);
          if (o[0] === 1 || o[0] === 4) {
            this.font = o[0];
            if (o[0] === 4) this.style |= STYLE_FIXED;
            else this.style &= ~STYLE_FIXED;
            return this.store(prev);
          }
          return this.store(0);
        }
        case 9: {
          // save_undo: the snapshot resumes at this instruction's store byte
          this.undoStack.push(this.snapshot());
          if (this.undoStack.length > 25) this.undoStack.shift();
          return this.store(1);
        }
        case 10: {
          const snap = this.undoStack.pop();
          if (!snap) return this.store(0);
          this.loadSnapshot(snap);
          return this.store(2);
        }
        case 11:
          return this.print(String.fromCharCode(o[0]));
        case 12:
          return this.store(3);
        case 13:
          return;
      }
      // Remaining extended opcodes are for version 6 graphics; treat as no-ops.
      if (n >= 5 && n <= 0x1d) return;
      this.illegal('EXT', n, pc);
    }
  }

  ZMachine.STYLE = { REVERSE: STYLE_REVERSE, BOLD: STYLE_BOLD, ITALIC: STYLE_ITALIC, FIXED: STYLE_FIXED };
  ZMachine.Error = ZMachineError;

  root.ZMachine = ZMachine;
  if (typeof module !== 'undefined' && module.exports) module.exports = ZMachine;
})(typeof window !== 'undefined' ? window : globalThis);
