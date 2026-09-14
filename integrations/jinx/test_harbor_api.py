import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import aiohttp
import harbor_api


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".harbor-api-enabled").touch()
        self.calls = 0

        async def stage(messages, session_id):
            self.calls += 1
            target = self.root / "memory-engine" / "staging" / (session_id + ".md")
            target.write_text(json.dumps(messages))
            return target

        self.client = SimpleNamespace(lock=asyncio.Lock(), model_id="test-model", stage_messages_to_staging=stage)
        self.registry = SimpleNamespace(REGISTERED_TOOLS={
            "search_memory": {"effect": "read", "description": "Find notes", "arg_shape": "query"},
            "create_hq_task": {"effect": "write", "description": "Create task", "arg_shape": "JSON"},
            "delete_record": {"effect": "destructive", "description": "Delete", "arg_shape": "id"},
        }, dispatch=Mock(return_value={"ok": True}))
        self.runner = await harbor_api.start(self.client, self.root, self.registry, port=0)
        port = next(iter(self.runner.sites))._server.sockets[0].getsockname()[1]
        self.base = f"http://127.0.0.1:{port}"
        self.http = aiohttp.ClientSession(headers={"Authorization": "Bearer " + (self.root / ".harbor-api-key").read_text()})

    async def asyncTearDown(self):
        await self.http.close()
        await self.runner.cleanup()
        self.temp.cleanup()

    async def test_authentication_and_catalog(self):
        async with self.http.get(self.base + "/status", headers={"Authorization": "wrong"}) as response:
            self.assertEqual(response.status, 401)
        async with self.http.get(self.base + "/tools") as response:
            self.assertNotIn("jinx_delete_record", [t["name"] for t in (await response.json())["tools"]])
        self.assertEqual((self.root / ".harbor-api-key").stat().st_mode & 0o777, 0o600)

    async def test_writes_need_approval_and_destructive_tools_are_excluded(self):
        for name, status in [("jinx_create_hq_task", 403), ("jinx_delete_record", 400)]:
            async with self.http.post(self.base + "/tool", json={"name": name, "argument": "x"}) as response:
                self.assertEqual(response.status, status)
        self.registry.dispatch.assert_not_called()
        async with self.http.post(self.base + "/tool", json={"name": "jinx_create_hq_task", "argument": "x", "approved": True}) as response:
            self.assertEqual(response.status, 200)
        self.registry.dispatch.assert_called_once_with("create_hq_task", "x")

    async def test_archive_is_idempotent_and_preserves_raw_exchange(self):
        body = {"turnId": "turn-12345", "user": "A real instruction", "assistant": "A reply"}
        for _ in range(2):
            async with self.http.post(self.base + "/archive", json=body) as response:
                self.assertEqual(response.status, 200)
                result = await response.json()
                self.assertTrue(result["saved"])
                self.assertFalse(result["promoted"])
        self.assertEqual(self.calls, 1)
        self.assertIn("A real instruction", harbor_api.recent_harbor_memory(self.root))
        raw = json.loads((self.root / result["raw"]).read_text())
        self.assertEqual(raw["user"], body["user"])
        async with self.http.post(self.base + "/archive", json={**body, "user": "Changed"}) as response:
            self.assertEqual(response.status, 409)

    async def test_context_comes_from_existing_jinx_assembler(self):
        self.client.assemble_context = Mock(return_value=SimpleNamespace(text="Current memory"))
        self.client._read_base_system_prompt = Mock(return_value="Existing Jinx identity")
        messages = harbor_api.prepare_messages(self.client, [{"role": "user", "content": "Hello"}])
        self.assertEqual(messages[0]["content"], "Existing Jinx identity")
        self.assertIn("Current memory", messages[1]["content"])
        self.assertIn("separate transcripts", messages[-1]["content"])
        self.client.assemble_context.assert_called_once()


if __name__ == "__main__":
    unittest.main()
