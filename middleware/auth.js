const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("../models/User");

// Helper function to validate token with Django backend
const validateTokenWithDjango = async (token) => {
  try {
    const response = await axios.get(
      `${process.env.DJANGO_BASE_URL}/get-other-parent/`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 5000, // 5 second timeout
      }
    );

    if (response.status === 200 && response.data) {
      const responseData = response.data.data;
      const userData = responseData.summary.authenticated_parent;

      console.log("🔍 Backend: User data from Django:", userData);

      // Return basic user data (userId will be set from frontend)
      return {
        email: userData.email,
        name: userData.name,
        userType: userData.parent_type,
        uid: userData.uid || `generated_${userData.email}`, // Generate uid if not provided
        // Note: userId will be provided by frontend since Django doesn't return it here
      };
    }

    return null;
  } catch (error) {
    console.error("Error validating token with Django:", error.message);
    return null;
  }
};

// Middleware to authenticate JWT tokens from Django backend
const authenticateToken = async (req, res, next) => {
  console.log("Authenticating token...");
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    const frontendUserId = req.headers["x-user-id"]; // Get userId from header

    if (!token) {
      return res.status(401).json({
        error: "Access token required",
        code: 401,
      });
    }

    // Validate token with Django backend
    const userData = await validateTokenWithDjango(token);
    if (!userData) {
      return res.status(403).json({
        error: "Invalid or expired token",
        code: 403,
      });
    }

    // Use frontend userId since token is valid and Django doesn't provide userId
    const finalUserId = frontendUserId;

    if (!finalUserId) {
      return res.status(400).json({
        error: "User ID required in x-user-id header",
        code: 400,
      });
    }

    console.log("✅ HTTP Token validated successfully");
    console.log("🔧 HTTP Using userId from frontend:", finalUserId);

    // Set user info with userId for HTTP requests
    req.user = {
      ...userData,
      userId: parseInt(finalUserId), // Ensure it's a number like in socket auth
    };

    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({
      error: "Authentication service error",
      code: 500,
    });
  }
};

// Socket.io authentication middleware
const socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const frontendUserId = socket.handshake.auth.userId; // Get userId from frontend

    console.log(
      "🔐 Authenticating socket with token:",
      token ? "***provided***" : "missing"
    );
    console.log("🔐 Frontend userId:", frontendUserId);

    if (!token) {
      return next(new Error("Authentication error: Token required"));
    }

    // Validate token with Django backend
    const userData = await validateTokenWithDjango(token);
    if (!userData) {
      console.log("❌ Token validation failed");
      return next(new Error("Authentication error: Invalid token"));
    }

    // Use frontend userId since token is valid and Django doesn't provide userId
    const finalUserId = frontendUserId;

    if (!finalUserId) {
      console.log("❌ No userId provided from frontend");
      return next(new Error("Authentication error: User ID required"));
    }

    console.log("✅ Token validated successfully");
    console.log("🔧 Using userId from frontend:", finalUserId);

    // Set socket user info
    socket.userId = finalUserId;
    socket.uid = userData.uid;
    socket.email = userData.email;

    // Update or create user in our database with the correct userId
    const updatedUserData = { ...userData, userId: finalUserId };
    await updateUserFromToken(updatedUserData);

    next();
  } catch (error) {
    console.error("Socket authentication error:", error);
    next(new Error("Authentication service error"));
  }
};

// Helper function to update user from token data
const updateUserFromToken = async (userData) => {
  try {
    // First try to find existing user by userId, email, or uid
    let existingUser = await User.findOne({
      $or: [
        { userId: userData.userId },
        { email: userData.email },
        { uid: userData.uid },
      ],
    });

    if (existingUser) {
      // Update existing user
      await User.findByIdAndUpdate(
        existingUser._id,
        {
          userId: userData.userId,
          uid: userData.uid,
          email: userData.email,
          name: userData.name,
          userType: userData.userType,
          lastSeen: new Date(),
        },
        { new: true }
      );
      console.log(`✅ User ${userData.userId} updated in chat database`);
    } else {
      // Create new user
      await User.create({
        userId: userData.userId,
        uid: userData.uid,
        email: userData.email,
        name: userData.name,
        userType: userData.userType,
        lastSeen: new Date(),
      });
      console.log(`✅ User ${userData.userId} created in chat database`);
    }
  } catch (error) {
    console.error("Error updating user from token:", error);
    // Don't throw the error, just log it to avoid breaking authentication
  }
};

module.exports = {
  authenticateToken,
  socketAuth,
};
