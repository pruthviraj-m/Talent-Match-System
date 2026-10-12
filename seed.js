
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Candidate = require("./models/candidate");
const Job = require("./models/job");
const Account = require("./models/Account");

const CSV_PATH = path.join(
  __dirname,
  "data",
  "huge_job_recommendation_dataset.csv"
);

const DEMO_PASSWORD = "TalentDemo2026!";

function readCsvSample() {
  return new Promise((resolve, reject) => {
    const rows = [];
    const seenJobs = new Set();
    const seenCandidates = new Set();

    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on("data", row => {
        const title = (row.title || "").trim();
        const location = (row.location || row.user_location || "India").trim();
        const rawJobSkills = row.skills_required || "";
        const rawCandidateSkills = row.user_skills || "";

        if (title && rawJobSkills && rawCandidateSkills) {
          const jobKey = `${title.toLowerCase()}|${location.toLowerCase()}`;

          if (!seenJobs.has(jobKey) && seenJobs.size < 25) {
            seenJobs.add(jobKey);
          }

          const userId = (row.user_id || "").trim();
          if (userId && !seenCandidates.has(userId) &&
              seenCandidates.size < 25) {
            seenCandidates.add(userId);
          }

          rows.push({
            title,
            location,
            rawJobSkills,
            rawCandidateSkills,
            education: (row.education || "").trim(),
            experience: Number(row.experience) || 0,
            userId,
            jobId: (row.job_id || "").trim()
          });
        }
      })
      .on("end", () => {
        // Use distinct candidate identifiers and job identifiers
        // from the actual CSV rows.
        const jobs = [];
        const candidates = [];
        const jobKeys = new Set();
        const candidateKeys = new Set();

        for (const row of rows) {
          const jobKey = `${row.title.toLowerCase()}|${row.location.toLowerCase()}`;
          if (!jobKeys.has(jobKey) && jobs.length < 25) {
            jobKeys.add(jobKey);
            jobs.push(row);
          }

          if (row.userId && !candidateKeys.has(row.userId) &&
              candidates.length < 25) {
            candidateKeys.add(row.userId);
            candidates.push(row);
          }

          if (jobs.length === 25 && candidates.length === 25) break;
        }

        resolve({ jobs, candidates });
      })
      .on("error", reject);
  });
}

function parseSkills(value) {
  return [...new Set(
    String(value || "")
      .split(/[,;|]/)
      .map(s => s.trim())
      .filter(Boolean)
  )].slice(0, 30);
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB Atlas.");

  const { jobs, candidates } = await readCsvSample();

  if (jobs.length < 25 || candidates.length < 25) {
    throw new Error(
      `CSV did not provide enough distinct usable records. Jobs: ${jobs.length}, candidates: ${candidates.length}`
    );
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  let candidatesAdded = 0;
  let accountsAdded = 0;
  let jobsAdded = 0;

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const email = `demo.candidate${String(i + 1).padStart(2, "0")}@talentmatch.test`;

    const candidateData = {
      name: `Dataset Candidate ${String(i + 1).padStart(2, "0")}`,
      email,
      education: row.education || "Not specified",
      experience: Math.max(0, row.experience),
      skills: parseSkills(row.rawCandidateSkills),
      location: row.location || "Not specified"
    };

    const candidate = await Candidate.findOneAndUpdate(
      { email },
      { $set: candidateData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    candidatesAdded++;

    const existingAccount = await Account.findOne({ email });

    if (!existingAccount) {
      await Account.create({
        email,
        passwordHash,
        role: "candidate",
        candidate: candidate._id
      });
      accountsAdded++;
    } else {
      await Account.updateOne(
        { _id: existingAccount._id },
        { $set: { candidate: candidate._id } }
      );
    }
  }

  for (let i = 0; i < jobs.length; i++) {
    const row = jobs[i];
    const requiredSkills = parseSkills(row.rawJobSkills);

    if (!requiredSkills.length) continue;

    const jobData = {
      title: row.title,
      company: `Dataset Company ${String(i + 1).padStart(2, "0")}`,
      description: `Sample job posting derived from the recommendation dataset. Required skills: ${requiredSkills.join(", ")}.`,
      location: row.location || "Not specified",
      requiredSkills,
      education: row.education || "Not specified",
      experience: Math.max(0, row.experience),
      isActive: true
    };

    await Job.findOneAndUpdate(
      { title: jobData.title, location: jobData.location, company: jobData.company },
      { $set: jobData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    jobsAdded++;
  }

  console.log("\nSeed completed.");
  console.log(`Candidate profiles processed: ${candidatesAdded}`);
  console.log(`Candidate accounts created: ${accountsAdded}`);
  console.log(`Job postings processed: ${jobsAdded}`);
  console.log(`Demo candidate password: ${DEMO_PASSWORD}`);
  console.log("Demo emails: demo.candidate01@talentmatch.test through demo.candidate25@talentmatch.test");
}

main()
  .catch(error => {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
