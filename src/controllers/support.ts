import { Request, Response } from "express";
import emailjs from "@emailjs/nodejs";
import { AuthenticatedRequest } from "../middlewares/auth";

emailjs.init({
  publicKey: process.env.EMAILJS_PUBLIC_KEY,
  privateKey: process.env.EMAILJS_PRIVATE_KEY,
});

const SERVICE_ID = process.env.EMAILJS_SERVICE_ID!;
const TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID!;

export const submitSupportRequest = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const { name, phone, message } = req.body;

    if (!name || !message) {
      res.status(400).json({
        message: "Name and message are required",
      });
      return;
    }

    const templateParams = {
      name: name.trim(),
      email: email.trim(),
      phone: phone?.trim() || "Not provided",
      message: message.trim(),
    };

    await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams);

    console.log(`Support request received from ${name} <${email}>`);

    res.status(200).json({ message: "Message sent successfully" });
  } catch (error: any) {
    console.error("Error sending support email:", error);
    res.status(500).json({
      message: "Failed to send message. Please try again later.",
    });
  }
};
