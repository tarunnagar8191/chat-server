require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

// Import configurations and middleware
const connectDB = require("./config/database");
const { socketAuth } = require("./middleware/auth");

// Import routes
const chatRoutes = require("./routes/chat");
const callRoutes = require("./routes/calls");
const jitsiRoutes = require("./routes/jitsi");

// Import socket handler
const SocketHandler = require("./handlers/socketHandler");

// Import models
const User = require("./models/User");
const Message = require("./models/Message");
const Call = require("./models/Call");

const app = express();
const server = http.createServer(app);

// Configure Socket.IO
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Constants
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB();

// Middleware
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Initialize Socket Handler
const socketHandler = new SocketHandler(io);

// Socket.IO Authentication and Connection Handling
io.use(socketAuth);

io.on("connection", (socket) => {
  socketHandler.handleConnection(socket);
});

// API Routes
app.use("/api/chat", chatRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/jitsi", jitsiRoutes);

// v1 API Routes (for frontend compatibility)
app.use("/v1", chatRoutes);
app.use("/v1/calls", callRoutes);
app.use("/v1/jitsi", jitsiRoutes);

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Check database connectivity
    const userCount = await User.countDocuments();
    const messageCount = await Message.countDocuments();
    const callCount = await Call.countDocuments();

    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      service: "CareH Chat Microservice",
      version: "2.0.0",
      database: "Connected",
      statistics: {
        totalUsers: userCount,
        totalMessages: messageCount,
        totalCalls: callCount,
        activeConnections: socketHandler.getConnectedUsersCount(),
        onlineUsers: socketHandler.getOnlineUserIds(),
      },
      environment: process.env.NODE_ENV || "development",
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      service: "CareH Chat Microservice",
      error: "Database connectivity issue",
    });
  }
});

// Service info endpoint
app.get("/api/info", (req, res) => {
  res.json({
    service: "CareH Chat Microservice",
    version: "2.0.0",
    description:
      "Real-time chat, voice and video calling service with Jitsi SDK",
    features: [
      "Real-time messaging",
      "Voice calls with Jitsi",
      "Video calls with Jitsi",
      "User presence tracking",
      "Message delivery status",
      "Call history",
      "MongoDB persistence",
      "JWT authentication integration",
    ],
    endpoints: {
      health: "/health",
      chat: "/api/chat/*",
      calls: "/api/calls/*",
    },
    websocket: {
      events: [
        "message:send",
        "message:received",
        "call:initiate",
        "call:incoming",
        "jitsi:room_created",
        "jitsi:room_joined",
        "jitsi:room_left",
      ],
    },
  });
});

// CORS preflight handler
app.options("*", cors());

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err.stack);

  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
    code: err.status || 500,
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    code: 404,
    availableEndpoints: [
      "GET /health",
      "GET /api/info",
      "GET /api/chat/users",
      "GET /api/chat/messages/:withUserId",
      "POST /api/chat/messages",
      "GET /api/calls/history",
      "POST /api/calls/initiate",
    ],
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log("\n🛑 Shutting down CareH Chat Microservice...");

  // Close server
  server.close(() => {
    console.log("✅ HTTP server closed");
  });

  // Close database connection
  try {
    const mongoose = require("mongoose");
    await mongoose.connection.close();
    console.log("✅ MongoDB connection closed");
  } catch (error) {
    console.error("❌ Error closing MongoDB connection:", error);
  }

  process.exit(0);
};

// Handle shutdown signals
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Start server
server.listen(PORT, () => {
  console.log("\n🚀 CareH Chat Microservice Started Successfully!");
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log(`ℹ️  Service Info: http://localhost:${PORT}/api/info`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(
    `🗄️  Database: ${
      process.env.MONGODB_URI ? "MongoDB Atlas" : "Not configured"
    }`
  );
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log("\n📋 Available Features:");
  console.log("   ✅ Real-time messaging");
  console.log("   ✅ Jitsi voice calls");
  console.log("   ✅ Jitsi video calls");
  console.log("   ✅ User presence tracking");
  console.log("   ✅ MongoDB persistence");
  console.log("   ✅ JWT authentication");
  console.log("   ✅ CORS enabled");
  console.log("\n🔧 Integration Notes:");
  console.log("   • Use JWT tokens from Django backend");
  console.log("   • Users are auto-created from token data");
  console.log("   • Jitsi SDK replaces WebRTC for calls");
  console.log("   • All data stored in MongoDB Atlas");
  console.log("\n📚 API Documentation: Check /api/info for details");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

module.exports = { app, server, io };
