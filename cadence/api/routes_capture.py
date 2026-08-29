"""Capture routes.

One endpoint turns a sentence into a change. There is deliberately no confirmation step:
the parsed chip plus undo is the correction path, per the design's autonomy decision.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from cadence.api.dependencies import CaptureDep
from cadence.api.schemas import TaskResponse
from cadence.services.capture_service import CaptureView

router = APIRouter(prefix="/api/capture", tags=["capture"])


class CaptureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    utterance: str = Field(min_length=1, max_length=2000)


class ChipFieldResponse(BaseModel):
    label: str
    value: str


class ParsedChipResponse(BaseModel):
    kind: str
    summary: str
    fields: list[ChipFieldResponse]


class CaptureResponse(BaseModel):
    intent: str
    chip: ParsedChipResponse | None
    task: TaskResponse | None
    question: str | None
    candidates: list[str]
    mutation_id: str | None
    provider: str
    model_calls: int
    degraded: bool

    @classmethod
    def of(cls, view: CaptureView) -> CaptureResponse:
        outcome = view.outcome
        chip = outcome.chip
        return cls(
            intent=outcome.intent_kind,
            chip=(
                ParsedChipResponse(
                    kind=chip.kind,
                    summary=chip.summary,
                    fields=[
                        ChipFieldResponse(label=field.label, value=field.value)
                        for field in chip.fields
                    ],
                )
                if chip is not None
                else None
            ),
            task=TaskResponse.of(outcome.task) if outcome.task is not None else None,
            question=outcome.clarification.question if outcome.clarification else None,
            candidates=list(outcome.clarification.candidates) if outcome.clarification else [],
            mutation_id=outcome.mutation_id,
            provider=view.provider_name,
            model_calls=view.model_calls,
            degraded=view.degraded,
        )


@router.post("", response_model=CaptureResponse)
def capture(payload: CaptureRequest, service: CaptureDep) -> CaptureResponse:
    return CaptureResponse.of(service.capture(payload.utterance))


@router.post("/{mutation_id}/undo", response_model=CaptureResponse)
def undo(mutation_id: str, service: CaptureDep) -> CaptureResponse:
    return CaptureResponse.of(service.undo(mutation_id))


class ProviderStatusResponse(BaseModel):
    provider: str
    degraded: bool


@router.get("/status", response_model=ProviderStatusResponse)
def provider_status(service: CaptureDep) -> ProviderStatusResponse:
    provider, degraded = service.status()
    return ProviderStatusResponse(provider=provider, degraded=degraded)
