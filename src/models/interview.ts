import mongoose, { Schema, Document } from "mongoose";

export interface IInterview {
  userEmail: string;
  date: Date;
  timeTaken: number;
}

const interviewSchema = new Schema<IInterview>(
  {
    userEmail: { type: String, required: true},
    date: { type: Date, required: true },
    timeTaken: { type: Number, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const Interview = mongoose.model<IInterview>("Interview", interviewSchema);

export default Interview;
