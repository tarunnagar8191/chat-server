const mongoose = require("mongoose");

const callSchema = new mongoose.Schema(
  {
    callId: {
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
    callType: {
      type: String,
      enum: ["voice", "video"],
      required: true,
    },
    status: {
      type: String,
      enum: ["initiated", "ringing", "accepted", "rejected", "ended", "missed"],
      default: "initiated",
    },
    startTime: Date,
    endTime: Date,
    duration: {
      type: Number, // in seconds
      default: 0,
    },
    roomId: String,
    sdpOffer: String,
    sdpAnswer: String,
    iceCandidates: [
      {
        candidate: String,
        sdpMLineIndex: Number,
        sdpMid: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
callSchema.index({ fromUserId: 1, createdAt: -1 });
callSchema.index({ toUserId: 1, createdAt: -1 });
callSchema.index({ callId: 1 });

module.exports = mongoose.model("Call", callSchema);
