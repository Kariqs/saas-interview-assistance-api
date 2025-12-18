"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = exports.createAccount = void 0;
const user_1 = __importDefault(require("../models/user"));
const hash_1 = require("../utils/hash");
const jwt_1 = require("../utils/jwt");
const createAccount = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const usernameExists = await user_1.default.findOne({ username: username });
        const emailExists = await user_1.default.findOne({ email: email });
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
        const hashedPassword = await (0, hash_1.encryptPassword)(password);
        const newUser = new user_1.default({
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
    }
    catch (error) {
        console.log(error);
        res.status(400).json({ message: "Error creating user" });
    }
};
exports.createAccount = createAccount;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const userExists = await user_1.default.findOne({ email: email });
        if (!userExists) {
            res.status(404).json({ message: "Incorrect username or password" });
            return;
        }
        const passwordMatches = await (0, hash_1.decryptPassword)(password, userExists.password);
        if (!passwordMatches) {
            res.status(404).json({ message: "Incorrect username or password" });
            return;
        }
        const token = (0, jwt_1.generateToken)(userExists.username, userExists.email);
        res.status(200).json({
            message: "Login was successful.",
            user: {
                username: userExists.username,
                email: userExists.email,
            },
            token: token,
        });
    }
    catch (error) {
        console.log(error);
        res.status(400).json({ message: "Error occured while trying to log in." });
    }
};
exports.login = login;
