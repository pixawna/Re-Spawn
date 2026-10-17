// Copies public/index.html into dist/ and wires in the hashed bundle name.
const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
const bundle = fs.readdirSync(dist).find(function (f) { return /^bundle\..*\.js$/.test(f); });
if (!bundle) {
  console.error("No bundle found in dist/");
  process.exit(1);
}
const html = fs
  .readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8")
  .replace("__BUNDLE__", '<script src="./' + bundle + '"></script>');
fs.writeFileSync(path.join(dist, "index.html"), html);
console.log("dist/index.html -> " + bundle);
