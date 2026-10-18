"""Load local secrets before importing graph or agent modules. Never send them to builds."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


def agent_config():
    return {
        "claude_available": bool(os.getenv("ANTHROPIC_API_KEY")),
        "model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
        "default_mode": os.getenv("RESPAWN_AGENT_MODE", "auto"),
    }
