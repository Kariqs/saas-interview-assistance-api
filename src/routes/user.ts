import { Router } from "express";
import {
  login,
  createAccount,
  getUserByEmail,
  
} from "../controllers/user";
import { authenticate } from "../middlewares/auth";

const router = Router();

router.post("/signup", createAccount);
router.post("/login", login);
router.get("/user", authenticate, getUserByEmail);

export default router;
