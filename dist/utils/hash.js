"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptPassword = exports.encryptPassword = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const encryptPassword = async (password) => {
    return await bcryptjs_1.default.hash(password, 12);
};
exports.encryptPassword = encryptPassword;
const decryptPassword = async (password, encryptedPassword) => {
    return await bcryptjs_1.default.compare(password, encryptedPassword);
};
exports.decryptPassword = decryptPassword;
