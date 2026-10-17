// Pure to-do logic. Kept framework-free so it can be tested with plain Node.
function createStore(initial) {
  let items = (initial || []).map(function (t, i) {
    return { id: i + 1, text: t.text, done: !!t.done };
  });
  let nextId = items.length + 1;
  const listeners = [];

  function emit() {
    listeners.forEach(function (fn) { fn(items); });
  }

  return {
    all: function () { return items.slice(); },
    add: function (text) {
      const clean = String(text || "").trim();
      if (!clean) return null;
      const item = { id: nextId++, text: clean, done: false };
      items = items.concat([item]);
      emit();
      return item;
    },
    toggle: function (id) {
      items = items.map(function (t) { return t.id === id ? { id: t.id, text: t.text, done: !t.done } : t; });
      emit();
    },
    remove: function (id) {
      items = items.filter(function (t) { return t.id !== id; });
      emit();
    },
    remaining: function () { return items.filter(function (t) { return !t.done; }).length; },
    subscribe: function (fn) { listeners.push(fn); },
  };
}

module.exports = { createStore: createStore };
