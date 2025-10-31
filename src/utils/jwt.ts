import jwt, { Secret, SignOptions } from "jsonwebtoken";

const jwtSecret: Secret = process.env.JWT_SECRET || "default_secret";
const expiresIn: SignOptions["expiresIn"] = (process.env.JWT_EXPIRES_IN ||
  "1d") as SignOptions["expiresIn"];

export const generateToken = (username: string, email: string): string => {
  return jwt.sign({ username, email }, jwtSecret, {
    expiresIn: expiresIn,
  });
};

export const verifyToken = (token: string) => {
  try {
    return jwt.verify(token, jwtSecret);
  } catch (err) {
    return null;
  }
};
