
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");
const mongoose = require("mongoose");

const connectDB = require("./db");
const Candidate = require("./models/candidate");

const jobManagementRoutes = require("./routes/jobs");
const applicationRoutes = require("./routes/applications");
const matchingRoutes = require("./routes/matching");
const analyticsRoutes = require("./routes/analytics");
const authRoutes = require("./routes/auth");

const { protect, allowRoles } = require("./middleware/auth");

const app = express();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error(
        "Set JWT_SECRET to a secret of at least 32 characters in .env"
    );
}

const PORT = process.env.PORT || 3000;

const csvPath = path.join(
    __dirname,
    "data",
    "huge_job_recommendation_dataset.csv"
);

app.use(express.json());

// Authentication
app.use("/api/auth", authRoutes);

// MongoDB application routes
app.use("/api/applications", applicationRoutes);
app.use("/api/jobs/manage", jobManagementRoutes);
app.use("/api/matching", matchingRoutes);
app.use("/api/analytics", analyticsRoutes);

// Frontend
app.use(express.static(path.join(__dirname, "public")));

// 1. Health check (public)
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "TalentMatch backend is running"
    });
});

// 2. Dataset statistics (public)
app.get("/api/dataset", (req, res) => {
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({
            success: false,
            error: "Dataset not found",
            expectedPath: "data/huge_job_recommendation_dataset.csv"
        });
    }

    const columns = new Set();
    const users = new Set();
    const jobs = new Set();

    let totalRows = 0;
    let validScores = 0;
    let scoreSum = 0;

    fs.createReadStream(csvPath)
        .pipe(csv())
        .on("data", row => {
            totalRows++;

            Object.keys(row).forEach(key => columns.add(key));

            if (row.user_id) users.add(row.user_id.trim());
            if (row.job_id) jobs.add(row.job_id.trim());

            const score = Number(row.relevance_score);

            if (
                row.relevance_score !== undefined &&
                String(row.relevance_score).trim() !== "" &&
                Number.isFinite(score)
            ) {
                scoreSum += score;
                validScores++;
            }
        })
        .on("end", () => {
            res.json({
                success: true,
                dataset: "Job Recommendation Dataset",
                totalRows,
                columns: [...columns],
                uniqueCandidates: users.size,
                uniqueJobs: jobs.size,
                validRelevanceScores: validScores,
                averageRelevanceScore: validScores
                    ? Number((scoreSum / validScores).toFixed(4))
                    : null
            });
        })
        .on("error", error => {
            console.error("Dataset error:", error.message);

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: "Unable to read dataset"
                });
            }
        });
});

// 3. CSV job listings (public)
app.get("/api/jobs", (req, res) => {
    if (!fs.existsSync(csvPath)) {
        return res.status(404).json({
            success: false,
            error: "Dataset not found"
        });
    }

    const limit = Math.min(
        Math.max(parseInt(req.query.limit, 10) || 30, 1),
        100
    );

    const seen = new Set();
    const jobs = [];

    fs.createReadStream(csvPath)
        .pipe(csv())
        .on("data", row => {
            if (
                !row.job_id ||
                seen.has(row.job_id) ||
                jobs.length >= limit
            ) {
                return;
            }

            seen.add(row.job_id);

            jobs.push({
                job_id: row.job_id,
                title: row.title || "",
                description: row.description || "",
                location: row.location || "",
                skills_required: row.skills_required || "",
                education: row.education || "",
                experience: row.experience || "",
                relevance_score: row.relevance_score || ""
            });
        })
        .on("end", () => {
            res.json({
                success: true,
                count: jobs.length,
                jobs
            });
        })
        .on("error", error => {
            console.error("CSV jobs error:", error.message);

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: "Unable to read jobs"
                });
            }
        });
});

// 4. CSV candidate matches (recruiters only)
app.get(
    "/api/candidates/matches",
    protect,
    allowRoles("recruiter"),
    (req, res) => {
        if (!fs.existsSync(csvPath)) {
            return res.status(404).json({
                success: false,
                error: "Dataset not found"
            });
        }

        const jobId = String(req.query.jobId || "").trim();

        if (!jobId) {
            return res.status(400).json({
                success: false,
                error: "jobId query parameter is required"
            });
        }

        const limit = Math.min(
            Math.max(parseInt(req.query.limit, 10) || 30, 1),
            100
        );

        const candidates = [];

        fs.createReadStream(csvPath)
            .pipe(csv())
            .on("data", row => {
                if (
                    String(row.job_id || "").trim() !== jobId ||
                    !row.user_id
                ) {
                    return;
                }

                candidates.push({
                    user_id: row.user_id,
                    job_id: row.job_id,
                    title: row.title || "",
                    user_skills: row.user_skills || "",
                    user_location: row.user_location || "",
                    relevance_score: row.relevance_score || ""
                });
            })
            .on("end", () => {
                candidates.sort(
                    (a, b) =>
                        Number(b.relevance_score) -
                        Number(a.relevance_score)
                );

                res.json({
                    success: true,
                    jobId,
                    count: Math.min(candidates.length, limit),
                    candidates: candidates.slice(0, limit)
                });
            })
            .on("error", error => {
                console.error(
                    "CSV candidate matching error:",
                    error.message
                );

                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        error: "Unable to read candidate matches"
                    });
                }
            });
    }
);

// 5. MongoDB connection test (recruiters only)
app.get(
    "/api/db-test",
    protect,
    allowRoles("recruiter"),
    async (req, res) => {
        try {
            const result = await mongoose.connection.db.admin().ping();

            res.json({
                success: true,
                message: "TalentMatch is connected to MongoDB",
                database: mongoose.connection.name,
                result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: "MongoDB diagnostic failed"
            });
        }
    }
);

// 6. Retire old registration endpoint.
// Use POST /api/auth/register instead.
app.post("/api/candidates/register", (req, res) => {
    res.status(410).json({
        success: false,
        message:
            "This registration endpoint has been retired. Use POST /api/auth/register."
    });
});

// 7. Registered candidates (recruiters only)
app.get(
    "/api/candidates",
    protect,
    allowRoles("recruiter"),
    async (req, res) => {
        try {
            const candidates = await Candidate.find()
                .select("name email education experience skills location createdAt")
                .sort({ createdAt: -1 })
                .limit(100);

            res.json({
                success: true,
                count: candidates.length,
                candidates
            });
        } catch (error) {
            console.error(
                "MongoDB candidates error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not retrieve candidates."
            });
        }
    }
);

// 8. Connect to MongoDB, then start the server
connectDB()
    .then(() => {
        app.listen(PORT, () => {
            console.log(
                `TalentMatch running at http://localhost:${PORT}`
            );
        });
    })
    .catch(error => {
        console.error("Server startup failed:", error.message);
        process.exit(1);
    });
