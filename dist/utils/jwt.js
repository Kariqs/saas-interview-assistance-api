"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = exports.generateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwtSecret = process.env.JWT_SECRET || "default_secret";
const expiresIn = (process.env.JWT_EXPIRES_IN ||
    "1d");
const generateToken = (username, email) => {
    return jsonwebtoken_1.default.sign({ username, email }, jwtSecret, {
        expiresIn: expiresIn,
    });
};
exports.generateToken = generateToken;
const verifyToken = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, jwtSecret);
    }
    catch (err) {
        return null;
    }
};
exports.verifyToken = verifyToken;
