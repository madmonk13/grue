/*
 * Persistence: story files live in IndexedDB (they can be large); settings,
 * autosaves and save slots live in localStorage.
 */
(function (root) {
  'use strict';

  const PREFIX = 'grue.';

  const local = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(PREFIX + key);
      } catch {
        /* storage unavailable */
      }
    },
    keys(prefix) {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
        }
      } catch {
        /* storage unavailable */
      }
      return out;
    },
  };

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open('grue', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('stories');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } catch (e) {
          reject(e);
        }
      });
    }
    return dbPromise;
  }

  function tx(mode, fn) {
    return db().then(
      (d) =>
        new Promise((resolve, reject) => {
          const t = d.transaction('stories', mode);
          const req = fn(t.objectStore('stories'));
          t.oncomplete = () => resolve(req && req.result);
          t.onerror = () => reject(t.error);
        })
    );
  }

  const stories = {
    put(id, record) {
      return tx('readwrite', (s) => s.put(record, id)).catch(() => null);
    },
    get(id) {
      return tx('readonly', (s) => s.get(id)).catch(() => null);
    },
    remove(id) {
      return tx('readwrite', (s) => s.delete(id)).catch(() => null);
    },
  };

  root.GrueStorage = { local, stories };
})(window);
