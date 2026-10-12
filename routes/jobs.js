const express = require("express");
const mongoose = require("mongoose");
const Job = require("../models/job");
const { protect, allowRoles } = require("../middleware/auth");

const router = express.Router();

// Escape special regex characters in search inputs.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET: View active jobs (public browsing).
router.get("/", async (req, res) => {
  try {
    const { search, location } = req.query;
    const filter = { isActive: true };

    if (search && typeof search === "string") {
      const safeSearch = escapeRegex(search);

      filter.$or = [
        { title: { $regex: safeSearch, $options: "i" } },
        { company: { $regex: safeSearch, $options: "i" } },
        { requiredSkills: { $regex: safeSearch, $options: "i" } },
      ];
    }

    if (location && typeof location === "string") {
      filter.location = {
        $regex: escapeRegex(location),
        $options: "i",
      };
    }

    const jobs = await Job.find(filter).sort({ createdAt: -1 });

    return res.json({
      success: true,
      count: jobs.length,
      jobs,
    });
  } catch (error) {
    console.error("Retrieve jobs error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve jobs",
    });
  }
});

// GET: View one active job (public browsing).
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID",
      });
    }

    const job = await Job.findOne({
      _id: id,
      isActive: true,
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    return res.json({ success: true, job });
  } catch (error) {
    console.error("Retrieve job error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve job",
    });
  }
});

// POST: Create a job (recruiters only).
router.post("/", protect, allowRoles("recruiter"), async (req, res) => {
  try {
    const {
      title,
      company,
      description,
      location,
      requiredSkills,
      education,
      experience,
    } = req.body;

    if (
      typeof title !== "string" ||
      !title.trim() ||
      typeof company !== "string" ||
      !company.trim() ||
      typeof description !== "string" ||
      !description.trim() ||
      typeof location !== "string" ||
      !location.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Title, company, description and location are required",
      });
    }

    if (
      !Array.isArray(requiredSkills) ||
      requiredSkills.length === 0 ||
      !requiredSkills.every(
        (skill) => typeof skill === "string" && skill.trim(),
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide requiredSkills as a non-empty array of strings",
      });
    }

    if (
      experience !== undefined &&
      (!Number.isFinite(Number(experience)) || Number(experience) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Experience must be a non-negative number",
      });
    }

    const job = await Job.create({
      title: title.trim(),
      company: company.trim(),
      description: description.trim(),
      location: location.trim(),
      requiredSkills: [...new Set(requiredSkills.map((skill) => skill.trim()))],
      education: typeof education === "string" ? education.trim() : "",
      experience: experience === undefined ? 0 : Number(experience),
    });

    return res.status(201).json({
      success: true,
      message: "Job created successfully",
      job,
    });
  } catch (error) {
    console.error("Create job error:", error.message);

    return res.status(400).json({
      success: false,
      message: "Could not create job",
      error: error.message,
    });
  }
});

// PUT: Update a job (recruiters only).
router.put("/:id", protect, allowRoles("recruiter"), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID",
      });
    }

    const allowedFields = [
      "title",
      "company",
      "description",
      "location",
      "requiredSkills",
      "education",
      "experience",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update",
      });
    }

    for (const field of ["title", "company", "description", "location"]) {
      if (
        updates[field] !== undefined &&
        (typeof updates[field] !== "string" || !updates[field].trim())
      ) {
        return res.status(400).json({
          success: false,
          message: `${field} must be a non-empty string`,
        });
      }

      if (typeof updates[field] === "string") {
        updates[field] = updates[field].trim();
      }
    }

    if (updates.requiredSkills !== undefined) {
      if (
        !Array.isArray(updates.requiredSkills) ||
        updates.requiredSkills.length === 0 ||
        !updates.requiredSkills.every(
          (skill) => typeof skill === "string" && skill.trim(),
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "requiredSkills must be a non-empty array of strings",
        });
      }

      updates.requiredSkills = [
        ...new Set(updates.requiredSkills.map((skill) => skill.trim())),
      ];
    }

    if (updates.experience !== undefined) {
      if (
        !Number.isFinite(Number(updates.experience)) ||
        Number(updates.experience) < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Experience must be a non-negative number",
        });
      }

      updates.experience = Number(updates.experience);
    }

    const job = await Job.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Active job not found",
      });
    }

    return res.json({
      success: true,
      message: "Job updated successfully",
      job,
    });
  } catch (error) {
    console.error("Update job error:", error.message);

    return res.status(400).json({
      success: false,
      message: "Could not update job",
      error: error.message,
    });
  }
});

// DELETE: Archive a job rather than permanently deleting it (recruiters only).
router.delete("/:id", protect, allowRoles("recruiter"), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid job ID",
      });
    }

    const job = await Job.findOneAndUpdate(
      { _id: id, isActive: true },
      { $set: { isActive: false } },
      { new: true },
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Active job not found",
      });
    }

    return res.json({
      success: true,
      message: "Job archived successfully",
    });
  } catch (error) {
    console.error("Archive job error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not archive job",
    });
  }
});

module.exports = router;
