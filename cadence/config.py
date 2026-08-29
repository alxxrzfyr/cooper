from typing import Annotated, Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

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
