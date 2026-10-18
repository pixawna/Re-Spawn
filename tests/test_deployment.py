from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from backend import main


def test_demo_rejects_import_before_cloning(monkeypatch):
    monkeypatch.setenv("RESPAWN_EXAMPLES_ONLY", "1")
    monkeypatch.setattr(main.orch, "clone", lambda *args: pytest.fail("Must not clone"))
    with pytest.raises(HTTPException) as error:
        main.add_project(main.NewProject(url="https://github.com/owner/repo"))
    assert error.value.status_code == 403


def test_demo_rejects_non_bundled_run(monkeypatch):
    monkeypatch.setenv("RESPAWN_EXAMPLES_ONLY", "1")
    monkeypatch.setattr(main.orch, "get_project", lambda pid: {"id": pid})
    with pytest.raises(HTTPException) as error:
        main.resurrect("owner-repo")
    assert error.value.status_code == 403


def test_demo_limits_parallel_repairs(monkeypatch):
    monkeypatch.setenv("RESPAWN_EXAMPLES_ONLY", "1")
    monkeypatch.setattr(main.orch, "get_project", lambda pid: {"id": pid})
    monkeypatch.setattr(
        main.orch,
        "RUNS",
        {"run": SimpleNamespace(project_id="legacy-todo-app", status="running")},
    )
    with pytest.raises(HTTPException) as error:
        main.resurrect("legacy-python-report")
    assert error.value.status_code == 409
