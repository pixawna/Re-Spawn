import threading
from types import SimpleNamespace
from fastapi.testclient import TestClient
from backend import reports, main


def run(events, **extra):
    defaults = dict(
        id="run-1234abcd",
        project_id="patient",
        status="dead",
        cond=threading.Condition(),
        events=events,
        certificate=None,
        execution_environment={},
        patch="",
        started=0,
    )
    defaults.update(extra)
    return SimpleNamespace(**defaults)


def e(kind, seq, **data):
    return dict(type=kind, seq=seq, t=float(seq), **data)


def test_failed_report_preserves_error_and_never_invents_verification():
    value = reports.build(
        run(
            [
                e("agent_mode", 0, mode="deterministic"),
                e(
                    "diagnosis",
                    1,
                    alive=False,
                    code=1,
                    excerpt="actual failure",
                    error={"summary": "Missing module"},
                ),
                e("attempt", 2, n=1, status="failed"),
                e("done", 3, status="dead"),
            ]
        )
    )
    assert value["summary"]["initial_status"] == "build failed"
    assert value["summary"]["routes_tried"] == 1
    assert value["proof"]["verification"] is None
    assert value["summary"]["tests"] is None
    assert "actual failure" in reports.markdown(value)
    assert "No completed verification certificate" in reports.markdown(value)


def test_controller_switch_and_tool_query_association_are_recorded():
    value = reports.build(
        run(
            [
                e("agent_mode", 0, mode="claude"),
                e("tool", 1, tool="diagnose_project", status="start", args={}),
                e(
                    "cypher",
                    2,
                    query="MATCH (n) RETURN n",
                    rows=3,
                    params={},
                    tag="inspect",
                    ms=2,
                ),
                e(
                    "tool",
                    3,
                    tool="diagnose_project",
                    status="done",
                    result={"failure": "actual"},
                ),
                e("agent_fallback", 4, message="fallback"),
                e("tool", 5, tool="rank_recovery_plans", status="start", args={}),
            ]
        )
    )
    calls = [row for row in value["timeline"] if row["kind"] == "tool"]
    assert calls[0]["controller"] == "claude"
    assert calls[0]["queries"] == [2]
    assert calls[0]["result"] == {"failure": "actual"}
    assert calls[1]["controller"] == "deterministic"
    assert calls[1]["result"] is None


def test_feasible_alternatives_are_not_falsely_reported_as_rejected():
    plans = [
        dict(
            id="a",
            cost=1,
            titles=["A"],
            steps=["a"],
            feasible=True,
            reasons=[],
            evidence=[],
        ),
        dict(
            id="b",
            cost=2,
            titles=["B"],
            steps=["b"],
            feasible=True,
            reasons=[],
            evidence=[],
        ),
        dict(
            id="c",
            cost=3,
            titles=["C"],
            steps=["c"],
            feasible=False,
            reasons=["policy blocks workaround"],
            evidence=[
                {"query": "MATCH (p:Policy) RETURN p", "result": [{"allow": False}]}
            ],
        ),
    ]
    value = reports.build(run([e("plans", 0, plans=plans, chosen="a")]))
    text = reports.markdown(value)
    assert "CHOSEN · cost 1" in text
    assert "Feasible alternative (not selected at this round) · cost 2" in text
    assert "RULED OUT · cost 3" in text
    assert "policy blocks workaround" in text


def test_reuse_requires_an_observed_matching_source_run():
    original = run([])
    other = run(
        [e("shared_learning", 0, source_run=original.id, source_project="patient")],
        id="run-11111111",
        project_id="second",
    )
    unrelated = run(
        [e("shared_learning", 0, source_run="run-99999999")], id="run-22222222"
    )
    value = reports.build(original, [original, other, unrelated])
    assert [reuse["project"] for reuse in value["later_reuses"]] == ["second"]


def test_exports_escape_untrusted_content_and_safe_fences():
    value = reports.build(
        run(
            [
                e(
                    "diagnosis",
                    0,
                    alive=False,
                    excerpt="<script>alert(1)</script>\n```\n# fake section",
                )
            ]
        )
    )
    exported = reports.html_document(value)
    assert "<script>" not in exported
    assert "&lt;script&gt;" in exported
    assert "````text" in reports.markdown(value)


def test_saved_reports_remain_readable_without_live_run(tmp_path, monkeypatch):
    original = run([e("done", 0, status="dead")])
    reports.save(original, tmp_path / "reports")
    monkeypatch.setattr(main.orch, "DATA", tmp_path)
    monkeypatch.setattr(main.orch, "RUNS", {})
    client = TestClient(main.app)
    response = client.get("/api/runs/" + original.id + "/report")
    assert response.status_code == 200
    assert response.json()["summary"]["status"] == "dead"
    for format, suffix in [("markdown", ".md"), ("html", ".html")]:
        response = client.get(
            "/api/runs/" + original.id + "/report", params={"format": format}
        )
        assert response.status_code == 200
        assert suffix in response.headers["content-disposition"]
        assert response.headers["x-content-type-options"] == "nosniff"
    assert client.get("/api/projects/patient/reports").json()[0]["archived"] is True
    assert client.get("/api/runs/run-ffffffff/report").status_code == 404
    assert (
        client.get("/api/runs/" + original.id + "/report?format=exe").status_code == 422
    )
    assert reports.load("../../private", tmp_path / "reports") is None


def test_saved_reports_keep_later_reuse_links_after_restart(tmp_path):
    original = run([])
    reports.save(original, tmp_path)
    later = run(
        [
            e(
                "shared_learning",
                0,
                source_run=original.id,
                source_project="patient",
                a="cli@3",
                b="webpack@5",
            )
        ],
        id="run-11111111",
        project_id="second",
    )
    reports.save(later, tmp_path)
    loaded = reports.load(original.id, tmp_path)
    assert loaded["later_reuses"][0]["project"] == "second"
    assert len(reports.load(original.id, tmp_path)["later_reuses"]) == 1
