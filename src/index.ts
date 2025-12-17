import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { serve } from "inngest/bun";
import { getCoinsRoute } from "./routes/getCoints";
import { cryptoMoversRoutes } from "./routes/crypto-movers";
import { buybackWalletRoutes } from "./routes/buyback-wallet";
import { functions, inngest } from "./inngest";

// Inngest handler
const inngestHandler = serve({ client: inngest, functions });
const inngestRoute = new Elysia().all("/inngest", ({ request }) => inngestHandler(request));

const app = new Elysia()
  .use(cors())
  .use(getCoinsRoute)
  .use(cryptoMoversRoutes)
  .use(buybackWalletRoutes)
  .use(inngestRoute)
  .get("/", () => "Hello Elysia")
  .listen(process.env.PORT || 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
