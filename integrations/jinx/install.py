"""Install the optional interface into an existing Jinx checkout; no restart."""
import ast
import hashlib
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1]).resolve()
expected_hash = sys.argv[2]
bot = root / "discord-bot.py"
original = bot.read_text()
if hashlib.sha256(bot.read_bytes()).hexdigest() != expected_hash:
    raise SystemExit("Jinx changed since inspection; inspect the current file before installing")
setup = """        self.http_session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=180)
        )
"""
close = """        await self.disconnect_voice()
        if self.http_session is not None and not self.http_session.closed:
"""
if original.count(setup) != 1 or original.count(close) != 1:
    raise SystemExit("Jinx lifecycle differs from the reviewed integration points")
patched = original.replace(setup, setup + """        from integrations.agent_harbor.harbor_api import start as start_harbor_api
        self.harbor_runner = await start_harbor_api(self, ROOT, reach_registry)
""").replace(close, """        if getattr(self, "harbor_runner", None) is not None:
            await self.harbor_runner.cleanup()
        await self.disconnect_voice()
        if self.http_session is not None and not self.http_session.closed:
""")
ast.parse(patched)
backup = Path.home() / ".jinx-harbor-backups" / datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
backup.mkdir(parents=True, mode=0o700)
for name in ("discord-bot.py", ".gitignore"):
    if (root / name).exists():
        shutil.copy2(root / name, backup / name)
target = root / "integrations" / "agent_harbor"
target.mkdir(parents=True, exist_ok=True)
for directory in (target.parent, target):
    (directory / "__init__.py").touch(exist_ok=True)
for name in ("harbor_api.py", "relay.py"):
    shutil.copy2(Path(__file__).parent / name, target / name)
gitignore = root / ".gitignore"
text = gitignore.read_text() if gitignore.exists() else ""
for line in ("/.harbor-api-key", "/.harbor-api-enabled"):
    if line not in text.splitlines():
        text += "\n" + line + "\n"
gitignore.write_text(text)
bot.write_text(patched)
(root / ".harbor-api-enabled").touch(mode=0o600, exist_ok=True)
print("Installed optional Harbor interface; original code backed up to", backup)
