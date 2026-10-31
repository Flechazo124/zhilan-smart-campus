const clients = new Set();
let sequence = 0;

function removeClient(client, closeResponse = false) {
  if (!clients.delete(client)) return;
  clearInterval(client.heartbeat);
  if (closeResponse && !client.res.writableEnded) {
    client.res.end();
  }
}

export function openRealtimeStream(req, res, user) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  });
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);

  const client = { userId: user.id, res, heartbeat: null };
  clients.add(client);
  client.heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      removeClient(client, true);
    }
  }, 20_000);
  client.heartbeat.unref();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    removeClient(client);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

export function publishRealtime(userIds, event) {
  const audience = new Set(userIds.filter(Boolean));
  if (!audience.size) return 0;

  const envelope = {
    ...event,
    id: `rt-${Date.now()}-${++sequence}`,
    emittedAt: new Date().toISOString()
  };
  const frame = `id: ${sequence}\nevent: campus-update\ndata: ${JSON.stringify(envelope)}\n\n`;
  let delivered = 0;

  for (const client of clients) {
    if (!audience.has(client.userId)) continue;
    try {
      client.res.write(frame);
      delivered += 1;
    } catch {
      removeClient(client, true);
    }
  }
  return delivered;
}
