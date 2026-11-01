"""Errors that are safe to show to the web app."""

from __future__ import annotations


class StatlyError(Exception):
    """An expected failure with a code from the shared contract."""

    code = "internal"


class BadRequest(StatlyError):
    code = "bad_request"


class UnknownMethod(StatlyError):
    code = "unknown_method"


class InvalidParams(StatlyError):
    code = "invalid_params"


class CollectionUnavailable(StatlyError):
    code = "collection_unavailable"


class NotAllowed(StatlyError):
    code = "not_allowed"
