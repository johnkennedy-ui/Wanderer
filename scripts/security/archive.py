"""Consume pinned scanner archives through descriptor-anchored paths only."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tarfile


READ_DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
READ_FILE = os.O_RDONLY | os.O_NOFOLLOW


def digest(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        result.update(chunk)
    return result.hexdigest()


def identity(value):
    return (
        value.st_dev,
        value.st_ino,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def parent_fd(path, create=False):
    """Open every ancestor without following a link; returned fd anchors it."""
    parts = Path(path).absolute().parts
    descriptor = os.open(parts[0], READ_DIRECTORY)
    try:
        for component in parts[1:-1]:
            try:
                child = os.open(component, READ_DIRECTORY, dir_fd=descriptor)
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(component, 0o700, dir_fd=descriptor)
                child = os.open(component, READ_DIRECTORY, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor, parts[-1]
    except Exception:
        os.close(descriptor)
        raise


def open_regular(path):
    parent, name = parent_fd(path)
    try:
        descriptor = os.open(name, READ_FILE, dir_fd=parent)
    finally:
        os.close(parent)
    details = os.fstat(descriptor)
    if not stat.S_ISREG(details.st_mode):
        os.close(descriptor)
        raise ValueError("Scanner archive is not a regular file")
    return descriptor


def open_directory(path, create=False, exclusive=False):
    parent, name = parent_fd(path, create=create)
    try:
        if create:
            try:
                os.mkdir(name, 0o700, dir_fd=parent)
            except FileExistsError:
                if exclusive:
                    raise
        return os.open(name, READ_DIRECTORY, dir_fd=parent)
    finally:
        os.close(parent)


def child_directory(parent, name, create=False):
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
        except FileExistsError:
            pass
    return os.open(name, READ_DIRECTORY, dir_fd=parent)


def member_path(entry):
    path = PurePosixPath(entry.name)
    if path.is_absolute() or ".." in path.parts or "\\" in entry.name:
        raise ValueError("Unsafe scanner archive path")
    return path


def relative_path(entry, prefix):
    path = member_path(entry)
    if prefix != "-":
        if not path.parts or path.parts[0] != prefix:
            raise ValueError("Unexpected scanner archive root")
        path = PurePosixPath(*path.parts[1:])
    return path


def member_parent(root, path, create):
    descriptor = os.dup(root)
    try:
        for component in path.parts[:-1]:
            child = child_directory(descriptor, component, create)
            os.close(descriptor)
            descriptor = child
        return descriptor, path.name
    except Exception:
        os.close(descriptor)
        raise


def hash_regular(parent, name, expected_size=None):
    descriptor = os.open(name, READ_FILE, dir_fd=parent)
    try:
        details = os.fstat(descriptor)
        if not stat.S_ISREG(details.st_mode):
            raise ValueError("Scanner cache member is not regular: " + name)
        if expected_size is not None and details.st_size != expected_size:
            raise ValueError("Scanner file missing or resized: " + name)
        with os.fdopen(os.dup(descriptor), "rb") as source:
            return digest(source), details
    finally:
        os.close(descriptor)


def snapshot(source_name, destination_name, expected_hash):
    source = open_regular(source_name)
    try:
        before = os.fstat(source)
        parent, name = parent_fd(destination_name, create=True)
        try:
            destination = os.open(
                name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=parent,
            )
        finally:
            os.close(parent)
        try:
            checksum = hashlib.sha256()
            with os.fdopen(os.dup(source), "rb") as input_file:
                with os.fdopen(destination, "wb", closefd=False) as output:
                    for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
                        checksum.update(chunk)
                        output.write(chunk)
            after = os.fstat(source)
            os.fchmod(destination, 0o400)
        finally:
            os.close(destination)
        if identity(before) != identity(after):
            raise ValueError("Scanner archive changed while being snapshotted")
        if checksum.hexdigest() != expected_hash:
            raise ValueError("Scanner archive checksum mismatch")
    finally:
        os.close(source)


def inventory(action, archive_name, destination_name, expected_hash, prefix):
    source = open_regular(archive_name)
    try:
        before = os.fstat(source)
        if digest(os.fdopen(os.dup(source), "rb")) != expected_hash:
            raise ValueError("Scanner archive checksum mismatch")
        if identity(before) != identity(os.fstat(source)):
            raise ValueError("Scanner archive changed after checksum verification")
        os.lseek(source, 0, os.SEEK_SET)
        destination = open_directory(
            destination_name, create=action == "install", exclusive=action == "install"
        )
        try:
            expected_files = set()
            records = []
            with os.fdopen(os.dup(source), "rb") as archive_file:
                with tarfile.open(fileobj=archive_file, mode="r:gz") as archive:
                    for entry in archive:
                        path = relative_path(entry, prefix)
                        if str(path) == ".":
                            if not entry.isdir():
                                raise ValueError("Archive root is not a directory")
                            continue
                        if entry.isdir():
                            parent, name = member_parent(destination, path, action == "install")
                            try:
                                child = child_directory(parent, name, action == "install")
                                os.close(child)
                            finally:
                                os.close(parent)
                            continue
                        if not entry.isfile() or str(path) in expected_files:
                            raise ValueError("Scanner archive contains link, special or duplicate entry")
                        expected_files.add(str(path))
                        parent, name = member_parent(destination, path, action == "install")
                        try:
                            mode = entry.mode & 0o777
                            contents = archive.extractfile(entry)
                            if contents is None:
                                raise ValueError("Scanner archive member is unreadable")
                            if action == "install":
                                output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode, dir_fd=parent)
                                try:
                                    with os.fdopen(output, "wb", closefd=False) as file:
                                        for chunk in iter(lambda: contents.read(1024 * 1024), b""):
                                            file.write(chunk)
                                    os.fchmod(output, mode)
                                finally:
                                    os.close(output)
                                content_hash, details = hash_regular(parent, name, entry.size)
                            else:
                                content_hash = digest(contents)
                                installed_hash, details = hash_regular(parent, name, entry.size)
                                if installed_hash != content_hash:
                                    raise ValueError("Scanner cache content changed: " + str(path))
                            if details.st_mode & 0o777 != mode:
                                raise ValueError("Scanner file mode changed: " + str(path))
                            records.append([str(path), entry.size, mode, content_hash])
                        finally:
                            os.close(parent)
            actual_files = set()
            def walk(directory, base=""):
                for name in os.listdir(directory):
                    details = os.stat(name, dir_fd=directory, follow_symlinks=False)
                    path = name if not base else base + "/" + name
                    if stat.S_ISDIR(details.st_mode):
                        child = os.open(name, READ_DIRECTORY, dir_fd=directory)
                        try:
                            walk(child, path)
                        finally:
                            os.close(child)
                    elif stat.S_ISREG(details.st_mode):
                        actual_files.add(path)
                    else:
                        raise ValueError("Scanner cache contains link or special entry")
            walk(destination)
            if actual_files != expected_files:
                raise ValueError("Scanner cache membership differs from pinned archive")
            if identity(before) != identity(os.fstat(source)):
                raise ValueError("Scanner archive changed while being inspected")
            return {"files": len(records), "contentSha256": hashlib.sha256(json.dumps(sorted(records), separators=(",", ":")).encode()).hexdigest()}
        finally:
            os.close(destination)
    finally:
        os.close(source)


def main():
    action, *arguments = sys.argv[1:]
    if action == "snapshot":
        if len(arguments) != 3:
            raise ValueError("Usage: archive.py snapshot SOURCE DESTINATION SHA256")
        snapshot(*arguments)
        return
    if action not in ("install", "verify") or len(arguments) != 4:
        raise ValueError("Unsupported archive operation")
    print(json.dumps(inventory(action, *arguments)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
