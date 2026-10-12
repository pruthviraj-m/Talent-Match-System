
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Candidate = require("./models/candidate");
const Job = require("./models/job");

const OUTPUT = path.join(__dirname, "results");
const DEMO_EMAIL = /^demo\.candidate\d+@talentmatch\.test$/;
const DEMO_COMPANY = /^Dataset Company \d+$/;

function normalize(skills) {
  return [...new Set(
    (Array.isArray(skills) ? skills : [])
      .filter(s => typeof s === "string" && s.trim())
      .map(s => s.trim().toLowerCase())
  )];
}

function match(candidate, job) {
  const candidateSkills = new Set(normalize(candidate.skills));
  const required = normalize(job.requiredSkills);
  const matched = required.filter(s => candidateSkills.has(s));
  const missing = required.filter(s => !candidateSkills.has(s));

  return {
    candidate: candidate.name,
    candidateEmail: candidate.email,
    job: job.title,
    company: job.company,
    location: job.location,
    candidateSkills: normalize(candidate.skills).join("; "),
    requiredSkills: required.join("; "),
    matchedSkills: matched.join("; "),
    missingSkills: missing.join("; "),
    matchedSkillCount: matched.length,
    totalRequiredSkills: required.length,
    matchPercentage: required.length
      ? Number((matched.length / required.length * 100).toFixed(2))
      : 0
  };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI missing from .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const candidates = await Candidate.find({
    email: DEMO_EMAIL
  }).lean();

  const jobs = await Job.find({
    company: DEMO_COMPANY,
    isActive: true
  }).lean();

  if (candidates.length !== 25 || jobs.length !== 25) {
    throw new Error(
      `Expected 25 candidates and 25 jobs; found ${candidates.length} and ${jobs.length}`
    );
  }

  const pairs = [];
  for (const candidate of candidates) {
    for (const job of jobs) {
      pairs.push(match(candidate, job));
    }
  }

  pairs.sort((a, b) =>
    b.matchPercentage - a.matchPercentage ||
    a.candidate.localeCompare(b.candidate) ||
    a.job.localeCompare(b.job)
  );

  const demandedSkills = {};
  const candidateSkills = {};

  for (const job of jobs) {
    for (const skill of normalize(job.requiredSkills)) {
      demandedSkills[skill] = (demandedSkills[skill] || 0) + 1;
    }
  }

  for (const candidate of candidates) {
    for (const skill of normalize(candidate.skills)) {
      candidateSkills[skill] = (candidateSkills[skill] || 0) + 1;
    }
  }

  const scores = pairs.map(p => p.matchPercentage);
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;

  const summary = {
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    jobCount: jobs.length,
    candidateJobPairs: pairs.length,
    averageMatchPercentage: Number(average.toFixed(2)),
    matchesAtLeast70Percent: pairs.filter(p => p.matchPercentage >= 70).length,
    perfectMatches: pairs.filter(p => p.matchPercentage === 100).length,
    matchScoreDistribution: {
      "0-24": scores.filter(s => s < 25).length,
      "25-49": scores.filter(s => s >= 25 && s < 50).length,
      "50-69": scores.filter(s => s >= 50 && s < 70).length,
      "70-99": scores.filter(s => s >= 70 && s < 100).length,
      "100": scores.filter(s => s === 100).length
    },
    mostDemandedSkills: Object.entries(demandedSkills)
      .map(([skill, count]) => ({ skill, jobCount: count }))
      .sort((a, b) => b.jobCount - a.jobCount || a.skill.localeCompare(b.skill)),
    mostCommonCandidateSkills: Object.entries(candidateSkills)
      .map(([skill, count]) => ({ skill, candidateCount: count }))
      .sort((a, b) => b.candidateCount - a.candidateCount || a.skill.localeCompare(b.skill))
  };

  fs.mkdirSync(OUTPUT, { recursive: true });

  fs.writeFileSync(
    path.join(OUTPUT, "summary.json"),
    JSON.stringify(summary, null, 2)
  );

  fs.writeFileSync(
    path.join(OUTPUT, "all_match_results.csv"),
    [
      Object.keys(pairs[0]).join(","),
      ...pairs.map(row =>
        Object.values(row).map(value =>
          `"${String(value).replace(/"/g, '""')}"`
        ).join(",")
      )
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(OUTPUT, "top_25_matches.csv"),
    [
      Object.keys(pairs[0]).join(","),
      ...pairs.slice(0, 25).map(row =>
        Object.values(row).map(value =>
          `"${String(value).replace(/"/g, '""')}"`
        ).join(",")
      )
    ].join("\n")
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log("\nCreated results/summary.json");
  console.log("Created results/all_match_results.csv");
  console.log("Created results/top_25_matches.csv");
}

main()
  .catch(error => {
    console.error("Results generation failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
