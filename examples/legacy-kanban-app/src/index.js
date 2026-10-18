const { columns, move, add } = require("./board");
let cards = [
  { id: 1, title: "Bring this board back to life", column: 2 },
  { id: 2, title: "Share what we learned", column: 1 },
  { id: 3, title: "Build the next idea", column: 0 },
];
function render() {
  const board = document.querySelector("#board");
  board.textContent = "";
  columns.forEach((name, index) => {
    const column = document.createElement("section");
    const title = document.createElement("h2");
    title.textContent = name;
    column.appendChild(title);
    cards
      .filter((c) => c.column === index)
      .forEach((card) => {
        const button = document.createElement("button");
        button.textContent = card.title + " →";
        button.onclick = () => {
          cards = move(cards, card.id);
          render();
        };
        column.appendChild(button);
      });
    board.appendChild(column);
  });
}
document.querySelector("form").onsubmit = (event) => {
  event.preventDefault();
  const input = document.querySelector("input");
  cards = add(cards, input.value);
  input.value = "";
  render();
};
render();
