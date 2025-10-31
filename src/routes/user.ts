import { Router } from "express";
import { login, createAccount } from "../controllers/user";

const router = Router();

router.post("/signup", createAccount);
router.post("/login", login);

export default router;
