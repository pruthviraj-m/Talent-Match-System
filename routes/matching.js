
const express = require("express");
const mongoose = require("mongoose");

const Candidate = require("../models/candidate");
const Job = require("../models/Job");
const { protect, allowRoles } = require("../middleware/auth");

const router = express.Router();

// Normalize skills so "Node.js" and "node.js" match.
function normalizeSkills(skills) {
  if (!Array.isArray(skills)) return [];

  return [
    ...new Set(
      skills
        .filter(skill => typeof skill === "string" && skill.trim())
        .map(skill => skill.trim().toLowerCase())
    )
  ];
}

// Calculate the skill match percentage.
function calculateMatch(candidateSkills, requiredSkills) {
  const candidateSet = new Set(normalizeSkills(candidateSkills));
  const required = normalizeSkills(requiredSkills);

  const matchedSkills = required.filter(skill => candidateSet.has(skill));
  const missingSkills = required.filter(skill => !candidateSet.has(skill));

  const matchPercentage = required.length
    ? Number(((matchedSkills.length / required.length) * 100).toFixed(2))
    : 0;

  return {
    matchPercentage,
    matchedSkills,
    missingSkills,
    totalRequiredSkills: required.length,
    matchedSkillCount: matchedSkills.length
  };
}

// GET: Rank candidates for a job (recruiters only).
router.get(
  "/jobs/:jobId/candidates",
  protect,
  allowRoles("recruiter"),
  async (req, res) => {
    try {
      const { jobId } = req.params;

      if (!mongoose.isValidObjectId(jobId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid job ID"
        });
      }

      const job = await Job.findOne({
        _id: jobId,
        isActive: true
      });

      if (!job) {
        return res.status(404).json({
          success: false,
          message: "Active job not found"
        });
      }

      const candidates = await Candidate.find()
        .select("name email education experience skills location")
        .lean();

      const rankedCandidates = candidates
        .map(candidate => ({
          candidate,
          ...calculateMatch(candidate.skills, job.requiredSkills)
        }))
        .sort((a, b) =>
          b.matchPercentage - a.matchPercentage ||
          a.candidate.name.localeCompare(b.candidate.name)
        );

      return res.json({
        success: true,
        job: {
          id: job._id,
          title: job.title,
          company: job.company,
          requiredSkills: normalizeSkills(job.requiredSkills)
        },
        totalCandidates: rankedCandidates.length,
        candidates: rankedCandidates
      });
    } catch (error) {
      console.error("Candidate matching error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not calculate candidate matches"
      });
    }
  }
);

// GET: Recommend active jobs for the logged-in candidate.
router.get(
  "/candidates/:candidateId/jobs",
  protect,
  allowRoles("candidate"),
  async (req, res) => {
    try {
      const { candidateId } = req.params;

      // Never allow a candidate to access another profile's recommendations.
      if (
        !req.user.candidateId ||
        req.user.candidateId !== candidateId
      ) {
        return res.status(403).json({
          success: false,
          message: "You can only view recommendations for your own profile."
        });
      }

      if (!mongoose.isValidObjectId(candidateId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid candidate ID"
        });
      }

      const candidate = await Candidate.findById(candidateId)
        .select("name skills education experience location")
        .lean();

      if (!candidate) {
        return res.status(404).json({
          success: false,
          message: "Candidate not found"
        });
      }

      const jobs = await Job.find({ isActive: true }).lean();

      const recommendations = jobs
        .map(job => ({
          job: {
            id: job._id,
            title: job.title,
            company: job.company,
            location: job.location,
            requiredSkills: normalizeSkills(job.requiredSkills),
            education: job.education,
            experience: job.experience
          },
          ...calculateMatch(candidate.skills, job.requiredSkills)
        }))
        .sort((a, b) =>
          b.matchPercentage - a.matchPercentage ||
          a.job.title.localeCompare(b.job.title)
        );

      return res.json({
        success: true,
        candidate: {
          id: candidate._id,
          name: candidate.name,
          skills: normalizeSkills(candidate.skills)
        },
        totalJobs: recommendations.length,
        recommendations
      });
    } catch (error) {
      console.error("Job recommendation error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not calculate job recommendations"
      });
    }
  }
);

module.exports = router;
