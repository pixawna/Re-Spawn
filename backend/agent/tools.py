"""The agent's tool belt. Same functions are exposed to external agents through MCP
(see backend/mcp_server.py), so Claude or any MCP client can drive the resurrection graph."""
from __future__ import annotations

from ..graph import planner

TOOLS = {
    "find_blockers": {
        "fn": planner.find_blockers,
        "description": "Trace packages the project uses that are INCOMPATIBLE_WITH its runtime or CONFLICT_WITH each other.",
    },
    "get_migration_options": {
        "fn": planner.get_migration_options,
        "description": "List Migration nodes FROM a blocked package version, plus runtime moves that avoid the incompatibility.",
    },
    "resolve_prerequisites": {
        "fn": planner.resolve_prerequisites,
        "description": "Walk REQUIRES chains and target conflicts to find what must happen before a migration.",
    },
    "rank_recovery_plans": {
        "fn": planner.rank_recovery_plans,
        "description": "Enumerate full recovery plans, prune infeasible ones (policy, missing runtimes, past failures), rank by cost and risk.",
    },
    "record_attempt": {
        "fn": planner.record_attempt,
        "description": "Store an Attempt node linked to the migrations it TRIED and the Verification it PRODUCED.",
    },
    "learn_conflict": {
        "fn": planner.learn_conflict,
        "description": "Write a CONFLICTS_WITH relationship discovered from a real failure.",
    },
    "find_alternative": {
        "fn": planner.find_alternative,
        "description": "Re-rank plans after a failure and return the best feasible route that has not failed yet.",
    },
}
