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
import { functions, inngest } from "./inngest";

// Create Inngest handler
const inngestHandler = serve({
  client: inngest,
  functions,
});

const app = new Elysia()
  .use(cors())
  .use(getCoinsRoute)
  .use(cryptoMoversRoutes)
  .use(cryptoCacheRoutes)
  .use(buybackWalletRoutes)
  .use(triggerSnapshotRoute)
  .use(commentsRoutes)
  .use(activityRoutes)
  .all("/inngest", ({ request }) => inngestHandler(request))
  .get("/", () => "Hello Elysia")
  .listen(process.env.PORT || 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
