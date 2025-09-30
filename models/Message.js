const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
    },
    fromUserId: {
      type: Number,
      required: true,
      ref: "User",
    },
    toUserId: {
      type: Number,
      required: true,
      ref: "User",
    },
    content: {
      type: String,
      required: true,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "audio", "video", "file"],
      default: "text",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: Date,
    deliveredAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
messageSchema.index({ fromUserId: 1, toUserId: 1, createdAt: -1 });
messageSchema.index({ fromUserId: 1, createdAt: -1 });
messageSchema.index({ toUserId: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
