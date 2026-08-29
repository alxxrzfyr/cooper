"""Domain error types.

Services raise these; the API layer maps them to HTTP status codes in one place.
Nothing here imports a framework, so the core stays testable without one.
"""


class CadenceError(Exception):
    """Base class for every error the domain raises."""


class DomainValidationError(CadenceError):
    """A value violates a domain rule."""


class TaskNotFoundError(CadenceError):
    """A referenced task does not exist."""


class AmbiguousReferenceError(CadenceError):
    """A reference matched more than one candidate and cannot be resolved."""

    def __init__(self, message: str, candidates: tuple[str, ...]) -> None:
        super().__init__(message)
        self.candidates = candidates


class ProviderError(CadenceError):
    """A provider could not produce a usable intent.

    Raised for transport failures, malformed output, and schema violations alike: the
    caller's response is the same in every case, so the distinction buys nothing.
    """


class QuotaExhaustedError(ProviderError):
    """The provider refused the request because a quota ran out."""
