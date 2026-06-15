from langchain_core.tools import tool


@tool
def think_tool(reflection: str) -> str:
    """Strategic reflection tool. Use to pause and reason about findings, gaps,
    or next steps. Does not perform any I/O — just records the reflection.

    Args:
        reflection: A short paragraph of reasoning about the current research state.
    """
    return f"Reflection recorded: {reflection}"
