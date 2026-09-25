"""Roster JSON validation and import/removal plan generation."""

__all__ = ["STATUS_ALLOWED", "FORBIDDEN_KEYS"]

STATUS_ALLOWED = frozenset({"", "dead"})
FORBIDDEN_KEYS = frozenset({"strength", "intelligence", "luck", "role"})
