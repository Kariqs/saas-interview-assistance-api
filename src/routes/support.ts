import { Router } from "express";
import { submitSupportRequest } from "../controllers/support";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.post("/support", authenticate, submitSupportRequest);

export default router;
