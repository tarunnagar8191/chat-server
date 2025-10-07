const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");

// Get Jitsi Meet configuration
router.get("/config", authenticateToken, async (req, res) => {
  try {
    const jitsiConfig = {
      serverURL: process.env.JITSI_SERVER_URL || "https://meet.jit.si",
      features: {
        chat: false,
        recording: false,
        invite: false,
        addPeople: false,
        calendar: false,
        callIntegration: true,
        meetingName: false,
        notification: false,
        lobbyMode: false,
        pip: true,
        raiseHand: false,
        reactions: false,
        securityOptions: false,
        tileView: true,
        toolboxAlwaysVisible: false,
        videoShare: false,
        welcomePage: false,
      },
      defaultConfig: {
        startWithAudioMuted: false,
        startWithVideoMuted: false,
        requireDisplayName: false,
        enableWelcomePage: false,
        enableClosePage: false,
        prejoinPageEnabled: false,
        disableDeepLinking: true,
        disableInviteFunctions: true,
        doNotStoreRoom: true,
        disableShortcuts: true,
        disableProfile: true,
      },
    };

    res.json({
      data: jitsiConfig,
      meta: {
        code: 200,
        message: "Jitsi configuration retrieved successfully",
      },
    });
  } catch (error) {
    console.error("Get Jitsi config error:", error);
    res.status(500).json({
      error: "Failed to retrieve Jitsi configuration",
      code: 500,
    });
  }
});

// Generate room ID for call
router.post("/room", authenticateToken, async (req, res) => {
  try {
    const { otherUserId, callType } = req.body;
    const userId = req.user.userId;

    if (!otherUserId) {
      return res.status(400).json({
        error: "otherUserId is required",
        code: 400,
      });
    }

    // Generate consistent room ID based on participant IDs
    const roomId = `careh_call_${Math.min(
      userId,
      parseInt(otherUserId)
    )}_${Math.max(userId, parseInt(otherUserId))}_${Date.now()}`;

    res.json({
      data: {
        roomId,
        callType: callType || "video",
        serverURL: process.env.JITSI_SERVER_URL || "https://meet.jit.si",
        participants: [userId, parseInt(otherUserId)],
      },
      meta: {
        code: 200,
        message: "Room ID generated successfully",
      },
    });
  } catch (error) {
    console.error("Generate room ID error:", error);
    res.status(500).json({
      error: "Failed to generate room ID",
      code: 500,
    });
  }
});

// JWT token generation for secure Jitsi rooms (optional)
router.post("/token", authenticateToken, async (req, res) => {
  try {
    const { roomId, userInfo } = req.body;
    const userId = req.user.userId;

    if (!roomId) {
      return res.status(400).json({
        error: "roomId is required",
        code: 400,
      });
    }

    // For now, return a simple response
    // In production, you would generate a proper JWT token here
    res.json({
      data: {
        token: null, // No JWT token for public Jitsi Meet server
        roomId,
        userInfo: {
          id: userId,
          name: userInfo?.displayName || `User ${userId}`,
          email: userInfo?.email,
          avatar: userInfo?.avatar,
        },
      },
      meta: {
        code: 200,
        message: "Token generated successfully",
      },
    });
  } catch (error) {
    console.error("Generate token error:", error);
    res.status(500).json({
      error: "Failed to generate token",
      code: 500,
    });
  }
});

module.exports = router;
