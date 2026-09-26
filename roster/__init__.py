"""Roster Fandom propose, JSON validation, import/removal plans, and chain register."""

__all__ = ["STATUS_ALLOWED", "FORBIDDEN_KEYS"]

STATUS_ALLOWED = frozenset({"", "dead"})
FORBIDDEN_KEYS = frozenset({"strength", "intelligence", "luck", "role"})
