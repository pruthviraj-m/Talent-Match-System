
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Account = require("../models/Account");
const Candidate = require("../models/candidate");
const { protect } = require("../middleware/auth");

const router = express.Router();

function createToken(account) {
  return jwt.sign(
    {
      accountId: account._id.toString(),
      role: account.role,
      candidateId: account.candidate
        ? account.candidate.toString()
        : null,
      email: account.email
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function publicAccount(account) {
  return {
    id: account._id,
    email: account.email,
    role: account.role,
    candidateId: account.candidate || null
  };
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  let createdCandidate = null;

  try {
    const {
      name,
      email,
      password,
      role,
      recruiterInviteCode,
      education = "",
      experience = 0,
      skills = [],
      location = ""
    } = req.body;

    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address."
      });
    }

    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters."
      });
    }

    if (!["candidate", "recruiter"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be candidate or recruiter."
      });
    }

    if (role === "candidate") {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Candidate name is required."
        });
      }

      if (!Array.isArray(skills) ||
          !skills.every(skill => typeof skill === "string")) {
        return res.status(400).json({
          success: false,
          message: "Skills must be an array of strings."
        });
      }

      if (!Number.isFinite(Number(experience)) || Number(experience) < 0) {
        return res.status(400).json({
          success: false,
          message: "Experience must be a non-negative number."
        });
      }
    }

    if (role === "recruiter") {
      if (
        !process.env.RECRUITER_INVITE_CODE ||
        recruiterInviteCode !== process.env.RECRUITER_INVITE_CODE
      ) {
        return res.status(403).json({
          success: false,
          message: "A valid recruiter invite code is required."
        });
      }
    }

    const existingAccount = await Account.findOne({
      email: normalizedEmail
    });

    if (existingAccount) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let candidateId = null;

    if (role === "candidate") {
      // Reuse a legacy profile with this email instead of duplicating it.
      let candidate = await Candidate.findOne({
        email: normalizedEmail
      });

      if (candidate) {
        return res.status(409).json({
          success: false,
          message:
            "A candidate profile already exists with this email. Ask the administrator to link the existing profile."
        });
      }

      candidate = await Candidate.create({
        name: name.trim(),
        email: normalizedEmail,
        education: String(education).trim(),
        experience: Number(experience),
        skills: [...new Set(skills.map(skill => skill.trim()).filter(Boolean))],
        location: String(location).trim()
      });

      createdCandidate = candidate;
      candidateId = candidate._id;
    }

    let account;

    try {
      account = await Account.create({
        email: normalizedEmail,
        passwordHash,
        role,
        candidate: candidateId
      });
    } catch (error) {
      // Roll back the new profile if account creation fails.
      if (createdCandidate) {
        await Candidate.findByIdAndDelete(createdCandidate._id);
      }
      throw error;
    }

    const token = createToken(account);

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token,
      user: publicAccount(account)
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not create the account."
    });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const { password, role } = req.body;

    if (!email || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const account = await Account.findOne({ email }).select("+passwordHash");

    // Use the same response for incorrect email and password.
    if (!account || !(await bcrypt.compare(password, account.passwordHash))) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    if (role && account.role !== role) {
      return res.status(403).json({
        success: false,
        message: `This account is registered as a ${account.role}.`
      });
    }

    return res.json({
      success: true,
      message: "Login successful.",
      token: createToken(account),
      user: publicAccount(account)
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not log in."
    });
  }
});

// GET /api/auth/me
router.get("/me", protect, async (req, res) => {
  try {
    const account = await Account.findById(req.user.accountId);

    if (!account) {
      return res.status(401).json({
        success: false,
        message: "Account no longer exists."
      });
    }

    let candidate = null;

    if (account.role === "candidate" && account.candidate) {
      candidate = await Candidate.findById(account.candidate);
    }

    return res.json({
      success: true,
      user: publicAccount(account),
      candidate
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not retrieve account details."
    });
  }
});

module.exports = router;
