import os

import uvicorn

from app.parent_monitor import start_parent_monitor


def main() -> None:
    port = int(os.environ.get("NOTO_BACKEND_PORT", "8765"))
    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        access_log=False,
        timeout_graceful_shutdown=2,
    )
    server = uvicorn.Server(config)
    start_parent_monitor(lambda: setattr(server, "should_exit", True))
    server.run()


if __name__ == "__main__":
    main()
