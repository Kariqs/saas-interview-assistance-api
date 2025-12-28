import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  activationKey?: string;
  accountActivated: boolean;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  tier: "free" | "1hour" | "2hour" | "3hour";
  consumedMinutes: number;
  remainingMinutes: number;
  hasUsedFreeTier: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    activationKey: { type: String },
    accountActivated: {
      type: Boolean,
      default: false,
    },
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },

    tier: {
      type: String,
      enum: ["free", "1hour", "2hour", "3hour"],
      default: "free",
    },
    consumedMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingMinutes: {
      type: Number,
      default: 15,
      min: 0,
    },
    hasUsedFreeTier: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", function (next) {
  next();
});

const User = mongoose.model<IUser>("User", userSchema);

export default User;
