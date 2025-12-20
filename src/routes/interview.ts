import { Router } from "express";
import {
  uploadResume,
  generateAnswer,
  createInterview,
  deleteInterviewById,
  fetchInterviewsByEmail,
} from "../controllers/interview";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.post("/upload-resume", authenticate, uploadResume);
router.post("/generate-answer", authenticate, generateAnswer);
router.post("/interview", authenticate, createInterview);
router.get("/interviews", authenticate, fetchInterviewsByEmail);
router.delete("/interview/:id", authenticate, deleteInterviewById);

export default router;
