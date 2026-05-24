"""
Wire protocol shared with src/lib/protocol.ts in the extension.
Keep these models in sync with the TypeScript source of truth.
"""

from __future__ import annotations

from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

PROTOCOL_VERSION = "1"


class ScreenshotPayload(BaseModel):
    mime: Literal["image/png", "image/jpeg"]
    data_base64: str


class PageBody(BaseModel):
    excerpt: Optional[str] = None
    content_text: str
    length: int
    truncated: bool


class PageContext(BaseModel):
    url: str = ""
    title: str = ""
    selection: Optional[str] = None
    page: Optional[PageBody] = None
    screenshot: Optional[ScreenshotPayload] = None
    captured_at: int


# Client → server
class HelloIn(BaseModel):
    type: Literal["hello"]
    protocol_version: str
    client_id: str
    client_version: str
    ua: str
    tools: list[str] = Field(default_factory=list)


class UserMessageIn(BaseModel):
    type: Literal["user_message"]
    message_id: str
    text: str
    page_context: Optional[PageContext] = None
    ts: int


class ToolResultOk(BaseModel):
    ok: Literal[True]
    result: Any


class ToolResultErr(BaseModel):
    ok: Literal[False]
    error: str


class ToolResultIn(BaseModel):
    type: Literal["tool_result"]
    call_id: str
    tool: str
    result: ToolResultOk | ToolResultErr
    ts: int


class PingIn(BaseModel):
    type: Literal["ping"]
    ts: int


ClientMessage = HelloIn | UserMessageIn | ToolResultIn | PingIn


# Server → client
class WelcomeOut(BaseModel):
    type: Literal["welcome"] = "welcome"
    session_id: str
    greeting: Optional[str] = None


class TypingOut(BaseModel):
    type: Literal["typing"] = "typing"
    on: bool


class AssistantMessageOut(BaseModel):
    type: Literal["assistant_message"] = "assistant_message"
    message_id: str
    text: str
    ts: int


class AssistantMessageStartOut(BaseModel):
    type: Literal["assistant_message_start"] = "assistant_message_start"
    message_id: str
    ts: int


class AssistantMessageDeltaOut(BaseModel):
    type: Literal["assistant_message_delta"] = "assistant_message_delta"
    message_id: str
    delta: str


class AssistantMessageEndOut(BaseModel):
    type: Literal["assistant_message_end"] = "assistant_message_end"
    message_id: str
    ts: int


class SystemOut(BaseModel):
    type: Literal["system"] = "system"
    level: Literal["info", "warn", "error"] = "info"
    message: str


class ErrorOut(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str


class ToolCallOut(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    call_id: str
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class PongOut(BaseModel):
    type: Literal["pong"] = "pong"
    ts: int


ServerMessage = (
    WelcomeOut
    | TypingOut
    | AssistantMessageOut
    | AssistantMessageStartOut
    | AssistantMessageDeltaOut
    | AssistantMessageEndOut
    | SystemOut
    | ErrorOut
    | ToolCallOut
    | PongOut
)


def parse_client(raw: dict) -> ClientMessage:
    t = raw.get("type")
    if t == "hello":
        return HelloIn.model_validate(raw)
    if t == "user_message":
        return UserMessageIn.model_validate(raw)
    if t == "tool_result":
        return ToolResultIn.model_validate(raw)
    if t == "ping":
        return PingIn.model_validate(raw)
    raise ValueError(f"unknown client message type: {t!r}")
