const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:5002');

ws.on('open', () => {
  console.log('Connected to WebSocket server');
});

ws.on('message', (data) => {
  console.log(`Notification received: ${data}`);
});

ws.on('close', () => {
  console.log('Disconnected from WebSocket server');
});
