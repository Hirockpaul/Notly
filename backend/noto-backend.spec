from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = collect_all("uvicorn")

a = Analysis(
    ["app/__main__.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + ["app.main", "app.parent_monitor", "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on"],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="noto-backend", console=True)
