import os
import select
import sys
import threading
from collections.abc import Callable, Mapping
from pathlib import Path


def linux_process_start_time(pid: int, proc_root: Path = Path("/proc")) -> str:
    stat = (proc_root / str(pid) / "stat").read_text(encoding="utf-8")
    closing_parenthesis = stat.rfind(")")
    if closing_parenthesis < 0:
        raise ValueError("Invalid Linux process identity.")
    fields = stat[closing_parenthesis + 2 :].split()
    if len(fields) < 20:
        raise ValueError("Invalid Linux process identity.")
    return fields[19]


def monitor_linux_parent(
    pid: int,
    expected_start_time: str,
    on_parent_exit: Callable[[], None],
    *,
    pidfd_open: Callable[[int], int] | None = None,
    poll_factory: Callable[[], object] | None = None,
    proc_root: Path = Path("/proc"),
) -> None:
    if pid <= 0 or not expected_start_time:
        on_parent_exit()
        return
    if pidfd_open is None:
        pidfd_open = getattr(os, "pidfd_open", None)
    if pidfd_open is None:
        on_parent_exit()
        return
    poll_factory = poll_factory or select.poll
    try:
        pidfd = pidfd_open(pid)
    except OSError:
        on_parent_exit()
        return

    try:
        try:
            actual_start_time = linux_process_start_time(pid, proc_root)
        except (OSError, ValueError):
            on_parent_exit()
            return
        if actual_start_time != expected_start_time:
            on_parent_exit()
            return
        poller = poll_factory()
        poller.register(pidfd, select.POLLIN)
        poller.poll()
    finally:
        os.close(pidfd)
    on_parent_exit()


def _open_windows_parent(pid: int) -> int:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    return kernel32.OpenProcess(0x00100000 | 0x1000, False, pid)


def _windows_process_creation_time(handle: int) -> str:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetProcessTimes.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
        ctypes.POINTER(wintypes.FILETIME),
    ]
    kernel32.GetProcessTimes.restype = wintypes.BOOL
    creation, exit_time, kernel_time, user_time = (wintypes.FILETIME() for _ in range(4))
    if not kernel32.GetProcessTimes(
        handle,
        ctypes.byref(creation),
        ctypes.byref(exit_time),
        ctypes.byref(kernel_time),
        ctypes.byref(user_time),
    ):
        raise OSError(ctypes.get_last_error(), "GetProcessTimes failed")
    return str((creation.dwHighDateTime << 32) | creation.dwLowDateTime)


def _wait_for_windows_parent(
    handle: int,
    *,
    wait_for_single_object: Callable[[int, int], int] | None = None,
    get_last_error: Callable[[], int] | None = None,
) -> None:
    if wait_for_single_object is None:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        wait_for_single_object = kernel32.WaitForSingleObject
        get_last_error = ctypes.get_last_error

    while True:
        result = wait_for_single_object(handle, 0xFFFFFFFF)
        if result == 0x00000000:  # WAIT_OBJECT_0
            return
        if result == 0x00000102:  # WAIT_TIMEOUT
            continue
        if result == 0xFFFFFFFF:  # WAIT_FAILED
            error = get_last_error() if get_last_error is not None else 0
            raise OSError(error, f"WaitForSingleObject failed (Windows error {error})")
        raise OSError(f"WaitForSingleObject returned unexpected result 0x{result:08x}")


def _close_windows_handle(handle: int) -> None:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle(handle)


def monitor_windows_parent(
    pid: int,
    expected_creation_time: str,
    on_parent_exit: Callable[[], None],
    *,
    open_parent: Callable[[int], int] = _open_windows_parent,
    get_creation_time: Callable[[int], str] = _windows_process_creation_time,
    wait_for_parent: Callable[[int], None] = _wait_for_windows_parent,
    close_handle: Callable[[int], None] = _close_windows_handle,
) -> None:
    handle = open_parent(pid)
    if not handle:
        on_parent_exit()
        return
    try:
        try:
            actual_creation_time = get_creation_time(handle)
        except OSError:
            on_parent_exit()
            return
        if not expected_creation_time or actual_creation_time != expected_creation_time:
            on_parent_exit()
            return
        wait_for_parent(handle)
    finally:
        close_handle(handle)
    on_parent_exit()


def start_parent_monitor(
    on_parent_exit: Callable[[], None],
    environ: Mapping[str, str] = os.environ,
) -> threading.Thread | None:
    raw_pid = environ.get("NOTO_PARENT_PID")
    if not raw_pid:
        return None
    try:
        pid = int(raw_pid)
    except ValueError:
        on_parent_exit()
        return None

    if sys.platform.startswith("linux"):
        expected_start_time = environ.get("NOTO_PARENT_START_TIME", "")

        def target() -> None:
            monitor_linux_parent(pid, expected_start_time, on_parent_exit)

    elif sys.platform == "win32":
        expected_start_time = environ.get("NOTO_PARENT_START_TIME", "")

        def target() -> None:
            monitor_windows_parent(pid, expected_start_time, on_parent_exit)

    else:
        return None

    monitor = threading.Thread(target=target, name="noto-parent-monitor", daemon=True)
    monitor.start()
    return monitor
