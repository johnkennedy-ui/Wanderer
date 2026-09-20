#!/usr/bin/env python3
"""Per-command inherited-group guardian for scanner supervision.

The guardian is a Linux child subreaper.  It intentionally remains in the
caller’s process group: an outer uncatchable group kill still contains it.
Unlike telemetry, subreaping survives a scanner ancestor or the inner
supervisor exiting, so ordinary descendants are adopted before cleanup.
"""

import ctypes
import errno
import fcntl
import json
import os
import re
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
TERMINATIONS = {"timeout", "overflow", "interrupted", "control-eof"}
STATUS_TERMINATIONS = TERMINATIONS | {"none", "cleanup-deadline", "spawn-error"}
STATUS_LIMIT = 64 * 1024
STATUS_DRAIN_CHUNK_LIMIT = 32
STATUS_DRAIN_TIME_LIMIT = 0.005
STATUS_KEYS = {"version", "exitCode", "signal", "termination", "reaping", "error"}


def valid_status_receipt(receipt):
    """Validate bounded supervisor receipt frames before using their contents."""
    if not isinstance(receipt, dict) or set(receipt) != STATUS_KEYS:
        return False
    if type(receipt["version"]) is not int or receipt["version"] != 1:
        return False
    termination = receipt["termination"]
    if not isinstance(termination, str) or termination not in STATUS_TERMINATIONS:
        return False
    reaping = receipt["reaping"]
    if not isinstance(reaping, str) or reaping not in {"reaped", "incomplete"}:
        return False
    if receipt["error"] is not None and not isinstance(receipt["error"], str):
        return False
    exit_code = receipt["exitCode"]
    if exit_code is not None and (type(exit_code) is not int or exit_code < 0):
        return False
    signal_name = receipt["signal"]
    if signal_name is not None and (
        not isinstance(signal_name, str) or re.fullmatch(r"SIG[A-Z0-9]+", signal_name) is None
    ):
        return False
    return not (exit_code is None and signal_name is None and receipt["error"] is None)


def qualified_interruption_ack(receipt):
    """Accept only the complete clean terminal receipt for local interruption."""
    return (
        valid_status_receipt(receipt)
        and receipt["termination"] == "interrupted"
        and receipt["reaping"] == "reaped"
        and receipt["error"] is None
    )


def consume_status_payload(status_pending, status_discarding, status_receipt_invalid,
                           interruption_acknowledged, payload):
    """Consume bounded newline-framed receipts without retaining invalid floods."""
    if status_discarding:
        delimiter = payload.find(b"\n")
        if delimiter == -1:
            return status_pending, status_discarding, status_receipt_invalid, interruption_acknowledged
        payload = payload[delimiter + 1:]
        status_discarding = False
    if len(status_pending) + len(payload) > STATUS_LIMIT:
        status_receipt_invalid = True
        status_pending = b""
        status_discarding = b"\n" not in payload
        if status_discarding:
            return status_pending, status_discarding, status_receipt_invalid, interruption_acknowledged
        payload = payload.rsplit(b"\n", 1)[1]
    status_pending += payload
    while b"\n" in status_pending:
        frame, status_pending = status_pending.split(b"\n", 1)
        try:
            receipt = json.loads(frame.decode("utf8"))
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError):
            status_receipt_invalid = True
            continue
        if not valid_status_receipt(receipt):
            status_receipt_invalid = True
        elif qualified_interruption_ack(receipt):
            interruption_acknowledged = True
    return status_pending, status_discarding, status_receipt_invalid, interruption_acknowledged


def require_pidfd(fault=None):
    """Prove the exact stable-handle primitive before starting scanner code."""
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


def records():
    """Take an atomic-per-process identity/parent snapshot from /proc/stat."""
    result = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/stat", encoding="utf8") as stat_file:
                tail = stat_file.read().rsplit(")", 1)[1].split()
            result[int(entry)] = {"ppid": int(tail[1]), "startTime": tail[19]}
        except (OSError, ValueError, IndexError):
            continue
    return result


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
    """Require the target's complete recorded chain to reach this guardian."""
    visited = set()
    while pid != os.getpid():
        if pid in visited or current.get(pid) != snapshot.get(pid):
            return False
        visited.add(pid)
        pid = snapshot[pid]["ppid"]
    return current.get(pid) == snapshot.get(pid)


def reap():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


def signal_snapshot(snapshot, which):
    """Signal only post-acquisition verified Linux pidfds."""
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
            # The check happens after the stable-handle acquisition. A
            # replacement cannot pass it, and later reuse cannot receive this
            # fd's signal.
            if not owns_snapshot_identity(snapshot, records(), pid):
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


def write_status(status_fd, termination, reaping, error):
    try:
        os.write(
            status_fd,
            (json.dumps({"version": 1, "exitCode": None, "signal": None,
                        "termination": termination, "reaping": reaping,
                        "error": error}, separators=(",", ":")) + "\n").encode(),
        )
        return True
    except OSError:
        return False


def main():
    supervisor, command, cwd, grace_ms, deadline_ms, *fault = sys.argv[1:]
    test_fault = fault[0] if fault else None
    reason = {"value": None}
    requested_deadline = {"value": None}
    locally_interrupted = {"value": False}

    def interrupted(_signum, _frame):
        reason["value"] = reason["value"] or "interrupted"
        locally_interrupted["value"] = True

    # This closes the launch window for catchable group cancellation.
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    if sys.platform != "linux" or ctypes.CDLL(None).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        write_status(3, "spawn-error", "incomplete", "SCANNER_SUBREAPER_UNSUPPORTED")
        return
    try:
        require_pidfd(test_fault)
    except OSError as error:
        write_status(3, "spawn-error", "incomplete", f"SCANNER_PIDFD_UNAVAILABLE:{error.errno or 'UNKNOWN'}")
        return
    if reason["value"] is not None:
        write_status(3, reason["value"], "reaped", "SCANNER_GUARDIAN_INTERRUPTED_BEFORE_LAUNCH")
        return
    status_read, status_write = os.pipe()
    ownership_read, ownership_write = os.pipe()
    def wire_protocol_fds():
        os.dup2(status_write, 3)
        os.dup2(ownership_write, 4)

    child = subprocess.Popen(
        [sys.executable, supervisor, command, cwd, grace_ms, deadline_ms, *fault],
        stdin=subprocess.PIPE,
        stdout=sys.stdout,
        stderr=sys.stderr,
        pass_fds=(status_write, ownership_write, 3, 4),
        preexec_fn=wire_protocol_fds,
        close_fds=True,
    )
    os.close(status_write)
    os.close(ownership_write)
    control_fd = child.stdin.fileno()
    os.set_blocking(control_fd, False)
    if test_fault == "eof-unread-control":
        # Test-only fault injection: make the real supervisor control pipe
        # full without blocking the guardian, so EOF handling cannot hide a
        # blocking control write or defer deadline escalation.
        fcntl.fcntl(control_fd, fcntl.F_SETPIPE_SZ, 4096)
        while True:
            try:
                os.write(control_fd, b"x" * 4096)
            except BlockingIOError:
                break
    for protocol_fd in (3, 4):
        os.set_blocking(protocol_fd, False)
    started = None
    kill_at = None
    final_at = None
    cleanup_error = None
    forwarded_status = False
    status_pending = b""
    status_discarding = False
    status_receipt_invalid = False
    interruption_acknowledged = False
    supervisor_dead = False
    status_drain_limited = False
    protocol_blocked = set()
    watched = {sys.stdin, status_read, ownership_read}
    control_pending = b""
    control_forwarded = None
    control_failed = False
    eof_watcher_observed = False
    post_poll_barrier_used = False
    status_drain_fixture_saturated = False

    def test_marker(name):
        """Expose only deterministic test-fault milestones to disposable fixtures."""
        if test_fault != "status-drain-quota":
            return
        with open(os.path.join(cwd, name), "w", encoding="utf8") as marker:
            marker.write("1")

    def saturate_status_output_for_test():
        """Fill only the test fixture's nonblocking caller-status pipe."""
        nonlocal status_drain_fixture_saturated
        if status_drain_fixture_saturated or test_fault != "status-drain-quota":
            return
        status_drain_fixture_saturated = True
        while True:
            try:
                os.write(3, b"x" * 65536)
            except BlockingIOError:
                test_marker(".guardian-status-output-blocked")
                return
            except OSError:
                # The caller can disappear; the fixture still must prove that
                # local containment does not retry a blocked protocol write.
                test_marker(".guardian-status-output-blocked")
                return

    def forward_control():
        """Make bounded progress without blocking cleanup on a full pipe."""
        nonlocal control_pending, control_forwarded, control_failed
        if not control_pending or control_failed:
            return
        try:
            written = os.write(control_fd, control_pending)
        except BlockingIOError:
            return
        except (BrokenPipeError, OSError):
            control_pending = b""
            control_failed = True
            return
        control_pending = control_pending[written:]
        if not control_pending:
            control_forwarded = (reason["value"], requested_deadline["value"])

    def begin_termination(value, deadline=None):
        nonlocal final_at, kill_at, control_pending
        now = time.monotonic()
        reason["value"] = reason["value"] or value
        # A caller supplied deadline is absolute.  In particular, do not turn
        # an already-expired deadline into a fresh relative cleanup window.
        candidate_deadline = (
            deadline if deadline is not None else now + int(deadline_ms) / 1000
        )
        previous_deadline = requested_deadline["value"]
        requested_deadline["value"] = (
            candidate_deadline if previous_deadline is None
            else min(previous_deadline, candidate_deadline)
        )
        if final_at is not None and requested_deadline["value"] < final_at:
            final_at = requested_deadline["value"]
            reserve = min(0.250, max(0.0005, (final_at - now) / 3))
            kill_at = max(now, final_at - reserve)
        effective = (reason["value"], requested_deadline["value"])
        if effective != control_forwarded and not control_failed:
            control_pending = (
                f"{effective[0]} {effective[1] * 1000:.3f}\n"
            ).encode()

    def forward_protocol(fd, payload):
        nonlocal forwarded_status, status_pending, status_discarding
        nonlocal status_receipt_invalid, interruption_acknowledged
        if fd == status_read:
            (
                status_pending,
                status_discarding,
                status_receipt_invalid,
                interruption_acknowledged,
            ) = consume_status_payload(
                status_pending,
                status_discarding,
                status_receipt_invalid,
                interruption_acknowledged,
                payload,
            )
        if fd in protocol_blocked:
            return
        try:
            written = os.write(3 if fd == status_read else 4, payload)
            if written != len(payload):
                raise BlockingIOError(errno.EAGAIN, "partial protocol frame")
            forwarded_status = forwarded_status or fd == status_read
            if fd == status_read and test_fault == "status-drain-quota":
                # Forward the first clean receipt, then make later status
                # forwarding exercise the real nonblocking failure path.
                test_marker(".guardian-valid-status-forwarded")
                saturate_status_output_for_test()
        except BlockingIOError:
            protocol_blocked.add(fd)
            if fd == status_read:
                status_receipt_invalid = True
                test_marker(".guardian-status-forward-blocked")
        except OSError:
            # The caller can disappear; the guardian remains responsible.
            protocol_blocked.add(fd)
            if fd == status_read:
                status_receipt_invalid = True
            begin_termination("control-eof")

    def read_protocol(fd):
        if (
            fd == status_read
            and test_fault == "status-drain-quota"
            and status_drain_fixture_saturated
            and child.poll() is None
        ):
            # Keep the retained descriptor readable until the direct
            # supervisor has exited. drain_status() must then enforce its
            # bounded read quota rather than a lucky pre-poll select branch.
            test_marker(".guardian-status-deferred")
            return True
        try:
            payload = os.read(fd, 65536)
        except BlockingIOError:
            return True
        except OSError:
            payload = b""
        if not payload:
            watched.discard(fd)
            begin_termination("control-eof")
            return False
        forward_protocol(fd, payload)
        return True

    def drain_status():
        """Drain bytes queued before a supervisor exit is finalized."""
        nonlocal status_drain_limited, status_receipt_invalid
        started_draining = time.monotonic()
        for _ in range(STATUS_DRAIN_CHUNK_LIMIT):
            if time.monotonic() - started_draining >= STATUS_DRAIN_TIME_LIMIT:
                status_drain_limited = True
                status_receipt_invalid = True
                test_marker(".guardian-status-drain-limited")
                return
            if status_read not in watched:
                return
            readable, _, _ = select.select([status_read], [], [], 0)
            if not readable or not read_protocol(status_read):
                return
        status_drain_limited = True
        status_receipt_invalid = True
        test_marker(".guardian-status-drain-limited")

    if reason["value"] is not None:
        begin_termination(reason["value"])

    while True:
        if test_fault == "eof-unread-control" and eof_watcher_observed:
            with open(
                os.path.join(cwd, ".guardian-eof-watcher"),
                "w",
                encoding="utf8",
            ) as marker:
                marker.write("absent" if sys.stdin not in watched else "present")
            test_fault = None
        readable, writable, _ = select.select(
            list(watched), [control_fd] if control_pending else [], [], 0.025
        )
        if (
            test_fault == "post-poll-drain"
            and not post_poll_barrier_used
            and status_read in readable
        ):
            # Deterministically exercise the stale-readiness ordering: the
            # supervisor has exited while status_read is ready, but the
            # guardian resumes with that descriptor excluded so child.poll()
            # must be followed by drain_status(). This is test-only.
            post_poll_barrier_used = True
            os.kill(os.getpid(), signal.SIGSTOP)
            readable = [fd for fd in readable if fd != status_read]
        if control_fd in writable:
            forward_control()
        for fd in readable:
            if fd == sys.stdin:
                control = sys.stdin.readline()
                if not control:
                    watched.discard(sys.stdin)
                    eof_watcher_observed = True
                parts = control.strip().split(maxsplit=1) if control else ["control-eof"]
                deadline = None
                if len(parts) == 2:
                    try:
                        deadline = float(parts[1]) / 1000
                    except ValueError:
                        deadline = None
                if parts[0] in TERMINATIONS:
                    begin_termination(parts[0], deadline)
            else:
                read_protocol(fd)
        if reason["value"] is not None:
            begin_termination(reason["value"])
        now = time.monotonic()
        status = child.poll()
        # Do not use waitpid(-1) while Popen still owns the inner supervisor:
        # it would consume that status and can turn a nonzero exit into 0.
        if status is not None:
            drain_status()
            reap()
        if status is not None and not supervisor_dead:
            supervisor_dead = True
            if not forwarded_status:
                begin_termination("control-eof")
        current = records()
        survivors = descendants(current)
        if (reason["value"] is not None or (supervisor_dead and survivors)) and final_at is None:
            final_at = requested_deadline["value"] if requested_deadline["value"] is not None else now + int(deadline_ms) / 1000
            reserve = min(0.250, max(0.0005, (final_at - now) / 3))
            # Both Python processes receive the same absolute deadline; this
            # is the guardian's final kill/reap slice, not another window.
            kill_at = max(now, final_at - reserve)
        needs_cleanup = supervisor_dead and bool(survivors)
        if kill_at is not None and now >= kill_at:
            needs_cleanup = True
        if needs_cleanup and started is None:
            started = now
            try:
                signal_snapshot(current, signal.SIGTERM)
            except OSError as error:
                cleanup_error = f"SCANNER_PIDFD_SIGNAL:{error.errno or 'UNKNOWN'}"
            # The first TERM was deliberately scheduled at final_at-reserve.
            # Do not give it a new grace window that consumes that reserve.
            kill_at = min(kill_at, now + int(grace_ms) / 1000, final_at)
        if started is not None and now >= kill_at:
            try:
                signal_snapshot(records(), signal.SIGKILL)
            except OSError as error:
                cleanup_error = cleanup_error or f"SCANNER_PIDFD_SIGNAL:{error.errno or 'UNKNOWN'}"
            # Reconsider late/adopted descendants on every bounded pass.
            kill_at = now + 0.025
        if not survivors:
            if supervisor_dead:
                if status_receipt_invalid or status_pending or status_discarding:
                    write_status(3, reason["value"] or "control-eof", "incomplete", "SCANNER_SUPERVISOR_STATUS_INVALID")
                    sys.exit(1)
                if locally_interrupted["value"] and not interruption_acknowledged:
                    write_status(3, "interrupted", "incomplete", "SCANNER_GUARDIAN_INTERRUPTED")
                    sys.exit(1)
                if not forwarded_status:
                    if status == 0:
                        # A clean process with no frame remains a protocol fault.
                        return
                    write_status(3, reason["value"] or "control-eof", "reaped" if cleanup_error is None else "incomplete", cleanup_error or "SCANNER_SUPERVISOR_DIED")
                if status not in (None, 0) or not forwarded_status:
                    sys.exit(1)
                return
        if final_at is not None and now >= final_at:
            write_status(3, reason["value"] or "control-eof", "incomplete", cleanup_error or "SCANNER_CLEANUP_DEADLINE")
            sys.exit(1)


if __name__ == "__main__":
    main()
