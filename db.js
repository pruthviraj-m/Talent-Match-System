
const mongoose = require("mongoose");

async function connectDB() {
    try {
        const uri = process.env.MONGODB_URI;

        if (!uri) {
            throw new Error("MONGODB_URI is missing from .env");
        }

        await mongoose.connect(uri);

        console.log("MongoDB Atlas connected successfully");
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exit(1);
    }
}

module.exports = connectDB;
