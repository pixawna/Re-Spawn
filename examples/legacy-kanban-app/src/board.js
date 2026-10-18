const columns = ["Backlog", "In progress", "Done"];
function move(cards, id) {
  return cards.map((card) =>
    card.id === id
      ? { ...card, column: (card.column + 1) % columns.length }
      : { ...card },
  );
}
function add(cards, title) {
  if (!title.trim()) return cards.slice();
  return cards.concat({
    id: Math.max(0, ...cards.map((c) => c.id)) + 1,
    title: title.trim(),
    column: 0,
  });
}
module.exports = { columns, move, add };
