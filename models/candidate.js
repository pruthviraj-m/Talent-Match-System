
const mongoose = require("mongoose");

const candidateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    education: {
        type: String,
        default: ""
    },
    experience: {
        type: Number,
        default: 0,
        min: 0
    },
    skills: {
        type: [String],
        default: []
    },
    location: {
        type: String,
        default: ""
    }
}, { timestamps: true });

module.exports =
  mongoose.models.Candidate ||
  mongoose.model("Candidate", candidateSchema);