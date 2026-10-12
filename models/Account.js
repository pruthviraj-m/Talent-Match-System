
const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    passwordHash: {
      type: String,
      required: true,
      select: false
    },

    role: {
      type: String,
      enum: ["candidate", "recruiter"],
      required: true
    },

    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Candidate",
      default: null
    }
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.Account ||
  mongoose.model("Account", accountSchema);
