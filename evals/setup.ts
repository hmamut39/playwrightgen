import { config } from "dotenv";

// Evals call a real provider, so they need the same local secrets the app uses.
// Loaded here rather than in each eval so a missing file degrades to "skipped"
// instead of a confusing authentication error.
config({ path: ".env.local", quiet: true });
