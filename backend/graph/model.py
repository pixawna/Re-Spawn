"""Stable identities shared by adapters and graph tools."""


def artifact_id(value: str, ecosystem: str = "npm") -> str:
    return value if ":" in value else f"{ecosystem}:{value}"
