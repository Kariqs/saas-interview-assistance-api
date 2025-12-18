import { Router } from "express";
import { uploadResume, generateAnswer } from "../controllers/interview";

const router = Router();

router.post("/upload-resume", uploadResume);
router.post("/generate-answer", generateAnswer);

export default router;
