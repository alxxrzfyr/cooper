from typing import Annotated, Literal

from cryptography.fernet import Fernet
from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from cadence.core.placement import PlacementRules
from cadence.core.scoring import ScoreWeights

# A shared secret shorter than this is not worth the false confidence. The header is
# the only thing standing between a malicious web page and a live calendar write
# token, so a blank or guessable value must fail at startup rather than at runtime.
SHARED_SECRET_MIN_LENGTH = 32


class Settings(BaseSettings):
    """Runtime settings loaded from CADENCE_* environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="CADENCE_", extra="ignore")

    # --- server, localhost only ---
    host: Literal["127.0.0.1"] = "127.0.0.1"
    port: int = 8000
    allowed_origin: str = "http://127.0.0.1:5173"
    allowed_hosts: tuple[str, ...] = ("127.0.0.1", "localhost")
    shared_secret: Annotated[SecretStr, Field(min_length=SHARED_SECRET_MIN_LENGTH)]
    database_url: str = "sqlite:///./cadence.db"

    # --- user context ---
    timezone: str = "Asia/Singapore"

    # --- scoring weights, must sum to 1.0 ---
    weight_deadline: float = 0.35
    weight_importance: float = 0.25
    weight_slip: float = 0.15
    weight_unblocks: float = 0.15
    weight_age: float = 0.10
    horizon_days: int = 14

    # --- placement ---
    block_min_minutes: int = 25
    block_max_minutes: int = 90
    block_buffer_minutes: int = 10
    earliest_start_buffer_minutes: int = 15
    shortlist_size: int = 5

    # --- model provider. 'rule_based' runs with no network at all. ---
    llm_provider: Literal["gemini", "rule_based"] = "rule_based"
    gemini_api_key: SecretStr | None = None
    # Model IDs live here because the Gemini lineup changes often. Never inline them.
    model_compile: str = "gemini-flash-lite-latest"
    model_rerank: str = "gemini-flash-latest"

    # --- Google Calendar ---
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    google_redirect_uri: str = "http://127.0.0.1:8000/api/auth/callback"
    write_calendar_id: str = "primary"
    busy_calendar_ids: str = "primary"
    # Fernet key protecting the refresh token at rest. Deliberately has no default: a
    # committed default encryption key protects nothing, and a blank one must fail loudly
    # rather than surface as a 500 on first use. Absent means calendar storage is disabled.
    token_encryption_key: SecretStr | None = None

    @field_validator("token_encryption_key", mode="after")
    @classmethod
    def _validate_fernet_key(cls, value: SecretStr | None) -> SecretStr | None:
        """Reject an unusable key at startup instead of at first credential write."""
        if value is None:
            return None
        raw = value.get_secret_value()
        if not raw:
            # An empty assignment in .env is treated as absent rather than as a broken key.
            return None
        try:
            Fernet(raw.encode())
        except (ValueError, TypeError) as error:
            raise ValueError(
                "CADENCE_TOKEN_ENCRYPTION_KEY is not a valid Fernet key. Generate one with: "
                'python -c "from cryptography.fernet import Fernet; '
                'print(Fernet.generate_key().decode())"'
            ) from error
        return value

    @property
    def calendar_storage_ready(self) -> bool:
        """Whether a credential can be stored safely."""
        return self.token_encryption_key is not None

    # --- jobs, seconds unless stated ---
    outbox_drain_interval: int = 30
    calendar_poll_interval: int = 300
    token_health_interval: int = 3600
    nightly_plan_interval_hours: int = 24
    day_drift_interval: int = 3600

    # --- guards ---
    max_mutations_per_turn: int = 20
    max_model_calls_per_utterance: int = 2
    rerank_candidate_count: int = 10

    def score_weights(self) -> ScoreWeights:
        return ScoreWeights(
            deadline=self.weight_deadline,
            importance=self.weight_importance,
            slip=self.weight_slip,
            unblocks=self.weight_unblocks,
            age=self.weight_age,
            horizon_days=self.horizon_days,
        )

    def placement_rules(self) -> PlacementRules:
        return PlacementRules(
            min_block_minutes=self.block_min_minutes,
            max_block_minutes=self.block_max_minutes,
            buffer_minutes=self.block_buffer_minutes,
            earliest_start_buffer_minutes=self.earliest_start_buffer_minutes,
        )

    def busy_calendars(self) -> tuple[str, ...]:
        return tuple(value.strip() for value in self.busy_calendar_ids.split(",") if value.strip())

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)
