"""Cross-ecosystem contract tests: detection, source edits, and honest verification."""

from pathlib import Path
import pytest
from backend.recovery.adapters import get_adapter
from backend.recovery.adapters.python import PythonAdapter
from backend.recovery import executor, inspector, verifier
from backend.graph import seeds


def test_detection_and_inspection_do_not_execute_setup_py(tmp_path):
    sentinel = tmp_path / "executed"
    (tmp_path / "setup.py").write_text(
        "from setuptools import setup\nfrom pathlib import Path\nPath('executed').write_text('bad')\nsetup(name='old-tool',version='1.0.0',install_requires=['packaging==24.2'])"
    )
    info = inspector.inspect(tmp_path)
    assert info["ecosystem"] == "pypi"
    assert info["environment"] == "python@3.12"
    assert info["deps"][0]["id"] == "pypi:packaging@24"
    assert not sentinel.exists()


def test_npm_and_pypi_artifacts_cannot_collide(tmp_path):
    npm = tmp_path / "js"
    npm.mkdir()
    (npm / "package.json").write_text('{"dependencies":{"packaging":"24.2.0"}}')
    py = tmp_path / "py"
    py.mkdir()
    (py / "requirements.txt").write_text("packaging==24.2\n")
    npm_dep = inspector.inspect(npm)["deps"][0]
    py_dep = inspector.inspect(py)["deps"][0]
    assert npm_dep["id"] == "npm:packaging@24"
    assert py_dep["id"] == "pypi:packaging@24"


def test_python_recipe_installs_prerequisite_and_replaces_real_source_import(tmp_path):
    (tmp_path / "requirements.txt").write_text("# original dependencies\n")
    (tmp_path / "report.py").write_text("from distutils.version import StrictVersion\n")
    adapter = PythonAdapter()
    before = adapter.inspect(tmp_path)
    assert before["deps"][0]["id"] == "python-stdlib:distutils@3"
    modified = set()
    for migration in seeds.PYTHON_MIGRATIONS:
        modified.update(adapter.apply_recipe(tmp_path, migration["recipe"])["files"])
    assert modified == {"report.py", "requirements.txt"}
    assert "Version as StrictVersion" in (tmp_path / "report.py").read_text()
    after = adapter.inspect(tmp_path)
    assert {d["id"] for d in after["deps"]} == {"pypi:packaging@24"}
    patch = executor.diff(
        tmp_path, tmp_path, adapter.patch_files(tmp_path, tmp_path, modified)
    )
    assert patch == ""


def test_python_migration_does_not_follow_source_symlinks(tmp_path):
    outside = tmp_path / "secret.txt"
    outside.write_text("from distutils.version import StrictVersion\n")
    project = tmp_path / "project"
    project.mkdir()
    (project / "requirements.txt").write_text("")
    (project / "escaped.py").symlink_to(outside)
    with pytest.raises(ValueError, match="expected distutils import"):
        PythonAdapter().apply_recipe(project, seeds.PYTHON_MIGRATIONS[1]["recipe"])
    assert outside.read_text() == "from distutils.version import StrictVersion\n"


def test_python_environment_constraint_is_not_silently_ignored(tmp_path):
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname="old"\nrequires-python="<3.12"\n'
    )
    with pytest.raises(ValueError, match="excludes"):
        inspector.inspect(tmp_path)


@pytest.mark.parametrize(
    "output,expected",
    [
        ("Ran 6 tests in 0.001s\n\nOK\n", {"passed": 6, "failed": 0}),
        (
            "Ran 6 tests in 0.001s\n\nFAILED (failures=1, errors=1)\n",
            {"passed": 4, "failed": 2},
        ),
        ("Ran 6 tests in 0.001s\n\nOK (skipped=1)\n", {"passed": 5, "failed": 0}),
        ("Ran 6 tests in 0.001s\n", {"passed": 0, "failed": 0}),
    ],
)
def test_unittest_evidence_requires_a_real_summary(output, expected):
    assert verifier.count_tests(output) == expected


def test_python_adapter_rejects_node_environments(tmp_path):
    with pytest.raises(ValueError, match="Python environment"):
        PythonAdapter().run(
            "build", tmp_path, lambda *_: None, {"kind": "node", "major": 22}
        )


@pytest.mark.parametrize(
    "source",
    [
        "import distutils\n",
        "from distutils.version import StrictVersion as V\n",
        "from distutils.version import (\n StrictVersion\n)\n",
    ],
)
def test_unsupported_source_patterns_are_diagnosed_without_offering_a_recipe(
    tmp_path, source
):
    (tmp_path / "requirements.txt").write_text("")
    (tmp_path / "report.py").write_text(source)
    info = PythonAdapter().inspect(tmp_path)
    assert info["deps"][0]["id"] == "python-stdlib:distutils@3"
    assert info["supported_migrations"] == []


def test_source_migration_preserves_documentation_and_comments(tmp_path):
    (tmp_path / "requirements.txt").write_text("")
    (tmp_path / "report.py").write_text(
        '"""from distutils.version import StrictVersion"""\n# from distutils.version import StrictVersion\nfrom distutils.version import StrictVersion  # actual import\n'
    )
    PythonAdapter().apply_recipe(tmp_path, seeds.PYTHON_MIGRATIONS[1]["recipe"])
    contents = (tmp_path / "report.py").read_text()
    assert contents.count("from distutils.version import StrictVersion") == 2
    assert (
        "from packaging.version import Version as StrictVersion  # actual import"
        in contents
    )
