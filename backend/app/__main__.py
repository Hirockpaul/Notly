import os

import uvicorn


def main() -> None:
    port = int(os.environ.get("NOTO_BACKEND_PORT", "8765"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, access_log=False)


if __name__ == "__main__":
    main()
