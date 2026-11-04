from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.audio import router as audio_router
from app.api.routes.health import router as health_router
from app.api.routes.sessions import router as sessions_router
from app.core.config import settings


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        version=settings.api_version,
        docs_url=None,
        redoc_url=None,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_private_network=True,
        allow_methods=["GET", "POST"],
        allow_headers=[
            "Content-Type",
            "X-Noto-Sample-Rate",
            "X-Noto-Channels",
            "X-Noto-Sequence",
            "X-Noto-Session-Id",
        ],
    )
    application.include_router(health_router, prefix=settings.api_prefix)
    application.include_router(audio_router, prefix="/api/audio")
    application.include_router(sessions_router, prefix="/api/sessions")
    return application


app = create_app()
