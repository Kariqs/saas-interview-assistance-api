import { Request, Response } from "express";
import Stripe from "stripe";
import User from "../models/user";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover",
});

export const stripeWebhook = async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const userEmail = session.metadata?.userEmail;
    const minutesToAdd = Number(session.metadata?.minutes);
    const tier = session.metadata?.tier;

    if (!userEmail || !minutesToAdd || !tier) {
      console.error("Missing metadata:", session.metadata);
      return res.json({ received: true });
    }

    try {
      await User.findOneAndUpdate(
        { email: userEmail },
        {
          $inc: { remainingMinutes: minutesToAdd },
          $set: { tier },
        },
        { new: true }
      );

      console.log(
        `Updated ${userEmail}: +${minutesToAdd} minutes, tier = ${tier}`
      );
    } catch (err) {
      console.error("Failed to update user:", err);
    }
  }

  res.json({ received: true });
};
