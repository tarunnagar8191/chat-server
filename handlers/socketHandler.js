const User = require("../models/User");
const Message = require("../models/Message");
const Call = require("../models/Call");
const { v4: uuidv4 } = require("uuid");

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socket
    this.userSockets = new Map(); // socketId -> userId
  }

  handleConnection(socket) {
    console.log(`🔌 User ${socket.userId} connected with socket ${socket.id}`);

    // Store socket connection
    this.connectedUsers.set(socket.userId, socket);
    this.userSockets.set(socket.id, socket.userId);

    // Update user online status
    this.updateUserOnlineStatus(socket.userId, true, socket.id);

    // Handle chat events
    this.handleChatEvents(socket);

    // Handle call events
    this.handleCallEvents(socket);

    // Handle disconnection
    socket.on("disconnect", () => {
      this.handleDisconnection(socket);
    });
  }

  handleChatEvents(socket) {
    // Send message
    socket.on("message:send", async (data) => {
      try {
        const { toUserId, content, messageType = "text" } = data;
        const fromUserId = socket.userId;

        if (!toUserId || !content) {
          socket.emit("error", {
            message: "toUserId and content are required",
            code: "INVALID_DATA",
          });
          return;
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

        // Send to recipient if online
        const recipientSocket = this.connectedUsers.get(parseInt(toUserId));
        if (recipientSocket) {
          recipientSocket.emit("message:received", message);
        }

        // Confirm to sender
        socket.emit("message:sent", message);
      } catch (error) {
        console.error("Socket message error:", error);
        socket.emit("error", {
          message: "Failed to send message",
          code: "MESSAGE_FAILED",
        });
      }
    });

    // Mark messages as read
    socket.on("message:markRead", async (data) => {
      try {
        const { withUserId } = data;
        const currentUserId = socket.userId;

        await Message.updateMany(
          {
            fromUserId: parseInt(withUserId),
            toUserId: currentUserId,
            isRead: false,
          },
          { isRead: true, readAt: new Date() }
        );

        // Notify sender that messages were read
        const senderSocket = this.connectedUsers.get(parseInt(withUserId));
        if (senderSocket) {
          senderSocket.emit("message:read", { byUserId: currentUserId });
        }

        socket.emit("message:markedRead", { withUserId });
      } catch (error) {
        console.error("Mark read error:", error);
        socket.emit("error", {
          message: "Failed to mark messages as read",
          code: "MARK_READ_FAILED",
        });
      }
    });

    // Typing indicators
    socket.on("typing:start", (data) => {
      const { toUserId } = data;
      const recipientSocket = this.connectedUsers.get(parseInt(toUserId));
      if (recipientSocket) {
        recipientSocket.emit("typing:start", { fromUserId: socket.userId });
      }
    });

    socket.on("typing:stop", (data) => {
      const { toUserId } = data;
      const recipientSocket = this.connectedUsers.get(parseInt(toUserId));
      if (recipientSocket) {
        recipientSocket.emit("typing:stop", { fromUserId: socket.userId });
      }
    });
  }

  handleCallEvents(socket) {
    // Initiate call
    socket.on("call:initiate", async (data) => {
      try {
        const { toUserId, callType = "voice" } = data;
        const fromUserId = socket.userId;

        console.log(`📞 Call initiate request: User ${fromUserId} calling User ${toUserId}`);
        console.log(`📞 Call data:`, data);

        if (!toUserId) {
          console.log(`❌ Missing toUserId in call request`);
          socket.emit("call:failed", {
            message: "toUserId is required for call",
            code: "INVALID_DATA",
          });
          return;
        }

        // Check if recipient is online
        const recipientSocket = this.connectedUsers.get(parseInt(toUserId));
        console.log(`🔍 Checking recipient ${toUserId} online status: ${recipientSocket ? 'ONLINE' : 'OFFLINE'}`);
        
        if (!recipientSocket) {
          console.log(`❌ User ${toUserId} is offline`);
          socket.emit("call:failed", {
            message: "User is not available",
            code: "USER_OFFLINE",
          });
          return;
        }

        const callData = {
          callId: uuidv4(),
          fromUserId,
          toUserId: parseInt(toUserId),
          callType,
          status: "initiated",
          roomId: `room_${uuidv4()}`,
        };

        console.log(`✅ Creating call with data:`, callData);

        // Save call to database
        const call = new Call(callData);
        await call.save();

        // Populate user details
        await call.populate("fromUserId", "name email userType");
        await call.populate("toUserId", "name email userType");

        console.log(`📞 Sending call:incoming to user ${toUserId}`);
        console.log(`📞 Sending call:initiated to user ${fromUserId}`);

        // Send to recipient
        recipientSocket.emit("call:incoming", call);

        // Confirm to caller
        socket.emit("call:initiated", call);
        
        console.log(`✅ Call initiated successfully between ${fromUserId} and ${toUserId}`);
      } catch (error) {
        console.error("Call initiate error:", error);
        socket.emit("call:failed", {
          message: "Failed to initiate call",
          code: "CALL_FAILED",
          error: error.message,
        });
      }
    });

    // Respond to call
    socket.on("call:respond", async (data) => {
      try {
        const { callId, response, toUserId } = data; // response: 'accepted' or 'rejected'
        const fromUserId = socket.userId;

        // Update call status in database
        const updateData = {
          status: response === "accept" ? "accepted" : "rejected",
        };

        if (response === "accept") {
          updateData.startTime = new Date();
        }

        const call = await Call.findOneAndUpdate({ callId }, updateData, {
          new: true,
        })
          .populate("fromUserId", "name email userType")
          .populate("toUserId", "name email userType");

        if (call) {
          // Notify caller
          const callerSocket = this.connectedUsers.get(parseInt(toUserId));
          if (callerSocket) {
            callerSocket.emit("call:response", {
              callId,
              response,
              fromUserId,
              call,
            });
          }

          // Confirm to responder
          socket.emit("call:responded", { callId, response, call });
        }
      } catch (error) {
        console.error("Call respond error:", error);
        socket.emit("error", {
          message: "Failed to respond to call",
          code: "CALL_RESPONSE_FAILED",
        });
      }
    });

    // End call
    socket.on("call:end", async (data) => {
      try {
        const { callId, toUserId } = data;
        const fromUserId = socket.userId;

        // Update call in database
        const call = await Call.findOneAndUpdate(
          { callId },
          {
            status: "ended",
            endTime: new Date(),
          },
          { new: true }
        );

        if (call && call.startTime) {
          call.duration = Math.floor((call.endTime - call.startTime) / 1000);
          await call.save();
        }

        // Notify other participant
        const otherSocket = this.connectedUsers.get(parseInt(toUserId));
        if (otherSocket) {
          otherSocket.emit("call:ended", { callId, fromUserId });
        }

        // Confirm to caller
        socket.emit("call:ended", { callId });
      } catch (error) {
        console.error("Call end error:", error);
        socket.emit("error", {
          message: "Failed to end call",
          code: "CALL_END_FAILED",
        });
      }
    });
  }

  async updateUserOnlineStatus(userId, isOnline, socketId = null) {
    try {
      const updateData = {
        isOnline,
        lastSeen: new Date(),
      };

      if (socketId) {
        updateData.socketId = socketId;
      }

      await User.findOneAndUpdate({ userId }, updateData, { upsert: false });

      // Broadcast user status to other connected users
      this.io.emit("user:status", {
        userId,
        isOnline,
        lastSeen: updateData.lastSeen,
      });
    } catch (error) {
      console.error("Update user status error:", error);
    }
  }

  handleDisconnection(socket) {
    const userId = this.userSockets.get(socket.id);

    if (userId) {
      console.log(`🔌 User ${userId} disconnected`);

      // Remove from tracking
      this.connectedUsers.delete(userId);
      this.userSockets.delete(socket.id);

      // Update offline status
      this.updateUserOnlineStatus(userId, false);
    }
  }

  // Get connected users count
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  // Get online user IDs
  getOnlineUserIds() {
    return Array.from(this.connectedUsers.keys());
  }
}

module.exports = SocketHandler;
