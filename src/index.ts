import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { serve } from "inngest/bun";
import { getCoinsRoute } from "./routes/getCoints";
import { cryptoMoversRoutes } from "./routes/crypto-movers";
import { cryptoCacheRoutes } from "./routes/crypto-cache";
import { buybackWalletRoutes } from "./routes/buyback-wallet";
import { triggerSnapshotRoute } from "./routes/trigger-snapshot";
import { commentsRoutes } from "./routes/comments";
import { activityRoutes } from "./routes/activity";
import { coinSentimentRoutes } from "./routes/coin-sentiment";
import { userPredictionsRoutes } from "./routes/user-predictions";
import { resultsRoutes } from "./routes/results";
import { forecastRoutes } from "./routes/forecast";
import { configRoutes } from "./routes/config";
import { resolvePredictionRoutes } from "./routes/resolve-prediction";
import { resolvePredictionBatchRoutes } from "./routes/resolve-prediction-batch";
import { aiKeypairsRoutes } from "./routes/ai-keypairs";
import { aiPredictionsRoutes } from "./routes/ai-predictions";
import { coinDetailsRoutes } from "./routes/coin-details";
import { communityPredictionsRoutes } from "./routes/community-predictions";
import { functions, inngest } from "./inngest";

// Create Inngest handler
const inngestHandler = serve({
  client: inngest,
  functions,
});

const app = new Elysia()
  .use(cors())
  .use(coinSentimentRoutes)
  .use(getCoinsRoute)
  .use(cryptoMoversRoutes)
  .use(cryptoCacheRoutes)
  .use(buybackWalletRoutes)
  .use(triggerSnapshotRoute)
  .use(commentsRoutes)
  .use(activityRoutes)
  .use(userPredictionsRoutes)
  .use(resultsRoutes)
  .use(forecastRoutes)
  .use(configRoutes)
  .use(resolvePredictionRoutes)
  .use(resolvePredictionBatchRoutes)
  .use(aiKeypairsRoutes)
  .use(aiPredictionsRoutes)
  .use(coinDetailsRoutes)
  .use(communityPredictionsRoutes)
  .all("/inngest", ({ request }) => inngestHandler(request))
  .get("/", () => {
    return {
      message: "Welcome to FutureFrog API",
    };
  })
  .listen(process.env.PORT || 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
