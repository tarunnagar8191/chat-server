const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const Call = require("../models/Call");
const User = require("../models/User");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// Get call history
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;

    const skip = (page - 1) * limit;

    const calls = await Call.find({
      $or: [{ fromUserId: currentUserId }, { toUserId: currentUserId }],
    })
      .populate("fromUserId", "name email userType")
      .populate("toUserId", "name email userType")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    res.json({
      data: calls,
      meta: {
        code: 200,
        message: "Call history retrieved successfully",
        page: parseInt(page),
        limit: parseInt(limit),
        total: calls.length,
      },
    });
  } catch (error) {
    console.error("Get call history error:", error);
    res.status(500).json({
      error: "Failed to retrieve call history",
      code: 500,
    });
  }
});

// Create a new call record
router.post("/initiate", authenticateToken, async (req, res) => {
  try {
    const { toUserId, callType = "voice" } = req.body;
    const fromUserId = req.user.userId;

    if (!toUserId) {
      return res.status(400).json({
        error: "toUserId is required",
        code: 400,
      });
    }

    // Check if recipient exists and is online
    const recipient = await User.findOne({ userId: parseInt(toUserId) });
    if (!recipient) {
      return res.status(404).json({
        error: "Recipient not found",
        code: 404,
      });
    }

    // Generate unique room ID for the call
    const roomId = `careh_call_${Math.min(
      fromUserId,
      parseInt(toUserId)
    )}_${Math.max(fromUserId, parseInt(toUserId))}_${Date.now()}`;

    const callData = {
      callId: uuidv4(),
      fromUserId,
      toUserId: parseInt(toUserId),
      callType,
      status: "initiated",
      roomId: roomId,
    };

    const call = new Call(callData);
    await call.save();

    // Populate user details
    await call.populate("fromUserId", "name email userType");
    await call.populate("toUserId", "name email userType");

    res.json({
      data: call,
      meta: {
        code: 200,
        message: "Call initiated successfully",
      },
    });
  } catch (error) {
    console.error("Initiate call error:", error);
    res.status(500).json({
      error: "Failed to initiate call",
      code: 500,
    });
  }
});

// Update call status
router.patch("/:callId/status", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { status, sdpOffer, sdpAnswer } = req.body;
    const currentUserId = req.user.userId;

    if (!status) {
      return res.status(400).json({
        error: "Status is required",
        code: 400,
      });
    }

    const updateData = { status };

    // Set timestamps based on status
    if (status === "accepted") {
      updateData.startTime = new Date();
    } else if (status === "ended") {
      updateData.endTime = new Date();
    }

    // Add SDP data if provided
    if (sdpOffer) updateData.sdpOffer = sdpOffer;
    if (sdpAnswer) updateData.sdpAnswer = sdpAnswer;

    const call = await Call.findOneAndUpdate(
      {
        callId,
        $or: [{ fromUserId: currentUserId }, { toUserId: currentUserId }],
      },
      updateData,
      { new: true }
    )
      .populate("fromUserId", "name email userType")
      .populate("toUserId", "name email userType");

    if (!call) {
      return res.status(404).json({
        error: "Call not found",
        code: 404,
      });
    }

    // Calculate duration if call ended
    if (status === "ended" && call.startTime) {
      call.duration = Math.floor((call.endTime - call.startTime) / 1000);
      await call.save();
    }

    res.json({
      data: call,
      meta: {
        code: 200,
        message: "Call status updated successfully",
      },
    });
  } catch (error) {
    console.error("Update call status error:", error);
    res.status(500).json({
      error: "Failed to update call status",
      code: 500,
    });
  }
});

// Add ICE candidate to call
router.post("/:callId/ice-candidate", authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    const { candidate, sdpMLineIndex, sdpMid } = req.body;
    const currentUserId = req.user.userId;

    if (!candidate) {
      return res.status(400).json({
        error: "ICE candidate is required",
        code: 400,
      });
    }

    const call = await Call.findOneAndUpdate(
      {
        callId,
        $or: [{ fromUserId: currentUserId }, { toUserId: currentUserId }],
      },
      {
        $push: {
          iceCandidates: {
            candidate,
            sdpMLineIndex,
            sdpMid,
          },
        },
      },
      { new: true }
    );

    if (!call) {
      return res.status(404).json({
        error: "Call not found",
        code: 404,
      });
    }

    res.json({
      data: { callId, candidate: { candidate, sdpMLineIndex, sdpMid } },
      meta: {
        code: 200,
        message: "ICE candidate added successfully",
      },
    });
  } catch (error) {
    console.error("Add ICE candidate error:", error);
    res.status(500).json({
      error: "Failed to add ICE candidate",
      code: 500,
    });
  }
});

// Get WebRTC configuration
router.get("/webrtc-config", authenticateToken, (req, res) => {
  try {
    const config = {
      iceServers: [
        { urls: process.env.STUN_SERVER || "stun:stun.l.google.com:19302" },
      ],
    };

    // Add TURN server if configured
    if (
      process.env.TURN_SERVER &&
      process.env.TURN_USERNAME &&
      process.env.TURN_PASSWORD
    ) {
      config.iceServers.push({
        urls: process.env.TURN_SERVER,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_PASSWORD,
      });
    }

    res.json({
      data: config,
      meta: {
        code: 200,
        message: "WebRTC configuration retrieved successfully",
      },
    });
  } catch (error) {
    console.error("Get WebRTC config error:", error);
    res.status(500).json({
      error: "Failed to get WebRTC configuration",
      code: 500,
    });
  }
});

module.exports = router;
