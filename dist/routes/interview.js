"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const interview_1 = require("../controllers/interview");
const router = (0, express_1.Router)();
router.post("/upload-resume", interview_1.uploadResume);
router.post("/generate-answer", interview_1.generateAnswer);
exports.default = router;
