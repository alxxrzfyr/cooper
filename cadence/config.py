"""Settings, read from .env.

Only the shared key is required. Everything else has a working default, so the app runs with
an empty .env beyond that one value.
"""

from __future__ import annotations

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

KEY_MIN = 24


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="CADENCE_", extra="ignore")

    # The one required value. Short keys are refused because this header is the only thing
    # stopping a random web page from reaching the API.
    shared_key: SecretStr = Field(min_length=KEY_MIN)

    host: str = "127.0.0.1"
    port: int = 8000
    origin: str = "http://127.0.0.1:5173"
    database_url: str = "sqlite:///./cadence.db"
    timezone: str = "Asia/Singapore"

    # Optional. Without a key the rule-based parser handles everything.
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-flash-lite-latest"

    # Optional. Without these the calendar is simply off.
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    google_redirect_uri: str = "http://127.0.0.1:8000/api/google/callback"
    calendar_id: str = "primary"
    encryption_key: SecretStr | None = None

    def key(self) -> str:
        return self.shared_key.get_secret_value()

    def gemini_key(self) -> str | None:
        return self.gemini_api_key.get_secret_value() if self.gemini_api_key else None

    def google_secret(self) -> str | None:
        return self.google_client_secret.get_secret_value() if self.google_client_secret else None

    def encryption(self) -> str | None:
        raw = self.encryption_key.get_secret_value() if self.encryption_key else None
        return raw or None
