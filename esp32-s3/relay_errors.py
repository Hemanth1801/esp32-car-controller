"""Shared exception type for imported and directly executed relay entrypoints."""


class RelayError(Exception):
    def __init__(self, message, code=503):
        super().__init__(message)
        self.code = code


class OwnershipConflict(RelayError):
    """Refuse to take over another app without stopping its valid session."""

    def __init__(self):
        super().__init__('The ESP is armed by another app. Disarm that app before switching controllers.', 409)
