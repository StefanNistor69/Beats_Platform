const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('redis');

// Create a Redis client (for redis v4.x)
// Connect to the Redis service defined in Docker Compose using its service name ("redis")
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'redis'}:${process.env.REDIS_PORT || 6379}`
});

redisClient.connect().then(() => {
  console.log('Connected to Redis');
}).catch(err => {
  console.error('Redis connection error:', err);
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 5002;
const CACHE_EXPIRATION = 10 * 5; // 5 minutes TTL for caching

// Middleware to parse incoming JSON requests
app.use(express.json());

// Store connected clients by room
let rooms = {};

// WebSocket connection event
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  // Assign client to a room when they join
  ws.on('message', (message) => {
    const parsedMessage = JSON.parse(message);

    if (parsedMessage.action === 'join') {
      const room = parsedMessage.room;

      // Initialize room if not exists
      if (!rooms[room]) {
        rooms[room] = [];
      }

      // Add client to the room
      rooms[room].push(ws);
      console.log(`Client joined room: ${room}`);

      ws.send(JSON.stringify({ message: `Joined room: ${room}` }));
    }
  });

  // WebSocket disconnection event
  ws.on('close', () => {
    console.log('Client disconnected');
    // Remove the client from all rooms they were part of
    for (let room in rooms) {
      rooms[room] = rooms[room].filter(client => client !== ws);
    }
  });
});

// Notify clients in a specific room
const notifyRoom = (room, message) => {
  const clients = rooms[room] || [];
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ notification: message }));
    }
  });
};

// Function to cache notifications
const cacheNotification = async (key, notification) => {
  try {
    await redisClient.setEx(key, CACHE_EXPIRATION, notification);
    console.log(`Notification cached with key: ${key}`);
  } catch (err) {
    console.error('Error caching notification:', err);
  }
};

// Function to check cache
const getCachedNotification = async (key) => {
  try {
    const cachedNotification = await redisClient.get(key);
    if (cachedNotification) {
      console.log(`Cache hit for key: ${key}`);
    }
    return cachedNotification;
  } catch (err) {
    console.error('Error fetching from cache:', err);
    return null;
  }
};

// Expose notification endpoints for different notification types
app.post('/notify-login', async (req, res) => {
  const notificationMessage = 'Login Successful';
  const cacheKey = 'notify-login';

  const cachedNotification = await getCachedNotification(cacheKey);
  if (cachedNotification) {
    return res.status(200).json({ message: `Cached: ${cachedNotification}` });
  }

  notifyRoom('notify-login', notificationMessage);
  await cacheNotification(cacheKey, notificationMessage);

  res.status(200).json({ message: 'Login notification received and cached successfully.' });
});

app.get('/status', (req, res) => {
  res.status(200).json({ status: 'Notification Service is running' });
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

  res.status(200).json({ message: 'Signup notification received and cached successfully.' });
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

  res.status(200).json({ message: 'Upload notification received and cached successfully.' });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Notification Service running on port ${PORT}`);
});
