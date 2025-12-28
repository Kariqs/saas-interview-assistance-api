import { Request, Response } from "express";
import User from "../models/user";
import {
  decryptPassword as comparePassword,
  encryptPassword as hashPassword,
} from "../utils/hash";
import { generateToken } from "../utils/jwt";
import { AuthenticatedRequest } from "../middlewares/auth";

export const createAccount = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { username, email, password } = req.body;

    const usernameExists = await User.findOne({ username: username });
    const emailExists = await User.findOne({ email: email });

    if (usernameExists) {
      res
        .status(400)
        .json({ message: "User with this username already exists" });
      return;
    }

    if (emailExists) {
      res.status(400).json({ message: "User with this email already exists" });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const newUser = new User({
      username: username,
      email: email,
      password: hashedPassword,
    });
    const savedUser = await newUser.save();
    const createdUser = {
      username: savedUser.username,
      email: savedUser.email,
    };
    res.status(201).json({
      message: "User created successfully.",
      user: createdUser,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({ message: "Error creating user" });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const userExists = await User.findOne({ email: email });
    if (!userExists) {
      res.status(404).json({ message: "Incorrect username or password" });
      return;
    }
    const passwordMatches = await comparePassword(
      password,
      userExists.password
    );
    if (!passwordMatches) {
      res.status(404).json({ message: "Incorrect username or password" });
      return;
    }

    const token = generateToken({
      username: userExists.username,
      email: userExists.email,
    });
    res.status(200).json({
      message: "Login was successful.",
      user: {
        username: userExists.username,
        email: userExists.email,
      },
      token: token,
      remainingMinutes: userExists.remainingMinutes,
      tier: userExists.tier,
      hasUsedFreeTier: userExists.hasUsedFreeTier,
    });
  } catch (error) {
    console.log(error);
    res.status(400).json({ message: "Error occured while trying to log in." });
  }
};

export const getUserByEmail = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(400).json({ message: "Unauthorized." });
    }
    const user = await User.findOne({ email }).select("-password");
    return res.status(200).json({
      message: "User fetched successfully.",
      user: user,
    });
  } catch (error) {
    console.error("Error fetching interviews", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

