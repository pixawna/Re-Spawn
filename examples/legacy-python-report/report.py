"""A 2020-style version report that genuinely fails on clean Python 3.12."""

from distutils.version import StrictVersion
from html import escape


def sort_versions(versions):
    return sorted(versions, key=StrictVersion)


def latest_version(versions):
    if not versions:
        raise ValueError("At least one version is required")
    return sort_versions(versions)[-1]


def render_report(versions, title="Release archive"):
    ordered = sort_versions(versions)
    rows = "".join("<li>" + escape(v) + "</li>" for v in ordered)
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Release archive</title>'
        "<style>body{background:#f3efe5;color:#293b34;max-width:460px;margin:40px auto;font:18px Georgia;padding:25px}h1{color:#44664c}li{padding:8px}small{font:12px monospace}</style>"
        "<small>PYTHON REPORT · BACK FROM THE AFTERLIFE</small><h1>"
        + escape(title)
        + "</h1>"
        "<p>Newest release: <strong>"
        + escape(latest_version(versions))
        + "</strong></p><ol>"
        + rows
        + "</ol></html>"
    )
