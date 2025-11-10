const User = require("../models/User");
const Message = require("../models/Message");
const Call = require("../models/Call");
const { v4: uuidv4 } = require("uuid");
const recordingService = require("../services/recordingService");

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socket
    this.userSockets = new Map(); // socketId -> userId
    this.callTimeouts = new Map(); // callId -> timeout reference
  }

  handleConnection(socket) {
    console.log(`🔌 User ${socket.userId} connected with socket ${socket.id}`);

    // Store socket connection
    this.connectedUsers.set(socket.userId, socket);
    this.userSockets.set(socket.id, socket.userId);

    // Update user online status
    this.updateUserOnlineStatus(socket.userId, true, socket.id);

    // Send missed calls notification when user comes online
    this.sendMissedCallsNotification(socket);

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

        console.log(
          `📞 Call initiate request: User ${fromUserId} calling User ${toUserId}`
        );
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
        console.log(
          `🔍 Checking recipient ${toUserId} online status: ${
            recipientSocket ? "ONLINE" : "OFFLINE"
          }`
        );

        const callData = {
          callId: uuidv4(),
          fromUserId,
          toUserId: parseInt(toUserId),
          callType,
          status: "initiated",
          roomId: `careh_call_${Math.min(
            fromUserId,
            parseInt(toUserId)
          )}_${Math.max(fromUserId, parseInt(toUserId))}_${Date.now()}`,
        };

        console.log(`✅ Creating call with data:`, callData);

        // Save call to database
        const call = new Call(callData);
        await call.save();

        // Manually fetch user details since we're using numeric userIds, not ObjectIds
        const fromUser = await User.findOne({ userId: fromUserId }).select(
          "name email userType"
        );
        const toUser = await User.findOne({
          userId: parseInt(toUserId),
        }).select("name email userType");

        console.log(`📞 From user details:`, fromUser);
        console.log(`📞 To user details:`, toUser);

        // Create enriched call data for sending
        const enrichedCallData = {
          ...callData,
          fromUser: fromUser
            ? {
                name: fromUser.name,
                email: fromUser.email,
                userType: fromUser.userType,
              }
            : null,
          toUser: toUser
            ? {
                name: toUser.name,
                email: toUser.email,
                userType: toUser.userType,
              }
            : null,
        };

        // Send to recipient if online
        if (recipientSocket) {
          console.log(`📞 Sending call:incoming to user ${toUserId}`);
          recipientSocket.emit("call:incoming", enrichedCallData);
        } else {
          console.log(`⏰ User ${toUserId} is offline, setting up missed call timer`);
        }

        // Confirm to caller (always show call screen)
        console.log(`📞 Sending call:initiated to user ${fromUserId}`);
        socket.emit("call:initiated", enrichedCallData);

        // Set up a 60-second timeout to mark call as missed if not answered
        const missedCallTimeout = setTimeout(async () => {
          try {
            const currentCall = await Call.findOne({ callId: callData.callId });
            
            // Only mark as missed if call is still in initiated/ringing state
            if (currentCall && (currentCall.status === "initiated" || currentCall.status === "ringing")) {
              console.log(`⏰ Call ${callData.callId} timed out, marking as missed`);
              
              await Call.findOneAndUpdate(
                { callId: callData.callId },
                { 
                  status: "missed",
                  endTime: new Date()
                }
              );

              // Notify caller that call was not answered
              const callerSocket = this.connectedUsers.get(fromUserId);
              if (callerSocket) {
                callerSocket.emit("call:no-answer", {
                  callId: callData.callId,
                  message: "Call was not answered"
                });
              }

              console.log(`✅ Call ${callData.callId} marked as missed`);
            }
          } catch (error) {
            console.error(`❌ Error marking call as missed:`, error);
          }
        }, 60000); // 60 seconds

        // Store timeout reference for cleanup if call is answered
        if (!this.callTimeouts) {
          this.callTimeouts = new Map();
        }
        this.callTimeouts.set(callData.callId, missedCallTimeout);

        console.log(
          `✅ Call initiated successfully between ${fromUserId} and ${toUserId}`
        );
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

        // Clear the missed call timeout if it exists
        if (this.callTimeouts && this.callTimeouts.has(callId)) {
          clearTimeout(this.callTimeouts.get(callId));
          this.callTimeouts.delete(callId);
          console.log(`⏰ Cleared missed call timeout for call ${callId}`);
        }

        // Update call status in database
        const updateData = {
          status: response === "accept" ? "accepted" : "rejected",
        };

        if (response === "accept") {
          updateData.startTime = new Date();
        } else {
          updateData.endTime = new Date();
        }

        const call = await Call.findOneAndUpdate({ callId }, updateData, {
          new: true,
        });

        console.log(`📞 Call response: ${response} for call ${callId}`);
        console.log(`📞 Updated call:`, call);

        // Start recording if call is accepted
        if (response === "accept" && call) {
          console.log(`🎬 Starting call recording for accepted call: ${callId}`);
          
          // Start recording asynchronously (don't block the response)
          recordingService.startCallRecording(callId, {
            callType: call.callType,
            fromUserId: call.fromUserId,
            toUserId: call.toUserId,
          }).catch(error => {
            console.error(`❌ Failed to start recording for call ${callId}:`, error.message);
          });
        }

        if (call) {
          // Manually fetch user details instead of populate
          const fromUser = await User.findOne({
            userId: call.fromUserId,
          }).select("name email userType");
          const toUser = await User.findOne({ userId: call.toUserId }).select(
            "name email userType"
          );

          const enrichedCall = {
            ...call.toObject(),
            fromUser: fromUser
              ? {
                  name: fromUser.name,
                  email: fromUser.email,
                  userType: fromUser.userType,
                }
              : null,
            toUser: toUser
              ? {
                  name: toUser.name,
                  email: toUser.email,
                  userType: toUser.userType,
                }
              : null,
          };

          // Notify caller
          const callerSocket = this.connectedUsers.get(parseInt(toUserId));
          if (callerSocket) {
            console.log(
              `📞 Notifying caller ${toUserId} of response: ${response}`
            );
            callerSocket.emit("call:response", {
              callId,
              response,
              fromUserId,
              call: enrichedCall,
            });
          }

          // Confirm to responder
          console.log(`📞 Confirming response to responder ${fromUserId}`);
          socket.emit("call:responded", {
            callId,
            response,
            call: enrichedCall,
          });
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

        // Clear the missed call timeout if it exists
        if (this.callTimeouts && this.callTimeouts.has(callId)) {
          clearTimeout(this.callTimeouts.get(callId));
          this.callTimeouts.delete(callId);
          console.log(`⏰ Cleared missed call timeout for call ${callId}`);
        }

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

        // Stop recording and upload to S3
        if (call && call.antMediaStreamId) {
          console.log(`🛑 Stopping and uploading call recording for: ${callId}`);
          
          // Stop recording asynchronously (don't block the call end notification)
          recordingService.stopCallRecording(callId).catch(error => {
            console.error(`❌ Failed to stop/upload recording for call ${callId}:`, error.message);
          });
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

    // WebRTC signaling events
    socket.on("webrtc:offer", (data) => {
      try {
        const { callId, offer } = data;
        const fromUserId = socket.userId;

        console.log(`📡 WebRTC offer from ${fromUserId} for call ${callId}`);

        // Find the call and get the other participant
        Call.findOne({ callId }).then(call => {
          if (call) {
            const otherUserId = call.fromUserId === fromUserId ? call.toUserId : call.fromUserId;
            const otherSocket = this.connectedUsers.get(otherUserId);

            if (otherSocket) {
              console.log(`📡 Forwarding WebRTC offer to ${otherUserId}`);
              otherSocket.emit("webrtc:offer", { callId, offer });
            }
          }
        });
      } catch (error) {
        console.error("WebRTC offer error:", error);
      }
    });

    socket.on("webrtc:answer", (data) => {
      try {
        const { callId, answer } = data;
        const fromUserId = socket.userId;

        console.log(`📡 WebRTC answer from ${fromUserId} for call ${callId}`);

        // Find the call and get the other participant
        Call.findOne({ callId }).then(call => {
          if (call) {
            const otherUserId = call.fromUserId === fromUserId ? call.toUserId : call.fromUserId;
            const otherSocket = this.connectedUsers.get(otherUserId);

            if (otherSocket) {
              console.log(`📡 Forwarding WebRTC answer to ${otherUserId}`);
              otherSocket.emit("webrtc:answer", { answer });
            }
          }
        });
      } catch (error) {
        console.error("WebRTC answer error:", error);
      }
    });

    socket.on("webrtc:ice-candidate", (data) => {
      try {
        const { callId, candidate } = data;
        const fromUserId = socket.userId;

        console.log(`🧊 WebRTC ICE candidate from ${fromUserId} for call ${callId}`);

        // Find the call and get the other participant
        Call.findOne({ callId }).then(call => {
          if (call) {
            const otherUserId = call.fromUserId === fromUserId ? call.toUserId : call.fromUserId;
            const otherSocket = this.connectedUsers.get(otherUserId);

            if (otherSocket) {
              console.log(`🧊 Forwarding WebRTC ICE candidate to ${otherUserId}`);
              otherSocket.emit("webrtc:ice-candidate", { candidate });
            }
          }
        });
      } catch (error) {
        console.error("WebRTC ICE candidate error:", error);
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

  async sendMissedCallsNotification(socket) {
    try {
      const userId = socket.userId;
      
      // Find all missed calls for this user
      const missedCalls = await Call.find({
        toUserId: userId,
        status: "missed",
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      }).sort({ createdAt: -1 });

      if (missedCalls.length > 0) {
        console.log(`📞 Found ${missedCalls.length} missed calls for user ${userId}`);
        
        // Fetch user details for each missed call
        const enrichedMissedCalls = await Promise.all(
          missedCalls.map(async (call) => {
            const fromUser = await User.findOne({ userId: call.fromUserId }).select(
              "name email userType"
            );
            
            return {
              callId: call.callId,
              fromUserId: call.fromUserId,
              callType: call.callType,
              status: call.status,
              createdAt: call.createdAt,
              fromUser: fromUser ? {
                name: fromUser.name,
                email: fromUser.email,
                userType: fromUser.userType,
              } : null,
            };
          })
        );

        // Send notification to user
        socket.emit("call:missed-calls", {
          count: missedCalls.length,
          calls: enrichedMissedCalls,
        });
      }
    } catch (error) {
      console.error("Send missed calls notification error:", error);
    }
  }

  async handleDisconnection(socket) {
    const userId = this.userSockets.get(socket.id);

    if (userId) {
      console.log(`🔌 User ${userId} disconnected`);

      // Check for any active calls by this user and handle recording cleanup
      try {
        const activeCalls = await Call.find({
          $or: [
            { fromUserId: userId },
            { toUserId: userId }
          ],
          status: { $in: ["initiated", "ringing", "accepted"] },
          antMediaStreamId: { $ne: null }
        });

        if (activeCalls.length > 0) {
          console.log(`🧹 Found ${activeCalls.length} active calls for disconnected user ${userId}, cleaning up recordings...`);
          
          for (const call of activeCalls) {
            // Update call status to ended
            call.status = "ended";
            call.endTime = new Date();
            if (call.startTime) {
              call.duration = Math.floor((call.endTime - call.startTime) / 1000);
            }
            await call.save();

            // Stop and upload recording
            recordingService.stopCallRecording(call.callId).catch(error => {
              console.error(`❌ Error handling recording for disconnected call ${call.callId}:`, error.message);
            });

            // Notify the other participant
            const otherUserId = call.fromUserId === userId ? call.toUserId : call.fromUserId;
            const otherSocket = this.connectedUsers.get(otherUserId);
            if (otherSocket) {
              otherSocket.emit("call:ended", { callId: call.callId, fromUserId: userId });
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error handling disconnect cleanup for user ${userId}:`, error.message);
      }

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
