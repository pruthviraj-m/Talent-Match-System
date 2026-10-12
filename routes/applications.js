const express = require("express");
const mongoose = require("mongoose");

const Application = require("../models/application");
const Candidate = require("../models/candidate");
const Job = require("../models/Job");
const { protect, allowRoles } = require("../middleware/auth");

const router = express.Router();

const validId = (id) => mongoose.isValidObjectId(id);

const validStatuses = [
  "Pending",
  "Under Review",
  "Shortlisted",
  "Rejected",
  "Accepted",
];

// GET: Candidates see their own applications.
// Recruiters can view applications, optionally filtered by job.
router.get("/", protect, async (req, res) => {
  try {
    const filter = {};

    if (req.user.role === "candidate") {
      if (!req.user.candidateId) {
        return res.status(403).json({
          success: false,
          message: "No candidate profile is linked to this account.",
        });
      }

      filter.candidate = req.user.candidateId;
    } else if (req.query.candidateId) {
      if (!validId(req.query.candidateId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid candidate ID",
        });
      }

      filter.candidate = req.query.candidateId;
    }

    if (req.query.jobId) {
      if (!validId(req.query.jobId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid job ID",
        });
      }

      filter.job = req.query.jobId;
    }

    const applications = await Application.find(filter)
      .populate("candidate", "name email skills education experience location")
      .populate("job", "title company location requiredSkills")
      .sort({ appliedAt: -1 })
      .limit(200);

    return res.json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error("Retrieve applications error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve applications",
    });
  }
});

// POST: Authenticated candidates apply using their linked profile.
router.post("/", protect, allowRoles("candidate"), async (req, res) => {
  try {
    const candidateId = req.user.candidateId;
    const { jobId } = req.body;

    if (!candidateId) {
      return res.status(403).json({
        success: false,
        message: "No candidate profile is linked to this account.",
      });
    }

    if (!jobId || !validId(jobId)) {
      return res.status(400).json({
        success: false,
        message: "A valid job ID is required.",
      });
    }

    const [candidate, job] = await Promise.all([
      Candidate.findById(candidateId),
      Job.findOne({ _id: jobId, isActive: true }),
    ]);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate profile not found.",
      });
    }

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Active job not found.",
      });
    }

    const application = await Application.create({
      candidate: candidate._id,
      job: job._id,
    });

    const populatedApplication = await Application.findById(application._id)
      .populate("candidate", "name email skills")
      .populate("job", "title company location requiredSkills");

    return res.status(201).json({
      success: true,
      message: "Application submitted successfully.",
      application: populatedApplication,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "You have already applied to this job.",
      });
    }

    console.error("Submit application error:", error.message);

    return res.status(400).json({
      success: false,
      message: "Could not submit application.",
    });
  }
});

// PATCH: Recruiters alone can update application status.
router.patch(
  "/:id/status",
  protect,
  allowRoles("recruiter"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!validId(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid application ID",
        });
      }

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
          allowedStatuses: validStatuses,
        });
      }

      const application = await Application.findByIdAndUpdate(
        id,
        { $set: { status } },
        { new: true, runValidators: true },
      )
        .populate("candidate", "name email")
        .populate("job", "title company");

      if (!application) {
        return res.status(404).json({
          success: false,
          message: "Application not found",
        });
      }

      return res.json({
        success: true,
        message: "Application status updated successfully",
        application,
      });
    } catch (error) {
      console.error("Update application error:", error.message);

      return res.status(400).json({
        success: false,
        message: "Could not update application.",
      });
    }
  },
);

module.exports = router;
