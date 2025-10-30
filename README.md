# Chat Microservice

A comprehensive real-time chat, voice, and video calling microservice built with Node.js, Socket.io, WebRTC, and MongoDB. Designed to integrate seamlessly with Django backend authentication.

## 🚀 Features

- **Real-time Messaging**: Instant messaging with delivery status
- **Voice & Video Calls**: WebRTC-based calling system 
- **User Presence**: Online/offline status tracking
- **Message History**: Persistent chat history with MongoDB
- **Call History**: Complete call logs with duration tracking
- **JWT Integration**: Seamless authentication with Django backend
- **WebSocket Events**: Real-time bidirectional communication
- **Scalable Architecture**: Microservice design for easy scaling

## 📋 Prerequisites

- Node.js 16+
- MongoDB Atlas account (or local MongoDB)
- Django backend with JWT authentication

## 🛠 Installation

1. **Install Dependencies**

```bash
cd chat-server
npm install
```

2. **Environment Configuration**
   Create `.env` file:

```env
PORT=3001
NODE_ENV=development
MONGODB_URI=mongodb+srv://devops:ydItcH6X8E8sktS0@stage-recruitg.g2as6px.mongodb.net/careh_chat_db
DJANGO_BASE_URL=http://localhost:8000
JWT_SECRET=careh-microservice-secret-key-2024
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:19006,exp://192.168.1.100:8081
STUN_SERVER=stun:stun.l.google.com:19302
```

3. **Start the Server**

```bash
# Development
npm run dev

# Production
npm start
```

## 🏗 Architecture

### Database Models

**User Model**

```javascript
{
  userId: Number,      // From Django backend
  uid: String,         // UUID from Django
  email: String,
  name: String,
  mobile: String,
  gender: String,
  userType: String,    // 'residing_parent' | 'non_residing_parent'
  isOnline: Boolean,
  lastSeen: Date,
  socketId: String
}
```

**Message Model**

```javascript
{
  messageId: String,
  fromUserId: Number,
  toUserId: Number,
  content: String,
  messageType: String, // 'text' | 'image' | 'audio'
  isRead: Boolean,
  readAt: Date,
  deliveredAt: Date
}
```

**Call Model**

```javascript
{
  callId: String,
  fromUserId: Number,
  toUserId: Number,
  callType: String,    // 'voice' | 'video'
  status: String,      // 'initiated' | 'accepted' | 'rejected' | 'ended'
  duration: Number,    // seconds
  roomId: String,
  sdpOffer: String,
  sdpAnswer: String,
  iceCandidates: Array
}
```

## 📡 API Endpoints

### Chat Endpoints

- `GET /api/chat/users` - Get all users
- `GET /api/chat/messages/:withUserId` - Get conversation messages
- `POST /api/chat/messages` - Send a message
- `GET /api/chat/conversations` - Get conversation list
- `GET /api/chat/messages/unread/count` - Get unread count

### Call Endpoints

- `GET /api/calls/history` - Get call history
- `POST /api/calls/initiate` - Create call record
- `PATCH /api/calls/:callId/status` - Update call status
- `GET /api/calls/webrtc-config` - Get WebRTC configuration

### System Endpoints

- `GET /health` - Health check with statistics
- `GET /api/info` - Service information

## 🔌 WebSocket Events

### Chat Events

```javascript
// Send message
socket.emit("message:send", {
  toUserId: 195,
  content: "Hello!",
  messageType: "text",
});

// Receive message
socket.on("message:received", (message) => {
  console.log("New message:", message);
});

// Typing indicators
socket.emit("typing:start", { toUserId: 195 });
socket.emit("typing:stop", { toUserId: 195 });
```

### Call Events

```javascript
// Initiate call
socket.emit("call:initiate", {
  toUserId: 195,
  callType: "voice", // or 'video'
});

// Respond to call
socket.emit("call:respond", {
  callId: "uuid",
  response: "accept", // or 'reject'
  toUserId: 196,
});

// End call
socket.emit("call:end", {
  callId: "uuid",
  toUserId: 195,
});
```

### WebRTC Events

```javascript
// Send offer
socket.emit("webrtc:offer", {
  callId: "uuid",
  toUserId: 195,
  offer: rtcPeerConnection.localDescription,
});

// Send answer
socket.emit("webrtc:answer", {
  callId: "uuid",
  toUserId: 196,
  answer: rtcPeerConnection.localDescription,
});

// Send ICE candidate
socket.emit("webrtc:ice-candidate", {
  callId: "uuid",
  toUserId: 195,
  candidate: event.candidate,
});
```

## 🔐 Authentication Integration

The microservice expects JWT tokens from your Django backend with this payload:

```javascript
{
  "user_id": 196,
  "uid": "9f165b69-bfe2-4295-b499-5b2d669e6336",
  "email": "user@example.com",
  "exp": 1759229350
}
```

### Frontend Integration Example

```javascript
// Connect to socket
const socket = io("http://localhost:3001", {
  auth: {
    token: "your-jwt-token-from-django",
  },
});

// Make API calls
const response = await fetch("http://localhost:3001/api/chat/users", {
  headers: {
    Authorization: `Bearer ${jwtToken}`,
    "Content-Type": "application/json",
  },
});
```


### Frontend WebRTC Setup

```javascript
// Initialize WebRTC
const peerConnection = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
});

// Handle incoming call
socket.on('call:incoming', async (callData) => {
  // Show incoming call UI
  const accepted = await showIncomingCallDialog(callData);

  if (accepted) {
    socket.emit('call:respond', {
      callId: callData.callId,
      response: 'accept',
      toUserId: callData.fromUserId
    });
  }
});

// Handle WebRTC offer
socket.on('webrtc:offer', async (data) => {
  await peerConnection.setRemoteDescription(data.offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit('webrtc:answer', {
    callId: data.callId,
    toUserId: data.fromUserId,
    answer: answer
  });
});
});
```

## 📱 React Native Integration

Update your existing services to use this microservice:

### Socket Service

```javascript
import io from "socket.io-client";

class SocketService {
  constructor() {
    this.socket = null;
  }

  connect(token) {
    this.socket = io("http://localhost:3001", {
      auth: { token },
      transports: ["websocket"],
    });

    this.socket.on("connect", () => {
      console.log("Connected to chat service");
    });

    this.socket.on("message:received", this.handleMessageReceived);
    this.socket.on("call:incoming", this.handleIncomingCall);
  }

  sendMessage(toUserId, content) {
    this.socket.emit("message:send", { toUserId, content });
  }

  initiateCall(toUserId, callType) {
    this.socket.emit("call:initiate", { toUserId, callType });
  }
}
```

### API Service

```javascript
const API_BASE = "http://localhost:3001/api";

export const chatAPI = {
  getUsers: () =>
    fetch(`${API_BASE}/chat/users`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  getMessages: (withUserId) =>
    fetch(`${API_BASE}/chat/messages/${withUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  getCallHistory: () =>
    fetch(`${API_BASE}/calls/history`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
};
```

## 🚦 Testing

### Health Check

```bash
curl http://localhost:3001/health
```

### Test Authentication

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN"
     http://localhost:3001/api/chat/users
```

## 🔧 Development

### Database Setup

The service automatically creates collections and indexes. Users are created automatically when they first connect with valid JWT tokens.

### Monitoring

- Health endpoint: `/health`
- Service info: `/api/info`
- Real-time statistics included in health checks

### Error Handling

All endpoints return consistent error format:

```json
{
  "error": "Error message",
  "code": 400,
  "timestamp": "2025-09-29T10:49:10.273Z"
}
```

## 🚀 Deployment

### Environment Variables

```bash
NODE_ENV=production
MONGODB_URI=your_mongodb_connection
JWT_SECRET=your_jwt_secret
ALLOWED_ORIGINS=https://yourapp.com
```

### PM2 Deployment

```bash
npm install -g pm2
pm2 start server.js --name careh-chat
pm2 startup
pm2 save
```

## 📈 Scaling Considerations

- Use Redis adapter for multiple server instances
- Implement message queues for offline message delivery
- Add rate limiting for API endpoints
- Consider WebRTC TURN servers for production

## 🔒 Security

- JWT token validation on all requests
- CORS properly configured
- Input validation on all endpoints
- Rate limiting recommended for production
- MongoDB connection secured with credentials

## 📞 Support

For integration support or issues, check:

1. Health endpoint for service status
2. Console logs for detailed error messages
3. MongoDB logs for database issues
4. WebRTC browser compatibility

---

**Note**: This microservice is designed to work alongside your Django backend. Users are automatically synchronized from JWT token data, and the service handles all real-time communication features.
