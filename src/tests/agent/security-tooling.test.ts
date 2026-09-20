import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const privateArchiveModulePath =
  "../../../scripts/security/private-archive.mjs";
const { withPrivateArchive } = await import(privateArchiveModulePath);
const toolingModulePath = "../../../scripts/security/tooling.mjs";
const { TOOL_SPECS, publishVerifiedArchive, toolPaths, withVerifiedTool } =
  await import(toolingModulePath);
const archiveScript = new URL(
  "../../../scripts/security/archive.py",
  import.meta.url,
);
const roots: string[] = [];
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const root = () => {
  const value = mkdtempSync(join(tmpdir(), "wanderer-private-archive-"));
  roots.push(value);
  return value;
};
afterEach(() =>
  roots
    .splice(0)
    .forEach((value) => rmSync(value, { recursive: true, force: true })),
);
const python = (args: string[], cwd: string) =>
  spawnSync("python3", ["-B", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });

describe("private scanner archive consumption", () => {
  it("consumes a private snapshot after the cache pathname changes", async () => {
    const cwd = root();
    const cache = join(cwd, "cache.tar.gz");
    writeFileSync(cache, "verified inert bytes");
    let directory = "";
    await withPrivateArchive({
      cwd,
      label: "fixture",
      source: cache,
      expectedHash: sha256("verified inert bytes"),
      use: ({
        archive,
        directory: run,
      }: {
        archive: string;
        directory: string;
      }) => {
        directory = run;
        writeFileSync(cache, "replacement bytes");
        expect(archive).not.toBe(cache);
        expect(archive.includes(".agent/tools")).toBe(false);
        expect(archive.startsWith(tmpdir())).toBe(true);
        expect(readFileSync(archive, "utf8")).toBe("verified inert bytes");
      },
    });
    expect(existsSync(directory)).toBe(false);
  });

  it("rejects symlink ancestors and same-inode mutation while snapshotting", () => {
    const cwd = root();
    const target = join(cwd, "target");
    mkdirSync(target);
    writeFileSync(join(target, "archive"), "inert");
    symlinkSync(target, join(cwd, "linked"));
    const linked = python(
      [
        archiveScript.pathname,
        "snapshot",
        join(cwd, "linked/archive"),
        join(cwd, "copy"),
        sha256("inert"),
      ],
      cwd,
    );
    expect(linked.status).toBe(1);
    const wrongHash = python(
      [
        archiveScript.pathname,
        "snapshot",
        join(target, "archive"),
        join(cwd, "wrong-hash-copy"),
        "0".repeat(64),
      ],
      cwd,
    );
    expect(wrongHash.status).toBe(1);
    const nonregular = python(
      [
        archiveScript.pathname,
        "snapshot",
        target,
        join(cwd, "directory-copy"),
        sha256("inert"),
      ],
      cwd,
    );
    expect(nonregular.status).toBe(1);
    const source = join(cwd, "source");
    const destination = join(cwd, "copy");
    writeFileSync(source, "old");
    const probe = `import hashlib, importlib.util, os, sys\nspec=importlib.util.spec_from_file_location('archive',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)\nsource,destination=sys.argv[2:]; original=module.os.fstat; calls=0\ndef changed(fd):\n global calls\n value=original(fd); calls+=1\n if calls == 2:\n  with open(source,'wb') as out: out.write(b'new')\n return value\nmodule.os.fstat=changed\ntry:\n module.snapshot(source,destination,hashlib.sha256(b'new').hexdigest())\nexcept ValueError as error:\n print(error); sys.exit(0)\nraise SystemExit(1)`;
    const mutated = python(
      ["-c", probe, archiveScript.pathname, source, destination],
      cwd,
    );
    expect(mutated.status).toBe(0);
    expect(mutated.stdout).toContain("changed while being snapshotted");
  });

  it("preserves archive membership, content, mode and partial-install failures", () => {
    const cwd = root();
    const archive = join(cwd, "fixture.tar.gz");
    const maker = `import io, sys, tarfile\nwith tarfile.open(sys.argv[1],'w:gz') as tar:\n root=tarfile.TarInfo('fixture'); root.type=tarfile.DIRTYPE; root.mode=0o755; tar.addfile(root)\n info=tarfile.TarInfo('fixture/tool'); data=b'inert executable'; info.size=len(data); info.mode=0o755; tar.addfile(info,io.BytesIO(data))`;
    expect(python(["-c", maker, archive], cwd).status).toBe(0);
    const checksum = sha256(readFileSync(archive));
    const destination = join(cwd, "installed");
    expect(
      python(
        [
          archiveScript.pathname,
          "install",
          archive,
          destination,
          checksum,
          "fixture",
        ],
        cwd,
      ).status,
    ).toBe(0);
    expect(
      python(
        [
          archiveScript.pathname,
          "verify",
          archive,
          destination,
          checksum,
          "fixture",
        ],
        cwd,
      ).status,
    ).toBe(0);
    chmodSync(join(destination, "tool"), 0o600);
    expect(
      python(
        [
          archiveScript.pathname,
          "verify",
          archive,
          destination,
          checksum,
          "fixture",
        ],
        cwd,
      ).status,
    ).toBe(1);
    chmodSync(join(destination, "tool"), 0o755);
    writeFileSync(join(destination, "tool"), "tampered inert bytes");
    expect(
      python(
        [
          archiveScript.pathname,
          "verify",
          archive,
          destination,
          checksum,
          "fixture",
        ],
        cwd,
      ).status,
    ).toBe(1);
    writeFileSync(join(destination, "tool"), "inert executable");
    writeFileSync(join(destination, "extra"), "inert");
    expect(
      python(
        [
          archiveScript.pathname,
          "verify",
          archive,
          destination,
          checksum,
          "fixture",
        ],
        cwd,
      ).status,
    ).toBe(1);
    const partial = join(cwd, "partial");
    mkdirSync(partial);
    expect(
      python(
        [
          archiveScript.pathname,
          "install",
          archive,
          partial,
          checksum,
          "fixture",
        ],
        cwd,
      ).status,
    ).toBe(1);
  });
  it.each(["duplicate", "traversal", "special"] as const)(
    "rejects %s archive entries before installation",
    (kind) => {
      const cwd = root();
      const archive = join(cwd, `${kind}.tar.gz`);
      const maker = `import io,sys,tarfile\nkind=sys.argv[2]\nwith tarfile.open(sys.argv[1],'w:gz') as tar:\n root=tarfile.TarInfo('fixture'); root.type=tarfile.DIRTYPE; tar.addfile(root)\n if kind == 'traversal':\n  info=tarfile.TarInfo('fixture/../escape'); data=b'inert'; info.size=len(data); tar.addfile(info,io.BytesIO(data))\n elif kind == 'special':\n  info=tarfile.TarInfo('fixture/tool'); info.type=tarfile.SYMTYPE; info.linkname='elsewhere'; tar.addfile(info)\n else:\n  for value in (b'one',b'two'):\n   info=tarfile.TarInfo('fixture/tool'); info.size=len(value); tar.addfile(info,io.BytesIO(value))`;
      expect(python(["-c", maker, archive, kind], cwd).status).toBe(0);
      expect(
        python(
          [
            archiveScript.pathname,
            "install",
            archive,
            join(cwd, "installed"),
            sha256(readFileSync(archive)),
            "fixture",
          ],
          cwd,
        ).status,
      ).toBe(1);
    },
  );
});

describe("scanner cache publication", () => {
  it("uses a verified existing winner without overwriting it", () => {
    expect(Object.isFrozen(TOOL_SPECS)).toBe(true);
    expect(Object.isFrozen(TOOL_SPECS.gitleaks)).toBe(true);
    const cwd = root();
    const winner = join(cwd, "winner.tar.gz");
    const loser = join(cwd, "loser.part");
    writeFileSync(winner, "same verified inert bytes");
    writeFileSync(loser, "same verified inert bytes");
    const winnerFd = openSync(winner, "r");
    try {
      const winnerInode = fstatSync(winnerFd).ino;
      publishVerifiedArchive(
        loser,
        winner,
        sha256("same verified inert bytes"),
      );
      expect(fstatSync(winnerFd).ino).toBe(winnerInode);
      expect(readFileSync(winnerFd, "utf8")).toBe("same verified inert bytes");
    } finally {
      closeSync(winnerFd);
    }
    expect(existsSync(loser)).toBe(false);
  });

  it("rejects an unverified competing winner without overwriting it", () => {
    const cwd = root();
    const winner = join(cwd, "winner.tar.gz");
    const loser = join(cwd, "loser.part");
    writeFileSync(winner, "competing corrupt bytes");
    writeFileSync(loser, "verified inert bytes");
    expect(() =>
      publishVerifiedArchive(loser, winner, sha256("verified inert bytes")),
    ).toThrow("winner checksum mismatch");
    expect(readFileSync(winner, "utf8")).toBe("competing corrupt bytes");
    expect(existsSync(loser)).toBe(false);
  });
});

const fixtureArchive = (
  cwd: string,
  spec: any,
  layout: "flat" | "prefixed",
) => {
  const archive = join(cwd, ".agent/tools/downloads", spec.archive);
  mkdirSync(join(cwd, ".agent/tools/downloads"), { recursive: true });
  const entries =
    layout === "flat"
      ? [["gitleaks", "fixture gitleaks"]]
      : [
          ["codeql", null],
          ["codeql/codeql", "fixture codeql"],
        ];
  const maker = `import io,json,sys,tarfile\nwith tarfile.open(sys.argv[1],'w:gz') as tar:\n for name,data in json.loads(sys.argv[2]):\n  info=tarfile.TarInfo(name); info.mode=0o755\n  if data is None: info.type=tarfile.DIRTYPE; tar.addfile(info)\n  else: raw=data.encode(); info.size=len(raw); tar.addfile(info,io.BytesIO(raw))`;
  expect(
    python(["-c", maker, archive, JSON.stringify(entries)], cwd).status,
  ).toBe(0);
  return { ...spec, archiveSha256: sha256(readFileSync(archive)) };
};

describe("withVerifiedTool private execution", () => {
  it("uses archive-relative CodeQL members for cache and private paths", () => {
    const cwd = root();
    const paths = toolPaths(cwd, "codeql");
    expect(TOOL_SPECS.codeql.binary).toBe("codeql");
    expect(paths.binary).toBe(join(cwd, ".agent/tools/codeql-2.27.0/codeql"));
  });

  it.each([
    ["gitleaks", "flat", "gitleaks", "fixture gitleaks"],
    ["codeql", "prefixed", "codeql", "fixture codeql"],
  ] as const)(
    "stages %s %s archive members under a private CommonJS boundary",
    async (name, layout, binary, expected) => {
      const cwd = root();
      const spec = fixtureArchive(
        cwd,
        {
          version: "fixture",
          archive: `${name}-fixture.tar.gz`,
          url: "https://invalid.example/fixture",
          prefix: layout === "flat" ? "-" : "codeql",
          binary,
        },
        layout,
      );
      let run = "";
      await withVerifiedTool(
        cwd,
        name,
        (tool: { binary: string }) => {
          run = tool.binary.slice(0, tool.binary.indexOf("/tool/"));
          expect(tool.binary.includes(".agent/tools")).toBe(false);
          expect(tool.binary).toBe(join(run, "tool", binary));
          expect(readFileSync(tool.binary, "utf8")).toBe(expected);
          expect(readFileSync(join(run, "package.json"), "utf8")).toBe(
            '{"type":"commonjs"}\n',
          );
          const tools = join(cwd, ".agent/tools");
          renameSync(tools, join(cwd, ".agent/moved-tools"));
          mkdirSync(join(cwd, "replacement-tools"));
          symlinkSync(join(cwd, "replacement-tools"), tools);
          expect(readFileSync(tool.binary, "utf8")).toBe(expected);
        },
        { spec },
      );
      expect(existsSync(run)).toBe(false);
    },
  );

  it("cleans the private executable after a callback failure", async () => {
    const cwd = root();
    const spec = fixtureArchive(
      cwd,
      {
        version: "fixture",
        archive: "gitleaks-fixture.tar.gz",
        url: "https://invalid.example/fixture",
        prefix: "-",
        binary: "gitleaks",
      },
      "flat",
    );
    let run = "";
    await expect(
      withVerifiedTool(
        cwd,
        "gitleaks",
        (tool: { binary: string }) => {
          run = tool.binary.slice(0, tool.binary.indexOf("/tool/"));
          throw new Error("fixture callback failure");
        },
        { spec },
      ),
    ).rejects.toThrow("fixture callback failure");
    expect(existsSync(run)).toBe(false);
  });
});
