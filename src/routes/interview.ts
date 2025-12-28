import { Router } from "express";
import {
  uploadResume,
  generateAnswer,
  createInterview,
  deleteInterviewById,
  fetchInterviewsByEmail,
  heartBeat,
  deductPartial,
} from "../controllers/interview";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.post("/upload-resume", authenticate, uploadResume);
router.post("/generate-answer", authenticate, generateAnswer);
router.post("/interview", authenticate, createInterview);
router.get("/interviews", authenticate, fetchInterviewsByEmail);
router.delete("/interview/:id", authenticate, deleteInterviewById);
router.post("/heartbeat", authenticate, heartBeat);
router.post("/deduct-partial", authenticate, deductPartial);

export default router;
