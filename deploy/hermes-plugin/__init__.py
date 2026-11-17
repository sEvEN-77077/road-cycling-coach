"""Send admitted coach messages to the deterministic local training service."""

import asyncio
import json
import os

COACH_BRIDGE = "/srv/road-cycling-coach/deploy/hermes-coach.sh"
FAILURE = {"action": "handled", "reply": "教练暂时无法处理，请稍后再试。"}


async def handle(platform, source, message_id, text, **_):
    if platform != "weixin":
        return None
    if not isinstance(source, dict) or source.get("chat_type") != "dm":
        return {"action": "handled"}
    if not isinstance(text, str) or len(text) > 1000:
        return {"action": "handled", "reply": "请发送 1000 字以内的文字指令。"}
    try:
        child = await asyncio.create_subprocess_exec(
            "/bin/bash", COACH_BRIDGE, "reply",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": os.path.expanduser("~")},
        )
        payload = json.dumps({"peer": source.get("user_id"), "id": message_id, "text": text}).encode()
        try:
            stdout, _ = await asyncio.wait_for(child.communicate(payload), timeout=11)
        except asyncio.TimeoutError:
            child.kill()
            await child.wait()
            return FAILURE
        if child.returncode != 0:
            return FAILURE
        reply = json.loads(stdout).get("text")
        return {"action": "handled", "reply": reply} if reply else {"action": "handled"}
    except (OSError, ValueError, AttributeError):
        return FAILURE


def register(ctx):
    ctx.register_hook("post_gateway_admission", handle)
