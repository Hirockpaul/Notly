import subprocess
import sys
import threading
from pathlib import Path

from app.parent_monitor import (
    _wait_for_windows_parent,
    linux_process_start_time,
    monitor_linux_parent,
    monitor_windows_parent,
    start_parent_monitor,
)


def write_stat(proc_root: Path, pid: int, start_time: str) -> None:
    process = proc_root / str(pid)
    process.mkdir()
    fields = ["S"] + ["0"] * 18 + [start_time] + ["0"] * 5
    (process / "stat").write_text(f"{pid} (Noto parent with spaces) {' '.join(fields)}")


def test_linux_process_identity_handles_spaces_in_process_name(tmp_path: Path) -> None:
    write_stat(tmp_path, 42, "987654")
    assert linux_process_start_time(42, tmp_path) == "987654"


def test_parent_missing_before_backend_initialization_exits_immediately(tmp_path: Path) -> None:
    exited = threading.Event()
    monitor_linux_parent(999999, "missing", exited.set, proc_root=tmp_path)
    assert exited.is_set()


def test_linux_pidfd_is_opened_before_identity_is_checked(tmp_path: Path, monkeypatch) -> None:
    exited = threading.Event()
    events: list[str] = []
    monkeypatch.setattr(
        "app.parent_monitor.linux_process_start_time",
        lambda _pid, _root: events.append("identity") or "real-start",
    )
    monkeypatch.setattr("app.parent_monitor.os.close", lambda fd: events.append(f"close:{fd}"))

    class Poller:
        def register(self, fd: int, _events: int) -> None:
            events.append(f"register:{fd}")

        def poll(self) -> None:
            events.append("poll")

    monitor_linux_parent(
        42,
        "real-start",
        exited.set,
        proc_root=tmp_path,
        pidfd_open=lambda pid: events.append(f"open:{pid}") or 71,
        poll_factory=lambda: Poller(),
    )
    assert exited.is_set()
    assert events == ["open:42", "identity", "register:71", "poll", "close:71"]


def test_linux_identity_mismatch_closes_opened_pidfd(tmp_path: Path, monkeypatch) -> None:
    write_stat(tmp_path, 42, "real-start")
    closed: list[int] = []
    monkeypatch.setattr("app.parent_monitor.os.close", closed.append)
    exited = threading.Event()
    monitor_linux_parent(
        42, "stale-start", exited.set, proc_root=tmp_path, pidfd_open=lambda _pid: 71
    )
    assert exited.is_set()
    assert closed == [71]


def test_linux_missing_proc_data_closes_opened_pidfd(tmp_path: Path, monkeypatch) -> None:
    closed: list[int] = []
    monkeypatch.setattr("app.parent_monitor.os.close", closed.append)
    exited = threading.Event()
    monitor_linux_parent(42, "expected", exited.set, proc_root=tmp_path, pidfd_open=lambda _pid: 72)
    assert exited.is_set()
    assert closed == [72]


def test_linux_pidfd_open_failure_fails_closed(tmp_path: Path) -> None:
    exited = threading.Event()

    def fail(_pid: int) -> int:
        raise ProcessLookupError

    monitor_linux_parent(42, "expected", exited.set, proc_root=tmp_path, pidfd_open=fail)
    assert exited.is_set()


def test_real_pidfd_detects_parent_exit_without_heartbeat() -> None:
    if not sys.platform.startswith("linux"):
        return
    owner = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    exited = threading.Event()
    monitor = threading.Thread(
        target=monitor_linux_parent,
        args=(owner.pid, linux_process_start_time(owner.pid), exited.set),
        daemon=True,
    )
    try:
        monitor.start()
        owner.terminate()
        owner.wait(timeout=5)
        assert exited.wait(timeout=5)
        assert unrelated.poll() is None
    finally:
        if owner.poll() is None:
            owner.kill()
            owner.wait(timeout=5)
        unrelated.terminate()
        unrelated.wait(timeout=5)


def test_development_without_owner_metadata_does_not_start_monitor() -> None:
    assert start_parent_monitor(lambda: None, {}) is None


def test_windows_parent_handle_is_identity_checked_before_waiting() -> None:
    events: list[str] = []
    monitor_windows_parent(
        42,
        "123456",
        lambda: events.append("exit"),
        open_parent=lambda pid: events.append(f"open:{pid}") or 99,
        get_creation_time=lambda handle: events.append(f"identity:{handle}") or "123456",
        wait_for_parent=lambda handle: events.append(f"wait:{handle}"),
        close_handle=lambda handle: events.append(f"close:{handle}"),
    )
    assert events == ["open:42", "identity:99", "wait:99", "close:99", "exit"]


def test_windows_reused_pid_is_not_trusted_or_waited_on() -> None:
    events: list[str] = []
    monitor_windows_parent(
        42,
        "expected",
        lambda: events.append("exit"),
        open_parent=lambda _pid: 99,
        get_creation_time=lambda _handle: "different",
        wait_for_parent=lambda _handle: events.append("wait"),
        close_handle=lambda handle: events.append(f"close:{handle}"),
    )
    assert events == ["exit", "close:99"]


def test_windows_missing_identity_fails_closed() -> None:
    events: list[str] = []
    monitor_windows_parent(
        42,
        "",
        lambda: events.append("exit"),
        open_parent=lambda _pid: 99,
        get_creation_time=lambda _handle: "123456",
        wait_for_parent=lambda _handle: events.append("wait"),
        close_handle=lambda handle: events.append(f"close:{handle}"),
    )
    assert events == ["exit", "close:99"]


def test_windows_wait_object_reports_parent_termination() -> None:
    calls: list[tuple[int, int]] = []
    _wait_for_windows_parent(
        99, wait_for_single_object=lambda handle, timeout: calls.append((handle, timeout)) or 0
    )
    assert calls == [(99, 0xFFFFFFFF)]


def test_windows_wait_timeout_continues_waiting() -> None:
    results = iter([0x102, 0])
    _wait_for_windows_parent(99, wait_for_single_object=lambda _handle, _timeout: next(results))


def test_windows_wait_failure_reports_last_error() -> None:
    import pytest

    with pytest.raises(OSError, match="Windows error 6"):
        _wait_for_windows_parent(
            99,
            wait_for_single_object=lambda _handle, _timeout: 0xFFFFFFFF,
            get_last_error=lambda: 6,
        )


def test_windows_wait_failure_still_closes_parent_handle() -> None:
    import pytest

    events: list[str] = []
    with pytest.raises(OSError, match="wait failed"):
        monitor_windows_parent(
            42,
            "expected",
            lambda: events.append("exit"),
            open_parent=lambda _pid: 99,
            get_creation_time=lambda _handle: "expected",
            wait_for_parent=lambda _handle: (_ for _ in ()).throw(OSError("wait failed")),
            close_handle=lambda handle: events.append(f"close:{handle}"),
        )
    assert events == ["close:99"]


def test_windows_wait_unexpected_result_is_an_error() -> None:
    import pytest

    with pytest.raises(OSError, match="unexpected result"):
        _wait_for_windows_parent(99, wait_for_single_object=lambda _handle, _timeout: 7)
