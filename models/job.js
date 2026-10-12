const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Job title is required"],
      trim: true
    },
    company: {
      type: String,
      required: [true, "Company name is required"],
      trim: true
    },
    description: {
      type: String,
      required: [true, "Job description is required"],
      trim: true
    },
    location: {
      type: String,
      required: [true, "Job location is required"],
      trim: true
    },
    requiredSkills: {
      type: [String],
      required: true,
      validate: {
        validator: skills =>
          Array.isArray(skills) &&
          skills.length > 0 &&
          skills.every(skill => typeof skill === "string" && skill.trim()),
        message: "At least one required skill must be provided"
      }
    },
    education: {
      type: String,
      default: "",
      trim: true
    },
    experience: {
      type: Number,
      default: 0,
      min: [0, "Experience cannot be negative"]
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

jobSchema.index({ title: 1, location: 1 });

module.exports =
  mongoose.models.Job ||
  mongoose.model("Job", jobSchema);