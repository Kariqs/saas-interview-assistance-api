import cors from "cors";
import "dotenv/config";
import express, { Application } from "express";
import morgan from "morgan";
import connectDB from "./config/db";
import { initializeRealtimeWebSocket } from "./config/websoket";
import interviewRoutes from "./routes/interview";
import userRoutes from "./routes/user";
import supportRoutes from "./routes/support";

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
app.use(interviewRoutes);
app.use(supportRoutes);

connectDB().then(() => {
  const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
  initializeRealtimeWebSocket(server);
});
