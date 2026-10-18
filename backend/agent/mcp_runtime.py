"""An actual MCP server/client session over the SDK's bidirectional memory transport.

The run-scoped server shares the API's graph connection and approval state. Claude
sees tools/list schemas and its tool calls travel through MCP tools/call.
"""

from __future__ import annotations
import asyncio
import json
from contextlib import asynccontextmanager
from datetime import timedelta
import anyio
from mcp import ClientSession, types
from mcp.server.lowlevel import Server
from mcp.shared.memory import create_client_server_memory_streams

SPECS = {
    "diagnose_project": (
        "Install and build the original project, import its resolved dependency graph, classify the real failure.",
        {},
    ),
    "find_blockers": ("Find runtime and package conflicts in FalkorDB.", {}),
    "rank_blockers": ("Rank dependencies by incoming degree computed in FalkorDB.", {}),
    "trace_dependency_chain": (
        "Trace resolved dependency and source-backed API relationships to the incompatible runtime.",
        {},
    ),
    "get_migration_options": (
        "Find migrations and runtime alternatives for a graph package ID.",
        {"package": {"type": "string"}},
    ),
    "resolve_prerequisites": (
        "Find prerequisites, conflicts, and Cypher evidence for a migration.",
        {"migration_id": {"type": "string"}},
    ),
    "rank_recovery_plans": (
        "Use FalkorDB algo.SPpaths to select a minimum-cost feasible plan. Returns plan IDs and evidence.",
        {},
    ),
    "find_alternative": (
        "Recompute the graph-selected route excluding recorded failures.",
        {"failed_plan": {"type": "string"}},
    ),
    "execute_plan": (
        "Execute the graph-selected plan in a fresh workspace; pause for user approval if risky; build, test, and verify. Only graph recipes may execute.",
        {"plan_id": {"type": "string"}},
    ),
}


def build_server(session):
    server = Server("respawn-run")

    @server.list_tools()
    async def list_tools():
        return [
            types.Tool(
                name=name,
                description=description,
                inputSchema={
                    "type": "object",
                    "properties": props,
                    "required": list(props),
                    "additionalProperties": False,
                },
            )
            for name, (description, props) in SPECS.items()
        ]

    @server.call_tool()
    async def call_tool(name, arguments):
        result = await asyncio.to_thread(session.dispatch, name, arguments)
        return [types.TextContent(type="text", text=json.dumps(result, default=str))]

    return server


@asynccontextmanager
async def connected(session):
    server = build_server(session)
    async with create_client_server_memory_streams() as (
        client_streams,
        server_streams,
    ):
        async with anyio.create_task_group() as group:
            group.start_soon(
                server.run, *server_streams, server.create_initialization_options()
            )
            try:
                async with ClientSession(
                    *client_streams, read_timeout_seconds=timedelta(minutes=30)
                ) as client:
                    await client.initialize()
                    yield client
            finally:
                group.cancel_scope.cancel()
