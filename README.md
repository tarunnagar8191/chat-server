# Chat Server

A real-time chat server built with Node.js, Express, and Socket.io.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm run dev
```

The server will run on http://localhost:3001

## Test Users

- **Alice**: alice@example.com / password123
- **Bob**: bob@example.com / password123

## API Endpoints

### Authentication

- `POST /api/login` - Login with email/password

### Protected Routes (require JWT token)

- `GET /api/users` - Get list of users
- `GET /api/messages?with=<userId>` - Get messages with specific user
- `POST /api/messages` - Send a message

### Health Check

- `GET /health` - Server status

## Socket.io Events

### Client to Server

- `message:send` - Send a message
- `typing:start` - Start typing indicator
- `typing:stop` - Stop typing indicator

### Server to Client

- `message:receive` - Receive a new message
- `message:sent` - Confirmation of sent message
- `typing:start` - User started typing
- `typing:stop` - User stopped typing

## Data Persistence

Messages and users are stored in JSON files:

- `messages.json` - All chat messages
- `users.json` - User data
