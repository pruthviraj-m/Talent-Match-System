const express = require("express");

const Candidate = require("../models/candidate");
const Job = require("../models/job");
const Application = require("../models/application");
const { protect, allowRoles } = require("../middleware/auth");

const router = express.Router();

const APPLICATION_STATUSES = [
  "Pending",
  "Under Review",
  "Shortlisted",
  "Rejected",
  "Accepted",
];

function normalizeSkills(skills) {
  if (!Array.isArray(skills)) return [];

  return [
    ...new Set(
      skills
        .filter((skill) => typeof skill === "string" && skill.trim())
        .map((skill) => skill.trim().toLowerCase()),
    ),
  ];
}

// GET: Recruitment analytics summary (recruiters only).
router.get("/summary", protect, allowRoles("recruiter"), async (req, res) => {
  try {
    const [
      totalCandidates,
      totalActiveJobs,
      totalApplications,
      statusCounts,
      skillCounts,
      candidates,
      applications,
    ] = await Promise.all([
      Candidate.countDocuments(),

      Job.countDocuments({ isActive: true }),

      Application.countDocuments(),

      Application.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),

      Job.aggregate([
        { $match: { isActive: true } },
        { $unwind: "$requiredSkills" },
        {
          $project: {
            skill: {
              $toLower: {
                $trim: { input: "$requiredSkills" },
              },
            },
          },
        },
        { $match: { skill: { $ne: "" } } },
        {
          $group: {
            _id: "$skill",
            demandCount: { $sum: 1 },
          },
        },
        { $sort: { demandCount: -1, _id: 1 } },
        { $limit: 10 },
      ]),

      Candidate.find().select("skills").lean(),

      Application.find()
        .select("candidate job status")
        .populate("candidate", "skills")
        .populate("job", "requiredSkills")
        .lean(),
    ]);

    // Include all defined statuses, including those with zero applications.
    const statusMap = Object.fromEntries(
      APPLICATION_STATUSES.map((status) => [status, 0]),
    );

    for (const item of statusCounts) {
      if (Object.prototype.hasOwnProperty.call(statusMap, item._id)) {
        statusMap[item._id] = item.count;
      }
    }

    const mostDemandedSkills = skillCounts.map((item) => ({
      skill: item._id,
      demandCount: item.demandCount,
    }));

    // Calculate skill match scores for applications.
    const matchScores = [];

    for (const application of applications) {
      if (!application.candidate || !application.job) continue;

      const candidateSkills = new Set(
        normalizeSkills(application.candidate.skills),
      );

      const requiredSkills = normalizeSkills(application.job.requiredSkills);

      const matchedCount = requiredSkills.filter((skill) =>
        candidateSkills.has(skill),
      ).length;

      const score = requiredSkills.length
        ? Number(((matchedCount / requiredSkills.length) * 100).toFixed(2))
        : 0;

      matchScores.push(score);
    }

    const averageMatchScore = matchScores.length
      ? Number(
          (
            matchScores.reduce((sum, score) => sum + score, 0) /
            matchScores.length
          ).toFixed(2),
        )
      : null;

    const highMatchApplications = matchScores.filter(
      (score) => score >= 70,
    ).length;

    // Count skills across candidate profiles.
    const candidateSkillFrequency = {};

    for (const candidate of candidates) {
      for (const skill of normalizeSkills(candidate.skills)) {
        candidateSkillFrequency[skill] =
          (candidateSkillFrequency[skill] || 0) + 1;
      }
    }

    const mostCommonCandidateSkills = Object.entries(candidateSkillFrequency)
      .map(([skill, candidateCount]) => ({
        skill,
        candidateCount,
      }))
      .sort(
        (a, b) =>
          b.candidateCount - a.candidateCount || a.skill.localeCompare(b.skill),
      )
      .slice(0, 10);

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),

      overview: {
        totalCandidates,
        totalActiveJobs,
        totalApplications,
      },

      applicationStatusDistribution: APPLICATION_STATUSES.map((status) => ({
        status,
        count: statusMap[status],
      })),

      mostDemandedSkills,

      mostCommonCandidateSkills,

      skillMatchAnalytics: {
        applicationsWithCalculableMatch: matchScores.length,
        averageMatchScore,
        applicationsWithMatchAtLeast70Percent: highMatchApplications,
        matchThresholdPercent: 70,
      },
    });
  } catch (error) {
    console.error("Analytics error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not generate recruitment analytics",
    });
  }
});

module.exports = router;
