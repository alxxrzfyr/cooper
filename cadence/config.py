from typing import Annotated, Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from cadence.core.scoring import ScoreWeights

# A shared secret shorter than this is not worth the false confidence. The header is
# the only thing standing between a malicious web page and a live calendar write
# token, so a blank or guessable value must fail at startup rather than at runtime.
SHARED_SECRET_MIN_LENGTH = 32


class Settings(BaseSettings):
    """Runtime settings loaded from CADENCE_* environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="CADENCE_", extra="ignore")

    host: Literal["127.0.0.1"] = "127.0.0.1"
    port: int = 8000
    allowed_origin: str = "http://127.0.0.1:5173"
    allowed_hosts: tuple[str, ...] = ("127.0.0.1", "localhost")
    shared_secret: Annotated[SecretStr, Field(min_length=SHARED_SECRET_MIN_LENGTH)]
    database_url: str = "sqlite:///./cadence.db"

    # Scoring weights. Tunable without touching code; must sum to 1.0.
    weight_deadline: float = 0.35
    weight_importance: float = 0.25
    weight_slip: float = 0.15
    weight_unblocks: float = 0.15
    weight_age: float = 0.10
    horizon_days: int = 14

    def score_weights(self) -> ScoreWeights:
        return ScoreWeights(
            deadline=self.weight_deadline,
            importance=self.weight_importance,
            slip=self.weight_slip,
            unblocks=self.weight_unblocks,
            age=self.weight_age,
            horizon_days=self.horizon_days,
        )
