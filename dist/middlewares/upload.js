"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const os_1 = require("os");
exports.upload = (0, multer_1.default)({
    dest: (0, os_1.tmpdir)(),
    limits: { fileSize: 5 * 1024 * 1024 },
});
