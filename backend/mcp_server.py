"""Expose Re:Spawn's graph tools over MCP so any MCP client (Claude Desktop, Claude Code,
Cursor…) can query and drive the resurrection graph.

    python -m backend.mcp_server            # stdio transport

Claude Desktop config:
    {"mcpServers": {"respawn": {"command": "python", "args": ["-m", "backend.mcp_server"],
                                "cwd": "/path/to/Re-Spawn"}}}
"""

from __future__ import annotations

try:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer as FastMCP
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP

from . import config  # load local environment before graph initialization
from .agent import orchestrator as orch
from .graph import planner, schema, dependencies

mcp = FastMCP("respawn")
schema.init()


@mcp.tool()
def find_blockers(project_id: str) -> dict:
    """Packages the project uses that are INCOMPATIBLE_WITH its runtime or CONFLICT_WITH each other."""
    return planner.find_blockers(project_id)


@mcp.tool()
def get_migration_options(project_id: str, package: str) -> dict:
    """Migration nodes FROM a blocked package version (e.g. 'npm:webpack@4'), plus runtime moves."""
    return planner.get_migration_options(project_id, package)


@mcp.tool()
def resolve_prerequisites(project_id: str, migration_id: str) -> dict:
    """Prerequisite migrations (REQUIRES chains and target conflicts) and blocking problems."""
    return planner.resolve_prerequisites(project_id, migration_id)


@mcp.tool()
def rank_recovery_plans(project_id: str) -> dict:
    """All candidate recovery plans with feasibility reasons, ranked by cost and risk."""
    return planner.rank_recovery_plans(project_id)


@mcp.tool()
def find_alternative(project_id: str, failed_plan: str) -> dict:
    """Best feasible plan that is not `failed_plan` (a '+'-joined list of migration ids)."""
    return planner.find_alternative(project_id, failed_plan)


@mcp.tool()
def record_attempt(
    project_id: str,
    run_id: str,
    steps: list[str],
    outcome: str,
    error_class: str = "",
    summary: str = "",
) -> dict:
    """Store an Attempt node and TRIED edges for a plan you executed yourself."""
    return planner.record_attempt(
        project_id, run_id, steps, outcome, error_class, summary
    )


@mcp.tool()
def learn_conflict(a: str, b: str, reason: str, evidence: str = "") -> dict:
    """Write a learned CONFLICTS_WITH edge between two package versions."""
    return planner.learn_conflict(a, b, reason, evidence)


@mcp.tool()
def resurrect(project_id: str) -> dict:
    """Run the full diagnose -> plan -> repair -> verify loop in a sandbox. Returns the run id."""
    return orch.start(project_id).to_dict()


@mcp.tool()
def run_status(run_id: str) -> dict:
    """Status, phase and certificate of a resurrection run."""
    run = orch.RUNS.get(run_id)
    return run.to_dict() if run else {"error": "unknown run"}


@mcp.tool()
def trace_dependency_chain(project_id: str) -> dict:
    """Trace resolved lockfile relationships to runtime conflicts with source evidence."""
    return dependencies.why_chains(project_id)


@mcp.tool()
def rank_blockers(project_id: str) -> dict:
    """Rank packages by incoming dependency degree in FalkorDB."""
    return dependencies.rank_blockers(project_id)


if __name__ == "__main__":
    mcp.run()
