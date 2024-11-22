const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('redis');
const client = require('prom-client');

// Collect default metrics for Prometheus
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 5002;
const CACHE_EXPIRATION = 10 * 5; // 5 minutes TTL for caching

// Shard configurations
const redisShard1 = createClient({ url: 'redis://redis-shard1-primary:6379' });
const redisShard2 = createClient({ url: 'redis://redis-shard2-primary:6379' });

// Connect Redis shards
[redisShard1, redisShard2].forEach((shard, index) => {
  shard.connect()
    .then(() => console.log(`Connected to Redis Shard ${index + 1}`))
    .catch((err) => console.error(`Redis Shard ${index + 1} connection error:`, err));
});

// Determine the Redis shard based on key
const getRedisShard = (key) => {
  const hash = key.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return hash % 2 === 0 ? redisShard1 : redisShard2;
};

// Middleware to parse JSON
app.use(express.json());

// WebSocket management
let rooms = {};
wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const parsedMessage = JSON.parse(message);
    if (parsedMessage.action === 'join') {
      const room = parsedMessage.room;
      if (!rooms[room]) rooms[room] = [];
      rooms[room].push(ws);
      ws.send(JSON.stringify({ message: `Joined room: ${room}` }));
    }
  });

  ws.on('close', () => {
    Object.keys(rooms).forEach((room) => {
      rooms[room] = rooms[room].filter((client) => client !== ws);
    });
  });
});

// Notify clients in a specific room
const notifyRoom = (room, message) => {
  const clients = rooms[room] || [];
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ notification: message }));
    }
  });
};

// Cache notification in the appropriate shard
const cacheNotification = async (key, notification) => {
  const shard = getRedisShard(key);
  try {
    await shard.setEx(key, CACHE_EXPIRATION, notification);
    console.log(`Notification cached on shard for key: ${key}`);
  } catch (err) {
    console.error('Error caching notification:', err);
  }
};

// Get cached notification from the appropriate shard
const getCachedNotification = async (key) => {
  const shard = getRedisShard(key);
  try {
    const cachedNotification = await shard.get(key);
    if (cachedNotification) console.log(`Cache hit for key: ${key}`);
    return cachedNotification;
  } catch (err) {
    console.error('Error fetching from cache:', err);
    return null;
  }
};

// Notification endpoints
app.post('/notify-login', async (req, res) => {
  const notificationMessage = 'Login Successful';
  const cacheKey = 'notify-login';

  const cachedNotification = await getCachedNotification(cacheKey);
  if (cachedNotification) {
    return res.status(200).json({ message: `Cached: ${cachedNotification}` });
  }

  notifyRoom('notify-login', notificationMessage);
  await cacheNotification(cacheKey, notificationMessage);

  res.status(200).json({ message: 'Login notification sent and cached successfully.' });
});

app.post('/notify-signup', async (req, res) => {
  const notificationMessage = 'Signup Successful';
  const cacheKey = 'notify-signup';

  const cachedNotification = await getCachedNotification(cacheKey);
  if (cachedNotification) {
    return res.status(200).json({ message: `Cached: ${cachedNotification}` });
  }

  notifyRoom('notify-signup', notificationMessage);
  await cacheNotification(cacheKey, notificationMessage);

  res.status(200).json({ message: 'Signup notification sent and cached successfully.' });
});

app.post('/notify-upload', async (req, res) => {
  const notificationMessage = 'Beat was uploaded successfully';
  const cacheKey = 'notify-upload';

  const cachedNotification = await getCachedNotification(cacheKey);
  if (cachedNotification) {
    return res.status(200).json({ message: `Cached: ${cachedNotification}` });
  }

  notifyRoom('notify-upload', notificationMessage);
  await cacheNotification(cacheKey, notificationMessage);

  res.status(200).json({ message: 'Upload notification sent and cached successfully.' });
});

app.post('/notify', async (req, res) => {
  const { room, message } = req.body;
  if (!room || !message) return res.status(400).json({ error: 'Missing room or message' });

  const cacheKey = `notify-${room}`;
  const cachedNotification = await getCachedNotification(cacheKey);
  if (cachedNotification) return res.status(200).json({ message: `Cached: ${cachedNotification}` });

  notifyRoom(room, message);
  await cacheNotification(cacheKey, message);

  res.status(200).json({ message: 'Notification sent and cached successfully.' });
});

app.get('/status', (req, res) => res.status(200).json({ status: 'Notification Service is running' }));

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// Start the server
server.listen(PORT, () => console.log(`Notification Service running on port ${PORT}`));
