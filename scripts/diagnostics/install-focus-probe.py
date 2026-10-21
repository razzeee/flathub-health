"""TEMPORARY instrumentation for a manual branch-only diagnostic run."""
from pathlib import Path

path = Path('.runner/action/run.py')
source = path.read_text()
needle = '    if mode == "screenshots":\n        docker += ["--tmpfs", "/dev/dri"]'
replacement = needle + '''
        docker += ["-v", f"{workspace / 'scripts/diagnostics'}:/focus-probe:ro",
                   "-e", "PATH=/focus-probe:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"]'''
if source.count(needle) != 1:
    raise RuntimeError('Pinned action did not match diagnostic mount boundary')
path.write_text(source.replace(needle, replacement))
Path('scripts/diagnostics/gnome-shell').chmod(0o755)
