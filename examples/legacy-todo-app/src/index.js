const { createStore } = require("./todos");

const KEY = "legacy-todo-app";
let saved = null;
try { saved = JSON.parse(window.localStorage.getItem(KEY)); } catch (e) { saved = null; }

const store = createStore(saved || [
  { text: "Give an old project a second chance", done: true },
  { text: "Upgrade the build tooling", done: false },
  { text: "Ship it again", done: false },
]);

const root = document.getElementById("root");
root.innerHTML =
  '<main class="card" data-app="respawn-todo">' +
  '<p class="kicker">legacy-todo-app · v1.3.0</p>' +
  "<h1>Things to do</h1>" +
  '<form id="f"><input id="i" placeholder="Add something…" autocomplete="off"/><button>Add</button></form>' +
  '<ul id="l"></ul><p id="c" class="count"></p></main>';

const list = document.getElementById("l");
const count = document.getElementById("c");

function render(items) {
  list.innerHTML = "";
  items.forEach(function (t) {
    const li = document.createElement("li");
    li.className = t.done ? "done" : "";
    li.innerHTML = '<label><input type="checkbox"' + (t.done ? " checked" : "") + "/> <span></span></label>" + '<button aria-label="Remove">×</button>';
    li.querySelector("span").textContent = t.text;
    li.querySelector("input").addEventListener("change", function () { store.toggle(t.id); });
    li.querySelector("button").addEventListener("click", function () { store.remove(t.id); });
    list.appendChild(li);
  });
  count.textContent = store.remaining() + " left";
  try { window.localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* private mode */ }
}

store.subscribe(render);
render(store.all());

document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  const input = document.getElementById("i");
  store.add(input.value);
  input.value = "";
});
