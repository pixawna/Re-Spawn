from pathlib import Path
from report import render_report

output = Path("dist")
output.mkdir(exist_ok=True)
(output / "index.html").write_text(render_report(["1.2.0", "1.10.0", "2.0.0", "1.9.0"]))
print("Built dist/index.html using real Python version comparison.")
