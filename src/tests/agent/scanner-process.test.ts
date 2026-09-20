import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ProcessIdentity = {
  ppid: number;
  pgrp: number;
  startTime: string;
};

type OwnedProcess = {
  pid: number;
  identity: ProcessIdentity;
};

const {
  consumeOwnershipFrames,
  executeScanner,
  selectOwnedTree,
  selectRecordedProcesses,
} =
  // @ts-expect-error Repository-native ESM helper intentionally has no TS declarations.
  await import("../../../scripts/security/scanner-process.mjs");
const directories: string[] = [];
const groups: {
  pid: number;
  ppid: number;
  pgrp: number;
  startTime: string;
}[] = [];
const node = process.execPath;
const helperUrl = new URL(
  "../../../scripts/security/scanner-process.mjs",
  import.meta.url,
).href;
const fixture = (source: string | ((directory: string) => string)) => {
  const directory = mkdtempSync(join(tmpdir(), "wanderer-scanner-process-"));
  directories.push(directory);
  const path = join(directory, "fixture.cjs");
  writeFileSync(
    path,
    typeof source === "function" ? source(directory) : source,
  );
  return { directory, path };
};
const waitFor = async (check: () => boolean, timeoutMs = 1_500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("fixture did not reach expected state");
};
const noProcess = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
const processState = (pid: number) => {
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8")
      .split(") ")[1]
      .split(" ")[0];
  } catch {
    return "absent";
  }
};
const processIdentity = (pid: number): ProcessIdentity | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(" ");
    return {
      ppid: Number(fields[1]),
      pgrp: Number(fields[2]),
      startTime: fields[19],
    };
  } catch {
    return null;
  }
};
const captureOwnedProcess = (pid: number): OwnedProcess => {
  const identity = processIdentity(pid);
  if (identity === null) throw new Error(`owned process ${pid} disappeared`);
  return { pid, identity };
};
const captureOwnedAncestors = (pid: number) => {
  const ancestors: OwnedProcess[] = [];
  const seen = new Set<number>();
  let ancestorPid = processIdentity(pid)?.ppid ?? 0;
  while (ancestorPid > 0 && !seen.has(ancestorPid)) {
    seen.add(ancestorPid);
    const ancestor = captureOwnedProcess(ancestorPid);
    ancestors.push(ancestor);
    ancestorPid = ancestor.identity.ppid;
  }
  return ancestors;
};
const trackGroup = (pid: number) => {
  const identity = processIdentity(pid);
  if (identity === null) throw new Error(`group leader ${pid} disappeared`);
  groups.push({
    pid,
    ppid: identity.ppid,
    pgrp: identity.pgrp,
    startTime: identity.startTime,
  });
  return pid;
};
const forgetGroup = (pid: number) => {
  const index = groups.findIndex((group) => group.pid === pid);
  if (index >= 0) groups.splice(index, 1);
};
const rescueOwnedProcess = (
  pid: number,
  expectedStartTime: string,
  allowedParents: number[],
) => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      "import ctypes,os,signal,sys\n" +
        "pid=int(sys.argv[1]);expected=sys.argv[2];parents={int(value) for value in sys.argv[3:]}\n" +
        "def identity(value):\n" +
        " try:\n" +
        "  tail=open(f'/proc/{value}/stat',encoding='utf8').read().rsplit(')',1)[1].split()\n" +
        "  return int(tail[1]),tail[19]\n" +
        " except (OSError,IndexError,ValueError): return None\n" +
        "before=identity(pid)\n" +
        "if before is None or before[0] not in parents or before[1] != expected: print('skipped');sys.exit(0)\n" +
        "fd=os.pidfd_open(pid,0)\n" +
        "try:\n" +
        " after=identity(pid)\n" +
        " if after is None or after[0] not in parents or after[1] != expected: print('skipped')\n" +
        " else:\n" +
        "  libc=ctypes.CDLL(None,use_errno=True);send=libc.pidfd_send_signal\n" +
        "  if send(fd,signal.SIGKILL,None,0) == 0: print('sent')\n" +
        "  else: print('skipped')\n" +
        "finally: os.close(fd)",
      String(pid),
      expectedStartTime,
      ...allowedParents.map(String),
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  if (result.error || result.status !== 0)
    throw (
      result.error ?? new Error(result.stderr || "owned process rescue failed")
    );
  return result.stdout.trim() === "sent";
};
const rescueOwnedFixtureProcess = (
  target: OwnedProcess,
  allowedParents: OwnedProcess[],
) => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      "import ctypes,errno,os,signal,sys\n" +
        "pid=int(sys.argv[1]);expected=sys.argv[2];allowed={(int(sys.argv[index]),sys.argv[index+1]) for index in range(3,len(sys.argv),2)}\n" +
        "def identity(value):\n" +
        " try:\n" +
        "  tail=open(f'/proc/{value}/stat',encoding='utf8').read().rsplit(')',1)[1].split()\n" +
        "  return int(tail[1]),tail[19]\n" +
        " except (OSError,IndexError,ValueError): return None\n" +
        "def allowed_parent(record):\n" +
        " parent=identity(record[0])\n" +
        " return parent is not None and (record[0],parent[1]) in allowed\n" +
        "before=identity(pid)\n" +
        "if before is None: print('absent');sys.exit(0)\n" +
        "if before[1] != expected or not allowed_parent(before): print('skipped');sys.exit(0)\n" +
        "try: fd=os.pidfd_open(pid,0)\n" +
        "except OSError as error:\n" +
        " if error.errno == errno.ESRCH: print('absent');sys.exit(0)\n" +
        " raise\n" +
        "try:\n" +
        " after=identity(pid)\n" +
        " if after is None: print('absent')\n" +
        " elif after[1] != expected or not allowed_parent(after): print('skipped')\n" +
        " else:\n" +
        "  libc=ctypes.CDLL(None,use_errno=True);send=libc.pidfd_send_signal\n" +
        "  send.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p,ctypes.c_uint];send.restype=ctypes.c_int\n" +
        "  if send(fd,signal.SIGKILL,None,0) == 0: print('sent')\n" +
        "  elif ctypes.get_errno() == errno.ESRCH: print('absent')\n" +
        "  else: print('skipped')\n" +
        "finally: os.close(fd)",
      String(target.pid),
      target.identity.startTime,
      ...allowedParents.flatMap(({ pid, identity }) => [
        String(pid),
        identity.startTime,
      ]),
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  if (result.error || result.status !== 0)
    throw (
      result.error ??
      new Error(result.stderr || "fixture process rescue failed")
    );
  const outcome = result.stdout.trim();
  if (!["absent", "sent", "skipped"].includes(outcome))
    throw new Error(`unexpected fixture rescue outcome: ${outcome}`);
  return outcome as "absent" | "sent" | "skipped";
};
const requireOwnedFixtureAbsent = async (
  target: OwnedProcess | null,
  allowedParents: OwnedProcess[],
  rescues: string[],
) => {
  if (
    target === null ||
    noProcess(target.pid) ||
    processState(target.pid) === "Z" ||
    processIdentity(target.pid)?.startTime !== target.identity.startTime
  )
    return;
  let lastOutcome = "not-attempted";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = rescueOwnedFixtureProcess(target, allowedParents);
    lastOutcome = outcome;
    if (outcome === "absent") return;
    if (outcome === "sent") {
      rescues.push(outcome);
      await waitFor(
        () =>
          noProcess(target.pid) ||
          processState(target.pid) === "Z" ||
          processIdentity(target.pid)?.startTime !== target.identity.startTime,
        1_000,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `could not safely rescue owned fixture ${target.pid}: ${lastOutcome}; current=${JSON.stringify(processIdentity(target.pid))}; allowed=${JSON.stringify(allowedParents)}`,
  );
};
const rescueOwnedGroup = (group: {
  pid: number;
  ppid: number;
  pgrp: number;
  startTime: string;
}) => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      "import ctypes,os,signal,sys\n" +
        "pid=int(sys.argv[1]);parent=int(sys.argv[2]);pgrp=int(sys.argv[3]);expected=sys.argv[4]\n" +
        "def identity(value):\n" +
        " try:\n" +
        "  tail=open(f'/proc/{value}/stat',encoding='utf8').read().rsplit(')',1)[1].split()\n" +
        "  return int(tail[1]),int(tail[2]),tail[19]\n" +
        " except (OSError,IndexError,ValueError): return None\n" +
        "before=identity(pid)\n" +
        "if before is None or before != (parent,pgrp,expected): sys.exit(0)\n" +
        "libc=ctypes.CDLL(None,use_errno=True);send=libc.pidfd_send_signal\n" +
        "send.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_void_p,ctypes.c_uint];send.restype=ctypes.c_int\n" +
        "members=[]\n" +
        "for entry in os.listdir('/proc'):\n" +
        " if entry.isdigit():\n" +
        "  value=int(entry);current=identity(value)\n" +
        "  if current is not None and current[1] == pgrp: members.append((value,current))\n" +
        "sent=0\n" +
        "for value,member in members:\n" +
        " try: fd=os.pidfd_open(value,0)\n" +
        " except OSError: continue\n" +
        " try:\n" +
        "  if identity(value) != member or member[1] != pgrp: continue\n" +
        "  if send(fd,signal.SIGKILL,None,0) == 0: sent += 1\n" +
        " finally: os.close(fd)\n" +
        "print('sent' if sent else 'skipped')\n",
      String(group.pid),
      String(group.ppid),
      String(group.pgrp),
      group.startTime,
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
};
afterEach(() => {
  groups.splice(0).forEach((group) => {
    const identity = processIdentity(group.pid);
    if (
      identity === null ||
      identity.ppid !== group.ppid ||
      identity.pgrp !== group.pgrp ||
      identity.startTime !== group.startTime
    )
      return;
    rescueOwnedGroup(group);
  });
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});

describe("scanner process supervision", () => {
  it("selects only an identity-bound synthetic owned tree", () => {
    const root = { ppid: 100, startTime: "root-start" };
    const records = new Map([
      [200, root],
      [201, { ppid: 200, startTime: "child-start" }],
      [202, { ppid: 201, startTime: "grandchild-start" }],
      [300, { ppid: 100, startTime: "unrelated-start" }],
    ]);
    expect([...selectOwnedTree(records, 200, root).keys()].sort()).toEqual([
      200, 201, 202,
    ]);
    expect(selectOwnedTree(records, 999, root)).toEqual(new Map());
    expect(
      selectOwnedTree(records, 200, { ppid: 100, startTime: "reused" }),
    ).toEqual(new Map());
    expect(
      selectOwnedTree(records, 200, { ppid: 101, startTime: "root-start" }),
    ).toEqual(new Map());
    expect(
      [
        ...selectOwnedTree(records, 200, { startTime: "root-start" }).keys(),
      ].sort(),
    ).toEqual([200, 201, 202]);
  });

  it("selects only recorded process identities and their current descendants", () => {
    const records = new Map([
      [200, { ppid: 100, startTime: "reused-root" }],
      [201, { ppid: 200, startTime: "replacement-child" }],
      [300, { ppid: 1, startTime: "recorded-child" }],
      [301, { ppid: 300, startTime: "late-grandchild" }],
      [400, { ppid: 1, startTime: "unrelated" }],
    ]);
    const selected = selectRecordedProcesses(records, {
      root: { pid: 200, startTime: "original-root" },
      descendants: [{ pid: 300, startTime: "recorded-child" }],
    });
    expect([...selected.keys()].sort()).toEqual([300, 301]);
  });

  it("uses only post-acquisition verified inert pidfds", () => {
    const source = (
      recordsName: string,
      signalName: string,
    ) => `import importlib.util,sys
spec=importlib.util.spec_from_file_location('scanner_supervisor',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
snapshot={200:{'ppid':100,'startTime':'original'},100:{'ppid':module.os.getpid(),'startTime':'parent-original'},module.os.getpid():{'ppid':1,'startTime':'self'}}
module.descendants=lambda _snapshot:[200]
setattr(module,${JSON.stringify(recordsName)},lambda:{200:{'ppid':100,'startTime':'original'},100:{'ppid':module.os.getpid(),'startTime':'parent-replacement'},module.os.getpid():{'ppid':1,'startTime':'self'}})
module.os.pidfd_open=lambda pid,flags:9
module.os.close=lambda _fd:None
called=[]
module.PIDFD_SEND_SIGNAL=lambda *args:called.append(args) or 0
getattr(module,${JSON.stringify(signalName)})(snapshot,module.signal.SIGKILL)
assert called == []`;
    const targetReplacement = (
      recordsName: string,
      signalName: string,
    ) => `import importlib.util,sys
spec=importlib.util.spec_from_file_location('scanner_supervisor',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
self=module.os.getpid()
snapshot={200:{'ppid':100,'startTime':'target-original'},100:{'ppid':self,'startTime':'parent-original'},self:{'ppid':1,'startTime':'self'}}
module.descendants=lambda _snapshot:[200]
module.os.pidfd_open=lambda pid,flags:9
module.os.close=lambda _fd:None
called=[]
module.PIDFD_SEND_SIGNAL=lambda *args:called.append(args) or 0
# The target was replaced before acquiring its stable handle: never signal it.
setattr(module,${JSON.stringify(recordsName)},lambda:{200:{'ppid':100,'startTime':'target-replacement'},100:{'ppid':self,'startTime':'parent-original'},self:{'ppid':1,'startTime':'self'}})
assert getattr(module,${JSON.stringify(signalName)})(snapshot,module.signal.SIGKILL) is True
assert called == []
# A verified fd, not PID 200, is the signal target even if the synthetic PID
# map changes immediately after the final identity check.
setattr(module,${JSON.stringify(recordsName)},lambda:snapshot.copy())
module.PIDFD_SEND_SIGNAL=lambda fd,*args:called.append(fd) or 0
getattr(module,${JSON.stringify(signalName)})(snapshot,module.signal.SIGKILL)
assert called == [9]
# Unsupported pidfds fail closed and never fall back to os.kill.
module.PIDFD_SEND_SIGNAL=None
module.os.kill=lambda *args:(_ for _ in ()).throw(AssertionError('bare pid'))
assert getattr(module,${JSON.stringify(signalName)})(snapshot,module.signal.SIGKILL) is False`;
    const cases: { path: URL; recordsName: string; signalName: string }[] = [
      {
        path: new URL(
          "../../../scripts/security/scanner-supervisor.py",
          import.meta.url,
        ),
        recordsName: "proc_records",
        signalName: "signal_children",
      },
      {
        path: new URL(
          "../../../scripts/security/scanner-guardian.py",
          import.meta.url,
        ),
        recordsName: "records",
        signalName: "signal_snapshot",
      },
    ];
    for (const { path, recordsName, signalName } of cases) {
      const result = spawnSync(
        "python3",
        ["-B", "-c", source(recordsName, signalName), path.pathname],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const replacement = spawnSync(
        "python3",
        ["-B", "-c", targetReplacement(recordsName, signalName), path.pathname],
        { encoding: "utf8" },
      );
      expect(replacement.status).toBe(0);
      expect(replacement.stderr).toBe("");
    }
  });

  it("fails admission on inert pidfd API errors and continues other owned cleanup", () => {
    const source = `import errno,importlib.util,sys
spec=importlib.util.spec_from_file_location('scanner_module',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.os.kill=lambda *args:(_ for _ in ()).throw(AssertionError('bare pid fallback'))
for code in (errno.ENOSYS,errno.EPERM):
 module.os.pidfd_open=lambda *_args,code=code:(_ for _ in ()).throw(OSError(code,'fault'))
 try: module.require_pidfd()
 except OSError as error: assert error.errno == code
 else: raise AssertionError('pidfd admission unexpectedly passed')
module.os.pidfd_open=lambda *_args:9
module.os.close=lambda _fd:None
module.PIDFD_SEND_SIGNAL=lambda *_args:(module.ctypes.set_errno(errno.EPERM) or -1)
try: module.require_pidfd()
except OSError as error: assert error.errno == errno.EPERM
else: raise AssertionError('pidfd send admission unexpectedly passed')
self=module.os.getpid()
snapshot={200:{'ppid':self,'startTime':'a'},201:{'ppid':self,'startTime':'b'},self:{'ppid':1,'startTime':'self'}}
module.descendants=lambda _snapshot:[200,201]
module.records=lambda:snapshot
module.proc_records=lambda:snapshot
opened=[]
def open_pidfd(pid,_flags):
 opened.append(pid)
 if pid == 201: raise OSError(errno.EPERM,'fault')
 return 9
module.os.pidfd_open=open_pidfd
module.os.close=lambda _fd:None
module.PIDFD_SEND_SIGNAL=lambda *_args:0
try:
 getattr(module,sys.argv[2])(snapshot,module.signal.SIGKILL)
except OSError as error: assert error.errno == errno.EPERM
else: raise AssertionError('cleanup error unexpectedly hidden')
assert set(opened) == {200,201}`;
    const cases: { path: URL; signalName: string }[] = [
      {
        path: new URL(
          "../../../scripts/security/scanner-supervisor.py",
          import.meta.url,
        ),
        signalName: "signal_children",
      },
      {
        path: new URL(
          "../../../scripts/security/scanner-guardian.py",
          import.meta.url,
        ),
        signalName: "signal_snapshot",
      },
    ];
    for (const { path, signalName } of cases) {
      const result = spawnSync(
        "python3",
        ["-B", "-c", source, path.pathname, signalName],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
    }
  });

  it("retains complete single-chunk and fragmented ownership frames over 64KiB", () => {
    const first = JSON.stringify({
      version: 1,
      root: { pid: 20, startTime: "first" },
      descendants: [],
    });
    const latest = JSON.stringify({
      version: 1,
      root: { pid: 21, startTime: "latest" },
      descendants: [{ pid: 22, startTime: "child" }],
    });
    const flood = Buffer.from(`${first}\n`.repeat(1_100) + `${latest}\n`);
    const single = consumeOwnershipFrames(Buffer.alloc(0), flood);
    expect(flood.length).toBeGreaterThan(64 * 1024);
    expect(single.pending).toEqual(Buffer.alloc(0));
    expect(single.frames.at(-1)).toEqual({
      root: { pid: 21, startTime: "latest" },
      descendants: [{ pid: 22, startTime: "child" }],
    });
    let pending = Buffer.alloc(0);
    const snapshots: any[] = [];
    for (
      let offset = 0, width = 1;
      offset < flood.length;
      width = ((width * 17) % 251) + 1
    ) {
      const consumed = consumeOwnershipFrames(
        pending,
        flood.subarray(offset, offset + width),
      );
      pending = consumed.pending;
      snapshots.push(...consumed.frames);
      offset += width;
    }
    expect(pending).toEqual(Buffer.alloc(0));
    expect(snapshots.at(-1)).toEqual({
      root: { pid: 21, startTime: "latest" },
      descendants: [{ pid: 22, startTime: "child" }],
    });
  });

  it("discards an oversized unterminated line through its delimiter", () => {
    const valid = JSON.stringify({
      version: 1,
      root: { pid: 333, startTime: "valid" },
      descendants: [],
    });
    let pending = consumeOwnershipFrames(
      Buffer.alloc(0),
      Buffer.alloc(64 * 1024 + 1, 120),
    ).pending;
    const suffix = consumeOwnershipFrames(pending, Buffer.from(valid));
    pending = suffix.pending;
    expect(suffix.frames).toEqual([]);
    expect(pending.discarding).toBe(true);
    const recovered = consumeOwnershipFrames(
      pending,
      Buffer.from(`ignored-prefix\n${valid}\n`),
    );
    expect(recovered.frames).toEqual([
      { root: { pid: 333, startTime: "valid" }, descendants: [] },
    ]);
  });

  it("preserves actual root exit, signal, and missing-command status", async () => {
    await expect(
      executeScanner(node, ["-e", "process.exit(7)"], process.cwd(), 1_000),
    ).resolves.toMatchObject({
      exitCode: 7,
      signal: null,
      error: null,
      cleanup: "reaped",
      termination: "none",
    });
    // Exercise real SIGABRT without invoking host crash-report services.
    // PR_SET_DUMPABLE applies only to this disposable fixture process.
    await expect(
      executeScanner(
        "python3",
        [
          "-c",
          "import ctypes,os,signal; assert ctypes.CDLL(None).prctl(4,0,0,0,0) == 0; os.kill(os.getpid(), signal.SIGABRT)",
        ],
        process.cwd(),
        1_000,
      ),
    ).resolves.toMatchObject({
      exitCode: null,
      signal: "SIGABRT",
      error: null,
      cleanup: "reaped",
    });
    const missing = await executeScanner(
      "/nonexistent/scanner",
      [],
      process.cwd(),
      1_000,
    );
    expect(missing).toMatchObject({
      exitCode: null,
      signal: null,
      cleanup: "reaped",
    });
    expect(missing.error).toMatch(/^SCANNER_SPAWN_ERROR:/);
  });

  it("waits for a successful inherited child/grandchild output tree", async () => {
    const { directory, path } = fixture(
      `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.stdout.write('grandchild')"],{stdio:'inherit'});child.on('exit',(code)=>process.exit(code));`,
    );
    await expect(
      executeScanner(node, [path], directory, 1_000),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: "grandchild",
      cleanup: "reaped",
    });
  });

  it("fails closed for missing, malformed, or contradictory supervisor status", async () => {
    for (const testStatusFault of [
      "missing",
      "truncated",
      "malformed",
      "contradictory",
    ]) {
      const result = await executeScanner(
        node,
        ["-e", "process.exit(0)"],
        process.cwd(),
        1_000,
        { testStatusFault },
      );
      expect(result).toMatchObject({
        exitCode: null,
        signal: null,
        cleanup: "unknown",
        termination: "unknown",
        error: "SCANNER_SUPERVISOR_STATUS_INVALID",
      });
    }
  });

  it("rejects mismatched, incomplete, and unclean status", async () => {
    const mismatch = await executeScanner(
      node,
      ["-e", "setInterval(()=>{},1000)"],
      process.cwd(),
      100,
      { graceMs: 25, cleanupDeadlineMs: 500, testStatusFault: "mismatch" },
    );
    expect(mismatch).toMatchObject({
      timedOut: true,
      cleanup: "unknown",
      error: "SCANNER_SUPERVISOR_TERMINATION_MISMATCH",
    });
    for (const testStatusFault of ["incomplete", "unclean"]) {
      const result = await executeScanner(
        node,
        ["-e", "process.exit(0)"],
        process.cwd(),
        1_000,
        { testStatusFault },
      );
      expect(result.exitCode).toBe(0);
      expect(result.error).toBe(
        testStatusFault === "incomplete"
          ? "SCANNER_CLEANUP_INCOMPLETE"
          : "SCANNER_CONTROL_EOF",
      );
      expect(result.cleanup).toBe(
        testStatusFault === "incomplete" ? "unknown" : "reaped",
      );
    }
  });

  it("requires the supervisor itself to exit normally", async () => {
    for (const testStatusFault of ["supervisor-nonzero", "supervisor-signal"]) {
      const result = await executeScanner(
        node,
        ["-e", "process.exit(0)"],
        process.cwd(),
        1_000,
        { testStatusFault },
      );
      expect(result).toMatchObject({
        exitCode: 0,
        cleanup: "unknown",
        error: "SCANNER_SUPERVISOR_EXIT_INVALID",
        supervisor: { normal: false },
      });
    }
  });

  it("reaps a SIGTERM-ignoring orphan with bounded settlement", async () => {
    const { directory, path } = fixture(
      (directory) =>
        `const {spawn}=require('node:child_process');const fs=require('node:fs');const mark=${JSON.stringify(join(directory, "mark"))};const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>require('fs').writeFileSync(process.argv[1],String(Date.now())),20)",mark],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(join(directory, "pid"))},String(child.pid));const watcher=setInterval(()=>{if(fs.existsSync(mark)){clearInterval(watcher);process.exit(0)}},5);`,
    );
    const controller = new AbortController();
    const pending = executeScanner(node, [path], directory, 1_000, {
      signal: controller.signal,
      graceMs: 50,
      cleanupDeadlineMs: 500,
    });
    await waitFor(() => existsSync(join(directory, "mark")));
    const started = Date.now();
    controller.abort();
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({
      interrupted: true,
      cleanup: "reaped",
      error: "SCANNER_INTERRUPTED",
    });
    const pid = Number(readFileSync(join(directory, "pid"), "utf8"));
    await waitFor(() => noProcess(pid));
    const lastWrite = statSync(join(directory, "mark")).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(statSync(join(directory, "mark")).mtimeMs).toBe(lastWrite);
  });

  it("times out and reaps a SIGTERM-ignoring orphan holding inherited pipes", async () => {
    // This keeps the original 200 ms timeout and readiness assertion while
    // avoiding two Node bootstrap phases. The child installs its SIGTERM
    // handler before it writes the readiness mark and inherits stdio pipes.
    const { directory } = fixture("");
    const path = join(directory, "timeout-fixture.py");
    writeFileSync(
      path,
      `import os,signal,subprocess,sys,time
mark=${JSON.stringify(join(directory, "timeout-mark"))}
pid=${JSON.stringify(join(directory, "timeout-pid"))}
ready=${JSON.stringify(join(directory, "timeout-ready"))}
child=subprocess.Popen([sys.executable,"-c",${JSON.stringify("import os,signal,sys,time\nsignal.signal(signal.SIGTERM, lambda *_: None)\nmark=sys.argv[1]\nwhile True:\n open(mark,'w').write(str(time.time()))\n time.sleep(.02)")},mark])
open(pid,'w').write(str(child.pid))
while not os.path.exists(mark): time.sleep(.002)
open(ready,'w').write('ready')`,
    );
    const started = Date.now();
    const pending = executeScanner("python3", [path], directory, 200, {
      graceMs: 25,
      cleanupDeadlineMs: 500,
    });
    await waitFor(() => existsSync(join(directory, "timeout-ready")));
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({
      timedOut: true,
      cleanup: "reaped",
      error: "SCANNER_TIMEOUT",
    });
    const pid = Number(readFileSync(join(directory, "timeout-pid"), "utf8"));
    await waitFor(() => noProcess(pid));
    const lastWrite = statSync(join(directory, "timeout-mark")).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(statSync(join(directory, "timeout-mark")).mtimeMs).toBe(lastWrite);
  });

  it("bounds multibyte output and supports AbortSignal", async () => {
    const overflow = await executeScanner(
      node,
      ["-e", "setInterval(()=>process.stdout.write('€€'),1)"],
      process.cwd(),
      1_000,
      { maxOutputBytes: 5, graceMs: 25, cleanupDeadlineMs: 500 },
    );
    expect(overflow).toMatchObject({
      overflow: true,
      cleanup: "reaped",
      error: "SCANNER_OVERFLOW",
      stdout: "€",
      stdoutBytes: 3,
    });
    expect(overflow.stdoutBytes + overflow.stderrBytes).toBeLessThanOrEqual(5);
    const controller = new AbortController();
    const pending = executeScanner(
      node,
      ["-e", "setInterval(()=>{},1000)"],
      process.cwd(),
      1_000,
      { signal: controller.signal, graceMs: 25, cleanupDeadlineMs: 500 },
    );
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      interrupted: true,
      cleanup: "reaped",
      error: "SCANNER_INTERRUPTED",
    });
  });

  it("handles SIGTERM and SIGINT only in disposable callers", async () => {
    for (const interruption of ["SIGTERM", "SIGINT"]) {
      const { directory } = fixture("");
      const ready = join(directory, `${interruption}-ready`);
      const result = join(directory, `${interruption}-result.json`);
      const harness = spawn(
        node,
        [
          "--input-type=module",
          "-e",
          `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};const controller=new AbortController();process.once(${JSON.stringify(interruption)},()=>controller.abort());fs.writeFileSync(${JSON.stringify(ready)},'ready');executeScanner(process.execPath,['-e','setInterval(()=>{},1000)'],${JSON.stringify(directory)},5000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:500}).then(value=>fs.writeFileSync(${JSON.stringify(result)},JSON.stringify(value)));`,
        ],
        { cwd: directory, detached: true, stdio: "ignore" },
      );
      trackGroup(harness.pid!);
      await waitFor(() => existsSync(ready));
      process.kill(harness.pid!, interruption);
      await waitFor(() => existsSync(result));
      expect(JSON.parse(readFileSync(result, "utf8"))).toMatchObject({
        interrupted: true,
        cleanup: "reaped",
        error: "SCANNER_INTERRUPTED",
      });
      await waitFor(() => harness.exitCode !== null);
      forgetGroup(harness.pid!);
    }
  });

  it.each(["SIGTERM", "SIGINT"])(
    "cleans ready ignoring descendants after a real guardian group %s",
    async (interruption) => {
      const { directory, path } = fixture(
        (directory) =>
          `const fs=require('node:fs');const {spawn}=require('node:child_process');const ready=${JSON.stringify(join(directory, "group-child-ready"))};const child=spawn(process.execPath,['-e',"const fs=require('node:fs');process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});fs.writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",ready],{stdio:'inherit'});process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});const wait=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(wait);fs.writeFileSync(${JSON.stringify(join(directory, "group-root"))},String(process.pid));fs.writeFileSync(${JSON.stringify(join(directory, "group-child"))},String(child.pid))}},2);setInterval(()=>{},1000);`,
      );
      const resultPath = join(directory, `${interruption}-group-result.json`);
      const harness = spawn(
        node,
        [
          "--input-type=module",
          "-e",
          `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};process.on(${JSON.stringify(interruption)},()=>{});executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},5000,{graceMs:25,cleanupDeadlineMs:500}).then(value=>{fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(value));process.exitCode=value.error?1:0;});`,
        ],
        { cwd: directory, detached: true, stdio: "ignore" },
      );
      trackGroup(harness.pid!);
      await waitFor(
        () =>
          existsSync(join(directory, "group-root")) &&
          existsSync(join(directory, "group-child")) &&
          existsSync(join(directory, "group-child-ready")),
      );
      process.kill(-harness.pid!, interruption);
      await waitFor(() => existsSync(resultPath));
      await waitFor(() => harness.exitCode !== null);
      const root = Number(readFileSync(join(directory, "group-root"), "utf8"));
      const child = Number(
        readFileSync(join(directory, "group-child"), "utf8"),
      );
      await waitFor(() => noProcess(root) && noProcess(child));
      expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
        cleanup: "reaped",
        termination: "interrupted",
        error: "SCANNER_INTERRUPTED",
      });
      expect(harness.exitCode).toBe(1);
      forgetGroup(harness.pid!);
    },
  );

  it("contains an adopted ignoring child after queued incomplete status and supervisor exit", async () => {
    const { directory } = fixture("");
    const childPidPath = join(directory, "queued-child");
    const childReadyPath = join(directory, "queued-child-ready");
    const statusQueuedPath = join(directory, "queued-status-queued");
    const supervisorPidPath = join(directory, "queued-supervisor-pid");
    const supervisorPath = join(directory, "queued-supervisor.py");
    const childCode =
      "import os,signal,sys,time\nsignal.signal(signal.SIGTERM,lambda *_:None)\nopen(sys.argv[1],'w').write('ready')\nwhile True: time.sleep(1)";
    const source = [
      "import json,os,subprocess,sys,time",
      "open(" +
        JSON.stringify(supervisorPidPath) +
        ",'w').write(str(os.getpid()))",
      "child=subprocess.Popen([sys.executable,'-c'," +
        JSON.stringify(childCode) +
        "," +
        JSON.stringify(childReadyPath) +
        "],close_fds=False)",
      "open(" + JSON.stringify(childPidPath) + ",'w').write(str(child.pid))",
      "while not os.path.exists(" +
        JSON.stringify(childReadyPath) +
        "): time.sleep(.002)",
      "status=os.fdopen(3,'w',encoding='utf8',closefd=True)",
      "owner=os.fdopen(4,'w',encoding='utf8',closefd=True)",
      "status.write(json.dumps({'version':1,'exitCode':0,'signal':None,'termination':'none','reaping':'incomplete','error':None},separators=(',',':'))+'\\n');status.flush()",
      "owner.write(json.dumps({'version':1,'root':None,'descendants':[]},separators=(',',':'))+'\\n');owner.flush()",
      "open(" + JSON.stringify(statusQueuedPath) + ",'w').write('queued')",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const started = Date.now();
    const guardian = spawn(
      "python3",
      ["-B", guardianPath, supervisorPath, "[]", directory, "25", "250"],
      { cwd: directory, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    let status = "";
    let child: number | null = null;
    let childIdentity: ReturnType<typeof processIdentity> = null;
    let supervisor: number | null = null;
    guardian.stderr?.on("data", (chunk) => (stderr += chunk));
    guardian.stdio[3]?.on("data", (chunk) => (status += chunk));
    try {
      await waitFor(() => existsSync(childPidPath));
      await waitFor(() => existsSync(childReadyPath));
      await waitFor(() => existsSync(statusQueuedPath));
      await waitFor(() => status.includes('"reaping":"incomplete"'));
      supervisor = Number(readFileSync(supervisorPidPath, "utf8"));
      child = Number(readFileSync(childPidPath, "utf8"));
      childIdentity = processIdentity(child);
      expect(childIdentity).not.toBeNull();
      await waitFor(() => noProcess(supervisor!) && !noProcess(child!));
      await waitFor(() => guardian.exitCode !== null, 1_000);
      await waitFor(() => noProcess(child!), 1_000);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(guardian.exitCode, stderr).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(status.trim())).toMatchObject({
        exitCode: 0,
        termination: "none",
        reaping: "incomplete",
      });
    } finally {
      if (guardian.exitCode === null) {
        if (child !== null && childIdentity !== null && !noProcess(child)) {
          rescueOwnedProcess(child, childIdentity.startTime, [
            guardian.pid!,
            supervisor!,
          ]);
        }
        guardian.kill("SIGKILL");
      }
    }
  });

  it("fails closed after null and nested receipts while reaping a ready adopted child", async () => {
    const { directory } = fixture("");
    const childPidPath = join(directory, "invalid-receipt-child");
    const childReadyPath = join(directory, "invalid-receipt-child-ready");
    const supervisorPidPath = join(directory, "invalid-receipt-supervisor-pid");
    const supervisorPath = join(directory, "invalid-receipt-supervisor.py");
    const childCode =
      "import os,signal,sys,time\nsignal.signal(signal.SIGTERM,lambda *_:None)\nopen(sys.argv[1],'w').write('ready')\nwhile True: time.sleep(1)";
    const source = [
      "import json,os,subprocess,sys,time",
      "open(" +
        JSON.stringify(supervisorPidPath) +
        ",'w').write(str(os.getpid()))",
      "child=subprocess.Popen([sys.executable,'-c'," +
        JSON.stringify(childCode) +
        "," +
        JSON.stringify(childReadyPath) +
        "],close_fds=False)",
      "open(" + JSON.stringify(childPidPath) + ",'w').write(str(child.pid))",
      "while not os.path.exists(" +
        JSON.stringify(childReadyPath) +
        "): time.sleep(.002)",
      "status=os.fdopen(3,'w',encoding='utf8',closefd=True)",
      "status.write('null\\n'+json.dumps({'version':1,'exitCode':0,'signal':None,'termination':[],'reaping':{},'error':None},separators=(',',':'))+'\\n');status.flush()",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const guardian = spawn(
      "python3",
      ["-B", guardianPath, supervisorPath, "[]", directory, "25", "250"],
      { cwd: directory, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    let status = "";
    let child: number | null = null;
    let childIdentity: ReturnType<typeof processIdentity> = null;
    let supervisor: number | null = null;
    guardian.stderr?.on("data", (chunk) => (stderr += chunk));
    guardian.stdio[3]?.on("data", (chunk) => (status += chunk));
    try {
      await waitFor(() => existsSync(childReadyPath));
      child = Number(readFileSync(childPidPath, "utf8"));
      supervisor = Number(readFileSync(supervisorPidPath, "utf8"));
      childIdentity = processIdentity(child);
      expect(childIdentity).not.toBeNull();
      await waitFor(() => guardian.exitCode !== null, 1_000);
      await waitFor(() => noProcess(child!), 1_000);
      expect(stderr).toBe("");
      expect(status).toContain("SCANNER_SUPERVISOR_STATUS_INVALID");
      expect(guardian.exitCode).toBe(1);
    } finally {
      if (guardian.exitCode === null) {
        if (child !== null && childIdentity !== null && !noProcess(child)) {
          rescueOwnedProcess(child, childIdentity.startTime, [
            guardian.pid!,
            supervisor!,
          ]);
        }
        guardian.kill("SIGKILL");
      }
    }
  });

  it("rejects every JSON scalar or nested receipt field before acknowledgement", () => {
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const result = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        "import importlib.util,sys;spec=importlib.util.spec_from_file_location('guardian',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);base={'version':1,'exitCode':0,'signal':None,'termination':'interrupted','reaping':'reaped','error':None};invalid={'version':[None,False,0,1.5,'1',[],{}],'exitCode':[False,-1,1.5,'0',[],{}],'signal':[False,0,[],{},'TERM'],'termination':[None,False,0,[],{},'bogus'],'reaping':[None,False,0,[],{},'none'],'error':[False,0,[],{}]};assert module.valid_status_receipt(base);assert all(not module.qualified_interruption_ack(value) for value in [None,[],0,'invalid',{'termination':'interrupted'}]);exec(\"for field, values in invalid.items():\\n for value in values:\\n  receipt=base.copy()\\n  receipt[field]=value\\n  assert module.valid_status_receipt(receipt) is False\\n  assert module.qualified_interruption_ack(receipt) is False\")",
        guardianPath,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("bounds newline-free floods and deeply nested status frames fail closed", () => {
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const result = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        "import importlib.util,sys;spec=importlib.util.spec_from_file_location('guardian',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);pending,discarding,invalid,ack=module.consume_status_payload(b'',False,False,False,b'x'*(module.STATUS_LIMIT+1));assert pending == b'' and discarding and invalid and not ack;pending,discarding,invalid,ack=module.consume_status_payload(pending,discarding,invalid,ack,b'\\n');assert pending == b'' and not discarding and invalid and not ack;deep=(b'['*1100)+b'0'+(b']'*1100)+b'\\n';pending,discarding,invalid,ack=module.consume_status_payload(b'',False,False,False,deep);assert pending == b'' and invalid and not ack",
        guardianPath,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects integer-limit status frames without escaping the parser", () => {
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const result = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        "import importlib.util,sys;sys.set_int_max_str_digits(4300);spec=importlib.util.spec_from_file_location('guardian',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);pending,discarding,invalid,ack=module.consume_status_payload(b'',False,False,False,(b'9'*5000)+b'\\n');assert pending == b'' and not discarding and invalid and not ack",
        guardianPath,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("fails closed on an integer-limit frame while reaping an adopted child", async () => {
    const { directory } = fixture("");
    const childPidPath = join(directory, "digit-limit-child");
    const childReadyPath = join(directory, "digit-limit-child-ready");
    const supervisorPidPath = join(directory, "digit-limit-supervisor-pid");
    const supervisorPath = join(directory, "digit-limit-supervisor.py");
    const childCode =
      "import signal,sys,time\nsignal.signal(signal.SIGTERM,lambda *_:None)\nopen(sys.argv[1],'w').write('ready')\nwhile True: time.sleep(1)";
    const source = [
      "import os,subprocess,sys,time",
      "sys.set_int_max_str_digits(4300)",
      "open(" +
        JSON.stringify(supervisorPidPath) +
        ",'w').write(str(os.getpid()))",
      "child=subprocess.Popen([sys.executable,'-c'," +
        JSON.stringify(childCode) +
        "," +
        JSON.stringify(childReadyPath) +
        "],pass_fds=(3,))",
      "open(" + JSON.stringify(childPidPath) + ",'w').write(str(child.pid))",
      "while not os.path.exists(" +
        JSON.stringify(childReadyPath) +
        "): time.sleep(.002)",
      "os.write(3,b'9'*5000+b'\\n')",
      "os._exit(0)",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const guardian = spawn(
      "python3",
      ["-B", guardianPath, supervisorPath, "[]", directory, "25", "250"],
      {
        cwd: directory,
        stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    let stderr = "";
    let status = "";
    let child: number | null = null;
    let childIdentity: ReturnType<typeof processIdentity> = null;
    let supervisor: number | null = null;
    guardian.stderr?.on("data", (chunk) => (stderr += chunk));
    guardian.stdio[3]?.on("data", (chunk) => (status += chunk));
    try {
      await waitFor(() => existsSync(childReadyPath));
      child = Number(readFileSync(childPidPath, "utf8"));
      supervisor = Number(readFileSync(supervisorPidPath, "utf8"));
      childIdentity = processIdentity(child);
      expect(childIdentity).not.toBeNull();
      await waitFor(() => guardian.exitCode !== null, 1_000);
      await waitFor(() => noProcess(child!), 1_000);
      expect(stderr).toBe("");
      expect(status).toContain("SCANNER_SUPERVISOR_STATUS_INVALID");
      expect(guardian.exitCode).toBe(1);
    } finally {
      if (guardian.exitCode === null) {
        if (child !== null && childIdentity !== null && !noProcess(child)) {
          rescueOwnedProcess(child, childIdentity.startTime, [
            guardian.pid!,
            supervisor!,
          ]);
        }
        guardian.kill("SIGKILL");
      }
    }
  });

  it("bounds status draining before cleanup of a continuously writing adopted child", async () => {
    const { directory } = fixture("");
    const childPidPath = join(directory, "status-flood-child");
    const childReadyPath = join(directory, "status-flood-child-ready");
    const supervisorPidPath = join(directory, "status-flood-supervisor-pid");
    const supervisorExitedPath = join(
      directory,
      "status-flood-supervisor-exited",
    );
    const identitiesCapturedPath = join(
      directory,
      "status-flood-identities-captured",
    );
    const validForwardedPath = join(
      directory,
      ".guardian-valid-status-forwarded",
    );
    const outputBlockedPath = join(
      directory,
      ".guardian-status-output-blocked",
    );
    const deferredPath = join(directory, ".guardian-status-deferred");
    const drainLimitedPath = join(directory, ".guardian-status-drain-limited");
    const forwardBlockedPath = join(
      directory,
      ".guardian-status-forward-blocked",
    );
    const floodStartedPath = join(directory, "status-flood-started");
    const supervisorPath = join(directory, "status-flood-supervisor.py");
    const childCode =
      "import os,signal,sys,time\nsignal.signal(signal.SIGTERM,lambda *_:None)\nopen(sys.argv[1],'w').write('ready')\nwhile not os.path.exists(sys.argv[2]): time.sleep(.002)\nopen(sys.argv[3],'w').write('flooding')\nwhile True: os.write(3,b'0\\n'*4096)";
    const source = [
      "import json,os,subprocess,sys,time",
      "open(" +
        JSON.stringify(supervisorPidPath) +
        ",'w').write(str(os.getpid()))",
      "child=subprocess.Popen([sys.executable,'-c'," +
        JSON.stringify(childCode) +
        "," +
        JSON.stringify(childReadyPath) +
        "," +
        JSON.stringify(outputBlockedPath) +
        "," +
        JSON.stringify(floodStartedPath) +
        "],pass_fds=(3,))",
      "open(" + JSON.stringify(childPidPath) + ",'w').write(str(child.pid))",
      "while not os.path.exists(" +
        JSON.stringify(childReadyPath) +
        "): time.sleep(.002)",
      "while not os.path.exists(" +
        JSON.stringify(identitiesCapturedPath) +
        "): time.sleep(.002)",
      "status=os.fdopen(3,'w',encoding='utf8',closefd=True)",
      "status.write(json.dumps({'version':1,'exitCode':0,'signal':None,'termination':'none','reaping':'reaped','error':None},separators=(',',':'))+'\\n');status.flush()",
      "while not os.path.exists(" +
        JSON.stringify(validForwardedPath) +
        "): time.sleep(.002)",
      "while not os.path.exists(" +
        JSON.stringify(floodStartedPath) +
        "): time.sleep(.002)",
      "while not os.path.exists(" +
        JSON.stringify(deferredPath) +
        "): time.sleep(.002)",
      "open(" + JSON.stringify(supervisorExitedPath) + ",'w').write('exited')",
      "os._exit(0)",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const guardian = spawn(
      "python3",
      [
        "-B",
        guardianPath,
        supervisorPath,
        "[]",
        directory,
        "25",
        "250",
        "status-drain-quota",
      ],
      {
        cwd: directory,
        stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    let stderr = "";
    if (guardian.pid === undefined) throw new Error("guardian did not start");
    const fixtureOwner = captureOwnedProcess(process.pid);
    const fixtureAncestors = captureOwnedAncestors(process.pid);
    const guardianIdentity = captureOwnedProcess(guardian.pid);
    const initIdentity = captureOwnedProcess(1);
    let child: OwnedProcess | null = null;
    let supervisor: OwnedProcess | null = null;
    const rescues: string[] = [];
    let cleanupComplete = false;
    guardian.stderr?.on("data", (chunk) => (stderr += chunk));
    const cleanup = async () => {
      if (guardian.exitCode === null) guardian.stdin?.end();
      try {
        await waitFor(() => guardian.exitCode !== null, 250);
      } catch {
        // A failed fixture can leave the guardian alive; the identity-bound
        // recovery below runs only after allowing its ordinary reaping path.
      }
      const errors: unknown[] = [];
      const attempt = async (operation: () => Promise<void>) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
      await attempt(() =>
        requireOwnedFixtureAbsent(
          supervisor,
          [guardianIdentity, initIdentity, fixtureOwner, ...fixtureAncestors],
          rescues,
        ),
      );
      await attempt(() =>
        requireOwnedFixtureAbsent(
          child,
          [
            supervisor,
            guardianIdentity,
            initIdentity,
            fixtureOwner,
            ...fixtureAncestors,
          ].filter((value): value is OwnedProcess => value !== null),
          rescues,
        ),
      );
      try {
        await waitFor(() => guardian.exitCode !== null, 250);
      } catch {
        await attempt(() =>
          requireOwnedFixtureAbsent(guardianIdentity, [fixtureOwner], rescues),
        );
      }
      if (errors.length > 0)
        throw new Error(
          `fixture cleanup failed: ${errors.map((error) => String(error)).join("; ")}`,
        );
    };
    try {
      await waitFor(() => existsSync(childReadyPath));
      await waitFor(() => existsSync(supervisorPidPath));
      child = captureOwnedProcess(Number(readFileSync(childPidPath, "utf8")));
      supervisor = captureOwnedProcess(
        Number(readFileSync(supervisorPidPath, "utf8")),
      );
      writeFileSync(identitiesCapturedPath, "captured");
      await waitFor(() => existsSync(validForwardedPath));
      await waitFor(() => existsSync(outputBlockedPath));
      await waitFor(() => existsSync(floodStartedPath));
      await waitFor(() => existsSync(supervisorExitedPath));
      const started = Date.now();
      await waitFor(() => guardian.exitCode !== null, 1_000);
      await waitFor(() => noProcess(child!.pid), 1_000);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(existsSync(deferredPath)).toBe(true);
      expect(existsSync(forwardBlockedPath)).toBe(true);
      expect(existsSync(drainLimitedPath)).toBe(true);
      expect(stderr).toBe("");
      expect(guardian.exitCode).toBe(1);
      await cleanup();
      cleanupComplete = true;
      expect(rescues).toEqual([]);
    } finally {
      if (!cleanupComplete) await cleanup();
    }
  });

  it("contains a pre-adoption flood fixture after its guardian already exits", async () => {
    const { directory } = fixture("");
    const childPidPath = join(directory, "pre-adoption-flood-child");
    const childReadyPath = join(directory, "pre-adoption-flood-child-ready");
    const supervisorPidPath = join(
      directory,
      "pre-adoption-flood-supervisor-pid",
    );
    const guardianPidPath = join(directory, "pre-adoption-flood-guardian-pid");
    const guardianExitedPath = join(
      directory,
      "pre-adoption-flood-guardian-exited",
    );
    const outputBlockedPath = join(
      directory,
      ".guardian-status-output-blocked",
    );
    const supervisorPath = join(directory, "pre-adoption-flood-supervisor.py");
    const childCode =
      "import os,signal,sys,time\nsignal.signal(signal.SIGTERM,lambda *_:None)\nopen(sys.argv[1],'w').write('ready')\nwhile not os.path.exists(sys.argv[2]): time.sleep(.002)";
    const source = [
      "import os,subprocess,sys,time",
      "open(" +
        JSON.stringify(supervisorPidPath) +
        ",'w').write(str(os.getpid()))",
      "child=subprocess.Popen([sys.executable,'-c'," +
        JSON.stringify(childCode) +
        "," +
        JSON.stringify(childReadyPath) +
        "," +
        JSON.stringify(outputBlockedPath) +
        "],pass_fds=(3,))",
      "open(" + JSON.stringify(childPidPath) + ",'w').write(str(child.pid))",
      "while not os.path.exists(" +
        JSON.stringify(childReadyPath) +
        "): time.sleep(.002)",
      "while True: time.sleep(1)",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const reaperSource =
      "import ctypes,json,os,select,subprocess,sys,time\n" +
      "if ctypes.CDLL(None).prctl(36,1,0,0,0) != 0: raise OSError('subreaper unavailable')\n" +
      "command=[sys.executable,'-B',*json.loads(sys.argv[1])];pid_path=sys.argv[2];exited_path=sys.argv[3]\n" +
      "control_read,control_write=os.pipe()\n" +
      "guardian=subprocess.Popen(command,stdin=control_read,pass_fds=(3,4,control_read))\n" +
      "os.close(control_read);open(pid_path,'w').write(str(guardian.pid))\n" +
      "closing=False\n" +
      "while True:\n" +
      " while True:\n" +
      "  try: pid,_=os.waitpid(-1,os.WNOHANG)\n" +
      "  except ChildProcessError: pid=-1\n" +
      "  if pid <= 0: break\n" +
      "  if pid == guardian.pid: open(exited_path,'w').write('exited')\n" +
      " if not closing:\n" +
      "  readable,_,_=select.select([sys.stdin],[],[],.01)\n" +
      "  if readable and os.read(sys.stdin.fileno(),1) == b'': closing=True;os.close(control_write)\n" +
      " if closing:\n" +
      "  try: pid,_=os.waitpid(-1,os.WNOHANG)\n" +
      "  except ChildProcessError: break\n" +
      " time.sleep(.005)";
    const wrapper = spawn(
      "python3",
      [
        "-B",
        "-c",
        reaperSource,
        JSON.stringify([
          guardianPath,
          supervisorPath,
          "[]",
          directory,
          "25",
          "250",
        ]),
        guardianPidPath,
        guardianExitedPath,
      ],
      {
        cwd: directory,
        stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    if (wrapper.pid === undefined)
      throw new Error("fixture reaper did not start");
    const fixtureOwner = captureOwnedProcess(process.pid);
    const wrapperIdentity = captureOwnedProcess(wrapper.pid);
    const initIdentity = captureOwnedProcess(1);
    let wrapperStderr = "";
    let guardian: OwnedProcess | null = null;
    let child: OwnedProcess | null = null;
    let supervisor: OwnedProcess | null = null;
    const rescues: string[] = [];
    let cleanupComplete = false;
    wrapper.stderr?.on("data", (chunk) => (wrapperStderr += chunk));
    const cleanup = async () => {
      const errors: unknown[] = [];
      const attempt = async (operation: () => Promise<void>) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
      await attempt(() =>
        requireOwnedFixtureAbsent(
          supervisor,
          [guardian, wrapperIdentity, initIdentity].filter(
            (value): value is OwnedProcess => value !== null,
          ),
          rescues,
        ),
      );
      await attempt(() =>
        requireOwnedFixtureAbsent(
          child,
          [supervisor, guardian, wrapperIdentity, initIdentity].filter(
            (value): value is OwnedProcess => value !== null,
          ),
          rescues,
        ),
      );
      await attempt(() =>
        requireOwnedFixtureAbsent(guardian, [wrapperIdentity], rescues),
      );
      if (wrapper.exitCode === null) wrapper.stdin?.end();
      try {
        await waitFor(() => wrapper.exitCode !== null, 250);
      } catch {
        await attempt(() =>
          requireOwnedFixtureAbsent(wrapperIdentity, [fixtureOwner], rescues),
        );
      }
      if (errors.length > 0)
        throw new Error(
          `fixture cleanup failed: ${errors.map((error) => String(error)).join("; ")}`,
        );
    };
    try {
      await waitFor(() => {
        if (wrapper.exitCode !== null)
          throw new Error(
            `fixture reaper exited ${wrapper.exitCode}: ${wrapperStderr}`,
          );
        return (
          existsSync(childReadyPath) &&
          existsSync(supervisorPidPath) &&
          existsSync(guardianPidPath)
        );
      });
      guardian = captureOwnedProcess(
        Number(readFileSync(guardianPidPath, "utf8")),
      );
      child = captureOwnedProcess(Number(readFileSync(childPidPath, "utf8")));
      supervisor = captureOwnedProcess(
        Number(readFileSync(supervisorPidPath, "utf8")),
      );
      expect(child.identity.ppid).toBe(supervisor.pid);
      expect(supervisor.identity.ppid).toBe(guardian.pid);
      expect(existsSync(outputBlockedPath)).toBe(false);
      expect(rescueOwnedFixtureProcess(guardian, [wrapperIdentity])).toBe(
        "sent",
      );
      await waitFor(() => existsSync(guardianExitedPath), 1_000);
      await cleanup();
      cleanupComplete = true;
      expect(rescues).toEqual(["sent", "sent"]);
      await waitFor(
        () => noProcess(child!.pid) && noProcess(supervisor!.pid),
        1_000,
      );
      expect(noProcess(child.pid)).toBe(true);
      expect(noProcess(supervisor.pid)).toBe(true);
      expect(wrapper.exitCode).toBe(0);
    } finally {
      if (!cleanupComplete) await cleanup();
    }
  });

  it("does not signal a replacement identity during fixture recovery", async () => {
    const fixtureProcess = spawn(
      "python3",
      ["-B", "-c", "import time;time.sleep(30)"],
      {
        stdio: "ignore",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    if (fixtureProcess.pid === undefined)
      throw new Error("fixture process did not start");
    const fixtureOwner = captureOwnedProcess(process.pid);
    const target = captureOwnedProcess(fixtureProcess.pid);
    const rescues: string[] = [];
    let cleanupComplete = false;
    try {
      expect(
        rescueOwnedFixtureProcess(
          {
            ...target,
            identity: { ...target.identity, startTime: "replacement" },
          },
          [fixtureOwner],
        ),
      ).toBe("skipped");
      expect(noProcess(target.pid)).toBe(false);
      await requireOwnedFixtureAbsent(target, [fixtureOwner], rescues);
      cleanupComplete = true;
      expect(rescues).toEqual(["sent"]);
    } finally {
      if (!cleanupComplete)
        await requireOwnedFixtureAbsent(target, [fixtureOwner], rescues);
    }
  });

  it("fails a ready scanner that exits zero after a guardian-only interruption", async () => {
    const { directory, path } = fixture((directory) => {
      const guardian = join(directory, "guardian-only");
      const ready = join(directory, "guardian-only-ready");
      const released = join(directory, "released-zero");
      return (
        "const fs=require('node:fs');const supervisor=process.ppid;const guardian=Number(fs.readFileSync('/proc/'+supervisor+'/stat','utf8').split(') ')[1].split(' ')[1]);fs.writeFileSync(" +
        JSON.stringify(guardian) +
        ",String(guardian));process.on('SIGTERM',()=>{fs.writeFileSync(" +
        JSON.stringify(released) +
        ",'1');process.exit(0)});fs.writeFileSync(" +
        JSON.stringify(ready) +
        ",String(process.pid));setInterval(()=>{},1000);"
      );
    });
    const resultPath = join(directory, "guardian-only-result.json");
    const harnessSource =
      "import fs from 'node:fs';import {executeScanner} from " +
      JSON.stringify(helperUrl) +
      ";process.on('SIGTERM',()=>{});executeScanner(process.execPath,[" +
      JSON.stringify(path) +
      "]," +
      JSON.stringify(directory) +
      ",5000,{graceMs:25,cleanupDeadlineMs:500}).then(value=>{fs.writeFileSync(" +
      JSON.stringify(resultPath) +
      ",JSON.stringify(value));process.exitCode=value.error?1:0;});";
    const harness = spawn(node, ["--input-type=module", "-e", harnessSource], {
      cwd: directory,
      detached: true,
      stdio: "ignore",
    });
    trackGroup(harness.pid!);
    await waitFor(() => existsSync(join(directory, "guardian-only-ready")));
    process.kill(
      Number(readFileSync(join(directory, "guardian-only"), "utf8")),
      "SIGTERM",
    );
    await waitFor(() => existsSync(resultPath));
    await waitFor(() => harness.exitCode !== null);
    expect(existsSync(join(directory, "released-zero"))).toBe(true);
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      exitCode: 0,
      cleanup: "reaped",
      termination: "interrupted",
      error: "SCANNER_INTERRUPTED",
    });
    expect(harness.exitCode).toBe(1);
    forgetGroup(harness.pid!);
  });

  it("fails closed when a guardian-only signal follows a queued normal receipt", async () => {
    const { directory } = fixture("");
    const childReadyPath = join(directory, "queued-normal-child-ready");
    const releasePath = join(directory, "queued-normal-release");
    const queuedPath = join(directory, "queued-normal-status");
    const controlPath = join(directory, "queued-normal-control");
    const childPidPath = join(directory, "queued-normal-child");
    const supervisorPidPath = join(directory, "queued-normal-supervisor-pid");
    const supervisorPath = join(directory, "queued-normal-supervisor.py");
    const childCode =
      "import os,sys,time\nopen(sys.argv[1],'w').write('ready')\nwhile not os.path.exists(sys.argv[2]): time.sleep(.002)";
    const source = [
      "import json,os,subprocess,sys,time",
      "open(" +
        JSON.stringify(supervisorPidPath) +
        ",'w').write(str(os.getpid()))",
      "child=subprocess.Popen([sys.executable,'-c'," +
        JSON.stringify(childCode) +
        "," +
        JSON.stringify(childReadyPath) +
        "," +
        JSON.stringify(releasePath) +
        "]) ",
      "open(" + JSON.stringify(childPidPath) + ",'w').write(str(child.pid))",
      "while not os.path.exists(" +
        JSON.stringify(childReadyPath) +
        "): time.sleep(.002)",
      "status=os.fdopen(3,'w',encoding='utf8',closefd=True)",
      "status.write(json.dumps({'version':1,'exitCode':0,'signal':None,'termination':'none','reaping':'reaped','error':None},separators=(',',':'))+'\\n');status.flush()",
      "open(" + JSON.stringify(queuedPath) + ",'w').write('queued')",
      "open(" +
        JSON.stringify(controlPath) +
        ",'w').write(sys.stdin.readline())",
      "open(" + JSON.stringify(releasePath) + ",'w').write('release')",
      "child.wait()",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const guardian = spawn(
      "python3",
      ["-B", guardianPath, supervisorPath, "[]", directory, "25", "500"],
      { cwd: directory, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    let receipts = "";
    let child: number | null = null;
    let childIdentity: ReturnType<typeof processIdentity> = null;
    let supervisor: number | null = null;
    guardian.stderr?.on("data", (chunk) => (stderr += chunk));
    guardian.stdio[3]?.on("data", (chunk) => (receipts += chunk));
    try {
      await waitFor(() => existsSync(childReadyPath));
      await waitFor(() => existsSync(queuedPath));
      await waitFor(() => receipts.includes('"termination":"none"'));
      child = Number(readFileSync(childPidPath, "utf8"));
      supervisor = Number(readFileSync(supervisorPidPath, "utf8"));
      childIdentity = processIdentity(child);
      expect(childIdentity).not.toBeNull();
      process.kill(guardian.pid!, "SIGTERM");
      await waitFor(
        () =>
          existsSync(controlPath) &&
          readFileSync(controlPath, "utf8").startsWith("interrupted "),
      );
      expect(readFileSync(controlPath, "utf8")).toMatch(/^interrupted /);
      await waitFor(() => guardian.exitCode !== null);
      await waitFor(() => noProcess(child!));
      const frames = receipts
        .trim()
        .split("\n")
        .map((frame) => JSON.parse(frame));
      expect(frames[0]).toMatchObject({
        exitCode: 0,
        termination: "none",
        reaping: "reaped",
      });
      expect(frames.at(-1)).toMatchObject({
        termination: "interrupted",
        reaping: "incomplete",
        error: "SCANNER_GUARDIAN_INTERRUPTED",
      });
      expect(guardian.exitCode, stderr).toBe(1);
      expect(stderr).toBe("");
    } finally {
      if (guardian.exitCode === null) {
        if (child !== null && childIdentity !== null && !noProcess(child)) {
          rescueOwnedProcess(child, childIdentity.startTime, [
            guardian.pid!,
            supervisor!,
          ]);
        }
        guardian.kill("SIGKILL");
      }
    }
  });

  it("removes the EOF watcher and contains an unread control pipe", async () => {
    const { directory } = fixture("");
    const readyPath = join(directory, "eof-ready");
    const supervisorPidPath = join(directory, "eof-supervisor-pid");
    const eofWatcherPath = join(directory, ".guardian-eof-watcher");
    const supervisorPath = join(directory, "eof-supervisor.py");
    const source = [
      "import fcntl,os,signal,time",
      "ready=" + JSON.stringify(readyPath),
      "pid=" + JSON.stringify(supervisorPidPath),
      "signal.signal(signal.SIGTERM,lambda *_:None)",
      "fcntl.fcntl(0,fcntl.F_SETPIPE_SZ,4096)",
      "open(pid,'w').write(str(os.getpid()))",
      "open(ready,'w').write('ready')",
      "while True:",
      " time.sleep(1)",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const guardian = spawn(
      "python3",
      [
        "-B",
        guardianPath,
        supervisorPath,
        "[]",
        directory,
        "25",
        "250",
        "eof-unread-control",
      ],
      { cwd: directory, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    let status = "";
    let supervisor: number | null = null;
    let supervisorIdentity: ReturnType<typeof processIdentity> = null;
    guardian.stderr?.on("data", (chunk) => (stderr += chunk));
    guardian.stdio[3]?.on("data", (chunk) => (status += chunk));
    try {
      await waitFor(() => existsSync(readyPath));
      supervisor = Number(readFileSync(supervisorPidPath, "utf8"));
      supervisorIdentity = processIdentity(supervisor);
      expect(supervisorIdentity).not.toBeNull();
      guardian.stdin?.end();
      await waitFor(() => existsSync(eofWatcherPath), 1_000);
      expect(readFileSync(eofWatcherPath, "utf8")).toBe("absent");
      await waitFor(() => guardian.exitCode !== null, 1_000);
      await waitFor(() => noProcess(supervisor!), 1_000);
      expect(guardian.exitCode, stderr).toBe(1);
      expect(stderr).toBe("");
      expect(status).toContain('"termination":"control-eof"');
    } finally {
      if (guardian.exitCode === null) {
        if (
          supervisor !== null &&
          supervisorIdentity !== null &&
          !noProcess(supervisor)
        ) {
          rescueOwnedProcess(supervisor, supervisorIdentity.startTime, [
            guardian.pid!,
          ]);
        }
        guardian.kill("SIGKILL");
      }
    }
  });

  it("deterministically drains terminal status queued before supervisor exit", async () => {
    const { directory } = fixture("");
    const supervisorPath = join(directory, "status-before-exit-supervisor.py");
    const supervisorPidPath = join(
      directory,
      "status-before-exit-supervisor-pid",
    );
    writeFileSync(
      supervisorPath,
      [
        "import json,os",
        "open(" +
          JSON.stringify(supervisorPidPath) +
          ",'w').write(str(os.getpid()))",
        "status=os.fdopen(3,'w',encoding='utf8',closefd=True)",
        "status.write(json.dumps({'version':1,'exitCode':0,'signal':None,'termination':'none','reaping':'reaped','error':None},separators=(',',':'))+'\\n')",
        "status.flush()",
        "os._exit(0)",
      ].join("\n"),
    );
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const guardian = spawn(
      "python3",
      [
        "-B",
        guardianPath,
        supervisorPath,
        "[]",
        directory,
        "25",
        "250",
        "post-poll-drain",
      ],
      { cwd: directory, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] },
    );
    let stderr = "";
    let status = "";
    guardian.stderr?.on("data", (chunk) => (stderr += chunk));
    guardian.stdio[3]?.on("data", (chunk) => (status += chunk));
    try {
      await waitFor(() => existsSync(supervisorPidPath));
      const supervisor = Number(readFileSync(supervisorPidPath, "utf8"));
      await waitFor(() => ["T", "t"].includes(processState(guardian.pid!)));
      await waitFor(() =>
        ["Z", "X", "x", "absent"].includes(processState(supervisor)),
      );
      process.kill(guardian.pid!, "SIGCONT");
      await waitFor(() => guardian.exitCode !== null, 1_000);
      expect(guardian.exitCode, stderr).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(status.trim())).toMatchObject({
        exitCode: 0,
        termination: "none",
        reaping: "reaped",
        error: null,
      });
    } finally {
      if (guardian.exitCode === null) guardian.kill("SIGKILL");
    }
  });

  it("retains an earlier caller deadline after a guardian-only signal", async () => {
    const { directory } = fixture("");
    const childPidPath = join(directory, "earlier-deadline-child");
    const supervisorPidPath = join(
      directory,
      "earlier-deadline-supervisor-pid",
    );
    const supervisorPath = join(directory, "earlier-deadline-supervisor.py");
    const childCode =
      "import signal,time\nsignal.signal(signal.SIGTERM,lambda *_:None)\nwhile True: time.sleep(1)";
    const source = [
      "import os,subprocess,sys,time",
      "open(" +
        JSON.stringify(supervisorPidPath) +
        ",'w').write(str(os.getpid()))",
      "child=subprocess.Popen([sys.executable,'-c'," +
        JSON.stringify(childCode) +
        "])",
      "open(" + JSON.stringify(childPidPath) + ",'w').write(str(child.pid))",
      "status=os.fdopen(3,'w',encoding='utf8',closefd=True)",
      "control=os.fdopen(4,'w',encoding='utf8',closefd=True)",
      "time.sleep(5)",
    ].join("\n");
    writeFileSync(supervisorPath, source);
    const guardianPath = new URL(
      "../../../scripts/security/scanner-guardian.py",
      import.meta.url,
    ).pathname;
    const guardian = spawn(
      "python3",
      ["-B", guardianPath, supervisorPath, "[]", directory, "25", "1000"],
      { cwd: directory, stdio: ["pipe", "ignore", "pipe", "pipe", "pipe"] },
    );
    let child: number | null = null;
    let childIdentity: ReturnType<typeof processIdentity> = null;
    let supervisor: number | null = null;
    try {
      await waitFor(() => existsSync(childPidPath));
      child = Number(readFileSync(childPidPath, "utf8"));
      supervisor = Number(readFileSync(supervisorPidPath, "utf8"));
      childIdentity = processIdentity(child);
      expect(childIdentity).not.toBeNull();
      const started = Date.now();
      process.kill(guardian.pid!, "SIGTERM");
      const deadline = Number(process.hrtime.bigint() / 1_000_000n) + 60;
      guardian.stdin?.write("interrupted " + deadline + "\n");
      await waitFor(() => guardian.exitCode !== null, 700);
      await waitFor(() => noProcess(child!), 700);
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      if (guardian.exitCode === null) {
        if (child !== null && childIdentity !== null && !noProcess(child)) {
          rescueOwnedProcess(child, childIdentity.startTime, [
            guardian.pid!,
            supervisor!,
          ]);
        }
        guardian.kill("SIGKILL");
      }
    }
  });

  it("admits no scanner launch when the guardian pidfd probe is unavailable", async () => {
    const { directory, path } = fixture(
      (directory) =>
        `require('node:fs').writeFileSync(${JSON.stringify(join(directory, "started"))},'1');`,
    );
    for (const testStatusFault of [
      "pidfd-missing",
      "pidfd-enosys",
      "pidfd-eperm",
    ]) {
      const result = await executeScanner(node, [path], directory, 1_000, {
        testStatusFault,
      });
      expect(existsSync(join(directory, "started"))).toBe(false);
      expect(result).toMatchObject({
        cleanup: "unknown",
        error: expect.stringMatching(/^SCANNER_PIDFD_UNAVAILABLE:/),
      });
    }
  });

  it("continues inner cleanup after guardian-only death without a false receipt", async () => {
    const { directory, path } = fixture(
      (directory) =>
        `const fs=require('node:fs');const {spawn}=require('node:child_process');const supervisor=process.ppid;const guardian=Number(fs.readFileSync('/proc/'+supervisor+'/stat','utf8').split(') ')[1].split(' ')[1]);const ready=${JSON.stringify(join(directory, "guardian-child-ready"))};const child=spawn(process.execPath,['-e',"const fs=require('node:fs');process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});fs.writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)",ready],{stdio:'inherit'});process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});const wait=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(wait);fs.writeFileSync(${JSON.stringify(join(directory, "guardian"))},String(guardian));fs.writeFileSync(${JSON.stringify(join(directory, "guardian-root"))},String(process.pid));fs.writeFileSync(${JSON.stringify(join(directory, "guardian-child"))},String(child.pid))}},2);setInterval(()=>{},1000);`,
    );
    const resultPath = join(directory, "guardian-death-result.json");
    const harness = spawn(
      node,
      [
        "--input-type=module",
        "-e",
        `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},5000,{graceMs:25,cleanupDeadlineMs:500}).then(value=>fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(value)));`,
      ],
      { cwd: directory, detached: true, stdio: "ignore" },
    );
    trackGroup(harness.pid!);
    await waitFor(
      () =>
        existsSync(join(directory, "guardian-child")) &&
        existsSync(join(directory, "guardian-child-ready")),
    );
    process.kill(
      Number(readFileSync(join(directory, "guardian"), "utf8")),
      "SIGKILL",
    );
    await waitFor(() => existsSync(resultPath));
    for (const marker of ["guardian-root", "guardian-child"]) {
      await waitFor(() =>
        noProcess(Number(readFileSync(join(directory, marker), "utf8"))),
      );
    }
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      cleanup: "unknown",
      termination: "unknown",
    });
    forgetGroup(harness.pid!);
  });

  it("reserves an actual kill/reap slice for a tiny shared deadline", async () => {
    const { directory } = fixture("");
    const path = join(directory, "tiny-fixture.py");
    writeFileSync(
      path,
      `import os,signal,subprocess,sys,time
root=${JSON.stringify(join(directory, "tiny-root"))}
child_pid=${JSON.stringify(join(directory, "tiny-child"))}
child_ready=${JSON.stringify(join(directory, "tiny-child-ready"))}
child=subprocess.Popen([sys.executable,"-c",${JSON.stringify("import os,signal,sys,time\nsignal.signal(signal.SIGTERM, lambda *_: None)\nopen(sys.argv[1],'w').write(str(os.getpid()))\nopen(sys.argv[2],'w').write('ready')\nwhile True: time.sleep(1)")},child_pid,child_ready])
while not os.path.exists(child_ready): time.sleep(.002)
signal.signal(signal.SIGTERM, lambda *_: None)
open(root,'w').write(str(os.getpid()))
while True: time.sleep(1)`,
    );
    const pending = executeScanner("python3", [path], directory, 1_000, {
      graceMs: 1_000,
      cleanupDeadlineMs: 1,
    });
    await waitFor(() => existsSync(join(directory, "tiny-root")));
    await waitFor(() => existsSync(join(directory, "tiny-child-ready")));
    const result = await pending;
    const root = Number(readFileSync(join(directory, "tiny-root"), "utf8"));
    const child = Number(readFileSync(join(directory, "tiny-child"), "utf8"));
    await waitFor(() => noProcess(root));
    await waitFor(() => noProcess(child));
    expect(result).toMatchObject({
      timedOut: true,
      cleanup: "unknown",
      error: "SCANNER_CLEANUP_DEADLINE",
    });
  });

  it("has no detached inner escape from an outer SIGKILL group", async () => {
    const { directory, path } = fixture(
      (directory) =>
        `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(join(directory, "group-child"))},String(child.pid));setInterval(()=>{},1000);`,
    );
    const harness = spawn(
      node,
      [
        "--input-type=module",
        "-e",
        `import {executeScanner} from ${JSON.stringify(helperUrl)};executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},5000,{graceMs:25});`,
      ],
      { cwd: directory, detached: true, stdio: "ignore" },
    );
    trackGroup(harness.pid!);
    await waitFor(() => existsSync(join(directory, "group-child")));
    const childPid = Number(
      readFileSync(join(directory, "group-child"), "utf8"),
    );
    process.kill(-harness.pid!, "SIGKILL");
    await waitFor(() => noProcess(childPid));
    forgetGroup(harness.pid!);
  });

  it("naturally exits a standalone caller after timeout cleanup of an ordinary pipe holder", async () => {
    const { directory, path } = fixture(
      (directory) =>
        `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(join(directory, "root-ready"))},String(process.pid));setInterval(()=>{},1000);`,
    );
    const resultPath = join(directory, "deadline-result.json");
    const harness = spawn(
      node,
      [
        "--input-type=module",
        "-e",
        `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},500,{graceMs:25,cleanupDeadlineMs:500}).then(value=>fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(value)));`,
      ],
      { cwd: directory, detached: true, stdio: "ignore" },
    );
    trackGroup(harness.pid!);
    await waitFor(() => existsSync(resultPath));
    await waitFor(() => harness.exitCode !== null);
    const rootPid = Number(readFileSync(join(directory, "root-ready"), "utf8"));
    await waitFor(() => noProcess(rootPid));
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      timedOut: true,
      cleanup: "reaped",
      error: "SCANNER_TIMEOUT",
    });
    expect(harness.exitCode).toBe(0);
    forgetGroup(harness.pid!);
  });

  it("fails closed and contains ordinary survivors when its supervisor is unavailable", async () => {
    const { directory, path } = fixture(
      (directory) =>
        `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(join(directory, "root-ready"))},String(process.pid));fs.writeFileSync(${JSON.stringify(join(directory, "grandchild-ready"))},String(child.pid));process.kill(process.ppid,'SIGSTOP');process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
    );
    const resultPath = join(directory, "fallback-result.json");
    const harness = spawn(
      node,
      [
        "--input-type=module",
        "-e",
        `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};const controller=new AbortController();const ready=${JSON.stringify(join(directory, "root-ready"))};const watcher=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(watcher);controller.abort();}},10);executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},1000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:1}).then(value=>{clearInterval(watcher);fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(value));});`,
      ],
      { cwd: directory, detached: true, stdio: "ignore" },
    );
    trackGroup(harness.pid!);
    await waitFor(() => existsSync(resultPath));
    await waitFor(() => harness.exitCode !== null);
    const rootPid = Number(readFileSync(join(directory, "root-ready"), "utf8"));
    const grandchildPid = Number(
      readFileSync(join(directory, "grandchild-ready"), "utf8"),
    );
    await waitFor(() => noProcess(rootPid));
    await waitFor(() => noProcess(grandchildPid));
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      exitCode: null,
      signal: null,
      error: "SCANNER_CLEANUP_DEADLINE",
      cleanup: "unknown",
      termination: "unknown",
      interrupted: true,
      supervisor: { exitCode: null, signal: null, normal: false },
    });
    expect(harness.exitCode).toBe(0);
    forgetGroup(harness.pid!);
  });

  it("contains ordinary descendants after supervisor death and fails closed", async () => {
    const killed = "supervisor-killed";
    const { directory, path } = fixture(
      (directory) =>
        `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(join(directory, "root-ready"))},String(process.pid));fs.writeFileSync(${JSON.stringify(join(directory, "grandchild-ready"))},String(child.pid));setTimeout(()=>{process.kill(process.ppid,'SIGKILL');fs.writeFileSync(${JSON.stringify(join(directory, killed))},'1')},50);process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
    );
    const resultPath = join(directory, "supervisor-death-result.json");
    const harness = spawn(
      node,
      [
        "--input-type=module",
        "-e",
        `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};const controller=new AbortController();const ready=${JSON.stringify(join(directory, killed))};const watcher=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(watcher);controller.abort();}},10);executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},1000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:1}).then(value=>{clearInterval(watcher);fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(value));});`,
      ],
      { cwd: directory, detached: true, stdio: "ignore" },
    );
    trackGroup(harness.pid!);
    await waitFor(() => existsSync(resultPath));
    await waitFor(() => harness.exitCode !== null);
    const rootPid = Number(readFileSync(join(directory, "root-ready"), "utf8"));
    const grandchildPid = Number(
      readFileSync(join(directory, "grandchild-ready"), "utf8"),
    );
    await waitFor(() => noProcess(rootPid));
    await waitFor(() => noProcess(grandchildPid));
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      exitCode: null,
      signal: null,
      cleanup: "unknown",
      termination: "unknown",
      interrupted: true,
      supervisor: { normal: false },
    });
    expect(harness.exitCode).toBe(0);
    forgetGroup(harness.pid!);
  });

  it("contains an unrecorded child after telemetry pause, ancestor exit, and supervisor death", async () => {
    const killed = "adopted-supervisor-killed";
    const release = "release-adopted-supervisor-kill";
    const telemetryPaused = "telemetry-paused";
    const childReady = "adopted-grandchild";
    const ancestorExited = "ancestor-exited";
    const supervisorPid = "supervisor-pid";
    const { directory, path } = fixture(
      (directory) =>
        `const fs=require('node:fs');const {spawn}=require('node:child_process');const supervisor=process.ppid;fs.writeFileSync(${JSON.stringify(join(directory, supervisorPid))},String(supervisor));process.kill(supervisor,'SIGSTOP');const pause=setInterval(()=>{let state='';try{state=fs.readFileSync('/proc/'+supervisor+'/stat','utf8').split(') ')[1].split(' ')[0]}catch{}if(state!=='T')return;clearInterval(pause);fs.writeFileSync(${JSON.stringify(join(directory, telemetryPaused))},'T');const child=spawn(process.execPath,['-e',"const fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});const wait=setInterval(()=>{if(fs.existsSync(process.argv[2])&&fs.existsSync(process.argv[3])){clearInterval(wait);process.kill(Number(fs.readFileSync(process.argv[4],'utf8')),'SIGKILL');fs.writeFileSync(process.argv[5],'1')}},5);setInterval(()=>{},1000)",${JSON.stringify(join(directory, childReady))},${JSON.stringify(join(directory, ancestorExited))},${JSON.stringify(join(directory, release))},${JSON.stringify(join(directory, supervisorPid))},${JSON.stringify(join(directory, killed))}],{stdio:'inherit'});const wait=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, childReady))})){clearInterval(wait);fs.writeFileSync(${JSON.stringify(join(directory, ancestorExited))},String(process.pid));process.exit(0)}},5)},5);`,
    );
    const resultPath = join(directory, "adopted-supervisor-death-result.json");
    const harness = spawn(
      node,
      [
        "--input-type=module",
        "-e",
        `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};const controller=new AbortController();const ready=${JSON.stringify(join(directory, killed))};const watcher=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(watcher);controller.abort();}},10);executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},1000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:500}).then(value=>{clearInterval(watcher);fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(value));process.exitCode=value.error?1:0;});`,
      ],
      { cwd: directory, detached: true, stdio: "ignore" },
    );
    trackGroup(harness.pid!);
    await waitFor(() => existsSync(join(directory, telemetryPaused)));
    const pausedSupervisor = Number(
      readFileSync(join(directory, supervisorPid), "utf8"),
    );
    expect(processState(pausedSupervisor)).toBe("T");
    await waitFor(() => existsSync(join(directory, childReady)));
    await waitFor(() => existsSync(join(directory, ancestorExited)));
    const ancestorPid = Number(
      readFileSync(join(directory, ancestorExited), "utf8"),
    );
    await waitFor(() => ["Z", "absent"].includes(processState(ancestorPid)));
    writeFileSync(join(directory, release), "release");
    await waitFor(() => existsSync(resultPath));
    await waitFor(() => harness.exitCode !== null);
    const rootPid = ancestorPid;
    const grandchildPid = Number(
      readFileSync(join(directory, childReady), "utf8"),
    );
    await waitFor(() => noProcess(rootPid));
    await waitFor(() => noProcess(grandchildPid));
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      exitCode: null,
      signal: null,
      cleanup: "unknown",
      termination: "unknown",
      supervisor: { normal: false },
    });
    expect(harness.exitCode).toBe(1);
    forgetGroup(harness.pid!);
  });

  it("retains ownership after large telemetry before adopted cleanup", async () => {
    const killed = "flooded-supervisor-killed";
    const { directory, path } = fixture(
      (directory) =>
        `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"const fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setTimeout(()=>{process.kill(process.ppid,'SIGKILL');fs.writeFileSync(process.argv[2],'1')},500);setInterval(()=>{},1000)",${JSON.stringify(join(directory, "flooded-grandchild"))},${JSON.stringify(join(directory, killed))}],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(join(directory, "flooded-root"))},String(process.pid));process.exit(0);`,
    );
    const resultPath = join(directory, "flooded-supervisor-death-result.json");
    const harness = spawn(
      node,
      [
        "--input-type=module",
        "-e",
        `import fs from 'node:fs';import {executeScanner} from ${JSON.stringify(helperUrl)};const controller=new AbortController();const ready=${JSON.stringify(join(directory, killed))};const watcher=setInterval(()=>{if(fs.existsSync(ready)){clearInterval(watcher);controller.abort();}},10);executeScanner(process.execPath,[${JSON.stringify(path)}],${JSON.stringify(directory)},2000,{signal:controller.signal,graceMs:25,cleanupDeadlineMs:1,testStatusFault:'ownership-flood'}).then(value=>{clearInterval(watcher);fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(value));});`,
      ],
      { cwd: directory, detached: true, stdio: "ignore" },
    );
    trackGroup(harness.pid!);
    await waitFor(() => existsSync(resultPath), 2_500);
    await waitFor(() => harness.exitCode !== null);
    const rootPid = Number(
      readFileSync(join(directory, "flooded-root"), "utf8"),
    );
    const grandchildPid = Number(
      readFileSync(join(directory, "flooded-grandchild"), "utf8"),
    );
    await waitFor(() => noProcess(rootPid));
    await waitFor(() => noProcess(grandchildPid));
    expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
      exitCode: null,
      signal: null,
      cleanup: "unknown",
      termination: "unknown",
    });
    expect(JSON.parse(readFileSync(resultPath, "utf8")).error).toBeTruthy();
    expect(harness.exitCode).toBe(0);
    forgetGroup(harness.pid!);
  });
});
