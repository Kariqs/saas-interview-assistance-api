import "dotenv/config";
import express, { Application } from "express";
import userRoutes from "./routes/user";
import connectDB from "./config/db";
import morgan from "morgan";
import cors from "cors";

const app: Application = express();
const port = process.env.PORT || 3000;

const allowedOrigins = ["http://localhost:4200", "app://."];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"), false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(morgan("combined"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(userRoutes);

connectDB().then(() => {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});
function callback(arg0: null, arg1: boolean) {
  throw new Error("Function not implemented.");
}
