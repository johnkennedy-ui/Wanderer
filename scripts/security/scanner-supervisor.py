#!/usr/bin/env python3
"""Own-process Linux subreaper for one scanner command.

This process deliberately stays in its inherited process group.  The outer
agent runner therefore still contains the scanner, this supervisor, and all
ordinary descendants if it has to send an uncatchable group SIGKILL.
"""

import ctypes
import errno
import json
import os
import select
import signal
import subprocess
import sys
import time

PR_SET_CHILD_SUBREAPER = 36
LIBC = ctypes.CDLL(None, use_errno=True)
PIDFD_SEND_SIGNAL = getattr(LIBC, "pidfd_send_signal", None)
if PIDFD_SEND_SIGNAL is not None:
    PIDFD_SEND_SIGNAL.argtypes = (ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint)
    PIDFD_SEND_SIGNAL.restype = ctypes.c_int
STATUS_VERSION = 1
TERMINATIONS = {
    "none",
    "timeout",
    "overflow",
    "interrupted",
    "control-eof",
    "cleanup-deadline",
    "spawn-error",
}


def require_pidfd(fault=None):
    """Admit scanner launch only when stable signaling is available."""
    if fault == "pidfd-missing" or not hasattr(os, "pidfd_open") or PIDFD_SEND_SIGNAL is None:
        raise OSError(errno.ENOSYS, "pidfd unavailable")
    if fault == "pidfd-enosys":
        raise OSError(errno.ENOSYS, "pidfd unavailable")
    if fault == "pidfd-eperm":
        raise OSError(errno.EPERM, "pidfd unavailable")
    pidfd = os.pidfd_open(os.getpid(), 0)
    try:
        if PIDFD_SEND_SIGNAL(pidfd, 0, None, 0) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error))
    finally:
        os.close(pidfd)


def proc_records():
    """Return creation identity and parent from one /proc/stat read per PID."""
    records = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/stat", encoding="utf8") as stat_file:
                # The comm field is parenthesized and can contain whitespace.
                tail = stat_file.read().rsplit(")", 1)[1].split()
            records[int(entry)] = {"ppid": int(tail[1]), "startTime": tail[19]}
        except (OSError, ValueError, IndexError):
            continue
    return records


def descendants(snapshot):
    result = []
    frontier = [os.getpid()]
    while frontier:
        parent = frontier.pop()
        children = [pid for pid, record in snapshot.items() if record["ppid"] == parent]
        result.extend(children)
        frontier.extend(children)
    return result


def owns_snapshot_identity(snapshot, current, pid):
    """Require the target's complete recorded chain to reach this supervisor."""
    visited = set()
    while pid != os.getpid():
        if pid in visited or current.get(pid) != snapshot.get(pid):
            return False
        visited.add(pid)
        pid = snapshot[pid]["ppid"]
    return current.get(pid) == snapshot.get(pid)


def signal_children(snapshot, which):
    """Signal only identities pinned by a Linux pidfd, never a bare PID."""
    if not hasattr(os, "pidfd_open") or PIDFD_SEND_SIGNAL is None:
        return False
    first_error = None
    for pid in reversed(descendants(snapshot)):
        expected = snapshot.get(pid)
        try:
            pidfd = os.pidfd_open(pid, 0)
        except OSError as error:
            if error.errno == errno.ESRCH:
                continue
            if first_error is None:
                first_error = error
            continue
        try:
            # Acquire first, then prove the fd still names the exact
            # identity/parent snapshot. A PID replaced before acquisition is
            # rejected; one replaced afterwards cannot be signalled through
            # this fd.
            if not owns_snapshot_identity(snapshot, proc_records(), pid):
                continue
            if PIDFD_SEND_SIGNAL(pidfd, int(which), None, 0) != 0:
                error = ctypes.get_errno()
                if error != errno.ESRCH:
                    if first_error is None:
                        first_error = OSError(error, os.strerror(error))
        finally:
            os.close(pidfd)
    if first_error is not None:
        raise first_error
    return True


def decode_wait_status(wait_status):
    if os.WIFEXITED(wait_status):
        return {"exitCode": os.WEXITSTATUS(wait_status), "signal": None}
    if os.WIFSIGNALED(wait_status):
        return {
            "exitCode": None,
            "signal": signal.Signals(os.WTERMSIG(wait_status)).name,
        }
    return {"exitCode": None, "signal": None}


def reap_available(root_pid, root_status):
    """Reap every child while retaining the direct root's real wait status."""
    while True:
        try:
            pid, wait_status = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return root_status
        if pid == 0:
            return root_status
        if pid == root_pid:
            root_status = decode_wait_status(wait_status)


def write_status(status_file, exit_code, root_signal, termination, reaping, error):
    status_file.write(
        json.dumps(
            {
                "version": STATUS_VERSION,
                "exitCode": exit_code,
                "signal": root_signal,
                "termination": termination,
                "reaping": reaping,
                "error": error,
            },
            separators=(",", ":"),
        )
        + "\n"
    )
    status_file.flush()


def write_owned_processes(root_identity_file, root_identity, snapshot, current_descendants):
    descendants = [
        {"pid": pid, "startTime": snapshot[pid]["startTime"]}
        for pid in current_descendants
        if pid in snapshot
    ]
    try:
        root_identity_file.write(
            json.dumps(
                {
                    "version": STATUS_VERSION,
                    "root": root_identity,
                    "descendants": descendants,
                },
                separators=(",", ":"),
            )
            + "\n"
        )
        root_identity_file.flush()
        return True
    except (BrokenPipeError, OSError):
        return False


def main():
    status_file = os.fdopen(3, "w", encoding="utf8", closefd=True)
    root_identity_file = os.fdopen(4, "w", encoding="utf8", closefd=True)
    if sys.platform != "linux" or ctypes.CDLL(None).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        write_status(
            status_file,
            None,
            None,
            "spawn-error",
            "incomplete",
            "SCANNER_SUBREAPER_UNSUPPORTED",
        )
        return

    status_fault = sys.argv[5] if len(sys.argv) == 6 else None
    try:
        require_pidfd(status_fault)
    except OSError as error:
        write_status(
            status_file,
            None,
            None,
            "spawn-error",
            "incomplete",
            f"SCANNER_PIDFD_UNAVAILABLE:{error.errno or 'UNKNOWN'}",
        )
        return

    reason = {"value": None}

    def interrupted(_signum, _frame):
        reason["value"] = reason["value"] or "interrupted"

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    command = json.loads(sys.argv[1])
    cwd = sys.argv[2]
    grace_ms = max(1, int(sys.argv[3]))
    cleanup_deadline_ms = max(1, int(sys.argv[4]))
    try:
        root = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL)
    except OSError as error:
        write_status(
            status_file,
            None,
            None,
            "spawn-error",
            "reaped",
            f"SCANNER_SPAWN_ERROR:{error.errno or 'UNKNOWN'}",
        )
        return
    initial_records = proc_records()
    root_record = initial_records.get(root.pid)
    root_identity = ({"pid": root.pid, "startTime": root_record["startTime"]}
                     if root_record is not None else None)
    if status_fault == "ownership-flood":
        for _index in range(1200):
            snapshot = proc_records()
            if not write_owned_processes(root_identity_file, root_identity, snapshot, descendants(snapshot)):
                reason["value"] = "control-eof"
    root_status = None
    termination_started = None
    requested_deadline = None
    cleanup_error = None
    kill_sent = False
    cleanup_deadline = None
    kill_deadline = None
    reap_deadline = None
    while True:
        try:
            readable, _, _ = select.select([sys.stdin], [], [], 0.025)
        except InterruptedError:
            readable = []
        if readable:
            control = sys.stdin.readline()
            if control == "":
                reason["value"] = reason["value"] or "control-eof"
            else:
                parts = control.strip().split(maxsplit=1)
                if parts and parts[0] in TERMINATIONS:
                    reason["value"] = reason["value"] or parts[0]
                    if len(parts) == 2:
                        try:
                            requested_deadline = float(parts[1]) / 1000
                        except ValueError:
                            requested_deadline = None

        root_status = reap_available(root.pid, root_status)
        snapshot = proc_records()
        current_descendants = descendants(snapshot)
        if not write_owned_processes(root_identity_file, root_identity, snapshot, current_descendants):
            reason["value"] = reason["value"] or "control-eof"
        if root_status is not None and not current_descendants:
            break

        now = time.monotonic()
        if reason["value"] and termination_started is None:
            try:
                signal_children(snapshot, signal.SIGTERM)
            except OSError as error:
                cleanup_error = f"SCANNER_PIDFD_SIGNAL:{error.errno or 'UNKNOWN'}"
            termination_started = now
            cleanup_deadline = max(now, requested_deadline or 0) if requested_deadline else now + cleanup_deadline_ms / 1000
            reserve = min(0.250, max(0.0005, (cleanup_deadline - now) / 2))
            kill_deadline = min(
                now + grace_ms / 1000,
                cleanup_deadline - reserve,
            )
        if (
            termination_started is not None
            and not kill_sent
            and now >= kill_deadline
        ):
            try:
                signal_children(proc_records(), signal.SIGKILL)
            except OSError as error:
                cleanup_error = cleanup_error or f"SCANNER_PIDFD_SIGNAL:{error.errno or 'UNKNOWN'}"
            # Fresh identity-bound passes include late/adopted descendants.
            kill_deadline = now + 0.025
            reap_deadline = cleanup_deadline
        if reap_deadline is not None and now >= reap_deadline:
            break

    root_status = reap_available(root.pid, root_status)
    reaping = "reaped" if not descendants(proc_records()) and cleanup_error is None else "incomplete"
    if status_fault == "missing":
        return
    if status_fault == "truncated":
        status_file.write('{"version":1')
        status_file.flush()
        return
    if status_fault == "malformed":
        status_file.write("not-json\n")
        status_file.flush()
        return
    if status_fault == "contradictory":
        write_status(status_file, 0, "SIGTERM", "none", "reaped", None)
        return
    if status_fault == "mismatch":
        write_status(
            status_file,
            root_status["exitCode"] if root_status else None,
            root_status["signal"] if root_status else None,
            "none",
            reaping,
            None,
        )
        return
    if status_fault == "incomplete":
        write_status(
            status_file,
            root_status["exitCode"] if root_status else None,
            root_status["signal"] if root_status else None,
            reason["value"] or "none",
            "incomplete",
            None,
        )
        return
    if status_fault == "unclean":
        write_status(
            status_file,
            root_status["exitCode"] if root_status else None,
            root_status["signal"] if root_status else None,
            "control-eof",
            reaping,
            None,
        )
        return
    write_status(
        status_file,
        root_status["exitCode"] if root_status else None,
        root_status["signal"] if root_status else None,
        reason["value"] or "none",
        reaping,
        cleanup_error or (None if root_status is not None else "SCANNER_ROOT_STATUS_UNKNOWN"),
    )
    if status_fault == "supervisor-nonzero":
        sys.exit(7)
    if status_fault == "supervisor-signal":
        signal.raise_signal(signal.SIGKILL)


if __name__ == "__main__":
    main()
