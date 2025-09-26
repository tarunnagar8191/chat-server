const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Constants
const JWT_SECRET = "your-secret-key-change-in-production";
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory data store
let users = [
  {
    id: "1",
    email: "alice@example.com",
    name: "Alice Johnson",
    password: bcrypt.hashSync("password123", 10),
  },
  {
    id: "2",
    email: "bob@example.com",
    name: "Bob Smith",
    password: bcrypt.hashSync("password123", 10),
  },
];

let messages = [];
const connectedUsers = new Map(); // userId -> socketId

// File paths for persistence
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const USERS_FILE = path.join(__dirname, "users.json");

// Load data from files if they exist
const loadData = () => {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, "utf8");
      messages = JSON.parse(data);
    }
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, "utf8");
      const savedUsers = JSON.parse(data);
      if (savedUsers.length > 0) {
        users = savedUsers;
      }
    }
  } catch (error) {
    console.error("Error loading data:", error);
  }
};

// Save data to files
const saveData = () => {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error("Error saving data:", error);
  }
};

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = user;
    next();
  });
};

// Socket.io authentication middleware
const socketAuth = (socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error("Authentication error"));
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new Error("Authentication error"));
    }
    socket.userId = decoded.id;
    next();
  });
};

// API Routes

// Login endpoint
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = users.find((u) => u.email === email);

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accessToken = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      {
        expiresIn: "24h",
      }
    );
    const refreshToken = jwt.sign({ id: user.id, refresh: true }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Response format matching the app's AuthContext expectation
    res.json({
      data: {
        accessToken,
        refreshToken,
        userData: {
          userId: parseInt(user.id),
          uid: `user_${user.id}`,
          email: user.email,
          isEmailVerified: true,
          name: user.name,
          mobile: "1234567890",
          gender: "other",
          userType: "parent",
          lastLogin: new Date().toISOString(),
        },
      },
      meta: {
        code: 200,
        message: "Login successful",
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get users endpoint
app.get("/api/users", authenticateToken, (req, res) => {
  try {
    const userList = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
    }));
    res.json(userList);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get children endpoint (dummy data for demo)
app.get("/api/parent/cases/", authenticateToken, (req, res) => {
  try {
    // Return dummy child data
    const dummyChildren = [
      {
        id: "child_1",
        name: "Emma Johnson",
        age: 8,
        school: "Sunnydale Elementary",
        status: "active",
        lastActivity: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        profilePicture: null,
        relationship: "daughter",
      },
      {
        id: "child_2",
        name: "Liam Johnson",
        age: 12,
        school: "Riverside Middle School",
        status: "active",
        lastActivity: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
        profilePicture: null,
        relationship: "son",
      },
    ];

    res.json({
      data: dummyChildren,
      meta: {
        code: 200,
        message: "Children retrieved successfully",
        total: dummyChildren.length,
      },
    });
  } catch (error) {
    console.error("Get children error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get messages endpoint
app.get("/api/messages", authenticateToken, (req, res) => {
  try {
    const { with: withUserId } = req.query;
    const userId = req.user.id;

    if (!withUserId) {
      return res.status(400).json({ error: "with parameter required" });
    }

    const conversation = messages
      .filter(
        (msg) =>
          (msg.from === userId && msg.to === withUserId) ||
          (msg.from === withUserId && msg.to === userId)
      )
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.json(conversation);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Send message endpoint
app.post("/api/messages", authenticateToken, (req, res) => {
  try {
    const { to, content } = req.body;
    const from = req.user.id;

    if (!to || !content) {
      return res.status(400).json({ error: "to and content required" });
    }

    const message = {
      id: uuidv4(),
      from,
      to,
      content,
      createdAt: new Date().toISOString(),
    };

    messages.push(message);
    saveData();

    // Emit to recipient if connected
    const recipientSocketId = connectedUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("message:receive", message);
    }

    res.json(message);
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Socket.io connection handling
io.use(socketAuth);

io.on("connection", (socket) => {
  // Store the connection
  connectedUsers.set(socket.userId, socket.id);

  // Handle message sending via socket
  socket.on("message:send", (data) => {
    try {
      const { to, content } = data;
      const from = socket.userId;

      if (!to || !content) {
        socket.emit("error", { message: "to and content required" });
        return;
      }

      const message = {
        id: uuidv4(),
        from,
        to,
        content,
        createdAt: new Date().toISOString(),
      };

      messages.push(message);
      saveData();

      // Emit to recipient if connected
      const recipientSocketId = connectedUsers.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("message:receive", message);
      }

      // Confirm to sender
      socket.emit("message:sent", message);
    } catch (error) {
      console.error("Socket message error:", error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  // Handle typing events (optional)
  socket.on("typing:start", (data) => {
    const { to } = data;
    const recipientSocketId = connectedUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("typing:start", { from: socket.userId });
    }
  });

  socket.on("typing:stop", (data) => {
    const { to } = data;
    const recipientSocketId = connectedUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit("typing:stop", { from: socket.userId });
    }
  });

  // Handle call initiation
  socket.on("call:initiate", (data) => {
    try {
      const { to, callType = "voice" } = data;
      const from = socket.userId;

      if (!to) {
        socket.emit("error", { message: "Recipient required for call" });
        return;
      }

      const callId = uuidv4();
      const callData = {
        id: callId,
        from,
        to,
        type: callType,
        status: "ringing",
        createdAt: new Date().toISOString(),
        roomName: `call_${callId}`,
      };

      // Emit to recipient if connected
      const recipientSocketId = connectedUsers.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("call:incoming", callData);
        // Confirm to caller
        socket.emit("call:initiated", callData);
      } else {
        socket.emit("call:failed", { message: "User is not available" });
      }
    } catch (error) {
      console.error("Socket call initiate error:", error);
      socket.emit("error", { message: "Failed to initiate call" });
    }
  });

  // Handle call response (accept/reject)
  socket.on("call:respond", (data) => {
    try {
      const { callId, response, to } = data; // response: "accept" or "reject"
      const from = socket.userId;

      const recipientSocketId = connectedUsers.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("call:response", {
          callId,
          response,
          from,
          roomName: response === "accept" ? `call_${callId}` : null,
        });
      }

      // Confirm to responder
      socket.emit("call:responded", { callId, response });
    } catch (error) {
      console.error("Socket call respond error:", error);
      socket.emit("error", { message: "Failed to respond to call" });
    }
  });

  // Handle call end
  socket.on("call:end", (data) => {
    try {
      const { callId, to } = data;
      const from = socket.userId;

      const recipientSocketId = connectedUsers.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("call:ended", { callId, from });
      }

      // Confirm to caller
      socket.emit("call:ended", { callId });
    } catch (error) {
      console.error("Socket call end error:", error);
      socket.emit("error", { message: "Failed to end call" });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`User ${socket.userId} disconnected`);
    connectedUsers.delete(socket.userId);
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    users: users.length,
    messages: messages.length,
    connections: connectedUsers.size,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Load data on startup
loadData();

// Start server
server.listen(PORT, () => {
  console.log(`\n🚀 Chat server running on port ${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`\n👥 Test users:`);
  console.log(`   Alice: alice@example.com / password123`);
  console.log(`   Bob: bob@example.com / password123`);
  console.log(`\n💾 Data will be persisted to:`);
  console.log(`   Messages: ${MESSAGES_FILE}`);
  console.log(`   Users: ${USERS_FILE}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server...");
  saveData();
  server.close(() => {
    console.log("✅ Server shut down gracefully");
    process.exit(0);
  });
});
