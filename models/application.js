
const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema({
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Candidate",
        required: true
    },
    job: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Job",
        required: true
    },
    status: {
        type: String,
        enum: [
            "Pending",
            "Under Review",
            "Shortlisted",
            "Rejected",
            "Accepted"
        ],
        default: "Pending"
    },
    appliedAt: {
        type: Date,
        default: Date.now
    }
});

// Prevent the same candidate applying to the same job twice.
applicationSchema.index(
    { candidate: 1, job: 1 },
    { unique: true }
);

module.exports =
  mongoose.models.Application ||
  mongoose.model("Application", applicationSchema);