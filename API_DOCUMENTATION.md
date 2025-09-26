# Backend API Documentation

## Chat, Voice Call, and Video Call Functionality

### Table of Contents

1. [Overview](#overview)
2. [Chat Functionality](#chat-functionality)
3. [Voice Call Functionality](#voice-call-functionality)
4. [Video Call Functionality](#video-call-functionality)
5. [Socket Events Reference](#socket-events-reference)
6. [Error Handling](#error-handling)
7. [Data Models](#data-models)

---

## Overview

This documentation covers the backend implementation for real-time messaging, voice calls, and video calls using Socket.IO and REST APIs. The system supports:

- Real-time messaging between users
- Voice calls using Jitsi Meet integration
- Video calls with camera enabled by default
- Call signaling and management
- User presence tracking

**Base URL**: `http://localhost:3001`  
**Socket Namespace**: Default (`/`)

---

## Chat Functionality

### REST API Endpoints

#### Get Message History

```http
GET /api/messages
Authorization: Bearer <jwt_token>
```

**Response:**

```json
{
  "success": true,
  "messages": [
    {
      "id": "message_uuid",
      "senderId": "user_id",
      "senderName": "User Name",
      "receiverId": "recipient_id",
      "content": "Message content",
      "timestamp": "2025-09-25T10:30:00.000Z",
      "type": "text"
    }
  ]
}
```

#### Send Message (Alternative to Socket)

```http
POST /api/messages
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "receiverId": "recipient_user_id",
  "content": "Message content",
  "type": "text"
}
```

**Response:**

```json
{
  "success": true,
  "message": {
    "id": "message_uuid",
    "senderId": "sender_id",
    "senderName": "Sender Name",
    "receiverId": "recipient_id",
    "content": "Message content",
    "timestamp": "2025-09-25T10:30:00.000Z",
    "type": "text"
  }
}
```

### Socket Events - Chat

#### Client to Server Events

##### Join Chat Room

```javascript
socket.emit("join", {
  userId: "user_id",
  token: "jwt_token",
});
```

##### Send Message

```javascript
socket.emit("message", {
  to: "recipient_user_id",
  content: "Message content",
  type: "text", // 'text', 'image', 'file'
});
```

##### Mark Message as Read

```javascript
socket.emit("message:read", {
  messageId: "message_uuid",
  userId: "user_id",
});
```

##### Typing Indicator

```javascript
// Start typing
socket.emit("typing:start", {
  to: "recipient_user_id",
});

// Stop typing
socket.emit("typing:stop", {
  to: "recipient_user_id",
});
```

#### Server to Client Events

##### Message Received

```javascript
socket.on('message', (data) => {
  // data structure:
  {
    id: 'message_uuid',
    senderId: 'sender_id',
    senderName: 'Sender Name',
    receiverId: 'recipient_id',
    content: 'Message content',
    timestamp: '2025-09-25T10:30:00.000Z',
    type: 'text'
  }
});
```

##### Typing Notifications

```javascript
socket.on("typing:start", (data) => {
  // data: { from: 'user_id', fromName: 'User Name' }
});

socket.on("typing:stop", (data) => {
  // data: { from: 'user_id' }
});
```

##### User Status

```javascript
socket.on("user:online", (data) => {
  // data: { userId: 'user_id', status: 'online' }
});

socket.on("user:offline", (data) => {
  // data: { userId: 'user_id', status: 'offline' }
});
```

---

## Voice Call Functionality

### Call Lifecycle

1. **Initiate** → Create call session and notify recipient
2. **Ring** → Recipient receives incoming call notification
3. **Accept/Reject** → Recipient responds to call
4. **Connect** → Both parties join Jitsi Meet room (audio only)
5. **End** → Either party can terminate the call

### Socket Events - Voice Calls

#### Client to Server Events

##### Initiate Voice Call

```javascript
socket.emit("call:initiate", {
  to: "recipient_user_id",
  callType: "voice",
});
```

##### Respond to Call

```javascript
socket.emit("call:respond", {
  callId: "call_uuid",
  response: "accept", // or 'reject'
  to: "caller_user_id",
});
```

##### End Call

```javascript
socket.emit("call:end", {
  callId: "call_uuid",
  to: "other_user_id",
});
```

#### Server to Client Events

##### Call Initiated (Caller)

```javascript
socket.on('call:initiated', (data) => {
  // data structure:
  {
    id: 'call_uuid',
    from: 'caller_id',
    to: 'recipient_id',
    type: 'voice',
    timestamp: '2025-09-25T10:30:00.000Z',
    roomName: 'call_uuid_room',
    status: 'ringing'
  }
});
```

##### Incoming Call (Recipient)

```javascript
socket.on('call:incoming', (data) => {
  // data structure:
  {
    id: 'call_uuid',
    from: 'caller_id',
    fromName: 'Caller Name',
    to: 'recipient_id',
    type: 'voice',
    timestamp: '2025-09-25T10:30:00.000Z',
    roomName: 'call_uuid_room'
  }
});
```

##### Call Status Updates

```javascript
socket.on("call:accepted", (data) => {
  // data: { callId: 'call_uuid', by: 'user_id' }
});

socket.on("call:rejected", (data) => {
  // data: { callId: 'call_uuid', by: 'user_id' }
});

socket.on("call:ended", (data) => {
  // data: { callId: 'call_uuid', by: 'user_id', reason: 'user_ended' }
});
```

##### Call Failed

```javascript
socket.on("call:failed", (data) => {
  // data: { message: 'Error message', reason: 'user_unavailable' }
});
```

---

## Video Call Functionality

### Call Lifecycle

1. **Initiate** → Create video call session and notify recipient
2. **Ring** → Recipient receives incoming video call notification
3. **Accept/Reject** → Recipient responds to call
4. **Connect** → Both parties join Jitsi Meet room (video + audio enabled)
5. **End** → Either party can terminate the call

### Socket Events - Video Calls

#### Client to Server Events

##### Initiate Video Call

```javascript
socket.emit("call:initiate", {
  to: "recipient_user_id",
  callType: "video",
});
```

##### Respond to Video Call

```javascript
socket.emit("call:respond", {
  callId: "call_uuid",
  response: "accept", // or 'reject'
  to: "caller_user_id",
});
```

##### End Video Call

```javascript
socket.emit("call:end", {
  callId: "call_uuid",
  to: "other_user_id",
});
```

#### Server to Client Events

##### Video Call Initiated (Caller)

```javascript
socket.on('call:initiated', (data) => {
  // data structure:
  {
    id: 'call_uuid',
    from: 'caller_id',
    to: 'recipient_id',
    type: 'video',
    timestamp: '2025-09-25T10:30:00.000Z',
    roomName: 'call_uuid_room',
    status: 'ringing'
  }
});
```

##### Incoming Video Call (Recipient)

```javascript
socket.on('call:incoming', (data) => {
  // data structure:
  {
    id: 'call_uuid',
    from: 'caller_id',
    fromName: 'Caller Name',
    to: 'recipient_id',
    type: 'video',
    timestamp: '2025-09-25T10:30:00.000Z',
    roomName: 'call_uuid_room'
  }
});
```

##### Video Call Status Updates

```javascript
socket.on("call:accepted", (data) => {
  // data: { callId: 'call_uuid', by: 'user_id', type: 'video' }
});

socket.on("call:rejected", (data) => {
  // data: { callId: 'call_uuid', by: 'user_id', type: 'video' }
});

socket.on("call:ended", (data) => {
  // data: { callId: 'call_uuid', by: 'user_id', reason: 'user_ended', type: 'video' }
});
```

---

## Socket Events Reference

### Connection Events

#### Client Connection

```javascript
// Client connects with authentication
socket.emit("join", {
  userId: "user_id",
  token: "jwt_token",
});

// Server confirms connection
socket.on("connected", (data) => {
  // data: { userId: 'user_id', socketId: 'socket_id' }
});
```

#### Disconnection

```javascript
socket.on("disconnect", () => {
  // Handle user disconnection
  // Server automatically cleans up user presence
});
```

### Error Events

```javascript
socket.on("error", (data) => {
  // data: { message: 'Error description', code: 'ERROR_CODE' }
});

socket.on("auth:error", (data) => {
  // data: { message: 'Authentication failed' }
});
```

### Presence Events

```javascript
socket.on("user:online", (data) => {
  // data: { userId: 'user_id', timestamp: '2025-09-25T10:30:00.000Z' }
});

socket.on("user:offline", (data) => {
  // data: { userId: 'user_id', timestamp: '2025-09-25T10:30:00.000Z' }
});
```

---

## Error Handling

### HTTP API Errors

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message"
  }
}
```

**Common Error Codes:**

- `UNAUTHORIZED`: Invalid or missing JWT token
- `USER_NOT_FOUND`: Specified user does not exist
- `MESSAGE_SEND_FAILED`: Failed to send message
- `CALL_FAILED`: Call initiation failed
- `USER_UNAVAILABLE`: Target user is offline or busy

### Socket Error Events

```javascript
socket.on("error", (error) => {
  console.error("Socket error:", error);
  // Handle based on error.code
});
```

**Socket Error Codes:**

- `AUTH_REQUIRED`: User must authenticate first
- `INVALID_DATA`: Malformed request data
- `USER_NOT_CONNECTED`: Target user is not connected
- `CALL_IN_PROGRESS`: User is already in a call
- `PERMISSION_DENIED`: Insufficient permissions

---

## Data Models

### Message Model

```json
{
  "id": "uuid",
  "senderId": "string",
  "senderName": "string",
  "receiverId": "string",
  "content": "string",
  "type": "text|image|file",
  "timestamp": "ISO 8601 datetime",
  "readBy": ["user_id"],
  "editedAt": "ISO 8601 datetime (optional)"
}
```

### Call Model

```json
{
  "id": "uuid",
  "from": "user_id",
  "fromName": "string",
  "to": "user_id",
  "toName": "string",
  "type": "voice|video",
  "status": "ringing|accepted|rejected|ended|failed",
  "roomName": "string",
  "timestamp": "ISO 8601 datetime",
  "duration": "number (seconds)",
  "endReason": "user_ended|network_error|timeout"
}
```

### User Presence Model

```json
{
  "userId": "string",
  "status": "online|offline|busy|in_call",
  "lastSeen": "ISO 8601 datetime",
  "socketId": "string (internal)"
}
```

---

## Implementation Notes

### Jitsi Meet Integration

**Voice Calls:**

- `startWithAudioMuted: false` (microphone enabled)
- `startWithVideoMuted: true` (camera disabled)
- Room naming: `call_${callId}`

**Video Calls:**

- `startWithAudioMuted: false` (microphone enabled)
- `startWithVideoMuted: false` (camera enabled by default)
- Room naming: `call_${callId}`

### Authentication

All Socket.IO events require authentication via the `join` event with a valid JWT token. HTTP API endpoints require the `Authorization: Bearer <token>` header.

### Rate Limiting

Consider implementing rate limiting for:

- Message sending (e.g., 100 messages per minute per user)
- Call initiation (e.g., 10 calls per minute per user)

### Data Persistence

- Messages are persisted to `messages.json`
- User data is stored in `users.json`
- Call history can be stored for analytics

### Security Considerations

- Validate all incoming data
- Sanitize message content to prevent XSS
- Implement proper JWT validation
- Use HTTPS in production
- Validate user permissions for each action

---

## Testing

### Test Users

```json
[
  {
    "id": "1",
    "email": "alice@example.com",
    "name": "Alice Johnson",
    "password": "password123"
  },
  {
    "id": "2",
    "email": "bob@example.com",
    "name": "Bob Smith",
    "password": "password123"
  }
]
```

### Sample Socket.IO Client Connection

```javascript
const io = require("socket.io-client");
const socket = io("http://localhost:3001");

// Authenticate
socket.emit("join", {
  userId: "1",
  token: "valid_jwt_token",
});

// Send a message
socket.emit("message", {
  to: "2",
  content: "Hello Bob!",
  type: "text",
});

// Initiate video call
socket.emit("call:initiate", {
  to: "2",
  callType: "video",
});
```

This documentation provides a comprehensive guide for backend developers to implement and maintain the chat, voice call, and video call functionality.
