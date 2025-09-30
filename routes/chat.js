const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const User = require("../models/User");
const Message = require("../models/Message");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// Get all connected users (for parent-to-parent communication)
router.get("/users", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;

    // Get all users except current user
    const users = await User.find(
      { userId: { $ne: currentUserId } },
      {
        userId: 1,
        uid: 1,
        email: 1,
        name: 1,
        userType: 1,
        isOnline: 1,
        lastSeen: 1,
      }
    ).sort({ isOnline: -1, lastSeen: -1 });

    res.json({
      data: users,
      meta: {
        code: 200,
        message: "Users retrieved successfully",
        total: users.length,
      },
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      error: "Failed to retrieve users",
      code: 500,
    });
  }
});

// Get conversation messages between two users (with query parameter)
router.get("/messages", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const withUserId = parseInt(req.query.with);
    const { page = 1, limit = 50 } = req.query;

    if (!withUserId) {
      return res.status(400).json({
        error: "Missing 'with' parameter",
        code: 400,
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get messages between current user and specified user
    const messages = await Message.find({
      $or: [
        { fromUserId: currentUserId, toUserId: withUserId },
        { fromUserId: withUserId, toUserId: currentUserId },
      ],
    })
      .sort({ createdAt: 1 }) // Ascending order (oldest first)
      .skip(skip)
      .limit(parseInt(limit));

    // Convert to frontend-compatible format
    const formattedMessages = messages.map((msg) => ({
      id: msg.messageId,
      from: msg.fromUserId.toString(),
      to: msg.toUserId.toString(),
      content: msg.content,
      text: msg.content,
      createdAt: msg.createdAt.toISOString(),
      timestamp: msg.createdAt,
      messageType: msg.messageType,
      isRead: msg.isRead,
      deliveredAt: msg.deliveredAt,
      sender:
        msg.fromUserId.toString() === currentUserId.toString()
          ? "user"
          : "child",
      status: msg.isRead ? "read" : "delivered",
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({
      error: "Failed to retrieve messages",
      code: 500,
    });
  }
});

// Get conversation messages between two users (original endpoint with path parameter)
router.get("/messages/:withUserId", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const withUserId = parseInt(req.params.withUserId);
    const { page = 1, limit = 50 } = req.query;

    const skip = (page - 1) * limit;

    const messages = await Message.find({
      $or: [
        { fromUserId: currentUserId, toUserId: withUserId },
        { fromUserId: withUserId, toUserId: currentUserId },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    // Mark messages as read
    await Message.updateMany(
      { fromUserId: withUserId, toUserId: currentUserId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({
      data: messages.reverse(), // Return in chronological order
      meta: {
        code: 200,
        message: "Messages retrieved successfully",
        page: parseInt(page),
        limit: parseInt(limit),
        total: messages.length,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({
      error: "Failed to retrieve messages",
      code: 500,
    });
  }
});

// Send a message
router.post("/messages", authenticateToken, async (req, res) => {
  try {
    const { toUserId, content, messageType = "text" } = req.body;
    const fromUserId = req.user.userId;

    if (!toUserId || !content) {
      return res.status(400).json({
        error: "toUserId and content are required",
        code: 400,
      });
    }

    const messageData = {
      messageId: uuidv4(),
      fromUserId,
      toUserId: parseInt(toUserId),
      content,
      messageType,
      deliveredAt: new Date(),
    };

    const message = new Message(messageData);
    await message.save();

    res.json({
      data: message,
      meta: {
        code: 200,
        message: "Message sent successfully",
      },
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      error: "Failed to send message",
      code: 500,
    });
  }
});

// Get unread message count
router.get("/messages/unread/count", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;

    const unreadCount = await Message.countDocuments({
      toUserId: currentUserId,
      isRead: false,
    });

    res.json({
      data: { unreadCount },
      meta: {
        code: 200,
        message: "Unread count retrieved successfully",
      },
    });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({
      error: "Failed to get unread count",
      code: 500,
    });
  }
});

// Get conversation list (users with whom current user has chatted)
router.get("/conversations", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;

    // Get unique conversations
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [{ fromUserId: currentUserId }, { toUserId: currentUserId }],
        },
      },
      {
        $addFields: {
          otherUserId: {
            $cond: {
              if: { $eq: ["$fromUserId", currentUserId] },
              then: "$toUserId",
              else: "$fromUserId",
            },
          },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: "$otherUserId",
          lastMessage: { $first: "$content" },
          lastMessageTime: { $first: "$createdAt" },
          lastMessageType: { $first: "$messageType" },
          unreadCount: {
            $sum: {
              $cond: {
                if: {
                  $and: [
                    { $eq: ["$toUserId", currentUserId] },
                    { $eq: ["$isRead", false] },
                  ],
                },
                then: 1,
                else: 0,
              },
            },
          },
        },
      },
    ]);

    res.json({
      data: conversations,
      meta: {
        code: 200,
        message: "Conversations retrieved successfully",
        total: conversations.length,
      },
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({
      error: "Failed to retrieve conversations",
      code: 500,
    });
  }
});

module.exports = router;
