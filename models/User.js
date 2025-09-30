const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: Number,
      required: true,
      unique: true,
    },
    uid: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
    },
    name: String,
    mobile: String,
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    userType: {
      type: String,
      enum: ["non_residing_parent", "residing_parent", "child"],
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    socketId: String,
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
userSchema.index({ userId: 1 });
userSchema.index({ uid: 1 });
userSchema.index({ email: 1 });

module.exports = mongoose.model("User", userSchema);
