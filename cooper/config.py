"""Settings, read from .env.

Local mode keeps using the shared key. Firebase mode adds hosted auth settings but still keeps
the rest of the app on safe defaults.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

KEY_MIN = 24


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="COOPER_", extra="ignore", hide_input_in_errors=True
    )

    # The shared key protects the local API from unrelated browser pages. Firebase mode does
    # not use it.
    shared_key: SecretStr | None = None
    auth_mode: Literal["local", "firebase"] = "local"
    firebase_project_id: str | None = None

    host: str = "127.0.0.1"
    port: int = 8000
    origin: str = "http://127.0.0.1:5173"
    database_url: str = "sqlite:///./cooper.db"
    timezone: str = "Asia/Singapore"
    owner_id: str = "local"

    gemini_model: str = "gemini-flash-lite-latest"
    included_ai_enabled: bool = False
    gemini_api_key: SecretStr | None = None
    groq_api_key: SecretStr | None = None
    groq_model: str = ""
    ai_price_revision: str = ""
    gemini_input_microusd_per_million: int = Field(default=0, ge=0)
    gemini_output_microusd_per_million: int = Field(default=0, ge=0)
    groq_input_microusd_per_million: int = Field(default=0, ge=0)
    groq_output_microusd_per_million: int = Field(default=0, ge=0)
    ai_input_token_bound: int = Field(default=8192, ge=1024, le=32768)
    ai_output_token_bound: int = Field(default=384, ge=160, le=1024)
    ai_deadline_seconds: int = Field(default=30, ge=1, le=60)

    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    google_redirect_uri: str = "http://127.0.0.1:8000/api/google/callback"
    oauth_state_secret: SecretStr | None = None
    sync_secret: SecretStr | None = None
    calendar_id: str = "primary"
    gmail_lookback_days: int = Field(default=14, ge=1, le=30)
    gmail_poll_interval_seconds: int = Field(default=300, ge=60, le=86_400)
    encryption_key: SecretStr | None = None

    def key(self) -> str:
        return self.shared_key.get_secret_value() if self.shared_key else ""

    def google_secret(self) -> str | None:
        return self.google_client_secret.get_secret_value() if self.google_client_secret else None

    def oauth_secret(self) -> str | None:
        return self.oauth_state_secret.get_secret_value() if self.oauth_state_secret else None

    def sync_key(self) -> str:
        return self.sync_secret.get_secret_value() if self.sync_secret else ""

    def encryption(self) -> str | None:
        raw = self.encryption_key.get_secret_value() if self.encryption_key else None
        return raw or None

    @field_validator("auth_mode", mode="before")
    @classmethod
    def _normalize_auth_mode(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().casefold()
        return value

    @field_validator("firebase_project_id", mode="before")
    @classmethod
    def _blank_project_id_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("shared_key", mode="before")
    @classmethod
    def _blank_shared_key_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("oauth_state_secret", mode="before")
    @classmethod
    def _blank_oauth_state_secret_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("sync_secret", mode="before")
    @classmethod
    def _blank_sync_secret_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def _validate_auth_mode(self) -> Settings:
        if self.included_ai_enabled:
            complete = (
                self.gemini_api_key
                and self.gemini_api_key.get_secret_value().strip()
                and self.groq_api_key
                and self.groq_api_key.get_secret_value().strip()
                and self.gemini_model.strip()
                and self.groq_model.strip()
                and self.ai_price_revision
                and "latest" not in self.gemini_model.lower()
                and "latest" not in self.groq_model.lower()
                and self.gemini_input_microusd_per_million > 0
                and self.gemini_output_microusd_per_million > 0
                and self.groq_input_microusd_per_million > 0
                and self.groq_output_microusd_per_million > 0
            )
            if not complete:
                raise ValueError(
                    "Included AI requires server credentials, pinned models and reviewed prices"
                )
        if self.auth_mode == "local" and len(self.key()) < KEY_MIN:
            raise ValueError(
                f"COOPER_SHARED_KEY must be at least {KEY_MIN} characters when "
                "COOPER_AUTH_MODE=local"
            )
        if self.auth_mode == "firebase":
            if not self.firebase_project_id:
                raise ValueError(
                    "COOPER_FIREBASE_PROJECT_ID is required when COOPER_AUTH_MODE=firebase"
                )
            if self.database_url.casefold().startswith("sqlite"):
                raise ValueError(
                    "COOPER_DATABASE_URL must point to PostgreSQL when COOPER_AUTH_MODE=firebase"
                )
            if not self.oauth_secret() or len(self.oauth_secret() or "") < KEY_MIN:
                raise ValueError(
                    f"COOPER_OAUTH_STATE_SECRET must be at least {KEY_MIN} characters when "
                    "COOPER_AUTH_MODE=firebase"
                )
            if len(self.sync_key()) < KEY_MIN:
                raise ValueError(
                    f"COOPER_SYNC_SECRET must be at least {KEY_MIN} characters when "
                    "COOPER_AUTH_MODE=firebase"
                )
        return self
