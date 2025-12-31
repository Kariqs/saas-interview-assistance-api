import { Request, Response } from "express";
import Stripe from "stripe";
import { AuthenticatedRequest } from "../middlewares/auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover",
});

type PackageConfig = {
  minutes: number;
  tier: string;
};

const PRICE_CONFIG: Record<string, PackageConfig> = {
  price_1SjFBJFZ79d2YXeIwfCf9zb5: {
    minutes: 60,
    tier: "1hour",
  },
  price_1SjFCMFZ79d2YXeIbHoPAvU5: {
    minutes: 120,
    tier: "2hour",
  },
  price_1SjFCwFZ79d2YXeIQKvjLo3d: {
    minutes: 180,
    tier: "3hour",
  },
};

export const createCheckoutSession = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const { priceId } = req.body;
  const userEmail = req.user?.email;

  if (!priceId) {
    return res.status(400).json({ error: "priceId is required" });
  }

  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const config = PRICE_CONFIG[priceId];

  if (!config) {
    return res.status(400).json({ error: "Invalid priceId" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: userEmail,

      metadata: {
        userEmail,
        minutes: String(config.minutes),
        tier: config.tier,
      },

      success_url: `${process.env.FRONTEND_URL}/stripe-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/stripe-cancel`,
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    res.status(500).json({ error: "Checkout failed" });
  }
};

export const stripeSuccess = (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful - KrackAI</title>
      <meta http-equiv="refresh" content="3;url=krackai://success" />
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { 
          margin: 0; 
          height: 100vh; 
          background: linear-gradient(135deg, #0a0a0a 0%, #121212 100%); 
          color: white; 
          font-family: 'Inter', sans-serif; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
        }
        .container { 
          text-align: center; 
          padding: 70px 50px; 
          background: rgba(18, 18, 18, 0.7); 
          backdrop-filter: blur(24px); 
          border-radius: 32px; 
          border: 1px solid rgba(6, 182, 212, 0.4); 
          box-shadow: 0 30px 60px rgba(6, 182, 212, 0.2); 
          max-width: 550px; 
          animation: fadeIn 1.2s ease-out; 
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .icon { 
          width: 140px; 
          height: 140px; 
          margin: 0 auto 40px; 
          background: rgba(6, 182, 212, 0.25); 
          border-radius: 50%; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          animation: pulseGlow 2.5s infinite; 
          border: 2px solid rgba(6, 182, 212, 0.5);
        }
        @keyframes pulseGlow { 
          0% { box-shadow: 0 0 0 0 rgba(6, 182, 212, 0.4); } 
          70% { box-shadow: 0 0 0 40px rgba(6, 182, 212, 0); } 
          100% { box-shadow: 0 0 0 0 rgba(6, 182, 212, 0); } 
        }
        svg { width: 80px; height: 80px; stroke: #06b6d4; stroke-width: 3; }
        h1 { font-size: 42px; margin: 0 0 24px; color: #06b6d4; font-weight: 700; }
        p { font-size: 20px; margin: 16px 0; color: #e0e0e0; line-height: 1.6; }
        .highlight { color: #06b6d4; font-weight: 600; }
        a { color: #06b6d4; text-decoration: none; font-weight: 700; border-bottom: 2px solid; padding-bottom: 2px; }
        a:hover { color: #0891b2; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1>Payment Successful!</h1>
        <p>Your <span class="highlight">interview credits</span> have been added to your account.</p>
        <p>You're all set to continue practicing with KrackAI.</p>
        <p>Returning to the app in 3 seconds...</p>
        <p>If not redirected, <a href="krackai://success">click here to return</a>.</p>
      </div>
    </body>
    </html>
  `);
};

export const stripeCancel = (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Canceled - KrackAI</title>
      <meta http-equiv="refresh" content="4;url=krackai://cancel" />
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { 
          margin: 0; 
          height: 100vh; 
          background: linear-gradient(135deg, #0a0a0a 0%, #121212 100%); 
          color: white; 
          font-family: 'Inter', sans-serif; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
        }
        .container { 
          text-align: center; 
          padding: 70px 50px; 
          background: rgba(18, 18, 18, 0.7); 
          backdrop-filter: blur(24px); 
          border-radius: 32px; 
          border: 1px solid rgba(251, 146, 60, 0.4); 
          box-shadow: 0 30px 60px rgba(251, 146, 60, 0.15); 
          max-width: 550px; 
          animation: fadeIn 1.2s ease-out; 
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .icon { 
          width: 140px; 
          height: 140px; 
          margin: 0 auto 40px; 
          background: rgba(251, 146, 60, 0.25); 
          border-radius: 50%; 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          border: 2px solid rgba(251, 146, 60, 0.5);
        }
        svg { width: 80px; height: 80px; stroke: #fb923c; stroke-width: 3; }
        h1 { font-size: 42px; margin: 0 0 24px; color: #fb923c; font-weight: 700; }
        p { font-size: 20px; margin: 16px 0; color: #e0e0e0; line-height: 1.6; }
        a { color: #fb923c; text-decoration: none; font-weight: 700; border-bottom: 2px solid; padding-bottom: 2px; }
        a:hover { color: #f97316; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1>Payment Canceled</h1>
        <p>No credits were charged to your account.</p>
        <p>You can try purchasing again anytime in KrackAI.</p>
        <p>Returning to the app in 4 seconds...</p>
        <p>If not redirected, <a href="krackai://cancel">click here to return</a>.</p>
      </div>
    </body>
    </html>
  `);
};
