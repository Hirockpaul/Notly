from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ActionItem(BaseModel):
    task: str = Field(min_length=1)
    owner: str | None = None
    deadline: str | None = None

    @field_validator("task", "owner", "deadline")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class NotesDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1)
    summary: str | None = None
    key_points: list[str] = Field(default_factory=list, alias="keyPoints")
    action_items: list[ActionItem] = Field(default_factory=list, alias="actionItems")
    important_information: list[str] = Field(default_factory=list, alias="importantInformation")
    decisions: list[str] = Field(default_factory=list)
    additional_context: list[str] = Field(default_factory=list, alias="additionalContext")

    @field_validator("title", "summary")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("key_points", "important_information", "decisions", "additional_context")
    @classmethod
    def clean_list(cls, values: list[str]) -> list[str]:
        return [value.strip() for value in values if value.strip()]

    @model_validator(mode="after")
    def require_useful_content(self) -> "NotesDocument":
        if not any(
            (
                self.summary,
                self.key_points,
                self.action_items,
                self.important_information,
                self.decisions,
                self.additional_context,
            )
        ):
            raise ValueError("Generated notes do not contain any useful sections.")
        return self
