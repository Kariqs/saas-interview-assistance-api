import { Router } from "express";
import { authenticate } from "../middlewares/auth";
import {
  createCheckoutSession,
  stripeCancel,
  stripeSuccess,
} from "../controllers/payment";

const router = Router();

router.post("/create-checkout-session", authenticate, createCheckoutSession);
router.get("/stripe-success", stripeSuccess); 
router.get("/stripe-cancel", stripeCancel); 

export default router;
